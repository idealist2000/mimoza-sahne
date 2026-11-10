'use strict';
// Mimoza Sahne — Electron ana süreci
const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen, globalShortcut, Tray, Menu, dialog, shell, protocol, nativeImage, powerSaveBlocker } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const ff = require('./ffmpeg.js');
const projects = require('./projects.js');
const inputLog = require('./input-log.js');
const T = require('../shared/timeline.js');

const RENDERER = path.join(__dirname, '..', 'renderer');
const ICON = path.join(__dirname, '..', 'assets', 'icon.png');

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('tr.com.mimozabilisim.sahne');

if (app.isPackaged) ff.setFfmpegPath(path.join(process.resourcesPath, 'bin', 'ffmpeg.exe'));

protocol.registerSchemesAsPrivileged([
  { scheme: 'mimoza', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
]);

let studio = null;
let controlBar = null;
let overlay = null;
let tray = null;
let rec = null; // aktif kayıt oturumu
let exportAbort = null;
let blocker = null;

// ---------- Ayarlar ----------
const settingsFile = () => path.join(app.getPath('userData'), 'ayarlar.json');
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 1));
  return next;
}

// ---------- Pencereler ----------
const webPrefs = extra => ({
  preload: path.join(__dirname, '..', 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  backgroundThrottling: false,
  ...extra,
});

function createStudio() {
  studio = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 680,
    backgroundColor: '#0e1116', title: 'Mimoza Sahne', icon: ICON, show: false,
    autoHideMenuBar: true, webPreferences: webPrefs(),
  });
  studio.setMenuBarVisibility(false);
  studio.loadFile(path.join(RENDERER, 'studio.html'));
  studio.once('ready-to-show', () => { studio.maximize(); studio.show(); });
  studio.on('close', e => {
    if (rec) { e.preventDefault(); studio.hide(); }
  });
  studio.on('closed', () => { studio = null; if (!rec) app.quit(); });
}

function displayFor(displayId) {
  const all = screen.getAllDisplays();
  return all.find(d => String(d.id) === String(displayId)) || screen.getPrimaryDisplay();
}

function createOverlay(display) {
  const b = display.bounds;
  overlay = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true, frame: false, resizable: false, movable: false, hasShadow: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, fullscreenable: false, show: false,
    backgroundColor: '#00000000', webPreferences: webPrefs(),
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.setVisibleOnAllWorkspaces(true);
  overlay.loadFile(path.join(RENDERER, 'overlay.html'));
  overlay.once('ready-to-show', () => overlay.showInactive());
  overlay.on('closed', () => { overlay = null; });
}

function createControlBar(display) {
  const wa = display.workArea;
  const w = 640, h = 64;
  controlBar = new BrowserWindow({
    x: Math.round(wa.x + (wa.width - w) / 2), y: wa.y + 12, width: w, height: h,
    transparent: true, frame: false, resizable: false, maximizable: false, minimizable: false,
    skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, hasShadow: false, show: false,
    backgroundColor: '#00000000', webPreferences: webPrefs(),
  });
  controlBar.setAlwaysOnTop(true, 'screen-saver', 1);
  // Kontrol çubuğu kayıtta görünmez (Windows 10 2004 ve sonrası).
  controlBar.setContentProtection(true);
  controlBar.loadFile(path.join(RENDERER, 'controlbar.html'));
  controlBar.once('ready-to-show', () => { controlBar.showInactive(); controlBar.moveTop(); });
  controlBar.on('closed', () => { controlBar = null; });
}

