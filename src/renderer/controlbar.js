// Kayıt motoru: kaynakları açar, her kanalı ayrı MediaRecorder ile diske yazar.
const $ = id => document.getElementById(id);
const api = window.mimoza;

// Simgeler
$('grip').innerHTML = icon('grip');
$('pause').innerHTML = icon('pause');
$('stop').innerHTML = icon('stop') + 'Bitir';
$('draw').innerHTML = icon('pen');
$('clear').innerHTML = icon('trash');
$('mark').innerHTML = icon('flag');
$('privacy').innerHTML = icon('eyeoff');
$('card').innerHTML = icon('card');
$('next').innerHTML = icon('next');
$('mic').innerHTML = icon('mic');
$('cancel').innerHTML = icon('x');
for (const b of document.querySelectorAll('[data-tool]')) b.innerHTML = icon(b.dataset.tool);

let config;
let streams = [];
const recorders = []; // { name, recorder, trackId, queue, startedAt }
let screenStart = 0;
let state = 'waiting'; // waiting | recording | paused | stopping
let pausedTotal = 0, pausedAt = 0;
let marks = [], privacy = [], privacyStart = null;
let micTracks = [];
let drawOn = false, cardOn = false, cardIndex = 0, cards = [];
let flashUntil = 0, flashText = '';
let audioCtx, analyser;

const now = () => performance.now();
function elapsed() {
  if (!screenStart) return 0;
  const p = pausedTotal + (pausedAt ? now() - pausedAt : 0);
  return Math.max(0, (now() - screenStart - p) / 1000);
}
const fmt = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); };
function flash(text) { flashText = text; flashUntil = now() + 1400; }

function tick() {
  $('time').textContent = now() < flashUntil ? flashText : fmt(elapsed());
  if (analyser) {
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
    $('level').style.height = Math.min(100, peak / 128 * 160) + '%';
    $('level').style.background = peak > 115 ? 'var(--red)' : 'var(--green)';
  }
  setTimeout(tick, 100);
}

function pickMime(kind) {
  const list = kind === 'audio' ? ['audio/webm;codecs=opus', 'audio/webm'] :
    ['video/x-matroska;codecs=avc1', 'video/webm;codecs=h264', 'video/webm;codecs=vp8', 'video/webm'];
  return list.find(t => MediaRecorder.isTypeSupported(t));
}

async function addRecorder(name, stream, kind, bits) {
  const mimeType = pickMime(kind);
  if (!mimeType) throw new Error('Kayıt biçimi desteklenmiyor.');
  const trackId = await api.rec.openTrack(name, mimeType);
  const opts = { mimeType };
  if (kind === 'audio') opts.audioBitsPerSecond = 128000; else opts.videoBitsPerSecond = bits;
  const recorder = new MediaRecorder(stream, opts);
  const entry = { name, recorder, trackId, queue: Promise.resolve(), startedAt: 0 };
  recorder.ondataavailable = ev => {
    if (!ev.data.size) return;
    entry.queue = entry.queue.then(async () => api.rec.chunk(trackId, new Uint8Array(await ev.data.arrayBuffer())));
  };
  recorder.onstart = () => { entry.startedAt = now(); };
  entry.stopped = new Promise(res => { recorder.onstop = res; recorder.onerror = res; });
  recorders.push(entry);
  return entry;
}

let FPS = 30;
async function openSources() {
  FPS = config.light ? 24 : 30;
  const big = config.quality === 720 ? { w: 1280, h: 720 } : { w: 1920, h: 1080 };
  let screen = null;
  if (config.sourceId) {
    screen = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: FPS, max: 30 }, width: { max: big.w }, height: { max: big.h } },
      audio: !!config.system,
    });
    streams.push(screen);
    screen.getVideoTracks()[0].addEventListener('ended', () => { if (state === 'recording' || state === 'paused') stop(); });
  }
  let camera = null;
  if (config.cameraId) {
    camera = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: config.cameraId }, width: { ideal: config.light ? 640 : 960 }, height: { ideal: config.light ? 360 : 540 }, frameRate: { ideal: FPS, max: 30 } } });
    streams.push(camera);
  }
  let mic = null;
  if (config.micId) {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: config.micId }, echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    streams.push(mic);
    micTracks = mic.getAudioTracks();
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    audioCtx.createMediaStreamSource(mic).connect(analyser);
  }
  return { screen, camera, mic };
}

