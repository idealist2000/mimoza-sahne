// Mimoza marka şablonları. Önizleme ve dışa aktarma için aynı çizim kodu kullanılır.
// Katman öğeleri (alt bant, başlık, bölüm, köşe) PNG olarak çizilip FFmpeg'de
// aynı formüllerle canlandırılır. Açılış ve kapanış kare kare çizilir.
(function (root) {
  'use strict';
  const NAVY = '#002058', NAVY2 = '#0B2E7A', YELLOW = '#FED501', WHITE = '#FFFFFF';
  const IN = 0.45, OUT = 0.35;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const easeOut = x => 1 - Math.pow(1 - x, 3);

  const TYPES = {
    lower: { name: 'Alt bant', dur: 6 },
    title: { name: 'Konu başlığı', dur: 5 },
    chapter: { name: 'Bölüm kartı', dur: 3.5 },
    corner: { name: 'Köşe bilgisi', dur: 0 },
  };

  // Canlandırma durumu: opaklık (doğrusal) ve yatay kayma (oran).
  function anim(el, t) {
    if (t < el.s || t > el.e) return null;
    const a = clamp((t - el.s) / IN, 0, 1), b = clamp((el.e - t) / OUT, 0, 1);
    const alpha = el.type === 'corner' ? Math.min(1, b * 3, a * 3) : Math.min(a, b);
    return { alpha, slide: 1 - easeOut(a) };
  }
  // FFmpeg ifadeleri (anim ile birebir aynı)
  function ffAnim(el, x0, slidePx) {
    const n = v => Number(v).toFixed(3);
    const a = `clip((t-${n(el.s)})/${IN},0,1)`;
    return { x: `${x0}-${slidePx}*pow(1-${a},3)`, inStart: el.s, inDur: el.type === 'corner' ? IN / 3 : IN, outStart: el.e - (el.type === 'corner' ? OUT / 3 : OUT), outDur: el.type === 'corner' ? OUT / 3 : OUT };
  }

  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function fitText(ctx, text, maxW, size, weight, family = 'Montserrat') {
    let s = size;
    do { ctx.font = `${weight} ${s}px "${family}", sans-serif`; s -= 1; } while (ctx.measureText(text).width > maxW && s > size * 0.5);
    return ctx.measureText(text).width;
  }
  const font = (w, s) => `${w} ${s}px "Montserrat ${w >= 800 ? 'ExtraBold' : 'SemiBold'}", Montserrat, sans-serif`;

  // Öğenin çıktı karesindeki kutusu ve kayma mesafesi
  function box(el, W, H) {
    const u = Math.min(W, H);
    const vertical = H > W;
    if (el.type === 'lower') return { x: Math.round(u * 0.05), y: Math.round(H - u * (vertical ? 0.36 : 0.27)), w: Math.round(Math.min(W - u * 0.1, u * 1.0)), h: Math.round(u * 0.155), slide: Math.round(u * 0.08) };
    if (el.type === 'title') return { x: Math.round(u * 0.05), y: Math.round(u * 0.06), w: Math.round(Math.min(W - u * 0.1, u * 1.15)), h: Math.round(u * 0.2), slide: Math.round(u * 0.08) };
    if (el.type === 'chapter') return { x: Math.round(u * 0.05), y: Math.round(u * 0.06), w: Math.round(Math.min(W - u * 0.1, u * 0.85)), h: Math.round(u * 0.105), slide: Math.round(u * 0.06) };
    if (el.type === 'corner') { const w = Math.round(u * 0.42), h = Math.round(u * 0.07); return { x: Math.round(W - w - u * 0.03), y: Math.round(u * 0.03), w, h, slide: 0 }; }
    return { x: 0, y: 0, w: W, h: H, slide: 0 };
  }

  // Öğeyi (0,0) kutusuna çizer.
  function drawElement(ctx, el, b, logo) {
    const h = b.h, w = b.w;
    ctx.save();
    if (el.type === 'lower') {
      // Sarı şerit + lacivert kutu + logo + ad / unvan
      ctx.fillStyle = YELLOW; rr(ctx, 0, 0, h * 0.09, h, h * 0.045); ctx.fill();
      ctx.fillStyle = NAVY; rr(ctx, h * 0.14, 0, w - h * 0.14, h, h * 0.12); ctx.fill();
      let x = h * 0.3;
      if (logo) { const s = h * 0.78; ctx.drawImage(logo, x, (h - s) / 2, s, s); x += s + h * 0.18; }
      const maxW = w - x - h * 0.3;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = WHITE;
      fitText(ctx, el.text1 || '', maxW, Math.round(h * 0.34), 800, 'Montserrat ExtraBold');
      ctx.fillText(el.text1 || '', x, h * 0.48);
      ctx.fillStyle = YELLOW;
      fitText(ctx, el.text2 || '', maxW, Math.round(h * 0.22), 600, 'Montserrat SemiBold');
      ctx.fillText(el.text2 || '', x, h * 0.8);
    } else if (el.type === 'title') {
      ctx.fillStyle = 'rgba(0,32,88,0.94)'; rr(ctx, 0, 0, w, h, h * 0.1); ctx.fill();
      ctx.fillStyle = YELLOW; ctx.fillRect(0, h * 0.18, h * 0.06, h * 0.64);
      const tag = (el.text2 || 'KONU').toLocaleUpperCase('tr-TR');
      ctx.font = font(800, Math.round(h * 0.13));
      const tw = ctx.measureText(tag).width + h * 0.2;
      ctx.fillStyle = YELLOW; rr(ctx, h * 0.2, h * 0.14, tw, h * 0.22, h * 0.05); ctx.fill();
      ctx.fillStyle = NAVY; ctx.textBaseline = 'middle'; ctx.fillText(tag, h * 0.3, h * 0.255);
      ctx.fillStyle = WHITE; ctx.textBaseline = 'alphabetic';
      fitText(ctx, el.text1 || '', w - h * 0.45, Math.round(h * 0.3), 800, 'Montserrat ExtraBold');
      ctx.fillText(el.text1 || '', h * 0.2, h * 0.76);
    } else if (el.type === 'chapter') {
      ctx.fillStyle = 'rgba(0,32,88,0.94)'; rr(ctx, 0, 0, w, h, h / 2); ctx.fill();
      const num = String(el.text2 || '').toLocaleUpperCase('tr-TR');
      ctx.font = font(800, Math.round(h * 0.34));
      const nw = ctx.measureText(num).width + h * 0.6;
      ctx.fillStyle = YELLOW; rr(ctx, h * 0.12, h * 0.12, nw, h * 0.76, h * 0.38); ctx.fill();
      ctx.fillStyle = NAVY; ctx.textBaseline = 'middle'; ctx.fillText(num, h * 0.42, h * 0.52);
      ctx.fillStyle = WHITE;
      fitText(ctx, el.text1 || '', w - nw - h * 0.7, Math.round(h * 0.38), 800, 'Montserrat ExtraBold');
      ctx.fillText(el.text1 || '', nw + h * 0.4, h * 0.52);
    } else if (el.type === 'corner') {
      ctx.fillStyle = 'rgba(0,32,88,0.78)'; rr(ctx, 0, 0, w, h, h / 2); ctx.fill();
      let x = h * 0.3;
      if (logo) { const s = h * 0.8; ctx.drawImage(logo, x, (h - s) / 2, s, s); x += s + h * 0.15; }
      ctx.fillStyle = WHITE; ctx.textBaseline = 'middle';
      fitText(ctx, el.text1 || '', w - x - h * 0.4, Math.round(h * 0.4), 600, 'Montserrat SemiBold');
      ctx.fillText(el.text1 || '', x, h * 0.53);
    }
    ctx.restore();
  }

  // Önizlemede katmanı çizer.
  function drawOverlay(ctx, el, t, W, H, logo) {
    const a = anim(el, t);
    if (!a || a.alpha <= 0) return;
    const b = box(el, W, H);
    ctx.save();
    ctx.globalAlpha = a.alpha;
    ctx.translate(b.x - b.slide * a.slide, b.y);
    drawElement(ctx, el, b, logo);
    ctx.restore();
  }

  // ---------- Açılış ve kapanış (tam kare, t: 0..dur) ----------
  function drawIntro(ctx, d, t, W, H, logo) {
    const u = Math.min(W, H), dur = d.dur || 4;
    const p = x => clamp(x, 0, 1);
    ctx.save();
    ctx.fillStyle = NAVY; ctx.fillRect(0, 0, W, H);
    // Arka planda çapraz ışık
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, 'rgba(11,46,122,0)'); g.addColorStop(0.5, 'rgba(11,46,122,0.9)'); g.addColorStop(1, 'rgba(11,46,122,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // Sarı şerit soldan sağa
    const wipe = easeOut(p(t / 0.7));
    ctx.fillStyle = YELLOW;
    ctx.fillRect(0, H * 0.5 + u * 0.215, W * wipe, u * 0.012);
    // Logo
    const ls = u * 0.36 * (0.85 + 0.15 * easeOut(p((t - 0.15) / 0.8)));
    ctx.globalAlpha = p((t - 0.1) / 0.5);
    if (logo) ctx.drawImage(logo, (W - ls) / 2, H * 0.5 - u * 0.36 - ls * 0.08, ls, ls);
    // Başlık ve alt başlık
    const ty = (1 - easeOut(p((t - 0.6) / 0.6))) * u * 0.05;
    ctx.globalAlpha = p((t - 0.6) / 0.5);
    ctx.fillStyle = WHITE; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    fitText(ctx, d.title || '', W * 0.86, Math.round(u * 0.085), 800, 'Montserrat ExtraBold');
    ctx.fillText(d.title || '', W / 2, H * 0.5 + u * 0.11 + ty);
    ctx.globalAlpha = p((t - 0.9) / 0.5);
    ctx.fillStyle = YELLOW;
    fitText(ctx, d.subtitle || '', W * 0.8, Math.round(u * 0.045), 600, 'Montserrat SemiBold');
    ctx.fillText(d.subtitle || '', W / 2, H * 0.5 + u * 0.185 + ty);
    ctx.globalAlpha = p((t - 1.2) / 0.5) * 0.85;
    ctx.fillStyle = WHITE;
    ctx.font = font(600, Math.round(u * 0.032));
    ctx.fillText(d.footer || '', W / 2, H - u * 0.07);
    ctx.restore();
    // Kararma ile çıkış
    const fade = p((t - (dur - 0.4)) / 0.4);
    if (fade > 0) { ctx.fillStyle = `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, W, H); }
  }

  function drawOutro(ctx, d, t, W, H, logo) {
    const u = Math.min(W, H), dur = d.dur || 5;
    const p = x => clamp(x, 0, 1);
    ctx.save();
    ctx.fillStyle = NAVY; ctx.fillRect(0, 0, W, H);
    const fadeIn = p(t / 0.4);
    ctx.globalAlpha = fadeIn;
    const ls = u * 0.26;
    const vertical = H > W;
    const cx = vertical ? W / 2 : W * 0.3, cy = vertical ? H * 0.32 : H / 2;
    if (logo) ctx.drawImage(logo, cx - ls / 2, cy - ls / 2, ls, ls);
    const tx = vertical ? W / 2 : W * 0.5;
    ctx.textAlign = vertical ? 'center' : 'left';
    const maxW = vertical ? W * 0.86 : W * 0.44;
    const base = vertical ? H * 0.52 : H * 0.42;
    ctx.globalAlpha = p((t - 0.3) / 0.5);
    ctx.fillStyle = WHITE;
    fitText(ctx, d.title || '', maxW, Math.round(u * 0.075), 800, 'Montserrat ExtraBold');
    ctx.fillText(d.title || '', tx, base);
    ctx.globalAlpha = p((t - 0.6) / 0.5);
    ctx.fillStyle = YELLOW;
    fitText(ctx, d.subtitle || '', maxW, Math.round(u * 0.045), 600, 'Montserrat SemiBold');
    ctx.fillText(d.subtitle || '', tx, base + u * 0.075);
    // Abone ol düğmesi (nabız)
    ctx.globalAlpha = p((t - 0.9) / 0.4);
    const pulse = 1 + 0.04 * Math.sin(Math.max(0, t - 1.2) * 5);
    const bw = u * 0.36 * pulse, bh = u * 0.085 * pulse;
    const bx = vertical ? W / 2 - bw / 2 : tx, by = base + u * 0.13;
    ctx.fillStyle = '#FF0033'; rr(ctx, bx, by, bw, bh, bh * 0.2); ctx.fill();
    ctx.fillStyle = WHITE; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = font(800, Math.round(u * 0.036 * pulse));
    ctx.fillText('ABONE OL', bx + bw / 2, by + bh / 2);
    ctx.globalAlpha = p((t - 1.1) / 0.5) * 0.9;
    ctx.textAlign = vertical ? 'center' : 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = font(600, Math.round(u * 0.034));
    (d.footer || '').split('\n').forEach((line, i) => ctx.fillText(line, tx, by + bh + u * (0.08 + i * 0.05)));
    ctx.restore();
    const fade = p((t - (dur - 0.5)) / 0.5);
    if (fade > 0) { ctx.fillStyle = `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, W, H); }
  }

  const api = { NAVY, YELLOW, TYPES, IN, OUT, anim, ffAnim, box, drawElement, drawOverlay, drawIntro, drawOutro };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Templates = api;
})(typeof window !== 'undefined' ? window : globalThis);