// ---------- Tepsi ----------
function setupTray() {
  const img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Mimoza Sahne');
  tray.on('click', () => { if (rec) sendCmd('pause'); else showStudio(); });
  updateTrayMenu();
}
function updateTrayMenu(state = {}) {
  if (!tray) return;
  const items = rec ? [
    { label: state.paused ? 'Kaydı sürdür (F9)' : 'Kaydı duraklat (F9)', click: () => sendCmd('pause') },
    { label: 'Kaydı bitir (F10)', click: () => sendCmd('stop') },
    { label: 'Çizim modu (Ctrl+Alt+D)', click: () => sendCmd('draw') },
    { label: 'Bölüm işareti koy (Ctrl+Alt+M)', click: () => sendCmd('mark') },
    { label: 'Gizlilik perdesi (Ctrl+Alt+G)', click: () => sendCmd('privacy') },
    { type: 'separator' },
    { label: 'Kaydı iptal et', click: () => sendCmd('cancel') },
  ] : [
    { label: 'Stüdyoyu göster', click: showStudio },
    { type: 'separator' },
    { label: 'Çıkış', click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(rec ? (state.paused ? 'Mimoza Sahne — duraklatıldı' : 'Mimoza Sahne — kaydediliyor') : 'Mimoza Sahne');
}
function showStudio() {
  if (!studio) createStudio();
  else { studio.show(); if (studio.isMinimized()) studio.restore(); studio.focus(); }
}

// ---------- Kısayollar ----------
const SHORTCUTS = {
  F9: 'pause', F10: 'stop',
  'Control+Alt+D': 'draw', 'Control+Alt+C': 'clear', 'Control+Alt+M': 'mark',
  'Control+Alt+G': 'privacy', 'Control+Alt+K': 'card', 'Control+Alt+N': 'next-card',
  'Control+Alt+U': 'mic', 'Control+Alt+Z': 'undo',
};
function registerShortcuts() {
  const failed = [];
  for (const [acc, cmd] of Object.entries(SHORTCUTS)) {
    try { if (!globalShortcut.register(acc, () => sendCmd(cmd))) failed.push(acc); } catch { failed.push(acc); }
  }
  return failed;
}
function sendCmd(cmd) {
  controlBar?.webContents.send('cmd', cmd);
}

// ---------- Medya protokolü (aralıklı okuma destekli) ----------
function setupProtocol() {
  protocol.handle('mimoza', async request => {
    const url = new URL(request.url);
    // mimoza://media/<projeId>/<dosya>  veya  mimoza://file/?p=<mutlak yol>
    let file;
    if (url.host === 'media') {
      const [, id, ...rest] = decodeURIComponent(url.pathname).split('/');
      file = path.join(projects.dirOf(id), rest.join('/'));
      if (!file.startsWith(projects.dirOf(id))) return new Response('Yasak', { status: 403 });
    } else if (url.host === 'file') {
      file = url.searchParams.get('p');
      const allowed = rec?.allowed || allowedFiles;
      if (!allowed.has(file)) return new Response('Yasak', { status: 403 });
    } else return new Response('Bulunamadı', { status: 404 });
    let stat;
    try { stat = fs.statSync(file); } catch { return new Response('Bulunamadı', { status: 404 }); }
    const ext = path.extname(file).toLowerCase();
    const type = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.mov': 'video/quicktime', '.m4a': 'audio/mp4' }[ext] || 'application/octet-stream';
    const range = request.headers.get('range');
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/);
      let start = m[1] ? +m[1] : 0;
      let end = m[2] ? +m[2] : stat.size - 1;
      if (!m[1] && m[2]) { start = stat.size - +m[2]; end = stat.size - 1; }
      end = Math.min(end, stat.size - 1);
      const body = Readable.toWeb(fs.createReadStream(file, { start, end }));
      return new Response(body, { status: 206, headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { 'Content-Type': type, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes' } });
  });
}
const allowedFiles = new Set();

// ---------- Ekran paylaşım isteği ----------
function setupDisplayMedia() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!rec?.config?.sourceId) return callback({});
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      const source = sources.find(s => s.id === rec.config.sourceId);
      if (!source) return callback({});
      const result = { video: source };
      if (rec.config.system && process.platform === 'win32') result.audio = 'loopback';
      callback(result);
    } catch { callback({}); }
  }, { useSystemPicker: false });
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });
}

