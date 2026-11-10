const $ = id => document.getElementById(id);
const video = $('video');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const status = message => { $('status').textContent = message; };
let scenes = [];
let sourceUrl;
let sourceFile;
let audio;
let audioSource;
let recorder;
let cancelled = false;
let busy = false;
let recordedDuration;
const duration = () => Number.isFinite(video.duration) ? video.duration : recordedDuration;

function setBusy(value) {
  busy = value;
  document.querySelectorAll('#editor input, #editor textarea, #editor select, #editor button:not(#cancel)').forEach(control => {
    control.disabled = value || (control.id === 'download-source' && !sourceFile);
  });
}

$('file').onchange = () => loadVideo($('file').files[0]);
document.addEventListener('mimoza-recorded', event => loadVideo(event.detail.file, event.detail.duration));
function loadVideo(file, length) {
  if (!file) return;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceFile = file;
  $('download-source').disabled = false;
  sourceUrl = URL.createObjectURL(file);
  recordedDuration = length;
  $('trim-start').value = '0';
  $('trim-end').value = '';
  video.src = sourceUrl;
  scenes = [];
  edit();
  status('Video açılıyor…');
};
$('aspect').onchange = resize;
video.onloadedmetadata = () => {
  resize();
  status('Metni ekleyin veya elle bir başlık oluşturun.');
};
function resize() {
  const formats = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [960, 960] };
  const size = formats[$('aspect').value];
  if (size) {
    [canvas.width, canvas.height] = size;
    return;
  }
  if (!video.videoWidth || !video.videoHeight) return;
  const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
  canvas.height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
}
video.addEventListener('error', () => status('Video okunamadı. Tarayıcınızın desteklediği bir MP4 veya WebM deneyin.'));
$('srt').onchange = async () => {
  const file = $('srt').files[0];
  if (file) $('script').value = await file.text();
};

function parseTime(value) {
  const [hours, minutes, seconds] = value.replace(',', '.').split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

function readCues() {
  if (!Number.isFinite(duration())) throw new Error('Önce bir video seçin.');
  const text = $('script').value.trim().replace(/\r\n?/g, '\n');
  if (!text) throw new Error('Önce konuşma metnini veya SRT altyazısını ekleyin.');
  if (text.includes('-->')) {
    const cues = text.split(/\n\s*\n/).flatMap(block => {
      const match = block.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})[^\n]*\n([\s\S]+)/);
      if (!match) return [];
      const start = parseTime(match[1]);
      const end = Math.min(duration(), parseTime(match[2]));
      const title = match[3].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      return start < end && title ? [{ start, end, title }] : [];
    });
    if (!cues.length) throw new Error('Video süresi içinde geçerli SRT satırı bulunamadı.');
    return cues;
  }
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const step = duration() / lines.length;
  return lines.map((title, index) => ({ title, start: index * step, end: (index + 1) * step }));
}

function plan(cues, picks) {
  scenes = picks.map(({ index, title }) => {
    const { start, end } = cues[index];
    return { start, end: Math.min(duration(), Math.max(start + 2.5, Math.min(end, start + 4))), title };
  }).sort((a, b) => a.start - b.start);
  edit();
  status(scenes.length + ' başlık hazır. Metni ve süreleri aşağıdan düzenleyebilirsiniz.');
}

$('quick').onclick = () => {
  try {
    const cues = readCues();
    const stride = Math.ceil(cues.length / 8);
    plan(cues, cues.flatMap((cue, index) => index % stride === 0 ?
      [{ index, title: cue.title.split(/\s+/).slice(0, 6).join(' ').slice(0, 75) }] : []));
  } catch (error) { status(error.message); }
};

