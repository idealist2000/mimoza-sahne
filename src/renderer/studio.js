// Stüdyo: ana sayfa, kayıt hazırlığı, işlem perdesi.
const $ = id => document.getElementById(id);
const api = window.mimoza;
const views = { home: $('home'), setup: $('setup'), editor: $('editor') };
let currentView = 'home';

window.App = {
  show(view) {
    currentView = view;
    for (const [k, el] of Object.entries(views)) el.hidden = k !== view;
    $('top-editor').hidden = view !== 'editor';
    $('top-editor-actions').hidden = view !== 'editor';
    if (view !== 'setup') Setup.stopPreviews();
    if (view === 'home') Home.refresh();
  },
  get view() { return currentView; },
};

const fmtDur = s => { s = Math.round(s || 0); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); };
const fmtDate = iso => { try { return new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Simgeler
$('new-recording').querySelector('.ba-icon').innerHTML = icon('record');
$('import-video').querySelector('.ba-icon').innerHTML = icon('import');
$('undo').innerHTML = icon('undo');
$('redo').innerHTML = icon('redo');
$('export-open').innerHTML = icon('export') + 'Dışa aktar';
$('refresh-sources').innerHTML = icon('redo') + 'Yenile';
$('pick-region').innerHTML = icon('region') + 'Alanı seç';
$('start-recording').innerHTML = icon('record') + 'Kaydı başlat';
$('ic-cam').innerHTML = icon('camera');
$('ic-mic').innerHTML = icon('mic');
$('ic-gear').innerHTML = icon('gear');
$('ic-card').innerHTML = icon('card');
const kindLabels = { screen: ['screen', 'Tüm ekran'], region: ['region', 'Alan seç'], window: ['window', 'Pencere'] };
for (const b of $('kind-tabs').querySelectorAll('button')) b.innerHTML = icon(kindLabels[b.dataset.kind][0]) + kindLabels[b.dataset.kind][1];

$('go-home').onclick = () => { if (window.Editor?.busy) return; window.Editor?.close(); App.show('home'); };

// ---------- Ana sayfa ----------
const Home = {
  async refresh() {
    const list = await api.project.list();
    $('project-count').textContent = list.length ? list.length + ' proje' : '';
    $('no-projects').hidden = list.length > 0;
    $('projects').replaceChildren(...list.slice(0, 40).map(p => {
      const el = document.createElement('div');
      el.className = 'project';
      el.tabIndex = 0;
      el.innerHTML = `<div class="thumb" style="${p.thumb ? `background-image:url('mimoza://media/${encodeURIComponent(p.id)}/thumb.jpg')` : ''}"><span class="dur">${fmtDur(p.duration)}</span></div>
        <div class="meta"><b>${esc(p.name)}</b><span>${esc(fmtDate(p.savedAt || p.created))}</span></div>
        <button class="icon del" title="Projeyi sil">${icon('trash')}</button>`;
      el.onclick = e => { if (!e.target.closest('.del')) window.Editor.open(p.id); };
      el.onkeydown = e => { if (e.key === 'Enter') window.Editor.open(p.id); };
      el.querySelector('.del').onclick = async () => { if (await api.project.remove(p.id)) Home.refresh(); };
      return el;
    }));
  },
};

$('new-recording').onclick = () => Setup.open();
$('import-video').onclick = async () => {
  const id = await api.project.import();
  Processing.hide();
  if (id) window.Editor.open(id);
};
addEventListener('keydown', e => {
  if (e.ctrlKey && e.key.toLowerCase() === 'n' && currentView === 'home') { e.preventDefault(); Setup.open(); }
});

(async () => {
  const info = await api.info();
  const names = { pause: 'Kaydı duraklat / sürdür', stop: 'Kaydı bitir', draw: 'Çizim modu', clear: 'Tahtayı temizle', mark: 'Bölüm işareti koy', privacy: 'Gizlilik perdesi', card: 'Kartı göster / gizle', 'next-card': 'Sıradaki kart', mic: 'Mikrofonu kapat / aç', undo: 'Son çizimi geri al' };
  $('key-list').innerHTML = Object.entries(info.shortcuts).map(([k, c]) =>
    `<div><span>${names[c] || c}</span><kbd>${k.replace('Control', 'Ctrl').replace(/\+/g, ' + ')}</kbd></div>`).join('');
  window.AppInfo = info;
})();

// ---------- Kayıt hazırlığı ----------
const Setup = {
  kind: 'screen',
  sourceId: null,
  sources: [],
  region: null,
  regionDisplay: null,
  camStream: null,
  micStream: null,
  micCtx: null,

  async open() {
    App.show('setup');
    const s = (await api.settings.get()).lastSetup || {};
    this.kind = s.kind || 'screen';
    this.region = s.kind === 'region' ? s.region : null;
    this.regionDisplay = s.displayId || null;
    $('quality').value = String(s.quality || 1080);
    $('system-audio').checked = s.system !== false;
    $('auto-zoom').checked = s.autoZoom !== false;
    $('profile').replaceChildren(...Object.entries(Profiles.profiles).map(([id, p]) => new Option(p.name, id)));
    $('profile').value = s.profile || 'ai';
    $('cards').value = s.cards || '';
    this.profileChanged();
    await this.devices(s);
    await this.loadSources();
    this.setKind(this.kind);
  },

  profileChanged() {
    const p = Profiles.profiles[$('profile').value];
    $('cards').placeholder = p.example + '\n' + p.fields.join(' | ');
    $('profile-tip').textContent = p.tips;
  },

  async devices(saved = {}) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true }));
      s.getTracks().forEach(t => t.stop());
    } catch {}
    const list = await navigator.mediaDevices.enumerateDevices();
    const cams = list.filter(d => d.kind === 'videoinput');
    const mics = list.filter(d => d.kind === 'audioinput' && d.deviceId !== 'communications');
    $('camera-select').replaceChildren(new Option('Kamera kullanma', ''), ...cams.map((d, i) => new Option(d.label || 'Kamera ' + (i + 1), d.deviceId)));
    $('mic-select').replaceChildren(new Option('Mikrofon kullanma', ''), ...mics.map((d, i) => new Option((d.label || 'Mikrofon ' + (i + 1)).replace(/^Default - /, 'Varsayılan - '), d.deviceId)));
    const has = (sel, id) => [...sel.options].some(o => o.value === id);
    $('camera-select').value = saved.cameraId && has($('camera-select'), saved.cameraId) ? saved.cameraId : '';
    $('mic-select').value = saved.micId !== undefined && has($('mic-select'), saved.micId) ? saved.micId : (mics[0]?.deviceId || '');
    this.previewCamera();
    this.previewMic();
  },

  async previewCamera() {
    this.camStream?.getTracks().forEach(t => t.stop());
    this.camStream = null;
    const id = $('camera-select').value;
    $('cam-off').hidden = !!id;
    $('cam-preview').hidden = !id;
    if (!id) return;
    try {
      this.camStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: id }, width: { ideal: 640 } } });
      $('cam-preview').srcObject = this.camStream;
      $('cam-preview').play();
    } catch (e) { $('cam-off').hidden = false; $('cam-off').textContent = 'Kamera açılamadı: ' + e.message; }
  },

  async previewMic() {
    this.micStream?.getTracks().forEach(t => t.stop());
    this.micCtx?.close().catch(() => {});
    this.micStream = null; this.micCtx = null;
    const id = $('mic-select').value;
    $('mic-level').style.width = '0';
    if (!id) return;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id } } });
      this.micCtx = new AudioContext();
      const an = this.micCtx.createAnalyser();
      an.fftSize = 512;
      this.micCtx.createMediaStreamSource(this.micStream).connect(an);
      const data = new Uint8Array(an.fftSize);
      const loop = () => {
        if (!this.micCtx) return;
        an.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        $('mic-level').style.width = Math.min(100, peak / 128 * 170) + '%';
        requestAnimationFrame(loop);
      };
      loop();
    } catch {}
  },

  stopPreviews() {
    this.camStream?.getTracks().forEach(t => t.stop());
    this.micStream?.getTracks().forEach(t => t.stop());
    this.micCtx?.close().catch(() => {});
    this.camStream = this.micStream = this.micCtx = null;
  },

  async loadSources() {
    $('sources').innerHTML = '<p class="muted">Kaynaklar yükleniyor…</p>';
    this.sources = await api.sources();
    this.renderSources();
  },

  renderSources() {
    const wanted = this.kind === 'window' ? 'window' : 'screen';
    const list = this.sources.filter(s => s.kind === wanted);
    if (!list.find(s => s.id === this.sourceId)) this.sourceId = list[0]?.id || null;
    if (this.kind === 'region') {
      $('sources').hidden = true;
      $('region-info').hidden = false;
      const src = this.sources.find(s => s.kind === 'screen' && (!this.regionDisplay || s.displayId === String(this.regionDisplay))) || list[0];
      this.sourceId = src?.id || null;
      $('region-thumb').src = src?.thumb || '';
      const r = this.region;
      $('region-box').hidden = !r;
      if (r) Object.assign($('region-box').style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
      $('region-size').textContent = r ? 'Seçili alan: ekranın %' + Math.round(r.w * 100) + ' × %' + Math.round(r.h * 100) + '’i' : 'Alan seçilmedi';
      $('pick-region').innerHTML = icon('region') + (r ? 'Alanı yeniden seç' : 'Alanı seç');
      this.validate();
      return;
    }
    $('sources').hidden = false;
    $('region-info').hidden = true;
    if (!list.length) $('sources').innerHTML = '<p class="muted">Kaydedilebilecek ' + (wanted === 'window' ? 'pencere' : 'ekran') + ' bulunamadı.</p>';
    else $('sources').replaceChildren(...list.map(s => {
      const b = document.createElement('button');
      b.className = 'source';
      b.setAttribute('aria-pressed', String(s.id === this.sourceId));
      b.innerHTML = (s.thumb ? `<img src="${s.thumb}" alt="">` : '<div class="noimg"></div>') + `<span>${esc(s.name)}</span>`;
      b.onclick = () => { this.sourceId = s.id; this.renderSources(); };
      b.ondblclick = () => { this.sourceId = s.id; this.start(); };
      return b;
    }));
    this.validate();
  },

  setKind(kind) {
    this.kind = kind;
    for (const b of $('kind-tabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.kind === kind));
    $('kind-help').textContent = {
      screen: 'Ekranın tamamı kaydedilir. Akıllı tahta çizimleri, kartlar ve tıklamaya yakınlaştırma çalışır.',
      region: 'Yalnızca seçtiğiniz dikdörtgen kaydedilir. Çizimler ve yakınlaştırma çalışır.',
      window: 'Yalnızca seçtiğiniz pencere kaydedilir. Pencere kaydında çizimler ve otomatik yakınlaştırma kullanılamaz.',
    }[kind];
    this.renderSources();
  },

  validate() {
    $('start-recording').disabled = !this.sourceId || (this.kind === 'region' && !this.region);
  },

  async pickRegion() {
    const src = this.sources.find(s => s.id === this.sourceId);
    const rect = await api.selectRegion(src?.displayId);
    if (rect) { this.region = rect; this.regionDisplay = src?.displayId; }
    await this.loadSources();
  },

  async start() {
    if ($('start-recording').disabled) return;
    const src = this.sources.find(s => s.id === this.sourceId);
    const config = {
      kind: this.kind, sourceId: this.sourceId, sourceName: src?.name, displayId: src?.displayId,
      region: this.kind === 'region' ? this.region : null,
      cameraId: $('camera-select').value || null, micId: $('mic-select').value || null,
      system: $('system-audio').checked, quality: +$('quality').value, autoZoom: $('auto-zoom').checked,
      profile: $('profile').value, cards: $('cards').value,
    };
    this.stopPreviews();
    try { await api.rec.prepare(config); }
    catch (e) { alert(e.message); }
  },
};
window.Setup = Setup;

for (const b of $('kind-tabs').querySelectorAll('button')) b.onclick = () => Setup.setKind(b.dataset.kind);
$('refresh-sources').onclick = () => Setup.loadSources();
$('pick-region').onclick = () => Setup.pickRegion();
$('camera-select').onchange = () => Setup.previewCamera();
$('mic-select').onchange = () => Setup.previewMic();
$('profile').onchange = () => Setup.profileChanged();
$('setup-back').onclick = () => App.show('home');
$('start-recording').onclick = () => Setup.start();

// ---------- İşlem perdesi ----------
const Processing = {
  show(text, sub = '') {
    $('processing').hidden = false;
    $('processing-text').textContent = text;
    $('processing-sub').textContent = sub;
    $('processing-close').hidden = true;
    document.querySelector('#processing .spinner').hidden = false;
  },
  error(text, sub) {
    this.show(text, sub);
    document.querySelector('#processing .spinner').hidden = true;
    $('processing-close').hidden = false;
  },
  hide() { $('processing').hidden = true; },
};
window.Processing = Processing;
$('processing-close').onclick = () => { Processing.hide(); App.show('home'); };
api.project.onProcessing(msg => {
  if (msg.error) Processing.error('İşlem tamamlanamadı', msg.error + (msg.dir ? '\nKayıt dosyaları: ' + msg.dir : ''));
  else Processing.show(msg.step, 'Lütfen bekleyin.');
});
api.project.onOpen(id => { Processing.hide(); window.Editor.open(id); });

App.show('home');