// ---------- IPC: genel ----------
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (e, patch) => writeSettings(patch));
ipcMain.handle('app:info', async () => ({ version: app.getVersion(), hook: inputLog.available(), platform: process.platform, shortcuts: SHORTCUTS }));
ipcMain.handle('encoder:detect', async () => { try { return (await ff.detectEncoder()).label; } catch (e) { return 'FFmpeg bulunamadı: ' + e.message; } });
ipcMain.handle('shell:show', (e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); });
ipcMain.handle('shell:open-project-folder', (e, id) => shell.openPath(projects.dirOf(id)));

ipcMain.handle('sources:list', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 384, height: 216 }, fetchWindowIcons: false });
  const displays = screen.getAllDisplays();
  return sources.filter(s => !/Mimoza Sahne/.test(s.name)).map(s => ({
    id: s.id,
    name: s.id.startsWith('screen') ? (displays.length > 1 ? 'Ekran ' + (displays.findIndex(d => String(d.id) === s.display_id) + 1) : 'Tüm ekran') : s.name,
    kind: s.id.startsWith('screen') ? 'screen' : 'window',
    displayId: s.display_id,
    thumb: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
  }));
});

// Alan seçimi: ekranı kaplayan seçim penceresi açılır.
ipcMain.handle('region:select', async (e, displayId) => {
  const display = displayFor(displayId);
  const b = display.bounds;
  studio?.hide();
  await new Promise(r => setTimeout(r, 250));
  const shot = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: b.width * display.scaleFactor, height: b.height * display.scaleFactor } });
  const src = shot.find(s => s.display_id === String(display.id)) || shot[0];
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, frame: false, resizable: false, movable: false,
    skipTaskbar: true, alwaysOnTop: true, fullscreen: process.platform !== 'linux', show: false, backgroundColor: '#000000', webPreferences: webPrefs(),
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(RENDERER, 'region.html'));
  const result = await new Promise(resolve => {
    const done = (ev, rect) => { if (ev.sender === win.webContents) { ipcMain.removeListener('region:done', done); resolve(rect); } };
    ipcMain.on('region:done', done);
    win.once('ready-to-show', () => { win.webContents.send('region:image', src?.thumbnail.toDataURL()); win.show(); win.focus(); });
    win.on('closed', () => { ipcMain.removeListener('region:done', done); resolve(null); });
  });
  if (!win.isDestroyed()) win.close();
  showStudio();
  return result;
});

// ---------- IPC: kayıt ----------
ipcMain.handle('rec:prepare', async (e, config) => {
  if (rec) throw new Error('Bir kayıt zaten sürüyor.');
  const display = config.kind === 'window' ? screen.getPrimaryDisplay() : displayFor(config.displayId);
  const p = projects.create();
  rec = { config: { ...config, displayBounds: display.bounds, scaleFactor: display.scaleFactor }, project: p, tracks: new Map(), nextTrack: 1, startedAt: null };
  writeSettings({ lastSetup: { ...config, cards: config.cards } });
  createOverlay(display);
  createControlBar(display);
  studio?.minimize();
  setTimeout(() => studio?.hide(), 300);
  updateTrayMenu();
  return { projectId: p.id };
});

ipcMain.handle('rec:config', () => rec?.config || null);
ipcMain.on('rec:resize', (e, h) => {
  if (!controlBar || e.sender !== controlBar.webContents) return;
  const [w] = controlBar.getSize();
  controlBar.setSize(w, Math.max(60, Math.min(200, Math.round(h))));
});

ipcMain.handle('rec:open-track', (e, name, mime) => {
  if (!rec) throw new Error('Kayıt oturumu yok.');
  const ext = mime.includes('h264') || mime.includes('avc1') || mime.includes('matroska') ? '.mkv' : '.webm';
  const file = path.join(rec.project.dir, name + '.raw' + ext);
  const stream = fs.createWriteStream(file);
  const id = rec.nextTrack++;
  rec.tracks.set(id, { name, file, stream, mime, bytes: 0, error: null });
  stream.on('error', err => { const t = rec?.tracks.get(id); if (t) t.error = err.message; });
  return id;
});

