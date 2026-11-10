// Akıllı temizlik önerileri: sessizlik, dolgu sesleri, dolgu kelimeleri, tekrarlar.
// Hiçbir öneri kendiliğinden uygulanmaz.
(function (root) {
  'use strict';

  const FILLER_SOUNDS = new Set(['ııı', 'ıı', 'ı', 'ıh', 'ıhh', 'eee', 'ee', 'e', 'eh', 'ehh', 'ehm', 'em', 'hmm', 'hm', 'mmm', 'mm', 'aaa', 'aa', 'ah', 'öö', 'ööö', 'uh', 'um', 'umm', 'uhm', 'er', 'erm']);
  const FILLER_WORDS = new Set(['şey', 'yani', 'hani', 'işte', 'falan', 'filan', 'like', 'basically']);

  const norm = w => String(w || '').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]/gu, '');
  const normFiller = w => norm(w).replace(/(.)\1{2,}/g, '$1$1$1');

  const TYPES = {
    silence: { name: 'Uzun sessizlikler', on: true, help: '0,8 saniyeden uzun boşluklar kısaltılır, kısa bir nefes payı bırakılır.' },
    sound: { name: 'Dolgu sesleri (ııı, eee, hmm)', on: true, help: 'Konuşma arasındaki tereddüt sesleri.' },
    unheard: { name: 'Yazıya dökülmemiş sesler', on: false, help: 'Kelimeler arasında ses olan ama metne girmeyen boşluklar. Çoğu zaman "ııı" olur, dinleyerek onaylayın.' },
    word: { name: 'Dolgu kelimeleri (şey, yani, hani)', on: false, help: 'Bazen anlam taşır. Dinleyip tek tek seçin.' },
    repeat: { name: 'Tekrarlanan sözler', on: false, help: '"Şimdi şimdi" gibi yeniden başlamalarda ilk söyleyişi keser.' },
  };

  // words: [{w,s,e}], silences: [{s,e}] (ses kanalı zamanı → kaynak zamanı), peaks: kaynak zamanına hizalı (25/sn)
  function suggest({ words = [], silences = [], peaks = null, peakOffset = 0, keep = null, duration }) {
    const out = [];
    let n = 0;
    const id = () => 'c' + (++n);
    const inKeep = (s, e) => !keep || keep.some(k => s < k.e && e > k.s);
    const add = (type, s, e, label) => { if (e - s > 0.05 && inKeep(s, e)) out.push({ id: id(), type, s: Math.max(0, s), e: Math.min(duration ?? Infinity, e), label, on: TYPES[type].on }); };

    // Sessizlikler: başta ve sonda 0.25 sn pay bırak.
    for (const z of silences) {
      const len = z.e - z.s;
      if (len < 0.8) continue;
      const pad = z.s < 0.05 || (duration && z.e > duration - 0.05) ? 0.1 : 0.25;
      add('silence', z.s + pad, z.e - pad, len.toFixed(1) + ' sn sessizlik');
    }

    // Dolgu sesleri ve kelimeleri
    words.forEach((w, i) => {
      const k = normFiller(w.w);
      if (!k) return;
      const prev = words[i - 1], next = words[i + 1];
      // Kelimenin çevresindeki boşluğun yarısını da al ki kesim doğal olsun.
      const s = prev ? Math.max(prev.e, w.s - 0.08) : Math.max(0, w.s - 0.08);
      const e = next ? Math.min(next.s, w.e + 0.08) : w.e + 0.08;
      if (FILLER_SOUNDS.has(k) || /^(ı+|e+|h?m+|a+h?|ö+)$/.test(k)) add('sound', s, e, '“' + w.w.trim() + '”');
      else if (FILLER_WORDS.has(k)) add('word', s, e, '“' + w.w.trim() + '”');
    });

    // Yazıya dökülmemiş sesler: kelimeler arasında 0.35–2.5 sn boşluk ve bu boşlukta konuşma enerjisi.
    if (peaks && peaks.length) {
      const sorted = [...peaks].sort((a, b) => a - b);
      const floor = sorted[Math.floor(sorted.length * 0.2)] || 0;
      const speech = sorted[Math.floor(sorted.length * 0.7)] || 0;
      const thr = floor + (speech - floor) * 0.45;
      const silent = (s, e) => silences.some(z => z.s <= s + 0.05 && z.e >= e - 0.05);
      for (let i = 1; i < words.length; i++) {
        const s = words[i - 1].e, e = words[i].s;
        const gap = e - s;
        if (gap < 0.35 || gap > 2.5 || silent(s, e)) continue;
        let loud = 0, total = 0;
        for (let t = s + 0.04; t < e - 0.04; t += 0.04) {
          const v = peaks[Math.floor((t - peakOffset) * 25)];
          if (v === undefined) continue;
          total++;
          if (v > thr) loud++;
        }
        if (total >= 5 && loud / total > 0.6) add('unheard', s + 0.03, e - 0.03, gap.toFixed(1) + ' sn ses');
      }
    }

    // Tekrarlar: 1–4 kelimelik öbek hemen ardından tekrar ediliyorsa ilkini kes.
    const nw = words.map(w => norm(w.w));
    for (let i = 0; i < words.length; i++) {
      for (let len = 4; len >= 1; len--) {
        if (i + 2 * len > words.length) continue;
        let same = true;
        for (let j = 0; j < len; j++) if (!nw[i + j] || nw[i + j] !== nw[i + len + j]) { same = false; break; }
        if (!same) continue;
        if (len === 1 && nw[i].length < 3) continue;
        if (words[i + len].s - words[i + len - 1].e > 1.5) continue;
        add('repeat', words[i].s - 0.04, words[i + len].s - 0.04, '“' + words.slice(i, i + len).map(w => w.w.trim()).join(' ') + '” ×2');
        i += len - 1;
        break;
      }
    }
    return out.sort((a, b) => a.s - b.s);
  }

  const api = { TYPES, suggest, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cleanup = api;
})(typeof window !== 'undefined' ? window : globalThis);
