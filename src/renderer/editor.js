// Kurgu stüdyosu: önizleme, zaman çizelgesi, kesme, yakınlaştırma, bulanıklaştırma, kamera, dışa aktarma.
// ($, api, esc, App, Processing stüdyo betiğinden gelir.)
(() => {
  const TL = window.Timeline;
  const canvas = $('preview');
  const ctx = canvas.getContext('2d');
  const vScreen = $('v-screen'), vCam = $('v-camera'), aMic = $('a-mic'), aSys = $('a-system');
  const FPS = 30;

  let P = null;        // proje
  let E = null;        // proje.edit
  let keep = [], srcDur = 0, outDur = 0;
  let sel = null;      // { type: 'clip'|'zoom'|'blur'|'camera', id|index }
  let history = [], future = [];
  let saveTimer = null;
  let playing = false;
  let pps = 30;        // zaman çizelgesi: saniye başına piksel
  let ringImg = null, clickImg = null;
  let sysFromScreen = false;
  let busy = false;
  let previewScale = 1;
  let OW = 1920, OH = 1080;

  // ---------- Yardımcılar ----------
  const fmt = (s, tenth = true) => {
    s = Math.max(0, s || 0);
    const m = Math.floor(s / 60), x = s - m * 60;
    return String(m).padStart(2, '0') + ':' + (tenth ? x.toFixed(1).padStart(4, '0') : String(Math.floor(x)).padStart(2, '0'));
  };
  const uid = p => p + Math.random().toString(36).slice(2, 9);
  const media = k => P?.media[k];
  const mediaUrl = file => 'mimoza://media/' + encodeURIComponent(P.id) + '/' + encodeURIComponent(file);
  const curT = () => vScreen.currentTime || 0;

  function recompute() {
    keep = TL.normalizeKeep(E.keep, srcDur);
    if (!keep.length) keep = [{ s: 0, e: srcDur }];
    E.keep = keep.map(k => ({ ...k }));
    outDur = TL.outputDuration(keep);
    const size = TL.outputSize(E.output.aspect, E.output.quality);
    OW = size.w; OH = size.h;
    previewScale = Math.min(1, 1280 / Math.max(OW, OH));
    canvas.width = Math.round(OW * previewScale);
    canvas.height = Math.round(OH * previewScale);
    fitCanvas();
    $('total-time').textContent = fmt(outDur);
    $('out-size').textContent = { '16:9': 'Yatay', '9:16': 'Dikey', '1:1': 'Kare' }[E.output.aspect] + ' · ' + OW + '×' + OH;
  }

  // Önizlemeyi alana sığdır
  function fitCanvas() {
    const wrap = $('preview-wrap');
    const w = wrap.clientWidth - 32, h = wrap.clientHeight - 32;
    if (w <= 0 || h <= 0) return;
    const s = Math.min(w / OW, h / OH);
    canvas.style.width = Math.floor(OW * s) + 'px';
    canvas.style.height = Math.floor(OH * s) + 'px';
  }
  new ResizeObserver(fitCanvas).observe($('preview-wrap'));

  // ---------- Geçmiş ve kayıt ----------
  function change(fn, { render = true } = {}) {
    const before = JSON.stringify(E);
    fn();
    if (JSON.stringify(E) === before) return;
    history.push(before);
    if (history.length > 200) history.shift();
    future = [];
    afterChange(render);
  }
  function afterChange(render = true) {
    recompute();
    scheduleSave();
    if (render) { renderTimeline(); renderInspector(); }
    updateUndo();
  }
  function undo() { if (!history.length) return; future.push(JSON.stringify(E)); E = P.edit = JSON.parse(history.pop()); sel = null; afterChange(); }
  function redo() { if (!future.length) return; history.push(JSON.stringify(E)); E = P.edit = JSON.parse(future.pop()); sel = null; afterChange(); }
  function updateUndo() { $('undo').disabled = !history.length; $('redo').disabled = !future.length; }
  function scheduleSave() {
    $('save-state').textContent = 'Kaydediliyor…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
  }
  async function save() {
    clearTimeout(saveTimer);
    if (!P) return;
    const { cursorData, ...rest } = P;
    await api.project.save({ ...rest, edit: E });
    $('save-state').textContent = 'Kaydedildi';
  }

  // ---------- Açma / kapama ----------
  async function open(id) {
    Processing.show('Proje açılıyor…');
    try {
      P = await api.project.load(id);
    } catch (e) { Processing.error('Proje açılamadı', e.message); return; }
    E = P.edit;
    srcDur = P.media.screen.duration;
    history = []; future = []; sel = null;
    E.zooms ||= []; E.blurs ||= []; E.mutes ||= [];
    E.overlays ||= [];
    E.captions ||= { on: false, style: 'karaoke', pos: 'bottom', size: 1 };
    E.audio ||= { denoise: true, normalize: true, duck: true };
    E.output.layout ||= 'fit';
    if (E.range === undefined) E.range = null;
    await window.EditorHooks?.onOpen?.(P, E);
    recompute();
    $('project-name').value = P.name;
    $('save-state').textContent = '';
    sysFromScreen = !!(media('system') && media('system').file === media('screen').file);
    vScreen.src = mediaUrl(media('screen').file);
    vScreen.muted = !sysFromScreen;
    vCam.removeAttribute('src');
    aMic.removeAttribute('src');
    aSys.removeAttribute('src');
    if (media('camera')) vCam.src = mediaUrl(media('camera').file);
    if (media('mic')) aMic.src = mediaUrl(media('mic').file);
    if (media('system') && !sysFromScreen) aSys.src = mediaUrl(media('system').file);
    for (const el of [vScreen, vCam, aMic, aSys]) el.load();
    await new Promise(res => {
      const t = setTimeout(res, 8000);
      vScreen.addEventListener('loadeddata', () => { clearTimeout(t); res(); }, { once: true });
      vScreen.addEventListener('error', () => { clearTimeout(t); res(); }, { once: true });
    });
    if (vScreen.error) { Processing.error('Video oynatılamadı', 'Dosya biçimi desteklenmiyor olabilir.'); return; }
    seekOut(0);
    const cap = P.capture || {};
    $('capture-info').textContent = { screen: 'Tüm ekran kaydı', region: 'Alan kaydı', window: 'Pencere kaydı', import: 'İçe aktarılan video' }[cap.kind] +
      (P.cursorData && !P.cursorData.hook ? ' · Tıklama bilgisi alınamadı' : '');
    $('t-autozoom').disabled = !P.cursorData?.clicks?.length || cap.kind === 'window' || cap.kind === 'import';
    App.show('editor');
    select(null);
    Processing.hide();
    fitTimeline();
    renderTimeline();
    renderInspector();
    renderMarks();
    updateUndo();
    window.EditorHooks?.afterOpen?.();
  }
  function close() {
    if (!P) return;
    pause();
    save();
    P = null;
  }
  window.Editor = { open, close, get busy() { return busy; } };
  // Paneller için iç arayüz
  window.EditorAPI = {
    get P() { return P; }, get E() { return E; }, get keep() { return keep; }, get outDur() { return outDur; }, get srcDur() { return srcDur; },
    get sel() { return sel; }, get pps() { return pps; }, get playing() { return playing; }, get size() { return { W: OW, H: OH }; },
    change, select, seekSrc, seekOut, play, pause, curT, scheduleSave, save, renderTimeline, renderInspector, layout, layoutRects, fmt, uid,
    segEl: (...a) => segEl(...a), attachSegDrag: (...a) => attachSegDrag(...a),
    ui: { row: (...a) => row(...a), slider: (...a) => slider(...a), segButtons: (...a) => segButtons(...a), checkbox: (...a) => checkbox(...a), group: (...a) => group(...a), btn: (...a) => btn(...a), selTitle: (...a) => selTitle(...a) },
    setBusy: v => { busy = v; },
  };

  $('project-name').addEventListener('change', () => {
    if (!P) return;
    P.name = $('project-name').value.trim() || P.name;
    $('project-name').value = P.name;
    scheduleSave();
  });

  // ---------- Oynatma ----------
  function segmentIndex(t) { return keep.findIndex(k => t >= k.s - 0.001 && t < k.e - 0.001); }
  function seekSrc(t) {
    vScreen.currentTime = Math.max(0, Math.min(srcDur, t));
    syncAux(true);
  }
  function seekOut(o) { seekSrc(TL.outputToSource(keep, Math.max(0, Math.min(outDur, o)))); }

  function syncEl(el, offset, dur, force) {
    if (!el.src || el.readyState < 1) return;
    const t = curT() - offset;
    const inside = t >= 0 && t < (dur || Infinity);
    if (!inside) { if (!el.paused) el.pause(); return; }
    if (force || Math.abs(el.currentTime - t) > 0.15) el.currentTime = t;
    if (playing && el.paused) el.play().catch(() => {});
    if (!playing && !el.paused) el.pause();
  }
  function syncAux(force = false) {
    const cam = media('camera'), mic = media('mic'), sys = media('system');
    if (cam) syncEl(vCam, cam.offset || 0, cam.duration, force);
    if (mic) syncEl(aMic, mic.offset || 0, mic.duration, force);
    if (sys && !sysFromScreen) syncEl(aSys, sys.offset || 0, sys.duration, force);
    const t = curT();
    const muted = E.mutes.some(m => t >= m.s && t < m.e);
    const vol = (k, max = 1) => { const tr = E.tracks[k] || {}; return muted || tr.mute ? 0 : Math.min(max, tr.volume ?? 1); };
    aMic.volume = vol('mic');
    if (sysFromScreen) vScreen.volume = vol('system'); else aSys.volume = vol('system');
  }

  function play() {
    if (!P || playing) return;
    const o = TL.sourceToOutput(keep, curT());
    if (o >= outDur - 0.05) seekOut(0);
    if (segmentIndex(curT()) < 0) seekOut(o);
    playing = true;
    vScreen.play().catch(() => { playing = false; });
    syncAux(true);
    $('play').innerHTML = icon('pause');
  }
  function pause() {
    playing = false;
    vScreen.pause();
    for (const el of [vCam, aMic, aSys]) el.pause();
    $('play').innerHTML = icon('play');
  }
  $('play').innerHTML = icon('play');
  $('play').onclick = () => (playing ? pause() : play());
  $('to-start').innerHTML = icon('undo');
  $('to-start').onclick = () => { pause(); seekOut(0); };

  function playbackTick() {
    if (!P) return;
    if (playing) {
      const t = curT();
      const i = segmentIndex(t);
      if (i < 0) {
        const nextSeg = keep.find(k => k.s > t);
        if (nextSeg) seekSrc(nextSeg.s); else { pause(); seekOut(outDur); }
      } else if (t >= keep[i].e - 0.02) {
        if (keep[i + 1]) seekSrc(keep[i + 1].s); else { pause(); }
      } else if (vScreen.ended) pause();
      syncAux(false);
    }
  }

  // ---------- Önizleme çizimi ----------
  function sourceRect() {
    const vw = vScreen.videoWidth || media('screen').width, vh = vScreen.videoHeight || media('screen').height;
    const r = P.capture?.region;
    if (!r) return { x: 0, y: 0, w: vw, h: vh, vw, vh };
    return { x: r.x * vw, y: r.y * vh, w: Math.max(16, r.w * vw), h: Math.max(16, r.h * vh), vw, vh };
  }
  const hasCam = () => !!(media('camera') && E.camera.visible);
  function layoutRects() { const R = sourceRect(); return TL.layoutRects(E, OW, OH, R.w, R.h, hasCam()); }
  function layout(t, ignoreZoom) {
    const R = sourceRect();
    const LR = TL.layoutRects(E, OW, OH, R.w, R.h, hasCam());
    const fit = LR.screen;
    const vp = ignoreZoom ? { x: 0, y: 0, w: 1, h: 1, scale: 1 } : TL.zoomViewport(E.zooms, t);
    return { R, fit, vp, k: fit.w / (vp.w * R.w), LR };
  }
  const toOut = (L, u, v) => [L.fit.x + (u - L.vp.x) / L.vp.w * L.fit.w, L.fit.y + (v - L.vp.y) / L.vp.h * L.fit.h];
  const toSrc = (L, X, Y) => [L.vp.x + (X - L.fit.x) / L.fit.w * L.vp.w, L.vp.y + (Y - L.fit.y) / L.fit.h * L.vp.h];

  function cursorAt(t) {
    const m = P.cursorData?.moves;
    if (!m?.length) return null;
    let lo = 0, hi = m.length - 1;
    if (t <= m[0][0]) return m[0];
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (m[mid][0] <= t) lo = mid; else hi = mid - 1; }
    return m[lo];
  }
  const cursorEnabled = () => P.cursorData && P.capture?.kind !== 'window' && P.capture?.kind !== 'import';

  function makeRing(size = 128) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,199,44,0.22)';
    g.beginPath(); g.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,199,44,0.95)';
    g.lineWidth = size * 0.07;
    g.beginPath(); g.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2); g.stroke();
    return c;
  }
  function makeClick(size = 128) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,199,44,1)';
    g.lineWidth = size * 0.05;
    g.beginPath(); g.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2); g.stroke();
    return c;
  }
  function makeMask(w, h, shape) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    shapePath(g, 0, 0, w, h, shape);
    g.fill();
    return c;
  }
  function shapePath(g, x, y, w, h, shape) {
    g.beginPath();
    if (shape === 'circle') g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else g.roundRect(x, y, w, h, shape === 'rounded' ? Math.min(w, h) * 0.16 : Math.min(w, h) * 0.04);
  }
  ringImg = makeRing();
  clickImg = makeClick();

  const camShape = () => (layoutRects().split ? 'rect' : E.camera.shape);
  function camRect() {
    const LR = layoutRects();
    if (LR.split) return LR.cam;
    const cam = media('camera');
    const aspect = cam?.width && cam?.height ? cam.width / cam.height : 16 / 9;
    return TL.cameraRect(E.camera, OW, OH, aspect);
  }

  function draw() {
    if (!P || App.view !== 'editor') return;
    const t = curT();
    const H = window.EditorHooks;
    ctx.setTransform(previewScale, 0, 0, previewScale, 0, 0);
    if (H?.drawCard?.(ctx, OW, OH)) return;
    const editingZoom = sel?.type === 'zoom' && !playing ? E.zooms.find(z => z.id === sel.id) : null;
    const L = layout(t, !!editingZoom);
    ctx.setTransform(previewScale, 0, 0, previewScale, 0, 0);
    ctx.fillStyle = E.output.bg || '#101418';
    ctx.fillRect(0, 0, OW, OH);
    if (vScreen.readyState >= 2) {
      const { R, fit, vp } = L;
      ctx.drawImage(vScreen, R.x + vp.x * R.w, R.y + vp.y * R.h, vp.w * R.w, vp.h * R.h, fit.x, fit.y, fit.w, fit.h);
      ctx.save();
      ctx.beginPath(); ctx.rect(fit.x, fit.y, fit.w, fit.h); ctx.clip();
      // Bulanıklaştırma
      for (const b of E.blurs) {
        if (t < b.s || t > b.e) continue;
        const [x1, y1] = toOut(L, b.x, b.y), [x2, y2] = toOut(L, b.x + b.w, b.y + b.h);
        ctx.save();
        ctx.beginPath(); ctx.rect(x1, y1, x2 - x1, y2 - y1); ctx.clip();
        ctx.filter = `blur(${Math.max(4, (b.strength || 20) * Math.min(R.w, R.h) / 1080 * L.k * 0.8)}px)`;
        const pad = 30;
        ctx.drawImage(vScreen, R.x + (b.x - 0.02) * R.w, R.y + (b.y - 0.02) * R.h, (b.w + 0.04) * R.w, (b.h + 0.04) * R.h,
          x1 - 0.02 * R.w * L.k, y1 - 0.02 * R.h * L.k, x2 - x1 + 0.04 * R.w * L.k, y2 - y1 + 0.04 * R.h * L.k);
        ctx.restore();
        void pad;
      }
      // İmleç vurgusu ve tıklamalar
      if (cursorEnabled()) {
        const ring = Math.min(R.w, R.h) * 0.055 * (E.cursor.size || 1) * L.k;
        if (E.cursor.highlight) {
          const c = cursorAt(t);
          if (c) { const [x, y] = toOut(L, c[1], c[2]); ctx.drawImage(ringImg, x - ring / 2, y - ring / 2, ring, ring); }
        }
        if (E.cursor.clicks) {
          for (const c of P.cursorData.clicks) {
            if (t < c[0] || t > c[0] + 0.35) continue;
            const s = ring * 1.6;
            const [x, y] = toOut(L, c[1], c[2]);
            ctx.drawImage(clickImg, x - s / 2, y - s / 2, s, s);
          }
        }
      }
      ctx.restore();
      // Yakınlaştırma düzenleme görünümü
      if (editingZoom) {
        const w = 1 / editingZoom.scale, h = 1 / editingZoom.scale;
        const zx = TL.clamp(editingZoom.cx - w / 2, 0, 1 - w), zy = TL.clamp(editingZoom.cy - h / 2, 0, 1 - h);
        const [x1, y1] = toOut(L, zx, zy), [x2, y2] = toOut(L, zx + w, zy + h);
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.beginPath(); ctx.rect(fit.x, fit.y, fit.w, fit.h); ctx.rect(x1, y1, x2 - x1, y2 - y1); ctx.fill('evenodd');
        ctx.strokeStyle = '#b18cff'; ctx.lineWidth = 3 / previewScale;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.restore();
      }
      if (sel?.type === 'blur') {
        const b = E.blurs.find(x => x.id === sel.id);
        if (b) {
          const [x1, y1] = toOut(L, b.x, b.y), [x2, y2] = toOut(L, b.x + b.w, b.y + b.h);
          ctx.save();
          ctx.setLineDash([10, 6]); ctx.strokeStyle = '#59d0ff'; ctx.lineWidth = 2 / previewScale;
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          ctx.setLineDash([]); ctx.fillStyle = '#59d0ff';
          const hs = 14 / previewScale;
          ctx.fillRect(x2 - hs / 2, y2 - hs / 2, hs, hs);
          ctx.restore();
        }
      }
    }
    // Kamera
    const cam = media('camera');
    if (cam && E.camera.visible) {
      const ct = t - (cam.offset || 0);
      if (ct >= 0 && ct <= cam.duration + 0.05 && vCam.readyState >= 2) {
        const r = camRect();
        const iw = vCam.videoWidth, ih = vCam.videoHeight;
        let sx = 0, sy = 0, sw = iw, sh = ih;
        const shape = camShape();
        if (shape === 'rect') {
          const s = Math.max(r.w / iw, r.h / ih); sw = r.w / s; sh = r.h / s; sx = (iw - sw) / 2; sy = (ih - sh) / 2;
        } else { const m = Math.min(iw, ih); sw = sh = m; sx = (iw - m) / 2; sy = (ih - m) / 2; }
        ctx.save();
        shapePath(ctx, r.x, r.y, r.w, r.h, shape);
        ctx.clip();
        if (E.camera.mirror) { ctx.translate(r.x * 2 + r.w, 0); ctx.scale(-1, 1); }
        ctx.drawImage(vCam, sx, sy, sw, sh, r.x, r.y, r.w, r.h);
        ctx.restore();
        if (sel?.type === 'camera') {
          ctx.save();
          ctx.strokeStyle = '#3ddc97'; ctx.lineWidth = 3 / previewScale;
          shapePath(ctx, r.x, r.y, r.w, r.h, shape); ctx.stroke();
          ctx.restore();
        }
      }
    }
    // Şablonlar ve altyazı
    H?.drawAfter?.(ctx, t, OW, OH, L);
    // Saat ve oynatma çizgisi
    const o = TL.sourceToOutput(keep, t);
    $('cur-time').textContent = fmt(o);
    const ph = $('tl-playhead');
    ph.style.left = (o * pps) + 'px';
    if (playing) {
      const lanes = $('tl-lanes');
      const x = o * pps;
      if (x > lanes.scrollLeft + lanes.clientWidth - 60 || x < lanes.scrollLeft) lanes.scrollLeft = Math.max(0, x - 80);
    }
  }

  function frame() {
    playbackTick();
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- Önizleme etkileşimi ----------
  function previewPoint(e) {
    const b = canvas.getBoundingClientRect();
    return [(e.clientX - b.left) / b.width * OW, (e.clientY - b.top) / b.height * OH];
  }
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (!P || e.button !== 0) return;
    const [X, Y] = previewPoint(e);
    const t = curT();
    // Kamera
    const cam = media('camera');
    if (cam && E.camera.visible && !layoutRects().split) {
      const r = camRect();
      if (X >= r.x && X <= r.x + r.w && Y >= r.y && Y <= r.y + r.h) {
        select({ type: 'camera' });
        drag = { kind: 'camera', start: [X, Y], orig: { ...E.camera }, before: JSON.stringify(E), r };
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        return;
      }
    }
    const zoom = sel?.type === 'zoom' ? E.zooms.find(z => z.id === sel.id) : null;
    if (zoom && !playing) {
      const L = layout(t, true);
      drag = { kind: 'zoom', zoom, L, before: JSON.stringify(E) };
      const [u, v] = toSrc(L, X, Y);
      zoom.cx = TL.clamp(u, 0, 1); zoom.cy = TL.clamp(v, 0, 1);
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      return;
    }
    const L = layout(t);
    const [u, v] = toSrc(L, X, Y);
    for (const b of [...E.blurs].reverse()) {
      if (t < b.s || t > b.e) continue;
      const nearHandle = Math.abs(u - (b.x + b.w)) < 0.02 && Math.abs(v - (b.y + b.h)) < 0.03;
      if (nearHandle || (u >= b.x && u <= b.x + b.w && v >= b.y && v <= b.y + b.h)) {
        select({ type: 'blur', id: b.id });
        drag = { kind: nearHandle ? 'blur-size' : 'blur', blur: b, L, start: [u, v], orig: { ...b }, before: JSON.stringify(E) };
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        return;
      }
    }
    select(null);
  });
  canvas.addEventListener('pointermove', e => {
    const [X, Y] = previewPoint(e);
    if (!drag) {
      if (!P) return;
      const cam = media('camera');
      const r = cam && E.camera.visible && !layoutRects().split ? camRect() : null;
      canvas.style.cursor = r && X >= r.x && X <= r.x + r.w && Y >= r.y && Y <= r.y + r.h ? 'move' : sel?.type === 'zoom' ? 'crosshair' : 'default';
      return;
    }
    if (drag.kind === 'camera') {
      const r = drag.r;
      const nx = drag.r.x + (X - drag.start[0]), ny = drag.r.y + (Y - drag.start[1]);
      E.camera.x = TL.clamp(OW - r.w > 0 ? nx / (OW - r.w) : 0.5, 0, 1);
      E.camera.y = TL.clamp(OH - r.h > 0 ? ny / (OH - r.h) : 0.5, 0, 1);
    } else if (drag.kind === 'zoom') {
      const [u, v] = toSrc(drag.L, X, Y);
      drag.zoom.cx = TL.clamp(u, 0, 1); drag.zoom.cy = TL.clamp(v, 0, 1);
    } else if (drag.kind === 'blur' || drag.kind === 'blur-size') {
      const [u, v] = toSrc(drag.L, X, Y);
      const b = drag.blur, o = drag.orig;
      if (drag.kind === 'blur') {
        b.x = TL.clamp(o.x + u - drag.start[0], 0, 1 - o.w);
        b.y = TL.clamp(o.y + v - drag.start[1], 0, 1 - o.h);
      } else {
        b.w = TL.clamp(u - o.x, 0.02, 1 - o.x);
        b.h = TL.clamp(v - o.y, 0.02, 1 - o.y);
      }
    }
  });
  const endDrag = () => {
    if (!drag) return;
    const before = drag.before;
    drag = null;
    if (JSON.stringify(E) !== before) { history.push(before); future = []; afterChange(); }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', e => {
    if (sel?.type !== 'camera') return;
    e.preventDefault();
    change(() => { E.camera.size = TL.clamp(E.camera.size * (e.deltaY < 0 ? 1.06 : 1 / 1.06), 0.1, 0.7); });
  }, { passive: false });

  // ---------- Seçim ----------
  function select(s) {
    sel = s;
    renderTimeline();
    renderInspector();
    const hint = $('preview-hint');
    hint.hidden = !s || !['zoom', 'blur', 'camera'].includes(s.type);
    hint.textContent = s?.type === 'zoom' ? 'Yakınlaşılacak yeri önizlemede tıklayın veya sürükleyin' :
      s?.type === 'blur' ? 'Alanı sürükleyin, sağ alt köşeden boyutlandırın' :
      s?.type === 'camera' ? 'Kamerayı sürükleyin, fare tekerleğiyle büyütün' : '';
  }

  // ---------- Kesme ----------
  function splitAtPlayhead() {
    const t = curT();
    change(() => { E.keep = TL.splitAt(keep, t); });
    const i = TL.normalizeKeep(E.keep, srcDur).length; void i;
  }
  function deleteSelection() {
    if (!sel) return;
    if (sel.type === 'clip') {
      if (keep.length <= 1) { alert('Videonun son parçası silinemez.'); return; }
      const k = keep[sel.index];
      if (!k) return;
      const before = JSON.stringify(E);
      E.keep = keep.filter((_, i) => i !== sel.index);
      history.push(before); future = [];
      sel = null;
      afterChange();
      seekOut(TL.sourceToOutput(TL.normalizeKeep(E.keep, srcDur), k.s));
    } else if (sel.type === 'zoom') {
      change(() => { E.zooms = E.zooms.filter(z => z.id !== sel.id); }); select(null);
    } else if (sel.type === 'blur') {
      change(() => { E.blurs = E.blurs.filter(b => b.id !== sel.id); }); select(null);
    } else if (sel.type === 'camera') {
      change(() => { E.camera.visible = false; }); select(null);
    } else window.EditorHooks?.deleteSel?.(sel);
  }
  function addZoom() {
    const t = curT();
    const z = { id: uid('z'), s: t, e: Math.min(srcDur, t + 3), scale: 1.8, cx: 0.5, cy: 0.5, auto: false };
    const c = cursorEnabled() ? cursorAt(t) : null;
    if (c) { z.cx = c[1]; z.cy = c[2]; }
    change(() => { E.zooms = [...E.zooms.filter(o => o.e <= z.s || o.s >= z.e), z].sort((a, b) => a.s - b.s); });
    select({ type: 'zoom', id: z.id });
  }
  function addBlur() {
    const t = curT();
    const b = { id: uid('b'), s: t, e: Math.min(srcDur, t + 5), x: 0.35, y: 0.35, w: 0.3, h: 0.12, strength: 22 };
    change(() => { E.blurs.push(b); });
    select({ type: 'blur', id: b.id });
  }

  // ---------- Araç düğmeleri ----------
  const toolIcons = { 't-split': 'split', 't-delete': 'trash', 't-zoom': 'zoom', 't-blur': 'blur', 't-autozoom': 'magic', 't-clearzoom': 'x', 't-folder': 'folder' };
  for (const [id, ic] of Object.entries(toolIcons)) $(id).querySelector('span').innerHTML = icon(ic);
  $('t-split').onclick = splitAtPlayhead;
  $('t-delete').onclick = deleteSelection;
  $('t-zoom').onclick = addZoom;
  $('t-blur').onclick = addBlur;
  $('t-autozoom').onclick = () => {
    if (!P.cursorData?.clicks?.length) return;
    change(() => { E.zooms = [...E.zooms.filter(z => !z.auto), ...TL.autoZooms(P.cursorData.clicks, srcDur)].sort((a, b) => a.s - b.s); });
  };
  $('t-clearzoom').onclick = () => { if (E.zooms.length && confirm('Tüm yakınlaştırmalar kaldırılsın mı?')) change(() => { E.zooms = []; }); };
  $('t-folder').onclick = () => api.openProjectFolder(P.id);
  $('undo').onclick = undo;
  $('redo').onclick = redo;

  addEventListener('keydown', e => {
    if (App.view !== 'editor' || !P || busy || !$('export-modal').hidden) return;
    if (e.target?.matches?.('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (e.ctrlKey && k === 'y') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey && k === 's') { e.preventDefault(); save(); return; }
    if (e.ctrlKey || e.altKey) return;
    if (k === ' ') { e.preventDefault(); playing ? pause() : play(); }
    else if (k === 's') splitAtPlayhead();
    else if (k === 'delete' || k === 'backspace') deleteSelection();
    else if (k === 'z') addZoom();
    else if (k === 'b') addBlur();
    else if (k === 'home') { pause(); seekOut(0); }
    else if (k === 'end') { pause(); seekOut(outDur); }
    else if (k === 'arrowleft') { pause(); seekOut(TL.sourceToOutput(keep, curT()) - (e.shiftKey ? 1 : 1 / FPS)); }
    else if (k === 'arrowright') { pause(); seekOut(TL.sourceToOutput(keep, curT()) + (e.shiftKey ? 1 : 1 / FPS)); }
    else if (k === 'i') setRange('s');
    else if (k === 'o') setRange('e');
    else if (k === 'escape') select(null);
  });
  function setRange(which) {
    const t = curT();
    change(() => {
      const r = E.range ? { ...E.range } : { s: 0, e: srcDur };
      r[which] = t;
      if (r.e - r.s < 0.5) { if (which === 's') r.e = Math.min(srcDur, r.s + 5); else r.s = Math.max(0, r.e - 5); }
      E.range = r;
    });
  }

  // ---------- Bölüm işaretleri ----------
  function renderMarks() {
    const list = P.marks || [];
    $('marks').replaceChildren(...(list.length ? list.map(m => {
      const b = document.createElement('button');
      b.innerHTML = `<b>${fmt(TL.sourceToOutput(keep, m.t), false)}</b>${esc(m.label)}`;
      b.onclick = () => { pause(); seekSrc(m.t); };
      return b;
    }) : [Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'Kayıtta Ctrl+Alt+M ile işaret koyabilirsiniz.' })]));
  }

  // ---------- Zaman çizelgesi ----------
  function fitTimeline() {
    const w = $('tl-lanes').clientWidth - 40;
    pps = TL.clamp(w / Math.max(1, outDur), 2, 200);
    $('tl-zoom').value = String(pps);
  }
  $('tl-zoom').oninput = () => {
    const lanes = $('tl-lanes');
    const centerT = (lanes.scrollLeft + lanes.clientWidth / 2) / pps;
    pps = +$('tl-zoom').value;
    renderTimeline();
    lanes.scrollLeft = centerT * pps - lanes.clientWidth / 2;
  };
  $('tl-lanes').addEventListener('wheel', e => {
    if (!e.ctrlKey) { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { $('tl-lanes').scrollLeft += e.deltaY; e.preventDefault(); } return; }
    e.preventDefault();
    $('tl-zoom').value = String(TL.clamp(pps * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 2, 200));
    $('tl-zoom').oninput();
  }, { passive: false });
  $('tl-lanes').addEventListener('scroll', () => drawWaves());
  addEventListener('resize', () => { if (P && App.view === 'editor') { renderTimeline(); } });

  function tracks() {
    const list = [
      ...(window.EditorHooks?.tracksBefore?.() || []),
      { key: 'zoom', name: 'Yakınlaştırma', icon: 'zoom' },
      { key: 'blur', name: 'Bulanıklaştırma', icon: 'blur' },
      { key: 'screen', name: P.capture?.kind === 'import' ? 'Video' : 'Ekran', icon: 'screen' },
    ];
    if (media('camera')) list.push({ key: 'camera', name: 'Kamera', icon: 'camera' });
    if (media('mic')) list.push({ key: 'mic', name: 'Mikrofon', icon: 'mic' });
    if (media('system')) list.push({ key: 'system', name: sysFromScreen ? 'Video sesi' : 'Bilgisayar sesi', icon: 'speaker' });
    return list;
  }

  function renderHeads(list) {
    $('tl-heads').replaceChildren(...list.map(tr => {
      const h = document.createElement('div');
      h.className = 'tl-head';
      h.innerHTML = `<span class="nm">${icon(tr.icon)}${tr.name}</span>`;
      if (tr.key === 'camera') {
        const b = document.createElement('button');
        b.title = 'Kamerayı göster / gizle';
        b.innerHTML = icon(E.camera.visible ? 'camera' : 'eyeoff');
        b.onclick = () => change(() => { E.camera.visible = !E.camera.visible; });
        h.append(b);
      }
      if (tr.key === 'mic' || tr.key === 'system') {
        const t = E.tracks[tr.key] ||= { volume: 1, mute: false };
        const r = document.createElement('input');
        r.type = 'range'; r.min = '0'; r.max = '1.5'; r.step = '0.05'; r.value = String(t.volume ?? 1);
        r.title = 'Ses seviyesi';
        let before = null;
        r.onpointerdown = () => { before = JSON.stringify(E); };
        r.oninput = () => { t.volume = +r.value; syncAux(); };
        r.onchange = () => { if (before && before !== JSON.stringify(E)) { history.push(before); future = []; afterChange(false); } };
        const b = document.createElement('button');
        b.title = 'Sesi kapat / aç';
        b.setAttribute('aria-pressed', String(!!t.mute));
        b.innerHTML = icon(t.mute ? 'micoff' : tr.key === 'mic' ? 'mic' : 'speaker');
        b.onclick = () => change(() => { t.mute = !t.mute; });
        h.append(r, b);
      }
      return h;
    }));
  }

  function renderRuler() {
    const ruler = $('tl-ruler');
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find(s => s * pps >= 70) || 600;
    const frag = [];
    for (let s = 0; s <= outDur + step; s += step) {
      const d = document.createElement('div');
      d.className = 'tick';
      d.style.left = (s * pps) + 'px';
      d.textContent = fmt(s, step < 1);
      frag.push(d);
    }
    for (const m of P.marks || []) {
      const f = document.createElement('div');
      f.className = 'flag';
      f.title = m.label;
      f.style.left = (TL.sourceToOutput(keep, m.t) * pps) + 'px';
      frag.push(f);
    }
    if (E.range) {
      const r = document.createElement('div');
      r.className = 'range-zone';
      const a = TL.sourceToOutput(keep, E.range.s), b = TL.sourceToOutput(keep, E.range.e);
      r.style.left = (a * pps) + 'px';
      r.style.width = Math.max(2, (b - a) * pps) + 'px';
      r.title = 'Dışa aktarma aralığı (I / O)';
      frag.push(r);
    }
    ruler.replaceChildren(...frag);
  }

  function segEl(cls, s, e, label, selected) {
    const os = TL.sourceToOutput(keep, s), oe = TL.sourceToOutput(keep, e);
    if (oe - os < 0.03) return null;
    const d = document.createElement('div');
    d.className = 'seg-item ' + cls + (selected ? ' sel' : '');
    d.style.left = (os * pps) + 'px';
    d.style.width = Math.max(4, (oe - os) * pps) + 'px';
    d.innerHTML = `<span>${label}</span>`;
    return d;
  }

  function attachSegDrag(el, item, list, onSelect) {
    el.insertAdjacentHTML('beforeend', '<i class="h l"></i><i class="h r"></i>');
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onSelect();
      const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
      const startX = e.clientX;
      const before = JSON.stringify(E);
      const o = { s: item.s, e: item.e };
      const os = TL.sourceToOutput(keep, o.s), oe = TL.sourceToOutput(keep, o.e);
      try { el.setPointerCapture(e.pointerId); } catch {}
      const others = list.filter(x => x !== item);
      const move = ev => {
        const dx = (ev.clientX - startX) / pps;
        if (mode === 'move') {
          const len = o.e - o.s;
          let ns = TL.outputToSource(keep, TL.clamp(os + dx, 0, outDur));
          ns = TL.clamp(ns, 0, srcDur - len);
          item.s = ns; item.e = ns + len;
        } else if (mode === 'l') {
          item.s = TL.clamp(TL.outputToSource(keep, TL.clamp(os + dx, 0, outDur)), 0, item.e - 0.5);
        } else {
          item.e = TL.clamp(TL.outputToSource(keep, TL.clamp(oe + dx, 0, outDur)), item.s + 0.5, srcDur);
        }
        if (list === E.zooms) {
          // Yakınlaştırmalar üst üste binmesin
          for (const z of others) {
            if (item.s < z.e && item.e > z.s) {
              if (mode === 'l') item.s = z.e; else if (mode === 'r') item.e = z.s;
              else { item.s = o.s; item.e = o.e; }
            }
          }
        }
        el.style.left = (TL.sourceToOutput(keep, item.s) * pps) + 'px';
        el.style.width = Math.max(4, (TL.sourceToOutput(keep, item.e) - TL.sourceToOutput(keep, item.s)) * pps) + 'px';
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        item.auto = false;
        if (JSON.stringify(E) !== before) { history.push(before); future = []; afterChange(); }
        else renderTimeline();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }

  function renderTimeline() {
    if (!P) return;
    const list = tracks();
    renderHeads(list);
    renderRuler();
    const width = Math.max($('tl-lanes').clientWidth, outDur * pps + 120);
    $('tl-inner').style.width = width + 'px';
    const rows = [];
    for (const tr of list) {
      const row = document.createElement('div');
      row.className = 'tl-track';
      row.dataset.key = tr.key;
      if (tr.key === 'zoom') {
        for (const z of E.zooms) {
          const el = segEl('zoom' + (z.auto ? ' auto' : ''), z.s, z.e, '×' + z.scale.toFixed(1), sel?.type === 'zoom' && sel.id === z.id);
          if (!el) continue;
          attachSegDrag(el, z, E.zooms, () => { if (!(sel?.type === 'zoom' && sel.id === z.id)) { select({ type: 'zoom', id: z.id }); seekSrc(Math.max(z.s + 0.5, Math.min(curT(), z.e - 0.1))); } });
          row.append(el);
        }
        row.ondblclick = e => { if (e.target === row) { seekOut((e.offsetX) / pps); addZoom(); } };
      } else if (tr.key === 'blur') {
        for (const b of E.blurs) {
          const el = segEl('blur', b.s, b.e, 'Bulanık', sel?.type === 'blur' && sel.id === b.id);
          if (!el) continue;
          attachSegDrag(el, b, E.blurs, () => { if (!(sel?.type === 'blur' && sel.id === b.id)) { select({ type: 'blur', id: b.id }); if (curT() < b.s || curT() > b.e) seekSrc(b.s + 0.05); } });
          row.append(el);
        }
        row.ondblclick = e => { if (e.target === row) { seekOut(e.offsetX / pps); addBlur(); } };
      } else if (tr.key === 'screen') {
        keep.forEach((k, i) => {
          const el = segEl('clip', k.s, k.e, (keep.length > 1 ? 'Parça ' + (i + 1) + ' · ' : '') + fmt(k.e - k.s, false), sel?.type === 'clip' && sel.index === i);
          el.onpointerdown = e => { e.stopPropagation(); select({ type: 'clip', index: i }); seekOut(e.offsetX / pps + TL.sourceToOutput(keep, k.s)); };
          row.append(el);
        });
      } else if (tr.key === 'camera') {
        const cam = media('camera');
        const el = segEl('cam' + (E.camera.visible ? '' : ' off'), Math.max(0, cam.offset || 0), Math.min(srcDur, (cam.offset || 0) + cam.duration), E.camera.visible ? 'Kamera' : 'Kamera gizli');
        if (el) { el.onpointerdown = e => { e.stopPropagation(); select({ type: 'camera' }); }; row.append(el); }
      } else if (window.EditorHooks?.renderTrack?.(tr.key, row)) {
        // Panel tarafından çizildi
      } else if (tr.key === 'mic' || tr.key === 'system') {
        const w = document.createElement('div');
        w.className = 'wave';
        w.dataset.key = tr.key;
        w.innerHTML = '<canvas></canvas>';
        row.append(w);
        for (const m of E.mutes) {
          const os = TL.sourceToOutput(keep, m.s), oe = TL.sourceToOutput(keep, m.e);
          if (oe - os < 0.03) continue;
          const z = document.createElement('div');
          z.className = 'mute-zone';
          z.title = 'Gizlilik: ses kapalı';
          z.style.left = (os * pps) + 'px';
          z.style.width = ((oe - os) * pps) + 'px';
          row.append(z);
        }
      }
      rows.push(row);
    }
    $('tl-tracks').replaceChildren(...rows);
    drawWaves();
  }

  function drawWaves() {
    if (!P) return;
    const lanes = $('tl-lanes');
    for (const w of document.querySelectorAll('.wave')) {
      const m = media(w.dataset.key);
      const peaks = m?.peaks;
      const c = w.querySelector('canvas');
      const left = lanes.scrollLeft, width = lanes.clientWidth;
      w.style.left = left + 'px';
      w.style.width = width + 'px';
      c.width = width; c.height = 28;
      const g = c.getContext('2d');
      g.clearRect(0, 0, width, 28);
      const tr = E.tracks[w.dataset.key] || {};
      g.fillStyle = tr.mute ? '#4a5260' : w.dataset.key === 'mic' ? '#3ddc97' : '#59a8ff';
      if (!peaks?.length) { g.fillRect(0, 13, Math.min(width, outDur * pps - left), 2); continue; }
      const vol = tr.volume ?? 1;
      for (let x = 0; x < width; x++) {
        const o = (left + x) / pps;
        if (o > outDur) break;
        const tt = TL.outputToSource(keep, o) - (m.offset || 0);
        const i = Math.floor(tt * 25);
        const v = i >= 0 && i < peaks.length ? peaks[i] / 255 * Math.min(1.4, vol) : 0;
        const h = Math.max(1, v * 26);
        g.fillRect(x, 14 - h / 2, 1, h);
      }
    }
  }

  // Zaman çizelgesinde gezinme
  function scrub(e) {
    const b = $('tl-inner').getBoundingClientRect();
    const o = TL.clamp((e.clientX - b.left) / pps, 0, outDur);
    seekOut(o);
  }
  $('tl-lanes').addEventListener('pointerdown', e => {
    if (!P || e.button !== 0 || e.target.closest('.seg-item')) return;
    pause();
    if (!e.target.closest('.tl-ruler')) select(null);
    scrub(e);
    const move = ev => scrub(ev);
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });

  // ---------- Özellikler paneli ----------
  function row(label, control) {
    const r = document.createElement('label');
    r.className = 'row';
    r.append(Object.assign(document.createElement('span'), { textContent: label }), control);
    return r;
  }
  function slider(min, max, step, value, oninput, fmtv) {
    const wrap = document.createElement('span');
    wrap.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) 42px;gap:6px;align-items:center';
    const r = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value });
    const out = document.createElement('output');
    out.textContent = fmtv(value);
    let before = null;
    r.onpointerdown = () => { before = JSON.stringify(E); };
    r.oninput = () => { oninput(+r.value); out.textContent = fmtv(+r.value); };
    r.onchange = () => { if (before && before !== JSON.stringify(E)) { history.push(before); future = []; afterChange(false); scheduleSave(); } before = null; };
    wrap.append(r, out);
    return wrap;
  }
  function segButtons(options, value, onpick) {
    const s = document.createElement('div');
    s.className = 'seg';
    for (const [v, label] of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(v === value));
      b.onclick = () => onpick(v);
      s.append(b);
    }
    return s;
  }
  function checkbox(value, onchange) {
    const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked: value });
    c.onchange = () => onchange(c.checked);
    return c;
  }
  function group(title, ...children) {
    const g = document.createElement('div');
    g.className = 'group';
    g.append(Object.assign(document.createElement('b'), { textContent: title }), ...children);
    return g;
  }
  function btn(label, onclick, cls = '') {
    const b = Object.assign(document.createElement('button'), { className: cls });
    b.innerHTML = label;
    b.onclick = onclick;
    return b;
  }
  function selTitle(ic, text) {
    const d = document.createElement('div');
    d.className = 'sel-title';
    d.innerHTML = `<span>${icon(ic)}</span><b>${text}</b>`;
    return d;
  }

  function cameraGroup() {
    if (!media('camera')) return null;
    return group('Kamera',
      row('Göster', checkbox(E.camera.visible, v => change(() => { E.camera.visible = v; }))),
      row('Şekil', segButtons([['circle', 'Daire'], ['rounded', 'Kare'], ['rect', 'Geniş']], E.camera.shape, v => change(() => { E.camera.shape = v; }))),
      row('Boyut', slider(0.1, 0.7, 0.01, E.camera.size, v => { E.camera.size = v; }, v => Math.round(v * 100) + '%')),
      row('Ayna', checkbox(!!E.camera.mirror, v => change(() => { E.camera.mirror = v; }))),
      row('Konum', segButtons([['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']], null, v => change(() => {
        E.camera.x = v[1] === 'l' ? 0.03 : 0.97; E.camera.y = v[0] === 't' ? 0.05 : 0.94; E.camera.visible = true;
      }))),
    );
  }

  function renderInspector() {
    const box = $('inspector');
    if (!P) { box.replaceChildren(); return; }
    const parts = [];
    if (sel?.type === 'zoom') {
      const z = E.zooms.find(x => x.id === sel.id);
      if (!z) { sel = null; return renderInspector(); }
      parts.push(selTitle('zoom', 'Yakınlaştırma'),
        group('Ayarlar',
          row('Yakınlık', slider(1.1, 3.5, 0.05, z.scale, v => { z.scale = v; z.auto = false; }, v => '×' + v.toFixed(1))),
          row('Süre', Object.assign(document.createElement('output'), { textContent: (z.e - z.s).toFixed(1) + ' sn' })),
          Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'Önizlemede yakınlaşılacak yeri tıklayın. Zaman çizelgesinde kenarlarından tutup süresini değiştirin.' }),
        ),
        btn(icon('trash') + 'Yakınlaştırmayı sil', deleteSelection));
    } else if (sel?.type === 'blur') {
      const b = E.blurs.find(x => x.id === sel.id);
      if (!b) { sel = null; return renderInspector(); }
      parts.push(selTitle('blur', 'Bulanıklaştırma'),
        group('Ayarlar',
          row('Güç', slider(6, 60, 1, b.strength || 22, v => { b.strength = v; }, v => String(v))),
          Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'API anahtarı, e-posta veya hesap bilgisi gibi alanları gizler. Alanı önizlemede sürükleyin.' }),
        ),
        btn(icon('trash') + 'Bulanıklaştırmayı sil', deleteSelection));
    } else if (sel?.type === 'clip') {
      const k = keep[sel.index];
      if (!k) { sel = null; return renderInspector(); }
      parts.push(selTitle('cut', 'Parça ' + (sel.index + 1)),
        group('Bilgi',
          row('Başlangıç', Object.assign(document.createElement('output'), { textContent: fmt(TL.sourceToOutput(keep, k.s)) })),
          row('Süre', Object.assign(document.createElement('output'), { textContent: fmt(k.e - k.s) })),
          Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'İstemediğiniz bölümün başına ve sonuna gelip S ile bölün, sonra parçayı seçip Delete ile silin.' }),
        ),
        btn(icon('trash') + 'Parçayı sil', deleteSelection));
    } else if (sel?.type === 'camera') {
      parts.push(selTitle('camera', 'Kamera'), cameraGroup());
    } else if (window.EditorHooks?.inspector && sel && !['zoom', 'blur', 'clip', 'camera'].includes(sel.type)) {
      const extra = window.EditorHooks.inspector(sel);
      if (!extra) { sel = null; return renderInspector(); }
      parts.push(...extra);
    } else {
      parts.push(selTitle('gear', 'Video ayarları'),
        group('Çıktı',
          row('Biçim', segButtons([['16:9', 'Yatay'], ['9:16', 'Dikey'], ['1:1', 'Kare']], E.output.aspect, v => change(() => { E.output.aspect = v; }))),
          row('Çözünürlük', segButtons([[1080, '1080p'], [720, '720p']], E.output.quality, v => change(() => { E.output.quality = v; }))),
          row('Arka plan', (() => { const c = Object.assign(document.createElement('input'), { type: 'color', value: E.output.bg || '#101418' }); c.onchange = () => change(() => { E.output.bg = c.value; }); return c; })()),
          ...(E.output.aspect === '9:16' && media('camera') ? [row('Dikey düzen', segButtons([['fit', 'Sığdır'], ['split', 'Ekran üstte, kamera altta']], E.output.layout || 'fit', v => change(() => { E.output.layout = v; E.camera.visible = true; })))] : []),
        ));
      parts.push(...(window.EditorHooks?.defaultGroups?.() || []));
      if (cursorEnabled()) parts.push(group('İmleç',
        row('Vurgu halkası', checkbox(E.cursor.highlight, v => change(() => { E.cursor.highlight = v; }))),
        row('Tıklama efekti', checkbox(E.cursor.clicks, v => change(() => { E.cursor.clicks = v; }))),
        row('Halka boyutu', slider(0.5, 2, 0.05, E.cursor.size || 1, v => { E.cursor.size = v; }, v => Math.round(v * 100) + '%')),
      ));
      const cg = cameraGroup();
      if (cg) parts.push(cg);
    }
    box.replaceChildren(...parts.filter(Boolean));
  }

  // ---------- Dışa aktarma ----------
  function openExport() {
    if (!P) return;
    pause();
    $('ex-aspect').value = E.output.aspect;
    $('ex-res').value = String(E.output.quality);
    $('ex-range').value = 'all';
    $('ex-range').options[1].disabled = !E.range;
    $('ex-range').options[1].textContent = E.range ? `Yalnızca seçili aralık (${fmt(TL.sourceToOutput(keep, E.range.s), false)} – ${fmt(TL.sourceToOutput(keep, E.range.e), false)})` : 'Yalnızca seçili aralık (kurguda I ve O ile seçin)';
    const hasWords = !!P.transcript?.words?.length;
    $('ex-captions').checked = hasWords && !!E.captions?.on;
    $('ex-captions').disabled = !hasWords;
    $('ex-srt').checked = false;
    $('ex-srt').disabled = !hasWords;
    $('export-form').hidden = false;
    $('export-progress').hidden = true;
    $('export-done').hidden = true;
    $('export-modal').hidden = false;
    updateSummary();
    api.encoder().then(label => { $('ex-summary').textContent = summaryText() + ' · Kodlayıcı: ' + label; });
  }
  function summaryText() {
    const size = TL.outputSize($('ex-aspect').value, +$('ex-res').value);
    const range = $('ex-range').value === 'range' && E.range ? E.range : null;
    const dur = TL.outputDuration(TL.clipKeep(keep, range)) + (!range && E.intro?.on ? E.intro.dur || 4 : 0) + (!range && E.outro?.on ? E.outro.dur || 5 : 0);
    return `Süre ${fmt(dur, false)} · ${size.w}×${size.h} · ${keep.length} parça · ${E.zooms.length} yakınlaştırma` + (E.overlays?.length ? ` · ${E.overlays.length} şablon` : '');
  }
  function updateSummary() { $('ex-summary').textContent = summaryText(); }
  $('ex-aspect').onchange = updateSummary;
  $('ex-res').onchange = updateSummary;
  $('ex-range').onchange = updateSummary;
  $('export-open').onclick = openExport;
  $('ex-close').onclick = () => { $('export-modal').hidden = true; };
  $('ex-done-close').onclick = () => { $('export-modal').hidden = true; };
  $('ex-done-icon').innerHTML = icon('check');
  let lastFile = null;
  $('ex-show').onclick = () => lastFile && api.showInFolder(lastFile);
  $('ex-cancel').onclick = () => api.exporter.cancel();
  api.exporter.onProgress(({ p, label }) => {
    $('ex-bar').style.width = Math.round(p * 100) + '%';
    $('ex-pct').textContent = Math.round(p * 100) + '%';
    $('ex-label').textContent = label ? '· ' + label : '';
  });
  $('ex-go').onclick = async () => {
    change(() => {
      E.output.aspect = $('ex-aspect').value; E.output.quality = +$('ex-res').value;
      if (E.captions) E.captions.on = $('ex-captions').checked;
    });
    await save();
    const range = $('ex-range').value === 'range' && E.range ? { ...E.range } : null;
    const assets = { ring: ringImg.toDataURL('image/png'), click: clickImg.toDataURL('image/png') };
    if (media('camera') && E.camera.visible && !layoutRects().split) {
      const r = camRect();
      assets.mask = makeMask(r.w, r.h, E.camera.shape).toDataURL('image/png');
    }
    $('export-form').hidden = true;
    $('export-progress').hidden = false;
    $('ex-bar').style.width = '0';
    $('ex-pct').textContent = '0%';
    $('ex-label').textContent = '· Hazırlanıyor';
    busy = true;
    let res;
    try {
      const extra = (await window.EditorHooks?.exportAssets?.({ range, srt: $('ex-srt').checked, onStep: t => { $('ex-label').textContent = '· ' + t; } })) || {};
      Object.assign(assets, extra.assets || {});
      const { cursorData, transcript, silences, ...rest } = P;
      res = await api.exporter.start(P.id, { ...rest, edit: E }, assets, { quality: $('ex-quality').value, range, srt: extra.srt || null, suffix: range ? ' (klip)' : '' });
    } catch (err) { res = { error: err.message }; }
    busy = false;
    $('export-progress').hidden = true;
    if (res.canceled) { $('export-form').hidden = false; return; }
    if (res.error) { $('export-form').hidden = false; $('ex-summary').textContent = 'Dışa aktarılamadı: ' + res.error; return; }
    lastFile = res.file;
    $('export-done').hidden = false;
    $('ex-done-info').textContent = `${res.file} · ${Math.round(res.seconds)} saniyede hazırlandı (${res.encoder}).` + (res.srt ? ' Altyazı dosyası da yanına kaydedildi.' : '');
  };
})();