ipcMain.on('rec:chunk', (e, id, data) => {
  const t = rec?.tracks.get(id);
  if (!t || !data) return;
  t.bytes += data.byteLength;
  t.stream.write(Buffer.from(data));
});

ipcMain.handle('rec:started', () => {
  if (!rec) return;
  rec.startedAt = Date.now();
  inputLog.start(rec.config.displayBounds);
  inputLog.rebase();
  const failed = registerShortcuts();
  blocker = powerSaveBlocker.start('prevent-display-sleep');
  updateTrayMenu();
  return { failedShortcuts: failed };
});

ipcMain.handle('rec:time', () => inputLog.time());
ipcMain.on('rec:paused', (e, paused) => {
  if (paused) inputLog.pause(); else inputLog.resume();
  updateTrayMenu({ paused });
  overlay?.webContents.send('overlay', { type: 'paused', paused });
});

// Kontrol çubuğundan katmana mesaj
ipcMain.on('overlay:send', (e, msg) => {
  if (!overlay) return;
  if (msg.type === 'draw') {
    overlay.setIgnoreMouseEvents(!msg.on, { forward: true });
    overlay.setFocusable(!!msg.on);
    if (msg.on) overlay.focus();
    else controlBar?.moveTop();
  }
  overlay.webContents.send('overlay', msg);
});
// Katmandan kontrol çubuğuna mesaj (ör. Esc ile çizimden çıkış)
ipcMain.on('overlay:event', (e, msg) => controlBar?.webContents.send('overlay-event', msg));
inputLog.onWheelEvent(() => overlay?.webContents.send('overlay', { type: 'wheel' }));

ipcMain.handle('rec:close-tracks', async () => {
  if (!rec) return;
  await Promise.all([...rec.tracks.values()].map(t => new Promise(r => t.stream.end(r))));
});

async function teardown() {
  globalShortcut.unregisterAll();
  if (blocker !== null) { try { powerSaveBlocker.stop(blocker); } catch {} blocker = null; }
  overlay?.close();
  controlBar?.close();
}

ipcMain.handle('rec:cancel', async () => {
  if (!rec) return;
  const r = rec;
  inputLog.stop();
  await Promise.all([...r.tracks.values()].map(t => new Promise(res => t.stream.end(res))));
  rec = null;
  await teardown();
  try { fs.rmSync(r.project.dir, { recursive: true, force: true }); } catch {}
  updateTrayMenu();
  showStudio();
});

