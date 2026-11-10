const api = window.mimoza;
  const sel = document.getElementById('sel');
  let start = null, rect = null;
  api.region.onImage(url => { if (url) document.body.style.backgroundImage = `url("${url}")`; });
  const show = r => {
    rect = r;
    Object.assign(sel.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    sel.hidden = false;
    document.getElementById('dim').hidden = true;
    const k = devicePixelRatio;
    document.getElementById('size').textContent = Math.round(r.w * k) + ' × ' + Math.round(r.h * k);
    document.getElementById('ok').disabled = r.w < 40 || r.h < 40;
  };
  addEventListener('pointerdown', e => {
    if (e.target.closest('#help')) return;
    start = [e.clientX, e.clientY];
  });
  addEventListener('pointermove', e => {
    if (!start) return;
    show({ x: Math.min(start[0], e.clientX), y: Math.min(start[1], e.clientY), w: Math.abs(e.clientX - start[0]), h: Math.abs(e.clientY - start[1]) });
  });
  addEventListener('pointerup', () => { start = null; });
  const done = () => {
    if (!rect || rect.w < 40 || rect.h < 40) return;
    api.region.done({ x: rect.x / innerWidth, y: rect.y / innerHeight, w: rect.w / innerWidth, h: rect.h / innerHeight });
  };
  document.getElementById('ok').onclick = done;
  for (const b of document.querySelectorAll('[data-p]')) b.onclick = () => {
    const [w, h] = b.dataset.p.split('x').map(n => n / devicePixelRatio);
    const s = Math.min(1, innerWidth / w, innerHeight / h);
    show({ x: (innerWidth - w * s) / 2, y: (innerHeight - h * s) / 2, w: w * s, h: h * s });
  };
  addEventListener('keydown', e => {
    if (e.key === 'Escape') api.region.done(null);
    if (e.key === 'Enter') done();
  });