$('ai').onclick = async () => {
  try {
    const cues = readCues();
    const model = $('model').value.trim();
    if (!model) throw new Error('Ollama modelinin adını girin.');
    if (cues.length > 120) throw new Error('Yapay zekâ planı için en fazla 120 altyazı satırı kullanın.');
    setBusy(true);
    status('Ollama başlıkları hazırlıyor…');
    const response = await fetch('/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, cues: cues.map(cue => cue.title.slice(0, 500)) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    plan(cues, data.scenes);
  } catch (error) { status(error.message); }
  finally { setBusy(false); }
};

$('add').onclick = () => {
  if (!Number.isFinite(duration())) return status('Önce bir video seçin.');
  const start = Math.min(video.currentTime, Math.max(0, duration() - 0.5));
  scenes.push({ title: 'Yeni başlık', start, end: Math.min(duration(), start + 3) });
  edit();
};

function edit() {
  $('scenes').replaceChildren(...scenes.map((scene, index) => {
    const row = document.createElement('div');
    row.className = 'scene';
    for (const [field, caption] of [['title', 'Başlık'], ['start', 'Başlangıç (sn)'], ['end', 'Bitiş (sn)']]) {
      const label = document.createElement('label');
      label.textContent = caption;
      const input = document.createElement('input');
      input.type = field === 'title' ? 'text' : 'number';
      if (field === 'title') input.maxLength = 75;
      else { input.min = 0; input.step = '0.01'; }
      input.value = field === 'title' ? scene[field] : Number(scene[field].toFixed(2));
      input.oninput = () => { scene[field] = field === 'title' ? input.value : input.valueAsNumber; };
      label.append(input);
      row.append(label);
    }
    const remove = document.createElement('button');
    remove.textContent = 'Sil';
    remove.onclick = () => { scenes.splice(index, 1); edit(); };
    row.append(remove);
    return row;
  }));
}

function draw() {
  const { width, height } = canvas;
  ctx.fillStyle = '#10121b';
  ctx.fillRect(0, 0, width, height);
  if (video.readyState >= 2) {
    const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
    const w = video.videoWidth * scale, h = video.videoHeight * scale;
    ctx.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
  }
  const time = video.currentTime;
  const active = scenes.reduce((latest, scene) => (
    scene.title.trim() && scene.start <= time && time < scene.end &&
    (!latest || scene.start >= latest.start) ? scene : latest
  ), null);
  if (!active) return;
  const unit = Math.min(width, height);
  const fade = Math.min(1, (time - active.start) / 0.28, (active.end - time) / 0.22);
  const x = unit * 0.055;
  const y = height - unit * (0.19 - (1 - fade) * 0.025);
  const padding = unit * 0.028;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.font = 'bold ' + Math.round(unit * 0.07) + 'px system-ui';
  ctx.textBaseline = 'middle';
  const maxText = width - 2 * (x + padding);
  const boxWidth = Math.min(ctx.measureText(active.title).width, maxText) + 2 * padding;
  ctx.fillStyle = '#111521';
  ctx.fillRect(x, y, boxWidth, unit * 0.12);
  ctx.fillStyle = $('accent').value;
  ctx.fillRect(x, y, unit * 0.008, unit * 0.12);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(active.title, x + padding, y + unit * 0.06, maxText);
  ctx.restore();
}

function preview() {
  if (!document.hidden) draw();
  requestAnimationFrame(preview);
}
requestAnimationFrame(preview);

$('cancel').onclick = () => {
  cancelled = true;
  if (recorder?.state === 'recording') recorder.stop();
};

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

$('download-source').onclick = () => {
  if (!sourceFile) return status('Önce bir video kaydedin veya yükleyin.');
  download(sourceFile, sourceFile.name || 'mimoza-kayit.webm');
  status('Kaynak dosya yeniden işlenmeden indirmeye gönderildi.');
};

$('poster').onclick = () => {
  if (video.readyState < 2) return status('Önce bir video yükleyin.');
  draw();
  canvas.toBlob(blob => {
    if (blob) download(blob, 'mimoza-kapak.png');
  }, 'image/png');
};

$('export').onclick = async () => {
  if (busy || !Number.isFinite(duration()) || video.readyState < 2) return status('Önce videonun yüklenmesini bekleyin.');
  if (scenes.some(scene => !Number.isFinite(scene.start) || !Number.isFinite(scene.end) ||
    scene.start < 0 || scene.start >= scene.end || scene.start >= duration() ||
    scene.end > duration() + 0.005)) return status('Başlıkların başlangıç ve bitiş sürelerini kontrol edin.');
  if (!window.MediaRecorder || !canvas.captureStream) return status('Dışa aktarmak için Chrome veya Edge kullanın.');
  const start = $('trim-start').valueAsNumber;
  const end = $('trim-end').value === '' ? duration() : $('trim-end').valueAsNumber;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end || end > duration()) {
    return status('Kesit başlangıcını ve bitişini kontrol edin.');
  }
  const format = $('format').value;
  const types = format === 'mp4' ? ['video/mp4;codecs=avc1.420034,mp4a.40.2', 'video/mp4'] :
    ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'];
  const mimeType = types.find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) return status('Tarayıcınız seçili çıktı türünü desteklemiyor. WebM’yi deneyin.');
  setBusy(true);
  cancelled = false;
  $('cancel').hidden = false;
  video.controls = false;
  video.pause();
  const previousTime = video.currentTime;
  const rate = video.playbackRate;
  let stream;
  let output;
  const stop = () => { if (recorder?.state === 'recording') recorder.stop(); };
  let exportTimer;
  let endFrame;
  const checkEnd = () => {
    if (video.currentTime >= end) stop();
    else endFrame = requestAnimationFrame(checkEnd);
  };
  const visibility = () => { if (document.hidden) { cancelled = true; stop(); } };
  try {
    status('Video hazırlanıyor. Bu sekmeyi açık tutun. Kayıt video süresi kadar sürer.');
    audio ??= new AudioContext();
    if (!audioSource) {
      audioSource = audio.createMediaElementSource(video);
      audioSource.connect(audio.destination);
    }
    await audio.resume();
    output = audio.createMediaStreamDestination();
    audioSource.connect(output);
    video.playbackRate = 1;
    if (Math.abs(video.currentTime - start) > 0.001) {
      const seeked = new Promise(resolve => video.addEventListener('seeked', resolve, { once: true }));
      video.currentTime = start;
      await seeked;
    }
    if (cancelled || document.hidden) {
      status('Kayıt iptal edildi.');
      return;
    }
    draw();
    stream = canvas.captureStream(0);
    output.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
    const chunks = [];
    const saved = new Promise((resolve, reject) => {
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.onerror = () => reject(new Error('Video kaydı tamamlanamadı.'));
    });
    video.addEventListener('ended', stop, { once: true });
    document.addEventListener('visibilitychange', visibility);
    recorder.start();
    const track = stream.getVideoTracks()[0];
    const frame = () => { draw(); track.requestFrame(); };
    frame();
    exportTimer = setInterval(frame, 1000 / 30);
    if (end < duration()) endFrame = requestAnimationFrame(checkEnd);
    const [blob] = await Promise.all([saved, video.play()]);
    if (cancelled) return status('Kayıt iptal edildi.');
    if (!blob.size) throw new Error('Video dosyası boş oluştu.');
    download(blob, 'mimoza-sahne.' + format);
    status('Video hazır. Tarayıcınızın indirilenler bölümünü kontrol edin.');
  } catch (error) {
    status(error.message);
  } finally {
    stop();
    recorder = undefined;
    clearInterval(exportTimer);
    cancelAnimationFrame(endFrame);
    video.removeEventListener('ended', stop);
    document.removeEventListener('visibilitychange', visibility);
    video.pause();
    video.playbackRate = rate;
    video.currentTime = previousTime;
    video.controls = true;
    if (output) audioSource.disconnect(output);
    stream?.getTracks().forEach(track => track.stop());
    $('cancel').hidden = true;
    setBusy(false);
  }
};








$('caption-auto').onclick = async () => {
  if (!sourceFile) return status('Önce bir video kaydedin veya yükleyin.');
  setBusy(true);
  status('Yerel altyazı hazırlanıyor…');
  try {
    const response = await fetch('/transcribe', {
      method: 'POST', headers: { 'x-mimoza-language': $('caption-language').value }, body: sourceFile,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    $('script').value = data.srt;
    status('Altyazı hazır. Metni kontrol edip başlık oluşturabilirsiniz.');
  } catch (error) { status(error.message); }
  finally { setBusy(false); }
};