// Kayıt bitti: dosyaları düzelt, ses dalgası çıkar, projeyi yaz.
ipcMain.handle('rec:finish', async (e, meta) => {
  if (!rec) return null;
  const r = rec;
  const cursor = inputLog.stop();
  await Promise.all([...r.tracks.values()].map(t => new Promise(res => t.stream.end(res))));
  rec = null;
  await teardown();
  updateTrayMenu();
  showStudio();
  studio?.webContents.send('processing', { step: 'Kayıt dosyaları hazırlanıyor…' });
  try {
    const media = {};
    for (const t of r.tracks.values()) {
      if (!t.bytes) continue;
      const kind = t.name === 'mic' || t.name === 'system' ? 'audio' : 'video';
      const info = await ff.finalizeRecording(t.file, kind);
      media[t.name] = { file: info.file, duration: info.duration, width: info.width, height: info.height, offset: +(meta.offsets?.[t.name] || 0).toFixed(4) };
      if (kind === 'audio') { delete media[t.name].width; delete media[t.name].height; }
    }
    if (!media.screen && media.camera) { media.screen = media.camera; delete media.camera; }
    if (!media.screen) throw new Error('Ekran kaydı oluşturulamadı. Kaynağı kontrol edip tekrar deneyin.');
    media.screen.offset = 0;
    studio?.webContents.send('processing', { step: 'Ses dalgaları çıkarılıyor…' });
    for (const key of ['mic', 'system']) {
      if (!media[key]) continue;
      try { fs.writeFileSync(path.join(r.project.dir, key + '.peaks.json'), JSON.stringify(await ff.audioPeaks(path.join(r.project.dir, media[key].file)))); } catch {}
    }
    try { await ff.thumbnail(path.join(r.project.dir, media.screen.file), Math.min(2, media.screen.duration / 2), path.join(r.project.dir, 'thumb.jpg')); } catch {}
    // İmleç kayıtlarını ekran kaydının süresine sığdır ve kaydırma ofsetini uygula.
    const shift = meta.cursorShift || 0;
    const fix = arr => arr.map(([t, ...rest]) => [+(t + shift).toFixed(3), ...rest]).filter(([t]) => t >= 0 && t <= media.screen.duration);
    const cursorData = cursor ? { moves: fix(cursor.moves), clicks: fix(cursor.clicks), scrolls: cursor.scrolls.map(t => t + shift), hook: cursor.hook } : null;
    if (cursorData) fs.writeFileSync(path.join(r.project.dir, 'cursor.json'), JSON.stringify(cursorData));
    const project = {
      version: 1, id: r.project.id, name: r.project.name, created: new Date().toISOString(),
      profile: r.config.profile,
      capture: { kind: r.config.kind, region: r.config.region || null, sourceName: r.config.sourceName },
      media,
      marks: (meta.marks || []).map(m => ({ t: Math.max(0, m.t), label: m.label })),
      privacy: (meta.privacy || []).map(p => ({ s: Math.max(0, p.s), e: Math.min(media.screen.duration, p.e) })),
    };
    project.edit = projects.defaultEdit(project);
    if (cursorData && r.config.autoZoom !== false && r.config.kind !== 'window') project.edit.zooms = T.autoZooms(cursorData.clicks, media.screen.duration);
    projects.save(project);
    studio?.webContents.send('project:open', project.id);
    return project.id;
  } catch (err) {
    studio?.webContents.send('processing', { error: err.message, dir: r.project.dir });
    return null;
  }
});

// ---------- IPC: projeler ----------
ipcMain.handle('project:list', () => projects.list());
ipcMain.handle('project:load', (e, id) => projects.load(id));
ipcMain.handle('project:save', (e, project) => projects.save(project));
ipcMain.handle('project:rename', (e, id, name) => {
  const p = projects.load(id);
  p.name = String(name).slice(0, 120) || p.name;
  return projects.save(p);
});
ipcMain.handle('project:delete', async (e, id) => {
  const { response } = await dialog.showMessageBox(studio, {
    type: 'warning', buttons: ['Sil', 'Vazgeç'], defaultId: 1, cancelId: 1,
    title: 'Projeyi sil', message: 'Bu proje ve içindeki kayıt dosyaları kalıcı olarak silinsin mi?', detail: 'Dışa aktardığınız videolar silinmez.',
  });
  if (response !== 0) return false;
  await shell.trashItem(projects.dirOf(id)).catch(() => fs.rmSync(projects.dirOf(id), { recursive: true, force: true }));
  return true;
});

