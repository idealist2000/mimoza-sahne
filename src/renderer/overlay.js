// Ekran katmanı: akıllı tahta, kartlar, gizlilik perdesi, geri sayım.
// Bu pencere kayda girer; kontrol çubuğu girmez.
const $ = id => document.getElementById(id);
const api = window.mimoza;
const canvas = $('ink');
const ctx = canvas.getContext('2d');
let strokes = [];
let current = null;
let tool = 'pen', color = '#ffc72c', temporary = true, drawing = false;
let spot = null;
let profile = 'ai';
const FADE_AFTER = 3000, FADE_TIME = 600;

function resize() {
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
}
addEventListener('resize', resize);
resize();

const pt = e => [e.clientX * devicePixelRatio, e.clientY * devicePixelRatio];

canvas.addEventListener('pointerdown', e => {
  if (!drawing || e.button !== 0) return;
  const p = pt(e);
  if (tool === 'eraser') {
    erasing = true;
    eraseAt(p);
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    return;
  }
  if (tool === 'spot') { spot = p; canvas.setPointerCapture(e.pointerId); return; }
  current = { tool, color, temporary, points: [p, p], at: performance.now() };
  strokes.push(current);
  canvas.setPointerCapture(e.pointerId);
});
let erasing = false;
function eraseAt(p) {
  const r = 28 * devicePixelRatio;
  strokes = strokes.filter(s => !s.points.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < r));
}
canvas.addEventListener('pointermove', e => {
  if (erasing) { eraseAt(pt(e)); return; }
  if (spot) { spot = pt(e); return; }
  if (!current) return;
  if (current.tool === 'arrow' || current.tool === 'box') current.points[1] = pt(e);
  else current.points.push(pt(e));
});
const end = () => {
  erasing = false;
  if (current) current.at = performance.now();
  current = null;
  spot = null;
};
canvas.addEventListener('pointerup', end);
canvas.addEventListener('pointercancel', end);
const TOOLS = ['pen', 'highlight', 'arrow', 'box', 'spot', 'eraser'];
const COLORS = ['#ffc72c', '#ff5a5f', '#3ddc97', '#59a8ff', '#ffffff'];
addEventListener('keydown', e => {
  if (!drawing) return;
  if (e.key === 'Escape') api.overlay.emit({ type: 'draw-off' });
  else if (e.key.toLowerCase() === 'z' && e.ctrlKey) strokes.pop();
  else if (/^[1-6]$/.test(e.key)) { tool = TOOLS[+e.key - 1]; api.overlay.emit({ type: 'tool', tool }); }
  else if (e.key.toLowerCase() === 'c') { color = COLORS[(COLORS.indexOf(color) + 1) % COLORS.length]; api.overlay.emit({ type: 'color', color }); }
  else if (e.key.toLowerCase() === 'g') { temporary = !temporary; api.overlay.emit({ type: 'temporary', on: temporary }); }
});

