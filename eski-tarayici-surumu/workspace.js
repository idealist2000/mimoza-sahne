const $ = id => document.getElementById(id);
const video = $('video');
const nav = [...document.querySelectorAll('[data-view]')];
const views = { record: $('record-workspace'), edit: $('editor'), publish: $('publish') };

function show(view) {
  for (const [name, region] of Object.entries(views)) region.hidden = view !== name;
  for (const button of nav) {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  if (view !== 'edit' && !$('export').disabled) video.pause();
  window.scrollTo(0, 0);
}
for (const button of nav) button.onclick = () => show(button.dataset.view);
$('open-video').onclick = () => { show('edit'); $('file').click(); };

const clock = seconds => {
  const whole = Math.max(0, Math.floor(seconds || 0));
  return String(Math.floor(whole / 60)).padStart(2, '0') + ':' + String(whole % 60).padStart(2, '0');
};
let recordedLength;
let recordingStart;
let pausedAt;
let pausedTime = 0;
let previewScenes = [];
const length = () => Number.isFinite(video.duration) ? video.duration : recordedLength || 0;

function timeline() {
  const duration = length();
  const rail = $('title-track');
  rail.replaceChildren();
  if (!duration) return;
  for (const scene of previewScenes) {
    if (!scene.title || !Number.isFinite(scene.start) || !Number.isFinite(scene.end) || scene.start < 0 || scene.start >= duration || scene.end <= scene.start) continue;
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = scene.title;
    item.title = scene.title + ' · ' + clock(scene.start);
    item.style.left = (scene.start / duration * 100) + '%';
    item.style.width = ((Math.min(duration, scene.end) - scene.start) / duration * 100) + '%';
    item.onclick = () => { video.currentTime = scene.start; };
    rail.append(item);
  }
}
document.addEventListener('mimoza-scenes', event => { previewScenes = event.detail; timeline(); });

function transport() {
  const duration = length();
  const available = duration > 0 && video.readyState >= 1 && !$('export').disabled;
  for (const id of ['play-toggle', 'playhead', 'mark-in', 'mark-out']) $(id).disabled = !available;
  $('playhead').max = duration;
  $('playhead').value = video.currentTime;
  $('play-toggle').textContent = video.paused ? '▶ Oynat' : 'Ⅱ Duraklat';
  $('editor-clock').value = clock(video.currentTime) + ' / ' + clock(duration);
}
for (const name of ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'emptied']) {
  video.addEventListener(name, () => { transport(); if (name !== 'timeupdate') timeline(); });
}
new MutationObserver(() => { transport(); updateNavigation(); }).observe($('export'), { attributes: true, attributeFilter: ['disabled'] });
$('playhead').oninput = event => { video.currentTime = Number(event.target.value); };
$('play-toggle').onclick = () => {
  if (video.paused) video.play().catch(() => { $('status').textContent = 'Video oynatılamadı.'; });
  else video.pause();
};
$('mark-in').onclick = () => { $('trim-start').value = (Math.floor(video.currentTime * 100) / 100).toFixed(2); };
$('mark-out').onclick = () => { $('trim-end').value = (Math.floor(video.currentTime * 100) / 100).toFixed(2); };
$('file').addEventListener('change', () => {
  const file = $('file').files[0];
  if (!file) return;
  recordedLength = undefined;
  $('active-file').textContent = file.name;
  show('edit');
});
document.addEventListener('mimoza-capture-start', () => {
  recordingStart = performance.now();
  pausedAt = undefined;
  pausedTime = 0;
  $('capture-empty').hidden = true;
});
document.addEventListener('mimoza-capture-pause', () => { pausedAt = performance.now(); });
document.addEventListener('mimoza-capture-resume', () => {
  if (pausedAt !== undefined) pausedTime += performance.now() - pausedAt;
  pausedAt = undefined;
});
document.addEventListener('mimoza-recorded', event => {
  recordingStart = undefined;
  recordedLength = event.detail.duration;
  $('active-file').textContent = event.detail.file.name;
  show('edit');
});
setInterval(() => {
  if (recordingStart === undefined) return;
  $('record-clock').value = clock(((pausedAt ?? performance.now()) - recordingStart - pausedTime) / 1000);
}, 200);

function showTrackFiles(files) {
  const buttons = $('track-downloads');
  buttons.replaceChildren();
  $('extra-tracks').hidden = !files.length;
  for (const file of files) {
    const button = document.createElement('button');
    button.textContent = file.name + ' indir';
    button.onclick = () => {
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    };
    buttons.append(button);
  }
}
document.addEventListener('mimoza-recorded', event => showTrackFiles(event.detail.trackFiles || []));
$('file').addEventListener('change', () => { if ($('file').files.length) showTrackFiles([]); });
function updateNavigation() {
  const recording = !$('record-stop').disabled;
  const editing = $('export').disabled;
  for (const button of nav) {
    button.disabled = (recording && button.dataset.view !== 'record') || (editing && button.dataset.view !== 'edit');
  }
  $('open-video').disabled = recording || editing;
}
new MutationObserver(updateNavigation).observe($('record-stop'), { attributes: true, attributeFilter: ['disabled'] });
document.addEventListener('mimoza-capture-finish', () => { recordingStart = undefined; });

document.addEventListener('mimoza-isolated-files', event => {
  showTrackFiles(event.detail);
  if (event.detail.length) show('edit');
});
