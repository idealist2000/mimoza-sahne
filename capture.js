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
        if (session.recorder?.state === 'recording') session.recorder.stop();
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
      session.audio = new AudioContext();
      await session.audio.resume();
      const mix = session.audio.createMediaStreamDestination();
      for (const track of audioTracks) {
        const sourceNode = session.audio.createMediaStreamSource(new MediaStream([track]));
        const gain = session.audio.createGain();
        gain.gain.value = audioTracks.length > 1 ? 0.7 : 1;
        sourceNode.connect(gain).connect(mix);
      }
      output.addTrack(mix.stream.getAudioTracks()[0]);
    }
    if (session.screenEnded) throw new Error('Ekran paylaşımı kapatıldı.');
    const chunks = [];
    const recorder = new MediaRecorder(output, { mimeType, videoBitsPerSecond: 4_000_000 });
    session.recorder = recorder;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { session.failed = true; };
    recorder.onstop = () => {
      const duration = (performance.now() - session.start) / 1000;
      release(session);
      current = undefined;
      if (session.failed || !chunks.length) return finish('Kayıt dosyası oluşturulamadı.');
      const file = new File(chunks, 'mimoza-kayit.webm', { type: 'video/webm' });
      document.dispatchEvent(new CustomEvent('mimoza-recorded', { detail: { file, duration } }));
      finish('Kayıt düzenleyiciye aktarıldı.');
    };
    recorder.start(1000);
    session.start = performance.now();
    $('record-stop').disabled = false;
    $('record-status').textContent = 'Kayıt sürüyor. Bu sekmeyi başka bir pencerenin arkasında açık tutun. Kayda bu sekmeyi dahil etmeyin.';
  } catch (error) {
    release(session);
    current = undefined;
    finish('Kayıt başlatılamadı. ' + error.message);
  }
};

$('record-stop').onclick = () => {
  if (current?.recorder?.state === 'recording') current.recorder.stop();
};
