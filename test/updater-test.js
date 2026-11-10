// Güncelleme akışı testi: yerel eklentiden latest.yml okunur, kurulum dosyası indirilip doğrulanır.
const { app } = require('electron');
app.whenReady().then(async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' }); // Windows güncelleme kanalını taklit et
  const { NsisUpdater } = require('electron-updater');
  const u = new NsisUpdater({ provider: 'generic', url: process.env.FEED });
  u.autoDownload = false;
  u.forceDevUpdateConfig = true;
  u.logger = { info() {}, warn: m => console.log('uyarı', m), error: m => console.log('hata', m) };
  u.on('download-progress', p => { if (Math.round(p.percent) % 25 === 0) console.log('indiriliyor %' + Math.round(p.percent)); });
  try {
    const r = await u.checkForUpdates();
    console.log('MEVCUT:', app.getVersion(), 'YENI:', r.updateInfo.version, 'NOT:', r.updateInfo.releaseNotes);
    const files = await u.downloadUpdate();
    console.log('INDIRILDI VE DOGRULANDI:', files);
  } catch (e) { console.log('HATA:', e.message); }
  app.exit(0);
});
