// Kurgu yan panelleri: Metin (altyazı ve metinden kurgu), Temizlik (öneriler ve ses), Şablonlar (Mimoza marka).
(() => {
  const A = window.EditorAPI;
  const TL = window.Timeline;
  const C = window.Captions;
  const CL = window.Cleanup;
  const TP = window.Templates;
  const DEFAULT_BRAND = { name: 'Onur Kalafat', title: 'SEO ve Yapay Zekâ Uzmanı', site: 'mimozabilisim.com', footer: 'mimozabilisim.com\ninfo@mimozabilisim.com' };

  let brand = { ...DEFAULT_BRAND };
  let logo = null;
  let tab = 'tools';
  let suggestions = null;
  let cardPreview = null;
  let textSel = null;       // { a, b } kelime indeksleri
  let lineCache = { key: '', lines: [] };
  let transcribing = false;
  let previewAudio = null;

  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter(k => k !== null && k !== undefined)); return e; };
  const h = (cls, text) => el('p', { className: cls, textContent: text });
  const words = () => A.P?.transcript?.words || [];

  // ---------- Hazırlık ----------
  const img = new Image();
  img.src = '../assets/logo.png';
  img.decode().then(() => { logo = img; }).catch(() => {});
  const fontsReady = Promise.all([
    document.fonts.load('800 40px "Montserrat ExtraBold"'),
    document.fonts.load('600 40px "Montserrat SemiBold"'),
  ]).catch(() => {});

  // ---------- Sekmeler ----------
  for (const b of document.querySelectorAll('#ltabs button')) b.onclick = () => showTab(b.dataset.tab);
  function showTab(name) {
    tab = name;
    for (const b of document.querySelectorAll('#ltabs button')) b.setAttribute('aria-pressed', String(b.dataset.tab === name));
    for (const t of ['tools', 'text', 'clean', 'brand']) $('tab-' + t).hidden = t !== name;
    if (name === 'text') renderText();
    if (name === 'clean') renderClean();
    if (name === 'brand') renderBrand();
    if (name !== 'clean' && suggestions) A.renderTimeline();
  }

  // ---------- Editör kancaları ----------
  window.EditorHooks = {
    async onOpen(P, E) {
      const st = await api.settings.get();
      brand = { ...DEFAULT_BRAND, ...(st.brand || {}) };
      E.intro ||= { on: false, title: P.name, subtitle: brand.name + ' · ' + brand.title, dur: 4 };
      E.outro ||= { on: false, title: 'İzlediğiniz için teşekkürler', subtitle: 'Sorularınızı yorumlara yazın', dur: 5 };
      suggestions = null;
      textSel = null;
      cardPreview = null;
      lineCache = { key: '', lines: [] };
    },
    animating() { return !!cardPreview; },
    afterOpen() { showTab(tab === 'tools' ? 'tools' : tab); },
    drawCard(ctx, W, H) {
      if (!cardPreview) return false;
      const t = (performance.now() - cardPreview.start) / 1000;
      const d = A.E[cardPreview.kind];
      if (t > (d.dur || 4)) { cardPreview = null; return false; }
      (cardPreview.kind === 'intro' ? TP.drawIntro : TP.drawOutro)(ctx, { ...d, footer: cardPreview.kind === 'intro' ? brand.site : (d.footer ?? brand.footer) }, t, W, H, logo);
      return true;
    },
    drawAfter(ctx, t, W, H, L) {
      const E = A.E;
      for (const o of E.overlays) TP.drawOverlay(ctx, o, t, W, H, logo);
      if (E.captions?.on && words().length) {
        const lines = captionLines();
        C.drawCaption(ctx, lines, t, capOpts(), W, H, L.LR.split ? L.LR.captionY : undefined);
      }
    },
    tracksBefore() {
      const list = [{ key: 'overlay', name: 'Şablonlar', icon: 'card' }];
      if (words().length) list.push({ key: 'caption', name: 'Altyazı', icon: 'keyboard' });
      if (suggestions?.length && tab === 'clean') list.push({ key: 'suggest', name: 'Öneriler', icon: 'magic' });
      return list;
    },
    renderTrack(key, row) {
      if (key === 'overlay') {
        const ordered = [...A.E.overlays].sort((a, b) => (a.type === 'corner' ? -1 : 0) - (b.type === 'corner' ? -1 : 0));
        for (const o of ordered) {
          const s = A.segEl('tpl ' + o.type, o.s, o.e, TP.TYPES[o.type].name + (o.text1 ? ' · ' + esc(o.text1) : ''), A.sel?.type === 'overlay' && A.sel.id === o.id);
          if (!s) continue;
          A.attachSegDrag(s, o, A.E.overlays, () => { if (!(A.sel?.type === 'overlay' && A.sel.id === o.id)) { A.select({ type: 'overlay', id: o.id }); A.seekSrc(Math.min(o.e - 0.05, o.s + TP.IN + 0.3)); } });
          row.append(s);
        }
        return true;
      }
      if (key === 'caption') {
        for (const l of captionLines()) {
          const s = A.segEl('cap', l.s, l.e, esc(l.words.map(w => w.w).join(' ')));
          if (!s) continue;
          s.onpointerdown = e => { e.stopPropagation(); A.pause(); A.seekSrc(l.s); };
          row.append(s);
        }
        return true;
      }
      if (key === 'suggest') {
        for (const sg of suggestions || []) {
          const s = A.segEl('sug' + (sg.on ? ' on' : ''), sg.s, sg.e, '');
          if (!s) continue;
          s.title = CL.TYPES[sg.type].name + ': ' + sg.label;
          s.onpointerdown = e => { e.stopPropagation(); sg.on = !sg.on; A.renderTimeline(); renderClean(); };
          row.append(s);
        }
        return true;
      }
      return false;
    },
    inspector(sel) {
      if (sel.type !== 'overlay') return null;
      const o = A.E.overlays.find(x => x.id === sel.id);
      if (!o) return null;
      const { ui } = A;
      const labels = { lower: ['Ad', 'Unvan'], title: ['Başlık', 'Etiket'], chapter: ['Bölüm adı', 'Numara'], corner: ['Yazı', null] }[o.type];
      const field = (label, key) => {
        const i = el('input', { type: 'text', value: o[key] || '', maxLength: 90 });
        i.oninput = () => { o[key] = i.value; A.scheduleSave(); };
        i.onchange = () => A.renderTimeline();
        return ui.row(label, i);
      };
      return [
        ui.selTitle('card', TP.TYPES[o.type].name),
        ui.group('Yazılar', field(labels[0], 'text1'), labels[1] ? field(labels[1], 'text2') : null,
          ui.row('Süre', el('output', { textContent: (o.e - o.s).toFixed(1) + ' sn' })),
          h('muted small', 'Süreyi zaman çizelgesinde kenarlarından tutarak değiştirin.')),
        ui.btn(icon('trash') + 'Şablonu sil', () => { A.change(() => { A.E.overlays = A.E.overlays.filter(x => x.id !== o.id); }); A.select(null); }),
      ];
    },
    deleteSel(sel) {
      if (sel.type !== 'overlay') return false;
      A.change(() => { A.E.overlays = A.E.overlays.filter(x => x.id !== sel.id); });
      A.select(null);
      return true;
    },
    defaultGroups() {
      const { ui } = A, E = A.E;
      if (!words().length) return [];
      const c = E.captions;
      return [ui.group('Altyazı',
        ui.row('Göster', ui.checkbox(!!c.on, v => A.change(() => { c.on = v; }))),
        ui.row('Stil', ui.segButtons(Object.entries(C.STYLES).map(([k, s]) => [k, s.name]), c.style, v => A.change(() => { c.style = v; }))),
        ui.row('Konum', ui.segButtons([['bottom', 'Alt'], ['middle', 'Orta'], ['top', 'Üst']], c.pos || 'bottom', v => A.change(() => { c.pos = v; }))),
        ui.row('Boyut', ui.slider(0.6, 1.6, 0.05, c.size || 1, v => { c.size = v; }, v => Math.round(v * 100) + '%')),
      )];
    },
    async exportAssets({ range, srt, onStep }) {
      await fontsReady;
      const E = A.E, { W, H } = A.size;
      const out = { assets: {}, srt: null };
      const L = A.layout(0, true);
      if (E.captions?.on && words().length) {
        out.assets.captions = C.buildAss(words(), TL.normalizeKeep(E.keep, A.srcDur), capOpts(), W, H, L.LR.split ? L.LR.captionY : undefined);
      }
      if (srt && words().length) out.srt = C.buildSrt(words(), TL.clipKeep(TL.normalizeKeep(E.keep, A.srcDur), range));
      out.assets.overlays = E.overlays.map(o => {
        const b = TP.box(o, W, H);
        const cv = el('canvas', { width: b.w, height: b.h });
        TP.drawElement(cv.getContext('2d'), o, b, logo);
        return { dataUrl: cv.toDataURL('image/png'), el: { type: o.type, s: o.s, e: o.e }, box: { x: b.x, y: b.y, w: b.w, h: b.h, slide: b.slide } };
      });
      if (!range) {
        for (const kind of ['intro', 'outro']) {
          const d = E[kind];
          if (!d?.on) continue;
          onStep?.((kind === 'intro' ? 'Açılış' : 'Kapanış') + ' hazırlanıyor');
          const dur = d.dur || (kind === 'intro' ? 4 : 5);
          const cv = el('canvas', { width: W, height: H });
          const g = cv.getContext('2d');
          const frames = Math.round(dur * 30);
          const data = { ...d, footer: kind === 'intro' ? brand.site : (d.footer ?? brand.footer) };
          for (let i = 0; i < frames; i++) {
            (kind === 'intro' ? TP.drawIntro : TP.drawOutro)(g, data, i / 30, W, H, logo);
            const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
            await api.exporter.frame(A.P.id, kind, i + 1, new Uint8Array(await blob.arrayBuffer()));
          }
          out.assets[kind] = { dur: frames / 30 };
        }
      }
      onStep?.('Başlatılıyor');
      return out;
    },
  };

  // Alt bant görünürken altyazı yukarı kayar.
  function capOpts() {
    const c = A.E.captions;
    const avoid = c.pos === 'bottom' || !c.pos ? A.E.overlays.filter(o => o.type === 'lower').map(o => ({ s: o.s, e: o.e })) : [];
    return { ...c, avoid };
  }
  function captionLines() {
    const E = A.E;
    const key = (A.P.transcript?.version || 0) + '|' + JSON.stringify(A.keep) + '|' + E.captions.style;
    if (lineCache.key !== key) lineCache = { key, lines: C.buildLines(words(), A.keep, E.captions.style) };
    return lineCache.lines;
  }
  function transcriptChanged() {
    A.P.transcript.version = (A.P.transcript.version || 0) + 1;
    A.scheduleSave();
  }

  // ---------- METİN ----------
  function wordIndexAt(t) {
    const w = words();
    let lo = 0, hi = w.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (w[m].s <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans >= 0 && t <= w[ans].e + 0.3 ? ans : -1;
  }
  const isCut = w => !A.keep.some(k => (w.s + w.e) / 2 >= k.s && (w.s + w.e) / 2 < k.e);

  async function renderText() {
    const box = $('tab-text');
    if (!A.P) return;
    const hasAudio = A.P.media.mic || A.P.media.system;
    if (!hasAudio) { box.replaceChildren(el('h3', { textContent: 'Altyazı' }), h('muted small', 'Bu projede ses kanalı olmadığı için altyazı oluşturulamaz.')); return; }
    if (!words().length || transcribing) return renderTranscribeForm(box);
    const toolbar = el('div', { className: 'txt-bar' },
      el('button', { innerHTML: icon('redo') + 'Yeniden', title: 'Altyazıyı yeniden oluştur', onclick: () => { if (confirm('Altyazı yeniden oluşturulsun mu? Metinde yaptığınız düzeltmeler kaybolur.')) { A.P.transcript = null; renderText(); A.renderTimeline(); A.renderInspector(); } } }),
      el('button', { innerHTML: icon('export') + 'SRT', title: 'Altyazıyı SRT dosyası olarak kaydet', onclick: () => api.saveSrt(A.P.name, C.buildSrt(words(), A.keep)) }),
      el('label', { className: 'check' }, (() => { const c = el('input', { type: 'checkbox', checked: !!A.E.captions.on }); c.onchange = () => A.change(() => { A.E.captions.on = c.checked; }); return c; })(), 'Videoda göster'),
    );
    const help = h('muted small', 'Kelimeye tıklayın: video o ana gider. Sürükleyerek seçip Delete: o kısım videodan kesilir. Çift tıklayın: kelimeyi düzeltin.');
    const actions = el('div', { className: 'txt-actions', id: 'txt-actions', hidden: true });
    const body = el('div', { className: 'transcript', id: 'transcript' });
    const w = words();
    let para = el('p');
    w.forEach((x, i) => {
      if (i > 0 && (x.s - w[i - 1].e > 1.4 || (/[.!?…]$/.test(w[i - 1].w) && x.s - w[i - 1].e > 0.7))) { body.append(para); para = el('p'); }
      const sp = el('span', { textContent: x.w, className: 'wd' + (isCut(x) ? ' cut' : '') + (x.hidden ? ' hid' : '') });
      sp.dataset.i = i;
      para.append(sp, ' ');
    });
    body.append(para);
    box.replaceChildren(el('h3', { textContent: 'Konuşma metni' }), toolbar, help, actions, body);
    attachTextEvents(body);
    paintSelection();
  }

  async function renderTranscribeForm(box) {
    const models = await api.speech.models();
    const st = await api.settings.get();
    const lang = el('select', {}, new Option('Türkçe', 'tr'), new Option('İngilizce', 'en'), new Option('Otomatik algıla', 'auto'));
    lang.value = st.sttLang || 'tr';
    const model = el('select', {}, ...Object.entries(models).map(([k, m]) => new Option(`${m.label} (${m.mb} MB${m.ready ? ', hazır' : ', ilk kullanımda iner'})`, k)));
    model.value = st.sttModel || 'small';
    const go = el('button', { className: 'primary wide', innerHTML: icon('magic') + 'Altyazı oluştur' });
    const bar = el('div', { className: 'bar' }, el('i'));
    const phase = h('muted small', '');
    const cancel = el('button', { textContent: 'İptal', onclick: () => api.speech.cancel() });
    const prog = el('div', { className: 'stt-prog', hidden: !transcribing }, phase, bar, cancel);
    go.disabled = transcribing;
    go.onclick = async () => {
      api.settings.set({ sttLang: lang.value, sttModel: model.value });
      transcribing = true;
      go.disabled = true;
      prog.hidden = false;
      phase.textContent = 'Başlatılıyor…';
      A.setBusy(true);
      const off = api.speech.onProgress(({ phase: ph, p }) => { phase.textContent = ph + ' · %' + Math.round(p * 100); bar.firstChild.style.width = Math.round(p * 100) + '%'; });
      const t0 = Date.now();
      const res = await api.speech.transcribe(A.P.id, { lang: lang.value, model: model.value });
      off();
      transcribing = false;
      A.setBusy(false);
      if (res.error) { prog.hidden = true; go.disabled = false; box.append(h('error small', res.error)); return; }
      A.P.transcript = res.transcript;
      A.P.transcript.seconds = Math.round((Date.now() - t0) / 1000);
      A.E.captions.on = true;
      A.scheduleSave();
      renderText();
      A.renderTimeline();
      A.renderInspector();
    };
    box.replaceChildren(
      el('h3', { textContent: 'Altyazı' }),
      h('muted small', 'Konuşmanız bu bilgisayarda yazıya dökülür; ses internete gönderilmez. Model ilk kullanımda bir kez indirilir.'),
      el('label', { className: 'field' }, 'Konuşma dili', lang),
      el('label', { className: 'field' }, 'Doğruluk', model),
      h('muted small', '"Doğru" seçeneği Türkçede daha az hata yapar. 10 dakikalık video için birkaç dakika sürebilir.'),
      go, prog,
    );
  }

  // Metin seçimi
  let dragAnchor = null;
  function attachTextEvents(body) {
    body.onpointerdown = e => {
      const sp = e.target.closest('.wd');
      if (!sp || e.button !== 0) return;
      const i = +sp.dataset.i;
      if (e.shiftKey && textSel) textSel = { a: Math.min(textSel.a, i), b: Math.max(textSel.b, i) };
      else { textSel = { a: i, b: i }; dragAnchor = i; }
      A.pause();
      A.seekSrc(words()[i].s);
      paintSelection();
    };
    body.onpointerover = e => {
      if (dragAnchor === null || !(e.buttons & 1)) return;
      const sp = e.target.closest('.wd');
      if (!sp) return;
      const i = +sp.dataset.i;
      textSel = { a: Math.min(dragAnchor, i), b: Math.max(dragAnchor, i) };
      paintSelection();
    };
    addEventListener('pointerup', () => { dragAnchor = null; });
    body.ondblclick = e => {
      const sp = e.target.closest('.wd');
      if (!sp) return;
      const i = +sp.dataset.i;
      const inp = el('input', { type: 'text', value: words()[i].w, className: 'wd-edit' });
      sp.replaceWith(inp);
      inp.focus();
      inp.select();
      const done = commit => {
        if (commit) {
          const v = inp.value.trim();
          if (v) { words()[i].w = v; words()[i].hidden = false; } else words()[i].hidden = true;
          transcriptChanged();
        }
        renderText();
        A.renderTimeline();
      };
      inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); };
      inp.onblur = () => done(true);
    };
  }
  function selRange() {
    const w = words();
    const a = w[textSel.a], b = w[textSel.b];
    const prev = w[textSel.a - 1], next = w[textSel.b + 1];
    return { s: prev ? Math.max(prev.e, a.s - 0.12) : Math.max(0, a.s - 0.12), e: next ? Math.min(next.s, b.e + 0.12) : Math.min(A.srcDur, b.e + 0.12) };
  }
  function paintSelection() {
    const body = $('transcript');
    if (!body) return;
    for (const sp of body.querySelectorAll('.wd.sel')) sp.classList.remove('sel');
    const actions = $('txt-actions');
    if (!textSel) { actions.hidden = true; return; }
    const spans = body.querySelectorAll('.wd');
    for (let i = textSel.a; i <= textSel.b; i++) spans[i]?.classList.add('sel');
    const allCut = words().slice(textSel.a, textSel.b + 1).every(isCut);
    const n = textSel.b - textSel.a + 1;
    actions.hidden = false;
    actions.replaceChildren(
      el('span', { className: 'muted small', textContent: n + ' kelime seçili' }),
      allCut ? el('button', { innerHTML: icon('undo') + 'Geri getir', onclick: restoreSelection }) :
        el('button', { className: 'danger', innerHTML: icon('cut') + 'Videodan kes', title: 'Delete', onclick: cutSelection }),
      el('button', { className: 'ghost', textContent: 'Seçimi kaldır', onclick: () => { textSel = null; paintSelection(); } }),
    );
  }
  function cutSelection() {
    if (!textSel) return;
    const r = selRange();
    A.change(() => { A.E.keep = TL.removeRange(A.keep, r.s, r.e); });
    textSel = null;
    renderText();
  }
  function restoreSelection() {
    if (!textSel) return;
    const r = selRange();
    A.change(() => { A.E.keep = TL.normalizeKeep([...A.keep, r], A.srcDur); });
    textSel = null;
    renderText();
  }
  addEventListener('keydown', e => {
    if (App.view !== 'editor' || tab !== 'text' || !textSel || e.target?.matches?.('input, textarea, select')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (words().slice(textSel.a, textSel.b + 1).every(isCut)) restoreSelection(); else cutSelection();
    } else if (e.key === 'Escape') { textSel = null; paintSelection(); }
  }, true);

  // Oynatırken o anki kelimeyi işaretle
  let lastWord = -1;
  function followWord() {
    setTimeout(followWord, 120);
    if (tab !== 'text' || !A.P || App.view !== 'editor') return;
    const body = $('transcript');
    if (!body) return;
    const i = wordIndexAt(A.curT());
    if (i === lastWord) return;
    body.querySelector('.wd.now')?.classList.remove('now');
    lastWord = i;
    if (i < 0) return;
    const sp = body.querySelectorAll('.wd')[i];
    if (!sp) return;
    sp.classList.add('now');
    if (A.playing) {
      const pb = body.parentElement.getBoundingClientRect(), sb = sp.getBoundingClientRect();
      if (sb.top < pb.top + 60 || sb.bottom > pb.bottom - 40) sp.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  setTimeout(followWord, 120);

  // ---------- TEMİZLİK ----------
  function renderClean() {
    const box = $('tab-clean');
    if (!A.P) return;
    const E = A.E;
    const voice = A.P.media.mic || A.P.media.system;
    const parts = [el('h3', { textContent: 'Ses iyileştirme' })];
    if (!voice) parts.push(h('muted small', 'Bu projede ses yok.'));
    else {
      const chk = (label, key, help) => el('label', { className: 'check', title: help || '' }, (() => { const c = el('input', { type: 'checkbox', checked: !!E.audio[key] }); c.onchange = () => A.change(() => { E.audio[key] = c.checked; }, { render: false }); return c; })(), label);
      parts.push(
        chk('Gürültü azaltma (fan, klima, uğultu)', 'denoise'),
        chk('Ses seviyesini dengele (YouTube, -14 LUFS)', 'normalize'),
        A.P.media.mic && A.P.media.system && A.P.media.system.file !== A.P.media.screen.file ? chk('Konuşurken bilgisayar sesini kıs', 'duck') : null,
        el('button', { className: 'wide', innerHTML: icon('speaker') + 'Bu noktadan 10 sn işlenmiş sesi dinle', onclick: listenProcessed }),
        h('muted small', 'Önizlemede ham ses duyulur. Ayarlar dışa aktarımda uygulanır; farkı bu düğmeyle dinleyebilirsiniz.'),
      );
    }
    parts.push(el('h3', { textContent: 'Kesim önerileri' }));
    if (!words().length) parts.push(h('muted small', 'Dolgu ve tekrar önerileri için önce Metin sekmesinden altyazı oluşturun. Uzun sessizlikler şimdi de bulunabilir.'));
    if (!suggestions) {
      parts.push(el('button', { className: 'primary wide', innerHTML: icon('magic') + 'Önerileri bul', disabled: !voice, onclick: findSuggestions }));
    } else if (!suggestions.length) {
      parts.push(h('muted small', 'Kesilecek bir şey bulunamadı.'), el('button', { className: 'wide', textContent: 'Tekrar ara', onclick: findSuggestions }));
    } else {
      for (const [type, info] of Object.entries(CL.TYPES)) {
        const items = suggestions.filter(s => s.type === type);
        if (!items.length) continue;
        const on = items.filter(s => s.on).length;
        const head = el('label', { className: 'check sug-head' }, (() => {
          const c = el('input', { type: 'checkbox', checked: on === items.length });
          c.indeterminate = on > 0 && on < items.length;
          c.onchange = () => { for (const s of items) s.on = c.checked; renderClean(); A.renderTimeline(); };
          return c;
        })(), el('b', { textContent: info.name }), el('span', { className: 'muted', textContent: ` ${on}/${items.length}` }));
        const list = el('div', { className: 'sug-list' }, ...items.map(s => el('div', { className: 'sug' },
          (() => { const c = el('input', { type: 'checkbox', checked: s.on }); c.onchange = () => { s.on = c.checked; renderClean(); A.renderTimeline(); }; return c; })(),
          el('span', { className: 'sug-t', textContent: A.fmt(TL.sourceToOutput(A.keep, s.s), false) }),
          el('span', { className: 'sug-l', textContent: s.label }),
          el('button', { className: 'icon ghost', title: 'Dinle', innerHTML: icon('play'), onclick: () => listen(s) }),
        )));
        parts.push(el('details', { className: 'sug-group', open: type !== 'silence' }, el('summary', {}, head), h('muted small', info.help), list));
      }
      const chosen = suggestions.filter(s => s.on);
      const secs = chosen.reduce((n, s) => n + (s.e - s.s), 0);
      parts.push(el('div', { className: 'sug-apply' },
        el('button', { className: 'primary wide', disabled: !chosen.length, innerHTML: icon('cut') + `Seçilenleri kes (${chosen.length} · ${secs.toFixed(1)} sn)`, onclick: applySuggestions }),
        el('button', { className: 'ghost wide', textContent: 'Önerileri kapat', onclick: () => { suggestions = null; renderClean(); A.renderTimeline(); } }),
      ));
    }
    box.replaceChildren(...parts.filter(Boolean));
  }

  async function findSuggestions() {
    const P = A.P;
    $('tab-clean').append(h('muted small', 'Ses inceleniyor…'));
    const silences = await api.speech.silences(P.id);
    const voice = P.media.mic ? P.media.mic : P.media.system;
    suggestions = CL.suggest({ words: words().filter(w => !w.hidden), silences, peaks: voice?.peaks, peakOffset: voice?.offset || 0, keep: A.keep, duration: A.srcDur });
    renderClean();
    A.renderTimeline();
  }
  let listenTimer = null;
  function listen(s) {
    clearTimeout(listenTimer);
    A.pause();
    A.seekSrc(Math.max(0, s.s - 1.2));
    A.play();
    listenTimer = setTimeout(() => A.pause(), (s.e - s.s + 2.4) * 1000);
  }
  function applySuggestions() {
    const chosen = suggestions.filter(s => s.on);
    A.change(() => { let k = A.keep; for (const s of chosen) k = TL.removeRange(k, s.s, s.e); A.E.keep = k; });
    suggestions = null;
    renderClean();
    $('tab-clean').append(h('ok small', `${chosen.length} kesim uygulandı. Geri almak için Ctrl+Z.`));
  }
  async function listenProcessed() {
    A.pause();
    const t = A.curT();
    const btn = document.activeElement;
    if (btn) btn.disabled = true;
    const { cursorData, transcript, silences, ...rest } = A.P;
    const res = await api.audioPreview(A.P.id, { ...rest, edit: A.E }, { s: t, e: Math.min(A.srcDur, t + 10) });
    if (btn) btn.disabled = false;
    if (res.error) { alert('Ses önizlemesi hazırlanamadı: ' + res.error); return; }
    previewAudio?.pause();
    previewAudio = new Audio(res.url);
    previewAudio.play();
  }

  // ---------- ŞABLONLAR ----------
  function renderBrand() {
    const box = $('tab-brand');
    if (!A.P) return;
    const E = A.E;
    const inp = (obj, key, ph, onDone) => {
      const i = el('input', { type: 'text', value: obj[key] || '', placeholder: ph || '', maxLength: 90 });
      i.oninput = () => { obj[key] = i.value; A.scheduleSave(); };
      i.onchange = () => onDone?.();
      return i;
    };
    const addAt = (type, extra) => {
      const t = A.curT();
      const dur = TP.TYPES[type].dur;
      const o = { id: A.uid('t'), type, s: t, e: Math.min(A.srcDur, t + dur), ...extra };
      A.change(() => { A.E.overlays.push(o); });
      A.select({ type: 'overlay', id: o.id });
      A.seekSrc(Math.min(o.e - 0.05, o.s + TP.IN + 0.3));
    };
    const corner = E.overlays.find(o => o.type === 'corner');
    box.replaceChildren(
      el('div', { className: 'brand-head' }, logo ? el('img', { src: '../assets/logo.png', alt: '' }) : null, el('div', {}, el('b', { textContent: 'Mimoza Bilişim' }), h('muted small', 'Sarı ve lacivert marka şablonları'))),
      el('h3', { textContent: 'Kimlik' }),
      el('label', { className: 'field' }, 'Ad', inp(brand, 'name')),
      el('label', { className: 'field' }, 'Unvan', inp(brand, 'title', 'Örn. İngilizce Öğretmeni')),
      el('label', { className: 'field' }, 'Web sitesi', inp(brand, 'site')),
      el('button', { className: 'ghost wide', textContent: 'Bunları varsayılan yap', onclick: async () => { await api.settings.set({ brand }); alert('Kimlik bilgileri kaydedildi. Yeni videolarda bunlar kullanılacak.'); } }),
      h('muted small', 'Alt bant eklerken bu bilgiler kullanılır. Eklenen alt bandın yazısını sağ panelden ayrıca değiştirebilirsiniz.'),
      el('h3', { textContent: 'Videoya ekle' }),
      el('button', { className: 'tool', innerHTML: `<span>${icon('card')}</span>Alt bant (ad ve unvan)`, onclick: () => addAt('lower', { text1: brand.name, text2: brand.title }) }),
      el('button', { className: 'tool', innerHTML: `<span>${icon('flag')}</span>Konu başlığı`, onclick: () => addAt('title', { text1: A.P.name, text2: 'Konu' }) }),
      el('button', { className: 'tool', innerHTML: `<span>${icon('flag')}</span>Bölüm kartı`, onclick: () => addAt('chapter', { text1: 'Yeni bölüm', text2: 'Bölüm ' + (E.overlays.filter(o => o.type === 'chapter').length + 1) }) }),
      el('button', { className: 'tool', disabled: !(A.P.marks || []).length, title: (A.P.marks || []).length ? '' : 'Kayıtta Ctrl+Alt+M ile bölüm işareti koyduğunuzda kullanılabilir', innerHTML: `<span>${icon('magic')}</span>Bölüm işaretlerinden kartlar`, onclick: chaptersFromMarks }),
      el('label', { className: 'check' }, (() => {
        const c = el('input', { type: 'checkbox', checked: !!corner });
        c.onchange = () => A.change(() => {
          if (c.checked) A.E.overlays.push({ id: A.uid('t'), type: 'corner', s: 0, e: A.srcDur, text1: brand.site });
          else A.E.overlays = A.E.overlays.filter(o => o.type !== 'corner');
        });
        return c;
      })(), 'Köşede web sitesi (tüm video)'),
      el('h3', { textContent: 'Açılış' }),
      el('label', { className: 'check' }, (() => { const c = el('input', { type: 'checkbox', checked: !!E.intro.on }); c.onchange = () => A.change(() => { E.intro.on = c.checked; }, { render: false }); return c; })(), 'Videonun başına açılış ekle (4 sn)'),
      el('label', { className: 'field' }, 'Başlık', inp(E.intro, 'title')),
      el('label', { className: 'field' }, 'Alt başlık', inp(E.intro, 'subtitle')),
      el('button', { className: 'wide', innerHTML: icon('play') + 'Açılışı önizle', onclick: () => { A.pause(); cardPreview = { kind: 'intro', start: performance.now() }; } }),
      el('h3', { textContent: 'Kapanış' }),
      el('label', { className: 'check' }, (() => { const c = el('input', { type: 'checkbox', checked: !!E.outro.on }); c.onchange = () => A.change(() => { E.outro.on = c.checked; }, { render: false }); return c; })(), 'Videonun sonuna kapanış ekle (5 sn)'),
      el('label', { className: 'field' }, 'Başlık', inp(E.outro, 'title')),
      el('label', { className: 'field' }, 'Alt başlık', inp(E.outro, 'subtitle')),
      el('label', { className: 'field' }, 'Alt bilgi', (() => { const t = el('textarea', { rows: 2, value: E.outro.footer ?? brand.footer }); t.oninput = () => { E.outro.footer = t.value; A.scheduleSave(); }; return t; })()),
      el('button', { className: 'wide', innerHTML: icon('play') + 'Kapanışı önizle', onclick: () => { A.pause(); cardPreview = { kind: 'outro', start: performance.now() }; } }),
    );
  }

  function chaptersFromMarks() {
    const marks = A.P.marks || [];
    A.change(() => {
      A.E.overlays = A.E.overlays.filter(o => o.type !== 'chapter' || !o.fromMark);
      marks.forEach((m, i) => {
        const s = Math.max(0, m.t);
        A.E.overlays.push({ id: A.uid('t'), type: 'chapter', s, e: Math.min(A.srcDur, s + TP.TYPES.chapter.dur), text1: m.label, text2: 'Bölüm ' + (i + 1), fromMark: true });
      });
    });
  }
})();
