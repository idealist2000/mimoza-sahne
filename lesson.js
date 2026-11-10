import { profiles } from './profiles.js';

const $ = id => document.getElementById(id);
const panel = $('lesson');
const profile = $('lesson-profile');
for (const [id, item] of Object.entries(profiles)) profile.add(new Option(item.name, id));
let scene = 'lesson';
let strokes = [];
let current;
let cardVisible = false;
let started = 0;
let elapsed = 0;
let marks = [];

function refreshProfile() {
  const active = profiles[profile.value];
  $('lesson-card').placeholder = active.example;
  $('lesson-card-label').firstChild.textContent = active.card + ' ';
}
profile.onchange = refreshProfile;
refreshProfile();

function refreshScene() {
  $('lesson-scene').value = scene;
  $('lesson-state').textContent = { waiting: 'Bekleme', lesson: 'Ders', questions: 'Soru-cevap', privacy: 'Gizlilik', closing: 'Kapanış' }[scene];
}
$('lesson-scene').onchange = event => { scene = event.target.value; refreshScene(); };
$('lesson-privacy').onclick = () => { scene = scene === 'privacy' ? 'lesson' : 'privacy'; refreshScene(); };
$('lesson-clear').onclick = () => { strokes = []; current = undefined; };
$('lesson-undo').onclick = () => { strokes.pop(); };
$('lesson-card-toggle').onclick = () => {
  cardVisible = !cardVisible;
  $('lesson-card-toggle').setAttribute('aria-pressed', String(cardVisible));
};
$('lesson-mark').onclick = () => {
  if (!started) {
    $('lesson-status').textContent = 'İşaret koymak için önce kayıt başlatın.';
    return;
  }
  const time = (performance.now() - started) / 1000 - elapsed;
  marks.push({ time, label: $('lesson-marker-name').value.trim() || 'Bölüm ' + (marks.length + 1) });
  $('lesson-status').textContent = marks.length + ' bölüm işareti kaydedildi.';
};
let pausedAt;
document.addEventListener('mimoza-capture-start', () => {
  started = performance.now();
  elapsed = 0;
  pausedAt = undefined;
  marks = [];
});
document.addEventListener('mimoza-capture-pause', () => { pausedAt = performance.now(); });
document.addEventListener('mimoza-capture-resume', () => {
  if (pausedAt) elapsed += (performance.now() - pausedAt) / 1000;
  pausedAt = undefined;
});
document.addEventListener('mimoza-recorded', () => { started = 0; });
document.addEventListener('keydown', event => {
  if (!event.altKey || event.repeat) return;
  const actions = { KeyG: 'lesson-privacy', KeyT: 'lesson-clear', KeyB: 'lesson-mark', KeyP: 'record-pause', KeyD: 'record-stop' };
  if (!actions[event.code]) return;
  event.preventDefault();
  $(actions[event.code]).click();
});

const canvas = $('capture-preview');
function point(event) {
  const bounds = canvas.getBoundingClientRect();
  return [(event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height];
}
canvas.addEventListener('pointerdown', event => {
  if (!$('lesson-draw').checked || event.button !== 0) return;
  const mode = $('lesson-ink').value;
  const p = point(event);
  current = { mode, color: $('lesson-color').value, points: [p, p], temporary: $('lesson-temporary').checked, created: performance.now() };
  if (mode === 'eraser') {
    strokes = strokes.filter(stroke => !stroke.points.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < .045));
    current = undefined;
    return;
  }
  strokes.push(current);
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!current) return;
  if (current.mode === 'arrow' || current.mode === 'box') current.points[1] = point(event);
  else current.points.push(point(event));
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(event, () => { current = undefined; });
}
canvas.addEventListener('wheel', () => { strokes = strokes.filter(stroke => !stroke.temporary); }, { passive: true });
window.addEventListener('scroll', () => { strokes = strokes.filter(stroke => !stroke.temporary); }, { passive: true });

export function chapterText() {
  if (!marks.length) return '';
  const chapters = marks[0].time < 1 ? marks : [{ time: 0, label: 'Giriş' }, ...marks];
  return chapters.map(({ time, label }) => {
    const seconds = Math.max(0, Math.floor(time));
    const hh = Math.floor(seconds / 3600);
    const mm = String(Math.floor(seconds % 3600 / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    return (hh ? hh + ':' : '') + mm + ':' + ss + ' ' + label;
  }).join('\n');
}

export function paintLesson(ctx, width, height) {
  if (scene !== 'lesson') {
    ctx.fillStyle = '#121625';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#ffdb70';
    ctx.font = 'bold ' + Math.round(width * .05) + 'px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText($('lesson-state').textContent, width / 2, height / 2, width * .9);
    ctx.textAlign = 'start';
    return;
  }
  const now = performance.now();
  strokes = strokes.filter(stroke => !stroke.temporary || now - stroke.created < 7000 || stroke === current);
  for (const stroke of strokes) {
    const points = stroke.points.map(([x, y]) => [x * width, y * height]);
    const [x, y] = points[0];
    const [endX, endY] = points.at(-1);
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.mode === 'highlight' ? 20 : 5;
    ctx.globalAlpha = stroke.mode === 'highlight' ? .4 : 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    if (stroke.mode === 'box') ctx.rect(x, y, endX - x, endY - y);
    else for (const [px, py] of points.slice(1)) ctx.lineTo(px, py);
    if (stroke.mode === 'arrow') {
      const angle = Math.atan2(endY - y, endX - x);
      for (const offset of [-.55, .55]) {
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - 24 * Math.cos(angle + offset), endY - 24 * Math.sin(angle + offset));
      }
    }
    ctx.stroke();
    ctx.restore();
  }
  if (!cardVisible) return;
  const lines = $('lesson-card').value.trim().split('|').map(line => line.trim()).filter(Boolean).slice(0, 4);
  if (!lines.length) return;
  const x = width * .05, y = height * .12;
  ctx.fillStyle = '#121625';
  ctx.fillRect(x, y, width * .5, 50 + lines.length * 38);
  ctx.fillStyle = '#ffdb70';
  ctx.font = 'bold 23px system-ui';
  ctx.fillText(profiles[profile.value].name, x + 20, y + 32);
  ctx.fillStyle = '#fff';
  ctx.font = '26px system-ui';
  lines.forEach((line, index) => ctx.fillText(line, x + 20, y + 67 + index * 38, width * .45));
}