// Katman yalnızca çizim değiştiğinde yeniden çizilir; boşken ekran birleştirme yükü oluşturmaz.
let inkDirty = true;
const touch = () => { inkDirty = true; };
for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'keydown']) addEventListener(ev, touch, true);
addEventListener('resize', touch);
function render() {
  const now = performance.now();
  const animating = current || spot || strokes.some(s => s.temporary);
  if (!animating && !inkDirty) { requestAnimationFrame(render); return; }
  inkDirty = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  strokes = strokes.filter(s => !s.temporary || s === current || now - s.at < FADE_AFTER + FADE_TIME);
  for (const s of strokes) {
    const age = s === current ? 0 : now - s.at;
    const alpha = s.temporary && age > FADE_AFTER ? 1 - (age - FADE_AFTER) / FADE_TIME : 1;
    const [x0, y0] = s.points[0];
    const [x1, y1] = s.points[s.points.length - 1];
    const k = devicePixelRatio;
    ctx.save();
    ctx.globalAlpha = alpha * (s.tool === 'highlight' ? 0.38 : 1);
    ctx.strokeStyle = s.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = (s.tool === 'highlight' ? 26 : 5) * k;
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = s.tool === 'highlight' ? 0 : 6 * k;
    ctx.beginPath();
    if (s.tool === 'box') {
      ctx.roundRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0), 8 * k);
    } else if (s.tool === 'arrow') {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      const a = Math.atan2(y1 - y0, x1 - x0), head = 22 * k;
      for (const off of [-0.5, 0.5]) { ctx.moveTo(x1, y1); ctx.lineTo(x1 - head * Math.cos(a + off), y1 - head * Math.sin(a + off)); }
    } else {
      ctx.moveTo(x0, y0);
      for (let i = 1; i < s.points.length - 1; i++) {
        const [ax, ay] = s.points[i], [bx, by] = s.points[i + 1];
        ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
      }
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();
    ctx.restore();
  }
  if (spot) {
    const r = 120 * devicePixelRatio;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.arc(spot[0], spot[1], r, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 * devicePixelRatio;
    ctx.beginPath();
    ctx.arc(spot[0], spot[1], r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderCard(fields) {
  const host = $('cardHost');
  if (!fields) { host.innerHTML = ''; return; }
  const p = Profiles.profiles[profile] || Profiles.profiles.general;
  const f = i => esc(fields[i] || '');
  let html = '';
  if (p.layout === 'vocab') {
    html = `<div class="card vocab"><div class="tag">${esc(p.name)}</div><div class="word">${f(0)}</div>${fields[1] ? `<div class="mean">${f(1)}</div>` : ''}${fields[2] ? `<div class="ex">${f(2)}</div>` : ''}</div>`;
  } else if (p.layout === 'flow') {
    html = `<div class="card flow"><div class="tag">${esc(p.name)}</div><div class="steps">` +
      fields.map((v, i) => (i ? '<span class="arrow">→</span>' : '') + `<span class="step"><small>${esc(p.fields[i] || '')}</small>${esc(v)}</span>`).join('') + '</div></div>';
  } else if (p.layout === 'compare') {
    html = `<div class="card compare"><div class="tag">${esc(p.name)}</div><div class="cols">` +
      `<div class="col"><b>${esc(p.fields[0])}</b>${f(0)}</div><div class="col ans"><b>${esc(p.fields[1])}</b>${f(1)}</div></div>` +
      (fields[2] ? `<div class="check">✓ ${f(2)}</div>` : '') + '</div>';
  } else {
    html = `<div class="card rows"><div class="tag">${esc(p.name)}</div>` +
      fields.map((v, i) => `<div class="row"><b>${esc(p.fields[i] || '')}</b><span>${esc(v)}</span></div>`).join('') + '</div>';
  }
  host.innerHTML = html;
}

api.overlay.onMessage(msg => {
  inkDirty = true;
  switch (msg.type) {
    case 'init': {
      profile = msg.config.profile || 'ai';
      const r = msg.config.region;
      if (msg.config.kind === 'region' && r) {
        const el = $('region');
        el.hidden = false;
        // Çerçeve kayıt alanının hemen dışında durur, böylece kayda girmez.
        Object.assign(el.style, { left: (r.x * innerWidth - 4) + 'px', top: (r.y * innerHeight - 4) + 'px', width: (r.w * innerWidth + 8) + 'px', height: (r.h * innerHeight + 8) + 'px' });
      }
      break;
    }
    case 'countdown':
      $('countdown').hidden = !msg.n;
      $('count').textContent = msg.n;
      break;
    case 'draw':
      drawing = msg.on;
      document.body.classList.toggle('drawing', drawing);
      break;
    case 'tool': tool = msg.tool; break;
    case 'color': color = msg.color; break;
    case 'temporary': temporary = msg.on; break;
    case 'clear': strokes = []; current = null; break;
    case 'undo': strokes.pop(); break;
    case 'wheel': strokes = strokes.filter(s => !s.temporary); break;
    case 'privacy': $('privacy').hidden = !msg.on; break;
    case 'card': renderCard(msg.fields); break;
  }
});