ipcMain.handle('project:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(studio, {
    title: 'Video içe aktar', properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mov', 'mkv', 'm4v'] }],
  });
  if (canceled || !filePaths[0]) return null;
  studio?.webContents.send('processing', { step: 'Video hazırlanıyor…' });
  const src = filePaths[0];
  const p = projects.create(path.basename(src, path.extname(src)));
  try {
    let info = await ff.probe(src);
    if (!info.hasVideo) throw new Error('Dosyada video bulunamadı.');
    let file = 'ekran' + path.extname(src).toLowerCase();
    const playable = ['h264', 'vp8', 'vp9', 'av1'].includes(info.codec) && ['.mp4', '.webm', '.m4v', '.mov'].includes(path.extname(src).toLowerCase());
    if (playable) fs.copyFileSync(src, path.join(p.dir, file));
    else {
      studio?.webContents.send('processing', { step: 'Video uyumlu biçime dönüştürülüyor…' });
      file = 'ekran.mp4';
      const enc = await ff.detectEncoder();
      await ff.run(['-y', '-i', src, ...enc.args(20), '-pix_fmt', enc.pix, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', path.join(p.dir, file)]);
    }
    info = await ff.probe(path.join(p.dir, file));
    const media = { screen: { file, duration: info.duration, width: info.width, height: info.height, offset: 0 } };
    if (info.hasAudio) {
      media.system = { file, duration: info.duration, offset: 0 };
      try { fs.writeFileSync(path.join(p.dir, 'system.peaks.json'), JSON.stringify(await ff.audioPeaks(path.join(p.dir, file)))); } catch {}
    }
    try { await ff.thumbnail(path.join(p.dir, file), Math.min(2, info.duration / 2), path.join(p.dir, 'thumb.jpg')); } catch {}
    const project = { version: 1, id: p.id, name: p.name, created: new Date().toISOString(), capture: { kind: 'import', region: null }, media, marks: [], privacy: [] };
    project.edit = projects.defaultEdit(project);
    project.edit.tracks.system.volume = 1;
    projects.save(project);
    return p.id;
  } catch (err) {
    fs.rmSync(p.dir, { recursive: true, force: true });
    studio?.webContents.send('processing', { error: err.message });
    return null;
  }
});

// ---------- IPC: dışa aktarma ----------
ipcMain.handle('export:start', async (e, id, project, assets, options) => {
  const dir = projects.dirOf(id);
  const videos = app.getPath('videos');
  const defaultDir = path.join(videos, 'Mimoza Sahne');
  fs.mkdirSync(defaultDir, { recursive: true });
  const safe = String(project.name || 'video').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  // MIMOZA_EXPORT_PATH yalnızca otomatik testlerde kayıt penceresini atlamak için kullanılır.
  const { canceled, filePath } = process.env.MIMOZA_EXPORT_PATH ? { canceled: false, filePath: process.env.MIMOZA_EXPORT_PATH } :
    await dialog.showSaveDialog(studio, {
      title: 'Videoyu kaydet', defaultPath: path.join(defaultDir, safe + '.mp4'), filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
    });
  if (canceled || !filePath) return { canceled: true };
  const assetFiles = {};
  for (const [k, dataUrl] of Object.entries(assets || {})) {
    if (!dataUrl) continue;
    const f = path.join(dir, 'export-' + k + '.png');
    fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'));
    assetFiles[k] = f;
  }
  const full = projects.load(id);
  full.edit = project.edit;
  full.name = project.name;
  exportAbort = new AbortController();
  const t0 = Date.now();
  try {
    const r = await ff.exportVideo(full, dir, assetFiles, filePath, {
      signal: exportAbort.signal, quality: options?.quality,
      onProgress: (p, label) => e.sender.send('export:progress', { p, label }),
    });
    return { file: filePath, encoder: r.encoder, seconds: (Date.now() - t0) / 1000 };
  } catch (err) {
    try { fs.unlinkSync(filePath); } catch {}
    return { error: exportAbort.signal.aborted ? 'Dışa aktarma iptal edildi.' : err.message };
  } finally {
    exportAbort = null;
    for (const f of Object.values(assetFiles)) { try { fs.unlinkSync(f); } catch {} }
  }
});
ipcMain.handle('export:cancel', () => exportAbort?.abort());

// ---------- Uygulama ----------
app.on('second-instance', showStudio);
app.whenReady().then(() => {
  setupProtocol();
  setupDisplayMedia();
  setupTray();
  createStudio();
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); inputLog.shutdown(); });
app.on('window-all-closed', () => { if (!rec) app.quit(); });
