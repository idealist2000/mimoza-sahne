import { paintLesson } from './lesson.js';
const $ = id => document.getElementById(id);
const preview = $('capture-preview');
const context = preview.getContext('2d');
let current;

function release(session) {
  cancelAnimationFrame(session.frame);
  for (const stream of session.streams) stream.getTracks().forEach(track => track.stop());
  session.audio?.close().catch(() => {});
  session.screen?.pause();
  session.camera?.pause();
}

async function source(stream) {
  const element = document.createElement('video');
  element.srcObject = stream;
  element.muted = true;
  element.playsInline = true;
  await element.play();
  return element;
}

function cover(ctx, image, x, y, width, height) {
  const iw = image.videoWidth || image.naturalWidth;
  const ih = image.videoHeight || image.naturalHeight;
  if (!iw || !ih) return;
  const scale = Math.max(width / iw, height / ih);
  const cropWidth = width / scale;
  const cropHeight = height / scale;
  ctx.drawImage(image, (iw - cropWidth) / 2, (ih - cropHeight) / 2, cropWidth, cropHeight, x, y, width, height);
}

function draw(session) {
  const { width, height } = preview;
  context.fillStyle = '#141726';
  context.fillRect(0, 0, width, height);
  if (session.screen) {
    const scale = Math.min(width / session.screen.videoWidth, height / session.screen.videoHeight);
    const w = session.screen.videoWidth * scale, h = session.screen.videoHeight * scale;
    if (Number.isFinite(w) && Number.isFinite(h)) context.drawImage(session.screen, (width - w) / 2, (height - h) / 2, w, h);
  }
  if (session.camera) {
    const w = session.screen ? Math.round(width * 0.25) : width;
    const h = session.screen ? Math.round(w * 9 / 16) : height;
    const x = session.screen ? width - w - 20 : 0;
    const y = session.screen ? height - h - 20 : 0;
    if (session.background) {
      const layer = session.layer;
      const painter = session.painter;
      layer.width = w;
      layer.height = h;
      cover(painter, session.camera, 0, 0, w, h);
      const frame = painter.getImageData(0, 0, w, h);
      for (let i = 0; i < frame.data.length; i += 4) {
        const red = frame.data[i], green = frame.data[i + 1], blue = frame.data[i + 2];
        const strength = green - Math.max(red, blue);
        if (green > 55 && strength > 24) frame.data[i + 3] = Math.max(0, Math.round(255 * (1 - (strength - 24) / 45)));
      }
      painter.putImageData(frame, 0, 0);
      cover(context, session.background, x, y, w, h);
      context.drawImage(layer, x, y);
    } else {
      cover(context, session.camera, x, y, w, h);
    }
  }
  if (session.gains) {
    const level = $('lesson-scene').value === 'privacy' ? 0 : session.gains.length > 1 ? 0.7 : 1;
    for (const gain of session.gains) gain.gain.value = level;
  }
  paintLesson(context, width, height);
  session.frame = requestAnimationFrame(() => draw(session));
}

function finish(message) {
  $('record-status').textContent = message;
  $('record-start').disabled = false;
  $('record-stop').disabled = true;
  $('editor').inert = false;
  $('capture-options').disabled = false;
}

$('record-start').onclick = async () => {
  const screen = $('record-screen').checked;
  const camera = $('record-camera').checked;
  if ($('editor').querySelector('#file').disabled) return finish('Önce düzenleme işleminin bitmesini bekleyin.');
  if (!screen && !camera) return finish('Ekran veya kamera seçin.');
  if (!navigator.mediaDevices || !window.MediaRecorder || !preview.captureStream) return finish('Kayıt için uygulamayı Chrome veya Edge’de açın.');
  const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) return finish('Tarayıcı WebM kaydını desteklemiyor.');
  $('record-start').disabled = true;
  $('editor').inert = true;
  $('capture-options').disabled = true;
  $('record-status').textContent = 'Kayıt izinleri bekleniyor…';
  const session = { streams: [] };
  current = session;
  try {
    if (screen) {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: $('record-system').checked });
      session.streams.push(stream);
      session.screen = await source(stream);
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        session.screenEnded = true;
        if (session.recorder && session.recorder.state !== 'inactive') session.recorder.stop();
      }, { once: true });
    }
    if (camera || $('record-mic').checked) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: camera ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
        audio: $('record-mic').checked,
      });
      session.streams.push(stream);
      if (camera) session.camera = await source(stream);
    }
    const file = $('record-background').files[0];
    if (file && camera) {
      const url = URL.createObjectURL(file);
      try {
        session.background = new Image();
        session.background.src = url;
        await session.background.decode();
      } finally {
        URL.revokeObjectURL(url);
      }
      session.layer = document.createElement('canvas');
      session.painter = session.layer.getContext('2d', { willReadFrequently: true });
    }
    if (session.screenEnded) throw new Error('Ekran paylaşımı kapatıldı.');
    preview.hidden = false;
    draw(session);
    const output = preview.captureStream(30);
    session.streams.push(output);
    const audioTracks = session.streams.flatMap(stream => stream.getAudioTracks());
    if (audioTracks.length) {
      session.gains = [];
      session.audio = new AudioContext();
      await session.audio.resume();
      const mix = session.audio.createMediaStreamDestination();
      for (const track of audioTracks) {
        const sourceNode = session.audio.createMediaStreamSource(new MediaStream([track]));
        const gain = session.audio.createGain();
        gain.gain.value = audioTracks.length > 1 ? 0.7 : 1;
        session.gains.push(gain);
        sourceNode.connect(gain).connect(mix);
      }
      output.addTrack(mix.stream.getAudioTracks()[0]);
    }
    if (session.screenEnded) throw new Error('Ekran paylaşımı kapatıldı.');
    const chunks = [];
    const recorder = new MediaRecorder(output, { mimeType, videoBitsPerSecond: 4_000_000 });
    session.recorder = recorder;
    session.output = output;
    session.mimeType = mimeType;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { session.failed = true; };
    recorder.onstop = () => {
      const duration = (performance.now() - session.start - session.paused - (session.pauseStart ? performance.now() - session.pauseStart : 0)) / 1000;
      stopLive(session);
      release(session);
      current = undefined;
      if (session.failed || !chunks.length) return finish('Kayıt dosyası oluşturulamadı.');
      const file = new File(chunks, 'mimoza-kayit.webm', { type: 'video/webm' });
      document.dispatchEvent(new CustomEvent('mimoza-recorded', { detail: { file, duration } }));
      finish('Kayıt düzenleyiciye aktarıldı.');
    };
    recorder.start(1000);
    session.start = performance.now();
    session.paused = 0;
    document.dispatchEvent(new Event('mimoza-capture-start'));
    $('record-stop').disabled = false;
    $('record-status').textContent = 'Kayıt sürüyor. Bu sekmeyi başka bir pencerenin arkasında açık tutun. Kayda bu sekmeyi dahil etmeyin.';
  } catch (error) {
    release(session);
    current = undefined;
    finish('Kayıt başlatılamadı. ' + error.message);
  }
};

