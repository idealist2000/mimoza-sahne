// Arayüz duman testi: uygulamayı açar, örnek projeyi kurguya yükler,
// ekran görüntüleri alır ve konsol hatalarını raporlar.
// Kullanım: MIMOZA_SMOKE_OUT=<klasör> electron test/smoke.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const out = process.env.MIMOZA_SMOKE_OUT || path.join(__dirname, 'smoke-out');
fs.mkdirSync(out, { recursive: true });
app.setPath('documents', path.join(out, 'docs'));
app.setPath('userData', path.join(out, 'userdata'));
app.setPath('videos', path.join(out, 'videos'));

const errors = [];
app.on('web-contents-created', (e, wc) => {
  wc.on('console-message', (ev) => {
    const { level, message } = ev;
    if (level === 'error' || level === 3 || /Uncaught|Error/.test(message)) errors.push(message);
    console.log('[konsol]', message);
  });
});

require('../src/main/main.js');
// Örnek projeyi oluştur
const ff = require('../src/main/ffmpeg.js');
const T = require('../src/shared/timeline.js');
app.whenReady().then(async () => {
  const fx = path.join(__dirname, 'fixture');
  const projDir = path.join(out, 'docs', 'Mimoza Sahne', 'Projeler', '2026-11-10_09-00-00');
  fs.mkdirSync(projDir, { recursive: true });
  for (const f of ['screen.webm', 'camera.webm', 'mic.webm', 'system.webm']) fs.copyFileSync(path.join(fx, f), path.join(projDir, f));
  const clicks = [[2.0, 0.2, 0.3, 1], [2.6, 0.22, 0.31, 1], [7.5, 0.8, 0.7, 1]];
  const moves = [];
  for (let t = 0; t < 12; t += 1 / 30) moves.push([+t.toFixed(3), 0.5 + 0.3 * Math.sin(t), 0.5 + 0.3 * Math.cos(t)]);
  fs.writeFileSync(path.join(projDir, 'cursor.json'), JSON.stringify({ moves, clicks, scrolls: [], hook: true }));
  fs.writeFileSync(path.join(projDir, 'mic.peaks.json'), JSON.stringify(await ff.audioPeaks(path.join(projDir, 'mic.webm'))));
  fs.writeFileSync(path.join(projDir, 'system.peaks.json'), JSON.stringify(await ff.audioPeaks(path.join(projDir, 'system.webm'))));
  await ff.thumbnail(path.join(projDir, 'screen.webm'), 2, path.join(projDir, 'thumb.jpg'));
  const project = {
    version: 1, id: '2026-11-10_09-00-00', name: 'Yapay zekâ dersi — örnek', created: new Date().toISOString(), profile: 'ai',
    capture: { kind: 'screen', region: null },
    media: {
      screen: { file: 'screen.webm', width: 1920, height: 1080, duration: 12, offset: 0 },
      camera: { file: 'camera.webm', width: 640, height: 480, duration: 11.5, offset: 0.3 },
      mic: { file: 'mic.webm', duration: 11.8, offset: 0.1 },
      system: { file: 'system.webm', duration: 12, offset: -0.05 },
    },
    marks: [{ t: 3, label: 'Prompt yazımı' }, { t: 8, label: 'Sonuçları kontrol' }],
    privacy: [{ s: 9, e: 10 }],
  };
  project.edit = require('../src/main/projects.js').defaultEdit(project);
  project.edit.zooms = T.autoZooms(clicks, 12);
  project.edit.blurs = [{ id: 'b1', s: 1, e: 9, x: 0.6, y: 0.1, w: 0.2, h: 0.15, strength: 22 }];
  project.edit.keep = T.removeRange([{ s: 0, e: 12 }], 4.5, 5.5);
  fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(project));

  const wait = ms => new Promise(r => setTimeout(r, ms));
  let win;
  for (let i = 0; i < 50 && !win; i++) { await wait(200); win = BrowserWindow.getAllWindows().find(w => w.isVisible()); }
  if (!win) { console.log('PENCERE AÇILMADI'); app.exit(1); return; }
  win.setSize(1440, 900);
  const shot = async name => { await wait(700); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(out, name + '.png'), img.toPNG()); };
  const js = code => win.webContents.executeJavaScript(code);
  try {
    await wait(1500);
    await js("App.show('home')");
    await shot('1-ana-sayfa');
    await js("window.Editor.open('2026-11-10_09-00-00')");
    await wait(2500);
    await js("document.getElementById('v-screen').currentTime = 2.4");
    await shot('2-kurgu');
    await js("document.querySelector('.seg-item.zoom').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0, pointerId:1}))");
    await wait(300);
    await shot('3-yakinlastirma-secili');
    // Arayüzden dışa aktarma
    process.env.MIMOZA_EXPORT_PATH = path.join(out, 'disa-aktarim.mp4');
    await js("document.getElementById('export-open').click()");
    await wait(600);
    await shot('3b-disa-aktar');
    await js("document.getElementById('ex-res').value='720'; document.getElementById('ex-go').click()");
    for (let i = 0; i < 120; i++) { await wait(500); if (await js("!document.getElementById('export-done').hidden || !document.getElementById('export-form').hidden")) break; }
    await shot('3c-disa-aktarim-bitti');
    console.log('DISA AKTARIM:', await js("document.getElementById('ex-done-info').textContent + ' | ' + document.getElementById('ex-summary').textContent"));
    await js("document.getElementById('ex-done-close').click()");
    delete process.env.MIMOZA_EXPORT_PATH;
    await js("Setup.open()");
    await wait(1500);
    await shot('4-kayit-hazirligi');
    // Gerçek kayıt testi: tüm ekran, 3 sn
    js("Setup.sourceId = Setup.sources.find(s => s.kind === 'screen').id; Setup.start()").catch(e => console.log("start:", e.message));
    let bar;
    for (let i = 0; i < 30 && !bar; i++) { await wait(200); bar = BrowserWindow.getAllWindows().find(w => w.getURL().includes('controlbar')); }
    if (!bar) throw new Error('Kontrol çubuğu açılmadı');
    for (let i = 0; i < 80; i++) { await wait(250); if (await bar.webContents.executeJavaScript('state') === 'recording') break; }
    await wait(1000);
    const barShot = await bar.webContents.capturePage();
    fs.writeFileSync(path.join(out, '5-kontrol-cubugu.png'), barShot.toPNG());
    await bar.webContents.executeJavaScript("commands.mark()");
    await wait(1500);
    await bar.webContents.executeJavaScript("commands.pause()");
    await wait(800);
    await bar.webContents.executeJavaScript("commands.pause()");
    await wait(1500);
    await bar.webContents.executeJavaScript("commands.stop(); 0");
    for (let i = 0; i < 60; i++) { await wait(250); if (await js("App.view === 'editor' && document.getElementById('processing').hidden")) break; }
    await wait(1000);
    await shot('6-kayit-sonrasi-kurgu');
    const dirs = fs.readdirSync(path.join(out, 'docs', 'Mimoza Sahne', 'Projeler'));
    for (const d of dirs) console.log('PROJE', d, fs.readdirSync(path.join(out, 'docs', 'Mimoza Sahne', 'Projeler', d)).join(', '));
    const newest = dirs.sort().pop();
    console.log('PROJE.JSON', fs.readFileSync(path.join(out, 'docs', 'Mimoza Sahne', 'Projeler', newest, 'project.json'), 'utf8').slice(0, 900));
  } catch (e) { errors.push('Test betiği: ' + e.message); }
  console.log('HATALAR:', errors.length ? errors.join('\n') : 'yok');
  app.exit(errors.length ? 1 : 0);
});
