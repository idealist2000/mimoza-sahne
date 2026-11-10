'use strict';
// Otomatik güncelleme: mimozabilisim.com'daki Mimoza Sahne Yayın eklentisinden yeni sürümü denetler,
// arka planda indirir ve kullanıcıya "yeniden başlat" seçeneği sunar. Kayıt sürerken indirme ve kurulum yapılmaz.
const { app, ipcMain } = require('electron');

let autoUpdater = null;
let state = { state: 'idle' };
let send = () => {};
let isRecording = () => false;
let pendingDownload = false;

function emit(s) { state = { ...state, ...s }; send(state); }

function startDownload() {
  if (isRecording()) { pendingDownload = true; return; }
  pendingDownload = false;
  autoUpdater.downloadUpdate().catch(e => emit({ state: 'error', message: e.message }));
}

function check() {
  if (!autoUpdater) return;
  autoUpdater.checkForUpdates().catch(e => emit({ state: 'error', message: e.message }));
}

function setup({ sender, recording }) {
  send = sender;
  isRecording = recording;
  ipcMain.handle('update:state', () => state);
  ipcMain.handle('update:check', () => { check(); return state; });
  ipcMain.handle('update:install', () => {
    if (isRecording()) return { error: 'Kayıt sürerken güncelleme kurulamaz.' };
    if (state.state !== 'ready') return { error: 'Güncelleme henüz hazır değil.' };
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  });
  if (!app.isPackaged || process.env.MIMOZA_NO_UPDATE) return;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    console.warn('Güncelleme modülü yüklenemedi:', e.message);
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => emit({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => emit({ state: 'current' }));
  autoUpdater.on('update-available', info => {
    emit({ state: 'available', version: info.version, notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '' });
    startDownload();
  });
  autoUpdater.on('download-progress', p => emit({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', info => emit({ state: 'ready', version: info.version }));
  autoUpdater.on('error', e => emit({ state: 'error', message: String(e?.message || e).split('\n')[0] }));
  // Açılıştan biraz sonra ve 6 saatte bir denetle
  setTimeout(check, 10_000);
  setInterval(check, 6 * 3600_000).unref();
}

// Kayıt bittiğinde bekleyen indirmeyi başlat
function recordingEnded() { if (pendingDownload && autoUpdater) startDownload(); }

module.exports = { setup, recordingEnded, check };
