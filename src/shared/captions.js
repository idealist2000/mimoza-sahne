// Altyazı: kelimelerden satır oluşturma, stiller ve ASS (libass) dosyası üretimi.
// Önizleme (tuval) ve dışa aktarma (FFmpeg) aynı satır bölme kurallarını kullanır.
(function (root) {
  'use strict';
  const T = typeof module !== 'undefined' && module.exports ? require('./timeline.js') : root.Timeline;

  const BRAND = { yellow: '#FED501', navy: '#002058', white: '#FFFFFF' };

  const STYLES = {
    classic: { name: 'Klasik', maxWords: 8, maxChars: 46, size: 0.046, upper: false, box: true, highlight: false },
    karaoke: { name: 'Vurgulu', maxWords: 4, maxChars: 26, size: 0.062, upper: false, box: false, highlight: true },
    big: { name: 'Büyük', maxWords: 3, maxChars: 18, size: 0.085, upper: true, box: false, highlight: true },
  };

  const PUNCT_END = /[.!?…]$/;
  const PUNCT_SOFT = /[,;:]$/;

  // Kelimeleri satırlara böler. Kesilen kelimeler (keep dışında kalanlar) atlanır.
  function buildLines(words, keep, styleKey) {
    const st = STYLES[styleKey] || STYLES.classic;
    const inKeep = w => !keep || keep.some(k => (w.s + w.e) / 2 >= k.s && (w.s + w.e) / 2 < k.e);
    const kept = (words || []).filter(w => w.w && w.w.trim() && !w.hidden && inKeep(w));
    const lines = [];
    let cur = [];
    const flush = () => { if (cur.length) lines.push({ s: cur[0].s, e: cur[cur.length - 1].e, words: cur }); cur = []; };
    for (let i = 0; i < kept.length; i++) {
      const w = kept[i];
      const prev = cur[cur.length - 1];
      if (prev) {
        const chars = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
        const gap = w.s - prev.e;
        // Kesim sınırını geçen satırları da böl.
        const crossesCut = keep && T.sourceToOutput(keep, w.s) - T.sourceToOutput(keep, prev.e) < (w.s - prev.e) - 0.05;
        if (cur.length >= st.maxWords || chars > st.maxChars || gap > 0.7 || PUNCT_END.test(prev.w) || crossesCut ||
          (PUNCT_SOFT.test(prev.w) && cur.length >= Math.ceil(st.maxWords / 2))) flush();
      }
      cur.push(w);
    }
    flush();
    // Satır en az 0.6 sn görünsün ve bir sonrakinin başına kadar uzasın (0.5 sn'den kısa boşluklarda).
    for (let i = 0; i < lines.length; i++) {
      const next = lines[i + 1];
      let e = Math.max(lines[i].e, lines[i].s + 0.6);
      if (next && next.s - e < 0.5) e = next.s;
      if (next) e = Math.min(e, next.s);
      lines[i].e = e;
    }
    return lines;
  }

  function lineAt(lines, t) {
    let lo = 0, hi = lines.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t < lines[mid].s) hi = mid - 1;
      else if (t >= lines[mid].e) lo = mid + 1;
      else return lines[mid];
    }
    return null;
  }

  const fmtText = (w, st) => (st.upper ? w.toLocaleUpperCase('tr-TR') : w);

  // ---------- ASS ----------
  function assTime(t) {
    t = Math.max(0, t);
    const cs = Math.round(t * 100);
    const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60, c = cs % 100;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
  }
  function assColor(hex, alpha = 0) {
    const h = hex.replace('#', '');
    return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
  }
  const escAss = s => String(s).replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, ' ');

  // Altyazı dikey konumu (0..1, satır merkezi)
  function captionY(opts, splitLayout) {
    if (splitLayout) return 0.5;
    if (opts.pos === 'middle') return 0.5;
    if (opts.pos === 'top') return 0.12;
    return opts.style === 'classic' ? 0.9 : 0.8;
  }

  function buildAss(words, keep, opts, W, H, splitY) {
    const st = STYLES[opts.style] || STYLES.classic;
    const unit = Math.min(W, H);
    const size = Math.round(unit * st.size * (opts.size || 1));
    const lines = buildLines(words, keep, opts.style);
    const y = Math.round((splitY ?? captionY(opts)) * H);
    const margin = Math.round(W * 0.06);
    const hl = opts.color || BRAND.yellow;
    // Stil: klasik = koyu kutu; diğerleri = kalın kenarlı yazı
    const style = st.box ?
      `Style: M,Montserrat SemiBold,${size},${assColor('#FFFFFF')},${assColor(hl)},${assColor('#000000')},${assColor('#0A0F18', 0x30)},0,0,0,0,100,100,0,0,3,${Math.round(size * 0.28)},0,5,${margin},${margin},0,1` :
      `Style: M,Montserrat ExtraBold,${size},${assColor('#FFFFFF')},${assColor(hl)},${assColor('#000000')},${assColor('#000000', 0x60)},-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(size * 0.09))},${Math.max(1, Math.round(size * 0.05))},5,${margin},${margin},0,1`;
    const out = [
      '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      style, '',
      '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ];
    const avoid = opts.avoid || [];
    for (const line of lines) {
      const yy = !splitY && avoid.some(r => line.s < r.e && line.e > r.s) ? Math.round(y - H * 0.2) : y;
      const pos = `{\\an5\\pos(${Math.round(W / 2)},${yy})}`;
      if (!st.highlight) {
        out.push(`Dialogue: 0,${assTime(line.s)},${assTime(line.e)},M,,0,0,0,,${pos}${escAss(line.words.map(w => fmtText(w.w, st)).join(' '))}`);
        continue;
      }
      // Her kelime için ayrı olay: o an söylenen kelime vurgu renginde ve biraz büyük.
      for (let i = 0; i < line.words.length; i++) {
        const s = i === 0 ? line.s : line.words[i].s;
        const e = i === line.words.length - 1 ? line.e : line.words[i + 1].s;
        if (e - s < 0.01) continue;
        const text = line.words.map((w, j) => j === i ?
          `{\\c${assColor(hl)}\\fscx108\\fscy108}${escAss(fmtText(w.w, st))}{\\c${assColor('#FFFFFF')}\\fscx100\\fscy100}` :
          escAss(fmtText(w.w, st))).join(' ');
        out.push(`Dialogue: 0,${assTime(s)},${assTime(e)},M,,0,0,0,,${pos}${text}`);
      }
    }
    return out.join('\n') + '\n';
  }

  // ---------- SRT ----------
  function srtTime(t) {
    const ms = Math.round(Math.max(0, t) * 1000);
    const p = (v, n = 2) => String(v).padStart(n, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  }
  // SRT, kesimlerden sonraki (çıktı) zamanlarla üretilir.
  function buildSrt(words, keep) {
    const lines = buildLines(words, keep, 'classic');
    return lines.map((l, i) => `${i + 1}\n${srtTime(T.sourceToOutput(keep, l.s))} --> ${srtTime(T.sourceToOutput(keep, l.e))}\n${l.words.map(w => w.w).join(' ')}\n`).join('\n');
  }

  // ---------- Tuval çizimi (önizleme) ----------
  function wrap(ctx, words, maxW) {
    const rows = [[]];
    let width = 0;
    const space = ctx.measureText(' ').width;
    for (const w of words) {
      const ww = ctx.measureText(w.t).width;
      if (rows[rows.length - 1].length && width + space + ww > maxW) { rows.push([]); width = 0; }
      const row = rows[rows.length - 1];
      width += (row.length ? space : 0) + ww;
      row.push({ ...w, width: ww });
    }
    return rows;
  }

  function drawCaption(ctx, lines, t, opts, W, H, splitY) {
    const line = lineAt(lines, t);
    if (!line) return;
    const st = STYLES[opts.style] || STYLES.classic;
    const unit = Math.min(W, H);
    const size = Math.round(unit * st.size * (opts.size || 1));
    const hl = opts.color || BRAND.yellow;
    const font = st.box ? `600 ${size}px "Montserrat SemiBold", Montserrat, sans-serif` : `800 ${size}px "Montserrat ExtraBold", Montserrat, sans-serif`;
    ctx.save();
    ctx.font = font;
    ctx.textBaseline = 'middle';
    const active = line.words.findIndex((w, i) => t >= (i === 0 ? line.s : w.s) && (i === line.words.length - 1 || t < line.words[i + 1].s));
    const items = line.words.map((w, i) => ({ t: fmtText(w.w, st), on: st.highlight && i === active }));
    const rows = wrap(ctx, items, W * 0.88);
    const lh = size * 1.25;
    let cy = (splitY ?? captionY(opts)) * H;
    if (splitY === undefined && (opts.avoid || []).some(r => line.s < r.e && line.e > r.s)) cy -= H * 0.2;
    const top = cy - (rows.length * lh) / 2;
    const space = ctx.measureText(' ').width;
    rows.forEach((row, r) => {
      const rw = row.reduce((n, x) => n + x.width, 0) + space * (row.length - 1);
      let x = (W - rw) / 2;
      const y = top + lh * (r + 0.5);
      if (st.box) {
        const pad = size * 0.28;
        ctx.fillStyle = 'rgba(10,15,24,0.81)';
        ctx.fillRect(x - pad, y - lh / 2 - pad * 0.15, rw + pad * 2, lh + pad * 0.3);
      }
      for (const w of row) {
        ctx.save();
        const k = w.on ? 1.08 : 1;
        ctx.translate(x + w.width / 2, y);
        ctx.scale(k, k);
        if (!st.box) {
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(4, size * 0.18);
          ctx.strokeStyle = '#000';
          ctx.strokeText(w.t, -w.width / 2, 0);
        }
        ctx.fillStyle = w.on ? hl : '#fff';
        ctx.fillText(w.t, -w.width / 2, 0);
        ctx.restore();
        x += w.width + space;
      }
    });
    ctx.restore();
  }

  const api = { BRAND, STYLES, buildLines, lineAt, buildAss, buildSrt, drawCaption, captionY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Captions = api;
})(typeof window !== 'undefined' ? window : globalThis);