$('record-stop').onclick = () => {
  if (current?.recorder && current.recorder.state !== 'inactive') current.recorder.stop();
};


const pauseButton = $('record-pause');
const stopButton = $('record-stop');
new MutationObserver(() => { pauseButton.disabled = stopButton.disabled; }).observe(stopButton, { attributes: true, attributeFilter: ['disabled'] });
pauseButton.onclick = () => {
  const session = current;
  if (session?.recorder?.state === 'recording') {
    session.recorder.pause();
    session.pauseStart = performance.now();
    pauseButton.textContent = 'Sürdür (Alt+P)';
    document.dispatchEvent(new Event('mimoza-capture-pause'));
  } else if (session?.recorder?.state === 'paused') {
    session.recorder.resume();
    session.paused += performance.now() - session.pauseStart;
    session.pauseStart = undefined;
    pauseButton.textContent = 'Duraklat (Alt+P)';
    document.dispatchEvent(new Event('mimoza-capture-resume'));
  }
};
document.addEventListener('mimoza-recorded', () => { pauseButton.textContent = 'Duraklat (Alt+P)'; });
$('studio-full').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) { $('record-status').textContent = error.message; }
};


const liveStatus = message => { $('live-status').textContent = message; };
let activeLive;

async function sendLive(action, headers, body) {
  const response = await fetch('/live/' + action, {
    method: 'POST', headers, body, signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

function stopLive(owner) {
  const relay = activeLive;
  if (relay?.owner === owner && relay.recorder.state !== 'inactive') relay.recorder.stop();
}

$('live-start').onclick = async () => {
  const owner = current;
  const key = $('live-key').value.trim();
  if (!owner?.output || owner.recorder.state === 'inactive') return liveStatus('Önce yerel kaydı başlatın.');
  if (!/^[a-z0-9-]{8,128}$/i.test(key)) return liveStatus('YouTube yayın anahtarınızı girin.');
  if (activeLive) return;
  $('live-start').disabled = true;
  liveStatus('FFmpeg başlatılıyor…');
  let headers;
  try {
    const result = await sendLive('start', { 'x-mimoza-stream-key': key });
    headers = { 'x-mimoza-live-id': result.id };
    $('live-key').value = '';
    if (current !== owner || owner.recorder.state === 'inactive') throw new Error('Yerel kayıt sona erdi.');
    const recorder = new MediaRecorder(owner.output, {
      mimeType: owner.mimeType, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128000,
    });
    const relay = { owner, recorder, pending: Promise.resolve(), queued: 0, error: null };
    activeLive = relay;
    recorder.ondataavailable = event => {
      if (!event.data.size || relay.error) return;
      if (relay.queued >= 6) {
        relay.error = new Error('Yayın bağlantısı kayıt hızına yetişemedi.');
        stopLive(owner);
        return;
      }
      relay.queued++;
      relay.pending = relay.pending.then(async () => {
        if (!relay.error) await sendLive('chunk', headers, event.data);
      }).catch(error => {
        relay.error = error;
        stopLive(owner);
      }).finally(() => { relay.queued--; });
    };
    recorder.onerror = () => {
      relay.error = new Error('Canlı yayın kaydedicisi durdu.');
      stopLive(owner);
    };
    recorder.onstop = async () => {
      await relay.pending;
      try { await sendLive('stop', headers); } catch (error) { relay.error ??= error; }
      activeLive = undefined;
      $('live-start').disabled = false;
      $('live-stop').disabled = true;
      liveStatus(relay.error?.message || 'Sinyal kesildi. Yayının kapandığını YouTube Studio’da kontrol edin.');
    };
    recorder.start(800);
    $('live-stop').disabled = false;
    liveStatus('Sinyal gönderiliyor. Önizlemeyi ve yayın durumunu YouTube Studio’da kontrol edin.');
  } catch (error) {
    activeLive = undefined;
    if (headers) await sendLive('stop', headers).catch(() => {});
    $('live-start').disabled = false;
    liveStatus(error.message);
  }
};
$('live-stop').onclick = () => { if (activeLive) stopLive(activeLive.owner); };

