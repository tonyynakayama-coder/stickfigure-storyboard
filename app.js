(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const canvas = $('#stageCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const actorPalette = ['#ef5b38', '#2869d8', '#3b9a68', '#8a55c7', '#df9f14', '#d64178'];
  let nextActorId = 3;
  let nextSceneId = 3;
  let activeSceneId = 1;
  let activeActorId = 1;
  let tool = 'puppet';
  let ink = '#20231f';
  let brushSize = 5;
  let drawing = false;
  let dragging = false;
  let dragActor = null;
  let drawStart = null;
  let linePreview = null;
  let recording = false;
  let playing = false;
  let roughCutPlaying = false;
  let exporting = false;
  let playStartedAt = 0;
  let recordStartedAt = 0;
  let raf = null;
  let history = [];
  let draggedSceneId = null;

  const makeActor = (id, name, color, x, y) => ({
    id, name, color, x, y, facing: 1, phase: 0, track: [], recorded: false
  });

  const makeScene = (id, name, background, actors, duration = 4000) => ({
    id, name, background, actors, duration, drawing: null, thumb: null
  });

  let scenes = [
    makeScene(1, 'Hallway — wide shot', '#fbf9f2', [
      makeActor(1, 'Hero-ish', actorPalette[0], 330, 338),
      makeActor(2, 'Suspicious Pal', actorPalette[1], 640, 344)
    ]),
    makeScene(2, 'The awkward reveal', '#d9ecff', [
      makeActor(3, 'Hero-ish', actorPalette[0], 430, 345),
      makeActor(4, 'Suspicious Pal', actorPalette[1], 590, 345)
    ])
  ];
  nextActorId = 5;

  const scene = () => scenes.find(s => s.id === activeSceneId);
  const actor = () => scene().actors.find(a => a.id === activeActorId);
  const clone = (obj) => JSON.parse(JSON.stringify(obj));

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * W / rect.width,
      y: (event.clientY - rect.top) * H / rect.height
    };
  }

  function formatTime(ms) {
    const total = Math.max(0, ms) / 1000;
    return `0:${total.toFixed(1).padStart(4, '0')}`;
  }

  function drawGrid() {
    ctx.save();
    ctx.strokeStyle = 'rgba(50,50,45,.045)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.restore();
  }

  function drawBackdrop(s) {
    ctx.clearRect(0, 0, W, H);
    if (s.background !== 'transparent') {
      ctx.fillStyle = s.background;
      ctx.fillRect(0, 0, W, H);
    }
    drawGrid();
    if (s.drawing) {
      const img = new Image();
      img.src = s.drawing;
      if (img.complete) ctx.drawImage(img, 0, 0, W, H);
      else img.onload = render;
    }
  }

  function positionAt(a, time) {
    if (!a.track.length) return { x:a.x, y:a.y, facing:a.facing, phase:a.phase };
    if (time <= a.track[0].t) return a.track[0];
    const last = a.track[a.track.length - 1];
    if (time >= last.t) return last;
    for (let i = 1; i < a.track.length; i++) {
      if (a.track[i].t >= time) {
        const p = a.track[i - 1], n = a.track[i];
        const mix = (time - p.t) / Math.max(1, n.t - p.t);
        return {
          x: p.x + (n.x - p.x) * mix,
          y: p.y + (n.y - p.y) * mix,
          facing: n.facing,
          phase: p.phase + (n.phase - p.phase) * mix
        };
      }
    }
    return last;
  }

  function strokeLimb(points, color, width, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(p => ctx.lineTo(p[0], p[1]));
    ctx.stroke();
    ctx.restore();
  }

  function drawStick(a, pos, selected = false, alpha = 1) {
    const style = $('#poseStyle').value;
    const speed = style === 'hero' ? 1.45 : style === 'sneak' ? .65 : 1;
    const stride = Math.sin(pos.phase * speed) * (style === 'hero' ? 30 : style === 'sneak' ? 12 : 22);
    const bob = Math.abs(Math.sin(pos.phase * speed)) * (style === 'sneak' ? 3 : 7);
    const crouch = style === 'sneak' ? 17 : 0;
    const x = pos.x, ground = Math.min(H - 18, pos.y), f = pos.facing || 1;
    const hipY = ground - 66 + crouch + bob;
    const shoulderY = hipY - 54;
    const headY = shoulderY - 28;
    const color = a.color;

    if (selected && alpha === 1 && !playing) {
      ctx.save(); ctx.globalAlpha = .1; ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(x, ground - 57, 54, 96, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    strokeLimb([[x,shoulderY],[x + f * 4,hipY]], color, 8, alpha);
    strokeLimb([[x,shoulderY + 8],[x + f * (20 + stride*.28),shoulderY + 32],[x + f * (32 + stride*.18),shoulderY + 55]], color, 7, alpha);
    strokeLimb([[x,shoulderY + 8],[x - f * (18 + stride*.22),shoulderY + 34],[x - f * (27 + stride*.16),shoulderY + 57]], color, 7, alpha);
    strokeLimb([[x + f*3,hipY],[x + stride*.55,hipY + 36],[x + stride,ground]], color, 8, alpha);
    strokeLimb([[x + f*3,hipY],[x - stride*.45,hipY + 38],[x - stride*.8,ground]], color, 8, alpha);
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = '#fffdf7'; ctx.strokeStyle = color; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(x + f*3, headY, 23, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + f*10, headY - 4, 2.5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + f*20, headY + 2, 2, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.globalAlpha = .15 * alpha; ctx.fillStyle = '#20231f'; ctx.beginPath(); ctx.ellipse(x,ground+4,35,6,0,0,Math.PI*2); ctx.fill(); ctx.restore();
  }

  function render(time = null) {
    const s = scene();
    drawBackdrop(s);
    const showOnion = $('#onionToggle').checked;
    s.actors.forEach(a => {
      const pos = time === null ? {x:a.x,y:a.y,facing:a.facing,phase:a.phase} : positionAt(a,time);
      if (showOnion && a.id === activeActorId && a.track.length && time === null) {
        [0.25,0.5,0.75].forEach((ratio, i) => {
          const index = Math.floor((a.track.length - 1) * ratio);
          drawStick(a, a.track[index], false, .055 + i*.02);
        });
      }
      drawStick(a, pos, a.id === activeActorId, 1);
    });
    if (linePreview) {
      strokeLimb([[linePreview.x1,linePreview.y1],[linePreview.x2,linePreview.y2]], ink, brushSize);
    }
  }

  function snapshotDrawing() {
    const selected = activeActorId;
    activeActorId = -1;
    drawBackdrop(scene());
    const data = canvas.toDataURL('image/png');
    activeActorId = selected;
    return data;
  }

  function bakeStroke(strokeFn) {
    const s = scene();
    drawBackdrop(s);
    strokeFn();
    s.drawing = canvas.toDataURL('image/png');
    render();
  }

  function hitActor(point) {
    return [...scene().actors].reverse().find(a => Math.hypot(point.x - a.x, point.y - (a.y - 70)) < 75);
  }

  function beginPointer(event) {
    const p = canvasPoint(event);
    canvas.setPointerCapture(event.pointerId);
    if (tool === 'puppet') {
      const hit = hitActor(p);
      if (!hit) return;
      activeActorId = hit.id;
      dragActor = hit;
      dragging = true;
      canvas.classList.add('dragging');
      $('#emptyNudge').style.opacity = '0';
      renderActorList();
      moveActor(p);
    } else {
      history.push(scene().drawing);
      drawing = true;
      drawStart = p;
      if (tool !== 'line') {
        drawBackdrop(scene());
        ctx.beginPath();
        ctx.moveTo(p.x,p.y);
      }
    }
  }

  function moveActor(p) {
    if (!dragActor) return;
    const oldX = dragActor.x;
    dragActor.x = Math.max(30, Math.min(W - 30, p.x));
    dragActor.y = Math.max(145, Math.min(H - 22, p.y + 65));
    if ($('#faceToggle').checked && Math.abs(dragActor.x - oldX) > 1) dragActor.facing = dragActor.x > oldX ? 1 : -1;
    dragActor.phase += Math.abs(dragActor.x - oldX) * .045;
    if (recording) {
      dragActor.track.push({ t:Math.min(scene().duration,performance.now()-recordStartedAt), x:dragActor.x, y:dragActor.y, facing:dragActor.facing, phase:dragActor.phase });
      dragActor.recorded = true;
    }
    render();
  }

  function movePointer(event) {
    const p = canvasPoint(event);
    if (dragging) moveActor(p);
    if (!drawing) return;
    if (tool === 'line') {
      linePreview = {x1:drawStart.x,y1:drawStart.y,x2:p.x,y2:p.y};
      render();
    } else {
      ctx.lineWidth = tool === 'eraser' ? brushSize * 3 : brushSize;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = tool === 'eraser' ? (scene().background === 'transparent' ? 'rgba(0,0,0,1)' : scene().background) : ink;
      ctx.globalCompositeOperation = tool === 'eraser' && scene().background === 'transparent' ? 'destination-out' : 'source-over';
      ctx.lineTo(p.x,p.y); ctx.stroke();
    }
  }

  function endPointer() {
    if (dragging) saveThumb();
    dragging = false; dragActor = null; canvas.classList.remove('dragging');
    if (!drawing) return;
    if (tool === 'line' && linePreview) {
      const line = {...linePreview};
      linePreview = null;
      bakeStroke(() => strokeLimb([[line.x1,line.y1],[line.x2,line.y2]],ink,brushSize));
    } else {
      ctx.globalCompositeOperation = 'source-over';
      scene().drawing = canvas.toDataURL('image/png');
    }
    drawing = false; drawStart = null; saveThumb(); render();
  }

  function setTool(value) {
    tool = value;
    $$('.tool').forEach(btn => btn.classList.toggle('active',btn.dataset.tool === value));
    canvas.classList.toggle('drawing',value !== 'puppet');
    $('#stageHint').innerHTML = value === 'puppet' ? '<span>↖</span> Drag a figure to puppeteer' : '<span>✎</span> Draw directly on the board';
  }

  function renderActorList() {
    const list = $('#actorList');
    list.innerHTML = '';
    scene().actors.forEach((a,i) => {
      const el = document.createElement('div');
      el.className = `actor-card${a.id === activeActorId ? ' selected' : ''}`;
      el.tabIndex = 0;
      el.style.setProperty('--actor',a.color);
      el.innerHTML = `<span class="actor-avatar">${i%2 ? '⚑' : '★'}</span><span class="actor-info"><b>${a.name}</b><small>${a.recorded ? 'Movement recorded ✓' : 'Ready for a pass'}</small></span><button class="actor-delete" aria-label="Delete ${a.name}" title="Delete actor">×</button>`;
      const choose = () => { activeActorId=a.id; renderActorList(); render(); };
      el.addEventListener('click',choose);
      el.addEventListener('keydown',e => { if(e.key==='Enter') choose(); });
      el.querySelector('.actor-delete').addEventListener('click',e => {
        e.stopPropagation();
        deleteActor(a.id);
      });
      list.appendChild(el);
    });
    $('#actorCount').textContent = scene().actors.length;
  }

  function saveThumb() {
    render();
    scene().thumb = canvas.toDataURL('image/jpeg',.7);
    renderTimeline();
  }

  function renderTimeline() {
    const timeline = $('#timeline');
    timeline.innerHTML='';
    scenes.forEach((s,i) => {
      const card=document.createElement('div');
      card.className=`scene-card${s.id===activeSceneId?' selected':''}`;
      card.draggable=true; card.dataset.id=s.id;
      card.innerHTML=`<span class="scene-index">${String(i+1).padStart(2,'0')}</span><span class="scene-content">${s.thumb?`<img class="scene-thumb" src="${s.thumb}" alt="">`:'<span class="scene-thumb"></span>'}<span class="scene-caption">${s.name}</span></span>`;
      card.addEventListener('click',()=>loadScene(s.id));
      card.addEventListener('dragstart',()=>{draggedSceneId=s.id;});
      card.addEventListener('dragover',e=>e.preventDefault());
      card.addEventListener('drop',e=>{e.preventDefault();reorderScene(draggedSceneId,s.id);});
      timeline.appendChild(card);
    });
    const add=document.createElement('button'); add.className='scene-card add-card'; add.innerHTML='＋'; add.title='Add scene'; add.addEventListener('click',addScene); timeline.appendChild(add);
    $('#sceneCount').textContent=scenes.length;
    $('#totalDuration').textContent=`${Math.round(scenes.reduce((sum,s)=>sum+s.duration,0)/1000)} sec`;
  }

  function loadScene(id) {
    stopPlayback();
    activeSceneId=id;
    const s=scene();
    activeActorId=s.actors[0]?.id;
    $('#sceneName').value=s.name;
    $('#sceneDuration').value=String(s.duration);
    $('#durationTime').textContent=formatTime(s.duration);
    $('#sceneNumber').textContent=`SCENE ${String(scenes.indexOf(s)+1).padStart(2,'0')}`;
    $$('.backdrop').forEach(b=>b.classList.toggle('selected',b.dataset.bg===s.background));
    renderActorList(); renderTimeline(); render();
  }

  function reorderScene(fromId,toId) {
    if(!fromId||fromId===toId)return;
    const from=scenes.findIndex(s=>s.id===fromId),to=scenes.findIndex(s=>s.id===toId);
    scenes.splice(to,0,scenes.splice(from,1)[0]);
    renderTimeline();
    $('#sceneNumber').textContent=`SCENE ${String(scenes.findIndex(s=>s.id===activeSceneId)+1).padStart(2,'0')}`;
    toast('Scene order updated');
  }

  function addActor() {
    if(scene().actors.length>=6){toast('Six actors is plenty of chaos');return;}
    const id=nextActorId++;
    const names=['Tiny Menace','Tall Stranger','Drama Club Ghost','The Principal'];
    const a=makeActor(id,names[(id-3)%names.length],actorPalette[(id-1)%actorPalette.length],480+((id%3)-1)*80,350);
    scene().actors.push(a); activeActorId=id; renderActorList(); saveThumb(); toast(`${a.name} joined the scene`);
  }

  function deleteActor(id) {
    const s = scene();
    if (s.actors.length === 1) {
      toast('Every scene needs at least one actor');
      return;
    }
    const index = s.actors.findIndex(a => a.id === id);
    if (index < 0) return;
    if (recording && activeActorId === id) finishRecording();
    const [removed] = s.actors.splice(index, 1);
    if (activeActorId === id) {
      activeActorId = s.actors[Math.min(index, s.actors.length - 1)].id;
    }
    renderActorList();
    saveThumb();
    toast(`${removed.name} removed`);
  }

  function addScene() {
    const id=nextSceneId++;
    const actors=[makeActor(nextActorId++,'Hero-ish',actorPalette[0],390,350)];
    scenes.push(makeScene(id,`Untitled scene ${scenes.length+1}`,'#fbf9f2',actors));
    loadScene(id); saveThumb(); toast('Fresh scene added');
  }

  function duplicateScene() {
    const copy=clone(scene());
    copy.id=nextSceneId++; copy.name=`${copy.name} (copy)`;
    copy.actors.forEach(a=>a.id=nextActorId++);
    scenes.splice(scenes.findIndex(s=>s.id===activeSceneId)+1,0,copy);
    loadScene(copy.id); toast('Scene duplicated');
  }

  function startRecording() {
    if(recording){finishRecording();return;}
    stopPlayback();
    const a=actor(); if(!a)return;
    recording=true; a.track=[]; a.recorded=false; recordStartedAt=performance.now();
    a.track.push({t:0,x:a.x,y:a.y,facing:a.facing,phase:a.phase});
    $('#recordBtn').classList.add('active'); $('#recordBtn span').textContent=`Recording ${a.name}`;
    $('#recordingBadge').classList.add('show'); $('#emptyNudge').style.opacity='0';
    recordTick();
  }

  function recordTick() {
    if(!recording)return;
    const elapsed=Math.min(scene().duration,performance.now()-recordStartedAt);
    $('#recordTimer').textContent=formatTime(elapsed);
    $('#currentTime').textContent=formatTime(elapsed);
    if(elapsed>=scene().duration){finishRecording();return;}
    raf=requestAnimationFrame(recordTick);
  }

  function finishRecording() {
    if(!recording)return;
    recording=false; cancelAnimationFrame(raf);
    const a=actor();
    if(a && a.track.length<2) a.track.push({t:scene().duration,x:a.x,y:a.y,facing:a.facing,phase:a.phase});
    if(a) a.recorded=true;
    $('#recordBtn').classList.remove('active'); $('#recordBtn span').textContent='Record movement';
    $('#recordingBadge').classList.remove('show'); $('#currentTime').textContent='0:00.0';
    renderActorList(); saveThumb(); toast(`${a?.name||'Actor'} pass recorded`);
  }

  function playScene(onDone) {
    if(playing){stopPlayback();return;}
    if(recording)finishRecording();
    playing=true; playStartedAt=performance.now(); $('#playBtn').textContent='Ⅱ';
    const tick=()=>{
      if(!playing)return;
      const elapsed=performance.now()-playStartedAt;
      $('#currentTime').textContent=formatTime(Math.min(elapsed,scene().duration));
      render(Math.min(elapsed,scene().duration));
      if(elapsed>=scene().duration){stopPlayback(); if(onDone)onDone(); return;}
      raf=requestAnimationFrame(tick);
    };
    tick();
  }

  function stopPlayback() {
    playing=false; cancelAnimationFrame(raf); $('#playBtn').textContent='▶'; $('#currentTime').textContent='0:00.0'; render();
  }

  function playRoughCut() {
    if(roughCutPlaying){roughCutPlaying=false;stopPlayback();$('#playAllBtn').innerHTML='<span>▶</span> Play rough cut';return;}
    roughCutPlaying=true; let index=0; $('#playAllBtn').innerHTML='<span>■</span> Stop rough cut';
    const next=()=>{
      if(!roughCutPlaying)return;
      if(index>=scenes.length){roughCutPlaying=false;$('#playAllBtn').innerHTML='<span>▶</span> Play rough cut';loadScene(scenes[0].id);toast('End of rough cut');return;}
      loadScene(scenes[index++].id); setTimeout(()=>playScene(next),120);
    };
    next();
  }

  const bytes = (...parts) => {
    const flat = parts.flatMap(part => Array.from(part instanceof Uint8Array ? part : part || []));
    return new Uint8Array(flat);
  };

  const word = value => new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
  const short = value => new Uint8Array([(value >>> 8) & 255, value & 255]);
  const textBytes = value => new TextEncoder().encode(value);
  const zeroes = count => new Uint8Array(count);
  const box = (type, ...data) => {
    const body = bytes(...data);
    return bytes(word(body.length + 8), textBytes(type), body);
  };
  const fullBox = (type, version, flags, ...data) => box(type, new Uint8Array([version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255]), ...data);

  function makeMp4(samples, avcConfig, width, height, fps) {
    const timescale = 90000;
    const frameDuration = Math.round(timescale / fps);
    const duration = samples.length * frameDuration;
    const matrix = bytes(word(0x00010000),word(0),word(0),word(0),word(0x00010000),word(0),word(0),word(0),word(0x40000000));
    const ftyp = box('ftyp',textBytes('isom'),word(512),textBytes('isom'),textBytes('iso2'),textBytes('avc1'),textBytes('mp41'));
    const avcC = box('avcC',avcConfig);
    const compressor = bytes(new Uint8Array([10]),textBytes('Stickboard'),zeroes(21));
    const avc1 = box('avc1',zeroes(6),short(1),zeroes(16),short(width),short(height),word(0x00480000),word(0x00480000),word(0),short(1),compressor,short(24),short(0xffff),avcC);
    const stsd = fullBox('stsd',0,0,word(1),avc1);
    const stts = fullBox('stts',0,0,word(1),word(samples.length),word(frameDuration));
    const stsc = fullBox('stsc',0,0,word(1),word(1),word(1),word(1));
    const stsz = fullBox('stsz',0,0,word(0),word(samples.length),...samples.map(sample=>word(sample.data.length)));
    const stss = fullBox('stss',0,0,word(samples.filter(s=>s.key).length),...samples.map((s,i)=>s.key?word(i+1):null).filter(Boolean));
    const makeStco = offsets => fullBox('stco',0,0,word(offsets.length),...offsets.map(word));
    const makeMoov = offsets => {
      const stbl = box('stbl',stsd,stts,stsc,stsz,makeStco(offsets),stss);
      const url = fullBox('url ',0,1);
      const dref = fullBox('dref',0,0,word(1),url);
      const dinf = box('dinf',dref);
      const vmhd = fullBox('vmhd',0,1,short(0),short(0),short(0),short(0));
      const minf = box('minf',vmhd,dinf,stbl);
      const mdhd = fullBox('mdhd',0,0,word(0),word(0),word(timescale),word(duration),short(0x55c4),short(0));
      const hdlr = fullBox('hdlr',0,0,word(0),textBytes('vide'),zeroes(12),textBytes('VideoHandler\0'));
      const mdia = box('mdia',mdhd,hdlr,minf);
      const tkhd = fullBox('tkhd',0,7,word(0),word(0),word(1),word(0),word(duration),zeroes(8),short(0),short(0),short(0),short(0),matrix,word(width << 16),word(height << 16));
      const trak = box('trak',tkhd,mdia);
      const mvhd = fullBox('mvhd',0,0,word(0),word(0),word(timescale),word(duration),word(0x00010000),short(0x0100),zeroes(10),matrix,zeroes(24),word(2));
      return box('moov',mvhd,trak);
    };
    let moov = makeMoov(new Array(samples.length).fill(0));
    let offset = ftyp.length + moov.length + 8;
    const offsets = samples.map(sample => { const current=offset; offset+=sample.data.length; return current; });
    moov = makeMoov(offsets);
    return new Blob([ftyp,moov,box('mdat',...samples.map(sample=>sample.data))],{type:'video/mp4'});
  }

  function setExportProgress(value, label = 'Rendering your rough cut…') {
    const percent = Math.round(value * 100);
    $('#exportProgress').textContent = `${percent}%`;
    $('#exportProgressBar').style.width = `${percent}%`;
    $('#exportStatus b').textContent = label;
    $('#exportBtn').innerHTML = `<span class="export-spinner-mini">◌</span> ${label === 'Finishing your MP4…' ? 'Finishing…' : `Rendering ${percent}%`}`;
  }

  async function exportWithWebCodecs() {
    if (!window.VideoEncoder || !window.VideoFrame) throw new Error('WebCodecs unavailable');
    const fps = 30;
    const config = {codec:'avc1.42001E',width:W,height:H,bitrate:2500000,framerate:fps,avc:{format:'avc'}};
    const support = await VideoEncoder.isConfigSupported(config);
    if (!support.supported) throw new Error('H.264 unavailable');
    const samples=[];
    let avcConfig=null;
    let encodeError=null;
    const encoder = new VideoEncoder({
      output(chunk,metadata) {
        const data=new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        samples.push({data,key:chunk.type==='key'});
        if(metadata?.decoderConfig?.description) avcConfig=new Uint8Array(metadata.decoderConfig.description);
      },
      error(error) { encodeError=error; }
    });
    encoder.configure(config);
    const totalFrames=scenes.reduce((sum,s)=>sum+Math.ceil(s.duration/1000*fps),0);
    let frameIndex=0;
    for(const s of scenes) {
      activeSceneId=s.id;
      activeActorId=-1;
      const sceneFrames=Math.ceil(s.duration/1000*fps);
      for(let localFrame=0;localFrame<sceneFrames;localFrame++) {
        render(localFrame/fps*1000);
        const frame=new VideoFrame(canvas,{timestamp:Math.round(frameIndex*1000000/fps),duration:Math.round(1000000/fps)});
        encoder.encode(frame,{keyFrame:localFrame===0 || frameIndex%60===0});
        frame.close();
        frameIndex++;
        if(frameIndex%8===0) {
          setExportProgress(frameIndex/totalFrames);
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }
    }
    setExportProgress(.98,'Finishing your MP4…');
    await encoder.flush();
    encoder.close();
    if(encodeError) throw encodeError;
    if(!samples.length || !avcConfig) throw new Error('No encoded MP4 frames');
    return makeMp4(samples,avcConfig,W,H,fps);
  }

  async function exportWithMediaRecorder() {
    const mimeTypes=['video/mp4;codecs=avc1.42E01E','video/mp4;codecs=avc1','video/mp4'];
    const mimeType=mimeTypes.find(type=>MediaRecorder.isTypeSupported(type));
    if(!mimeType) throw new Error('MP4 recording unavailable');
    const chunks=[];
    const recorder=new MediaRecorder(canvas.captureStream(30),{mimeType,videoBitsPerSecond:2500000});
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    const finished=new Promise((resolve,reject)=>{recorder.onstop=()=>resolve(new Blob(chunks,{type:'video/mp4'}));recorder.onerror=()=>reject(recorder.error);});
    recorder.start(250);
    const total=scenes.reduce((sum,s)=>sum+s.duration,0);
    let elapsedTotal=0;
    for(const s of scenes) {
      activeSceneId=s.id; activeActorId=-1;
      const start=performance.now();
      await new Promise(resolve=>{
        const tick=()=>{
          const elapsed=Math.min(s.duration,performance.now()-start);
          render(elapsed); setExportProgress((elapsedTotal+elapsed)/total);
          if(elapsed>=s.duration)resolve();else requestAnimationFrame(tick);
        };
        tick();
      });
      elapsedTotal+=s.duration;
    }
    recorder.stop();
    return finished;
  }

  async function exportTimeline() {
    if(exporting)return;
    exporting=true;
    if(recording)finishRecording();
    if(playing||roughCutPlaying){roughCutPlaying=false;stopPlayback();}
    const originalScene=activeSceneId;
    const button=$('#exportBtn');
    button.disabled=true; $('#exportStatus').classList.add('show'); setExportProgress(0);
    try {
      let video;
      try { video=await exportWithWebCodecs(); }
      catch(webCodecsError) {
        if(!window.MediaRecorder || !canvas.captureStream) throw webCodecsError;
        video=await exportWithMediaRecorder();
      }
      const project=$('#projectName').value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'stickboard-rough-cut';
      const url=URL.createObjectURL(video);
      const link=document.createElement('a');
      link.href=url; link.download=`${project}.mp4`; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
      toast('MP4 exported — ready to share');
    } catch(error) {
      console.error(error);
      toast('This browser cannot encode MP4 video');
    } finally {
      exporting=false; button.disabled=false; button.innerHTML='<span>⇩</span> Export video';
      $('#exportStatus').classList.remove('show'); loadScene(originalScene);
    }
  }

  function toast(message) {
    const el=$('#toast'); el.textContent=message; el.classList.add('show');
    clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),1800);
  }

  canvas.addEventListener('pointerdown',beginPointer);
  canvas.addEventListener('pointermove',movePointer);
  canvas.addEventListener('pointerup',endPointer);
  canvas.addEventListener('pointercancel',endPointer);
  $$('.tool').forEach(btn=>btn.addEventListener('click',()=>setTool(btn.dataset.tool)));
  $$('.swatch').forEach(btn=>btn.addEventListener('click',()=>{ ink=btn.dataset.color; $$('.swatch').forEach(b=>b.classList.toggle('selected',b===btn)); }));
  $('#customColor').addEventListener('input',e=>{ink=e.target.value;$$('.swatch').forEach(b=>b.classList.remove('selected'));});
  $('#brushSize').addEventListener('input',e=>{brushSize=+e.target.value;$('#brushOutput').value=brushSize;});
  $$('.backdrop').forEach(btn=>btn.addEventListener('click',()=>{history.push(scene().drawing);scene().background=btn.dataset.bg;$$('.backdrop').forEach(b=>b.classList.toggle('selected',b===btn));saveThumb();}));
  $('#clearBgBtn').addEventListener('click',()=>{history.push(scene().drawing);scene().drawing=null;saveThumb();toast('Backdrop drawing cleared');});
  $('#undoBtn').addEventListener('click',()=>{if(!history.length){toast('Nothing to undo yet');return;}scene().drawing=history.pop();saveThumb();});
  $('#addActorBtn').addEventListener('click',addActor);
  $('#addSceneBtn').addEventListener('click',addScene);
  $('#duplicateSceneBtn').addEventListener('click',duplicateScene);
  $('#recordBtn').addEventListener('click',startRecording);
  $('#playBtn').addEventListener('click',()=>playScene());
  $('#playAllBtn').addEventListener('click',playRoughCut);
  $('#exportBtn').addEventListener('click',exportTimeline);
  $('#rewindBtn').addEventListener('click',stopPlayback);
  $('#sceneDuration').addEventListener('change',e=>{scene().duration=+e.target.value;$('#durationTime').textContent=formatTime(scene().duration);renderTimeline();});
  $('#sceneName').addEventListener('change',e=>{scene().name=e.target.value.trim()||'Untitled scene';e.target.value=scene().name;renderTimeline();});
  $('#onionToggle').addEventListener('change',render);
  $('#poseStyle').addEventListener('change',render);
  $('#helpBtn').addEventListener('click',()=>$('#helpDialog').showModal());
  $('#closeHelp').addEventListener('click',()=>$('#helpDialog').close());
  $('#gotItBtn').addEventListener('click',()=>$('#helpDialog').close());
  $('#helpDialog').addEventListener('click',e=>{if(e.target===$('#helpDialog'))$('#helpDialog').close();});
  $('#projectName').addEventListener('change',()=>toast('Project title saved locally'));
  document.addEventListener('keydown',e=>{
    if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))return;
    const map={v:'puppet',p:'pencil',e:'eraser',l:'line'};
    if(map[e.key.toLowerCase()])setTool(map[e.key.toLowerCase()]);
    if(e.code==='Space'){e.preventDefault();playScene();}
    if(e.key.toLowerCase()==='r')startRecording();
  });

  renderActorList();
  render();
  scenes[0].thumb=canvas.toDataURL('image/jpeg',.7);
  const initial=activeSceneId; activeSceneId=2; render(); scenes[1].thumb=canvas.toDataURL('image/jpeg',.7); activeSceneId=initial;
  loadScene(1);
})();