// Ekran yakalama yalnızca görüntü değiştiğinde kare üretir. Sabit duran bir ekranda
// video kısalır ve ses kayar. Bu yüzden ekranı sabit 30 kare/sn'lik bir tuvalden geçiririz.
let pump = null;
async function constantFrameRate(stream) {
  const track = stream.getVideoTracks()[0];
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = new MediaStream([track]);
  await video.play();
  for (let i = 0; i < 40 && !video.videoWidth; i++) await new Promise(r => setTimeout(r, 50));
  const s = track.getSettings();
  const c = document.createElement('canvas');
  c.width = Math.round((video.videoWidth || s.width || 1920) / 2) * 2;
  c.height = Math.round((video.videoHeight || s.height || 1080) / 2) * 2;
  const g = c.getContext('2d', { alpha: false, desynchronized: true });
  const out = c.captureStream(0);
  const outTrack = out.getVideoTracks()[0];
  const draw = () => {
    if (video.videoWidth) {
      const k = Math.min(c.width / video.videoWidth, c.height / video.videoHeight);
      const w = video.videoWidth * k, h = video.videoHeight * k;
      if (w < c.width || h < c.height) { g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(video, (c.width - w) / 2, (c.height - h) / 2, w, h);
    }
    outTrack.requestFrame();
  };
  draw();
  // Çalışan bir zamanlayıcı: pencere görünür ve arka plan yavaşlatması kapalı.
  pump = setInterval(draw, 1000 / FPS);
  streams.push(out);
  return out;
}

async function start() {
  config = await api.rec.config();
  if (!config) return;
  cards = Profiles.parseCards(config.cards);
  if (!cards.length) { $('card').disabled = true; $('next').disabled = true; }
  if (!config.micId) { $('mic').disabled = true; }
  if (config.kind === 'window') { $('draw').disabled = true; $('clear').disabled = true; $('draw').title = 'Pencere kaydında çizim kayda girmez. Ekran veya alan kaydı seçin.'; }
  api.overlay.send({ type: 'init', config: { kind: config.kind, region: config.region, profile: config.profile } });
  let src;
  flash('Hazırlanıyor');
  flashUntil = Infinity;
  try {
    src = await openSources();
  } catch (e) {
    alert('Kayıt başlatılamadı: ' + e.message + '\n\nKamera veya mikrofon başka bir uygulamada açık olabilir.');
    return api.rec.cancel();
  }
  flashUntil = 0;
  // Geri sayım
  for (const n of [3, 2, 1]) {
    api.overlay.send({ type: 'countdown', n });
    flash(String(n)); flashUntil = Infinity;
    await new Promise(r => setTimeout(r, 900));
  }
  api.overlay.send({ type: 'countdown', n: 0 });
  flashUntil = 0;
  await new Promise(r => setTimeout(r, 120));
  try {
    const hd = config.quality !== 720;
    if (src.screen) {
      await addRecorder('screen', await constantFrameRate(src.screen), 'video', hd ? 6_000_000 : 3_500_000);
      if (src.screen.getAudioTracks().length) await addRecorder('system', new MediaStream(src.screen.getAudioTracks()), 'audio');
    }
    if (src.camera) await addRecorder('camera', src.camera, 'video', config.light ? 1_000_000 : 2_000_000);
    if (src.mic) await addRecorder('mic', src.mic, 'audio');
    if (!recorders.length) throw new Error('Kaydedilecek kaynak seçilmedi.');
    for (const r of recorders) r.recorder.start(1000);
    await new Promise(r => setTimeout(r, 60));
    const master = recorders.find(r => r.name === 'screen') || recorders[0];
    screenStart = master.startedAt || now();
    const logStart = now();
    await api.rec.started();
    config.cursorShift = (logStart - screenStart) / 1000;
    state = 'recording';
    $('state').className = 'rec';
    watchMemory();
  } catch (e) {
    alert('Kayıt başlatılamadı: ' + e.message);
    return api.rec.cancel();
  }
}

// Kayıt sırasında boş bellek kritik seviyeye inerse uyar.
let memWarnedAt = 0;
function watchMemory() {
  setInterval(async () => {
    if (state !== 'recording' && state !== 'paused') return;
    const st = await api.sysStatus(false).catch(() => null);
    if (!st || st.freeGB >= 0.6 || now() - memWarnedAt < 20000) return;
    memWarnedAt = now();
    flash('Bellek az!');
    flashUntil = now() + 4000;
    $('state').title = 'Boş bellek çok az. Kullanmadığınız programları kapatın veya kaydı bitirin.';
  }, 5000);
}

function togglePause() {
  if (state === 'recording') {
    for (const r of recorders) if (r.recorder.state === 'recording') r.recorder.pause();
    pausedAt = now();
    state = 'paused';
    $('state').className = 'rec paused';
    $('pause').innerHTML = icon('play');
    api.rec.paused(true);
  } else if (state === 'paused') {
    for (const r of recorders) if (r.recorder.state === 'paused') r.recorder.resume();
    pausedTotal += now() - pausedAt;
    pausedAt = 0;
    state = 'recording';
    $('state').className = 'rec';
    $('pause').innerHTML = icon('pause');
    api.rec.paused(false);
  }
}

async function stop() {
  if (state !== 'recording' && state !== 'paused') return;
  if (privacyStart !== null) togglePrivacy();
  const end = elapsed();
  state = 'stopping';
  $('state').className = 'rec waiting';
  $('time').textContent = 'Kaydediliyor';
  for (const b of document.querySelectorAll('button')) b.disabled = true;
  for (const r of recorders) if (r.recorder.state !== 'inactive') r.recorder.stop();
  await Promise.all(recorders.map(r => r.stopped));
  await Promise.all(recorders.map(r => r.queue));
  clearInterval(pump);
  for (const s of streams) s.getTracks().forEach(t => t.stop());
  const master = recorders.find(r => r.name === 'screen') || recorders[0];
  const offsets = {};
  for (const r of recorders) offsets[r.name] = (r.startedAt - master.startedAt) / 1000;
  await api.rec.finish({ offsets, cursorShift: config.cursorShift || 0, marks, privacy, duration: end });
}

async function cancel() {
  if (state === 'stopping') return;
  if (!confirm('Kayıt iptal edilsin mi? Kaydedilen görüntü silinir.')) return;
  state = 'stopping';
  for (const r of recorders) if (r.recorder.state !== 'inactive') r.recorder.stop();
  for (const s of streams) s.getTracks().forEach(t => t.stop());
  await api.rec.cancel();
}

function setDraw(on) {
  if (config?.kind === 'window') return;
  drawOn = on;
  $('draw').setAttribute('aria-pressed', String(on));
  $('tools').hidden = !on;
  api.overlay.send({ type: 'draw', on });
}

function togglePrivacy() {
  if (state !== 'recording' && state !== 'paused') return;
  if (privacyStart === null) { privacyStart = elapsed(); $('privacy').setAttribute('aria-pressed', 'true'); api.overlay.send({ type: 'privacy', on: true }); }
  else { privacy.push({ s: privacyStart, e: elapsed() }); privacyStart = null; $('privacy').setAttribute('aria-pressed', 'false'); api.overlay.send({ type: 'privacy', on: false }); }
}

function showCard(on) {
  if (!cards.length) return;
  cardOn = on;
  $('card').setAttribute('aria-pressed', String(on));
  api.overlay.send(on ? { type: 'card', fields: cards[cardIndex], index: cardIndex, total: cards.length } : { type: 'card', fields: null });
}

function toggleMic() {
  if (!micTracks.length) return;
  const muted = micTracks[0].enabled;
  for (const t of micTracks) t.enabled = !muted;
  $('mic').setAttribute('aria-pressed', String(muted));
  $('mic').innerHTML = icon(muted ? 'micoff' : 'mic');
  flash(muted ? 'Mikrofon kapalı' : 'Mikrofon açık');
}

const commands = {
  pause: togglePause,
  stop,
  cancel,
  draw: () => setDraw(!drawOn),
  clear: () => api.overlay.send({ type: 'clear' }),
  undo: () => api.overlay.send({ type: 'undo' }),
  mark: () => {
    if (state !== 'recording' && state !== 'paused') return;
    marks.push({ t: elapsed(), label: 'Bölüm ' + (marks.length + 1) });
    flash('İşaret ' + marks.length);
  },
  privacy: togglePrivacy,
  card: () => showCard(!cardOn),
  'next-card': () => { if (!cards.length) return; cardIndex = (cardIndex + 1) % cards.length; showCard(true); },
  mic: toggleMic,
};
api.rec.onCmd(cmd => commands[cmd]?.());
api.overlay.onEvent(msg => {
  if (msg.type === 'draw-off') setDraw(false);
  else if (msg.type === 'tool') for (const o of document.querySelectorAll('[data-tool]')) o.setAttribute('aria-pressed', String(o.dataset.tool === msg.tool));
  else if (msg.type === 'color') for (const o of document.querySelectorAll('[data-color]')) o.setAttribute('aria-pressed', String(o.dataset.color === msg.color));
  else if (msg.type === 'temporary') $('temporary').checked = msg.on;
});

$('pause').onclick = commands.pause;
$('stop').onclick = commands.stop;
$('cancel').onclick = commands.cancel;
$('draw').onclick = commands.draw;
$('clear').onclick = commands.clear;
$('mark').onclick = commands.mark;
$('privacy').onclick = commands.privacy;
$('card').onclick = commands.card;
$('next').onclick = commands['next-card'];
$('mic').onclick = commands.mic;
for (const b of document.querySelectorAll('[data-tool]')) b.onclick = () => {
  for (const o of document.querySelectorAll('[data-tool]')) o.setAttribute('aria-pressed', String(o === b));
  api.overlay.send({ type: 'tool', tool: b.dataset.tool });
};
for (const b of document.querySelectorAll('[data-color]')) b.onclick = () => {
  for (const o of document.querySelectorAll('[data-color]')) o.setAttribute('aria-pressed', String(o === b));
  api.overlay.send({ type: 'color', color: b.dataset.color });
};
// Kontrol çubuğu odaktayken de çizim kısayolları çalışsın.
addEventListener('keydown', e => {
  if (!drawOn) return;
  const tools = [...document.querySelectorAll('[data-tool]')];
  if (/^[1-6]$/.test(e.key)) tools[+e.key - 1].click();
  else if (e.key.toLowerCase() === 'c') {
    const sw = [...document.querySelectorAll('[data-color]')];
    const i = sw.findIndex(b => b.getAttribute('aria-pressed') === 'true');
    sw[(i + 1) % sw.length].click();
  } else if (e.key.toLowerCase() === 'g') $('temporary').click();
  else if (e.key === 'Escape') setDraw(false);
});
$('temporary').onchange = () => api.overlay.send({ type: 'temporary', on: $('temporary').checked });

// Kontrol çubuğu boyutu çizim araçlarına göre değişir
new MutationObserver(() => api.rec.resize?.($('bar').offsetHeight + 8)).observe($('tools'), { attributes: true });

tick();
start();
