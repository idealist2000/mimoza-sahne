// Mimoza Sahne — ortak zaman çizelgesi hesapları.
// Hem kurgu önizlemesi (tarayıcı) hem de FFmpeg dışa aktarımı (Node) bu dosyayı kullanır.
// Böylece önizlemede görülen yakınlaştırma ve kesimler çıktıdakiyle birebir aynı olur.
(function (root) {
  'use strict';

  const EASE = 0.45; // yakınlaştırma geçiş süresi (sn)
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = x => x * x * (3 - 2 * x);

  // ---------- Kesimler (kept segments) ----------
  function normalizeKeep(keep, duration) {
    const list = (keep || [{ s: 0, e: duration }])
      .map(k => ({ s: clamp(k.s, 0, duration), e: clamp(k.e, 0, duration) }))
      .filter(k => k.e - k.s > 0.02)
      .sort((a, b) => a.s - b.s);
    const out = [];
    for (const k of list) {
      const last = out[out.length - 1];
      if (last && k.s <= last.e + 0.001) last.e = Math.max(last.e, k.e);
      else out.push({ ...k });
    }
    return out;
  }

  function outputDuration(keep) {
    return keep.reduce((sum, k) => sum + (k.e - k.s), 0);
  }

  function sourceToOutput(keep, t) {
    let acc = 0;
    for (const k of keep) {
      if (t < k.s) return acc;
      if (t <= k.e) return acc + (t - k.s);
      acc += k.e - k.s;
    }
    return acc;
  }

  function outputToSource(keep, o) {
    let acc = 0;
    for (const k of keep) {
      const len = k.e - k.s;
      if (o <= acc + len) return k.s + (o - acc);
      acc += len;
    }
    const last = keep[keep.length - 1];
    return last ? last.e : 0;
  }

  // Kaynak zamanında t noktasını böler (kesim çizgisi ekler).
  function splitAt(keep, t) {
    const out = [];
    for (const k of keep) {
      if (t > k.s + 0.05 && t < k.e - 0.05) out.push({ s: k.s, e: t }, { s: t, e: k.e });
      else out.push({ ...k });
    }
    return out;
  }

  // Kaynak zamanında [s,e] aralığını kaldırır.
  function removeRange(keep, s, e) {
    const out = [];
    for (const k of keep) {
      if (e <= k.s || s >= k.e) { out.push({ ...k }); continue; }
      if (s > k.s) out.push({ s: k.s, e: s });
      if (e < k.e) out.push({ s: e, e: k.e });
    }
    return out.filter(k => k.e - k.s > 0.02);
  }

  // ---------- Yakınlaştırma ----------
  function zoomWeight(z, t) {
    const T = Math.min(EASE, (z.e - z.s) / 2);
    if (t <= z.s || t >= z.e) return 0;
    return smooth(clamp((t - z.s) / T, 0, 1)) * smooth(clamp((z.e - t) / T, 0, 1));
  }

  // Yakınlaştırma durumunu döndürür: ölçek ve merkez (0..1).
  function zoomAt(zooms, t) {
    let scale = 1, cx = 0.5, cy = 0.5;
    for (const z of zooms || []) {
      const w = zoomWeight(z, t);
      if (!w) continue;
      scale += (z.scale - 1) * w;
      cx += (z.cx - 0.5) * w;
      cy += (z.cy - 0.5) * w;
    }
    return { scale, cx, cy };
  }

  // Görünür pencere (kaynak karede 0..1 koordinatlarında).
  function zoomViewport(zooms, t) {
    const { scale, cx, cy } = zoomAt(zooms, t);
    const w = 1 / scale, h = 1 / scale;
    return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h, scale };
  }

  // FFmpeg ifadeleri: aynı formüller.
  function ffNum(n) { return Number(n).toFixed(4).replace(/\.?0+$/, '') || '0'; }
  function ffWeight(z) {
    const T = Math.min(EASE, (z.e - z.s) / 2);
    const a = `clip((t-${ffNum(z.s)})/${ffNum(T)},0,1)`;
    const b = `clip((${ffNum(z.e)}-t)/${ffNum(T)},0,1)`;
    return `(${a}*${a}*(3-2*${a}))*(${b}*${b}*(3-2*${b}))`;
  }
  function ffZoomExpressions(zooms) {
    if (!zooms || !zooms.length) return null;
    const scale = '1' + zooms.map(z => `+${ffNum(z.scale - 1)}*${ffWeight(z)}`).join('');
    const cx = '0.5' + zooms.map(z => `+${ffNum(z.cx - 0.5)}*${ffWeight(z)}`).join('');
    const cy = '0.5' + zooms.map(z => `+${ffNum(z.cy - 0.5)}*${ffWeight(z)}`).join('');
    return { scale, cx, cy };
  }

  // Tıklamalardan otomatik yakınlaştırma üretir.
  // clicks: [[t, x, y], ...] (x,y kaynak karede 0..1)
  function autoZooms(clicks, duration, options = {}) {
    const scale = options.scale || 1.8;
    const groups = [];
    for (const [t, x, y] of clicks || []) {
      if (x < 0 || x > 1 || y < 0 || y > 1) continue;
      const g = groups[groups.length - 1];
      if (g && t - g.last < 3 && Math.hypot(x - g.cx, y - g.cy) < 0.28) {
        g.points.push([x, y]);
        g.last = t;
        g.cx = g.points.reduce((s, p) => s + p[0], 0) / g.points.length;
        g.cy = g.points.reduce((s, p) => s + p[1], 0) / g.points.length;
      } else {
        groups.push({ first: t, last: t, cx: x, cy: y, points: [[x, y]] });
      }
    }
    const zooms = [];
    for (const g of groups) {
      let s = Math.max(0, g.first - 0.7);
      const e = Math.min(duration, Math.max(g.last + 2.2, s + 2.5));
      const prev = zooms[zooms.length - 1];
      if (prev && s < prev.e + 0.3) {
        if (Math.hypot(prev.cx - g.cx, prev.cy - g.cy) < 0.12) { prev.e = e; continue; }
        s = prev.e + 0.05;
        if (e - s < 1.2) continue;
      }
      if (e - s > 25) continue;
      zooms.push({ id: 'z' + Math.random().toString(36).slice(2, 9), s, e, scale, cx: g.cx, cy: g.cy, auto: true });
    }
    return zooms;
  }

  // Çıktı boyutu
  function outputSize(aspect, quality) {
    const short = quality === 720 ? 720 : 1080;
    if (aspect === '9:16') return { w: short, h: Math.round(short * 16 / 9 / 2) * 2 };
    if (aspect === '1:1') return { w: short, h: short };
    return { w: Math.round(short * 16 / 9 / 2) * 2, h: short };
  }

  // Ekran katmanını çıktı karesine sığdırır.
  function fitRect(srcW, srcH, outW, outH, padding) {
    const pad = padding || 0;
    const aw = outW - pad * 2, ah = outH - pad * 2;
    const s = Math.min(aw / srcW, ah / srcH);
    const w = Math.round(srcW * s / 2) * 2, h = Math.round(srcH * s / 2) * 2;
    return { x: Math.round((outW - w) / 2), y: Math.round((outH - h) / 2), w, h };
  }

  // Kamera kutusu (çıktı pikselleri)
  function cameraRect(cam, outW, outH, camAspect) {
    const base = Math.min(outW, outH);
    const w = Math.round(base * cam.size / 2) * 2;
    const h = cam.shape === 'rect' ? Math.round(w / (camAspect || 16 / 9) / 2) * 2 : w;
    const x = Math.round(clamp(cam.x, 0, 1) * (outW - w));
    const y = Math.round(clamp(cam.y, 0, 1) * (outH - h));
    return { x, y, w, h };
  }

  const api = {
    EASE, clamp, normalizeKeep, outputDuration, sourceToOutput, outputToSource, splitAt, removeRange,
    zoomAt, zoomViewport, ffZoomExpressions, autoZooms, outputSize, fitRect, cameraRect, ffNum,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Timeline = api;
})(typeof window !== 'undefined' ? window : globalThis);
