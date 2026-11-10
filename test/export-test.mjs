// Dışa aktarma motoru testi: sentetik kayıtlarla tam bir proje dışa aktarılır
// ve çıktının süresi, boyutu ve ses akışı kontrol edilir.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ff = require('../src/main/ffmpeg.js');
const T = require('../src/shared/timeline.js');

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture');

// Örnek kayıtlar yoksa üret
if (!fs.existsSync(path.join(dir, 'mask.png'))) {
  fs.mkdirSync(dir, { recursive: true });
  const mk = (args, name) => ff.run(['-y', ...args, path.join(dir, name)]);
  await mk(['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=12', '-c:v', 'libvpx', '-b:v', '2M', '-deadline', 'realtime', '-cpu-used', '8'], 'screen.webm');
  await mk(['-f', 'lavfi', '-i', 'testsrc=s=640x480:r=30:d=11.5', '-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8'], 'camera.webm');
  await mk(['-f', 'lavfi', '-i', 'sine=f=440:d=11.8', '-c:a', 'libopus'], 'mic.webm');
  await mk(['-f', 'lavfi', '-i', 'sine=f=880:d=12', '-c:a', 'libopus'], 'system.webm');
  await mk(['-f', 'lavfi', '-i', 'color=c=0xffc72c@0.9:s=128x128,format=rgba', '-frames:v', '1'], 'ring.png');
  await mk(['-f', 'lavfi', '-i', 'color=c=white@0.5:s=128x128,format=rgba', '-frames:v', '1'], 'click.png');
  await mk(['-f', 'lavfi', '-i', 'color=c=white:s=256x256,format=gray', '-frames:v', '1'], 'mask.png');
}
const clicks = [[2.0, 0.2, 0.3], [2.6, 0.22, 0.31], [7.5, 0.8, 0.7]];
const moves = [];
for (let t = 0; t < 12; t += 1 / 30) moves.push([t, 0.5 + 0.3 * Math.sin(t), 0.5 + 0.3 * Math.cos(t)]);

const base = () => ({
  media: {
    screen: { file: 'screen.webm', width: 1920, height: 1080, duration: 12, offset: 0 },
    camera: { file: 'camera.webm', width: 640, height: 480, duration: 11.5, offset: 0.3 },
    mic: { file: 'mic.webm', duration: 11.8, offset: 0.1 },
    system: { file: 'system.webm', duration: 12, offset: -0.05 },
  },
  capture: { kind: 'screen', region: null },
  cursorData: { moves, clicks },
  edit: {
    keep: T.removeRange([{ s: 0, e: 12 }], 4, 6),
    zooms: T.autoZooms(clicks, 12),
    blurs: [{ id: 'b1', s: 1, e: 9, x: 0.6, y: 0.1, w: 0.2, h: 0.15, strength: 20 }],
    mutes: [{ s: 8, e: 9 }],
    camera: { visible: true, x: 0.97, y: 0.95, size: 0.24, shape: 'circle', mirror: false },
    tracks: { mic: { volume: 1 }, system: { volume: 0.5 } },
    output: { aspect: '16:9', quality: 720, bg: '#101418' },
    cursor: { highlight: true, clicks: true, size: 1 },
  },
});
const assets = { ring: path.join(dir, 'ring.png'), click: path.join(dir, 'click.png'), mask: path.join(dir, 'mask.png') };

let failed = 0;
async function check(name, project, expect) {
  const out = path.join(dir, 'out-' + name + '.mp4');
  const t0 = Date.now();
  try {
    const r = await ff.exportVideo(project, dir, assets, out, {});
    const info = await ff.probe(out);
    const ok = Math.abs(info.duration - expect.duration) < 0.25 && info.width === expect.w && info.height === expect.h && info.hasAudio === expect.audio;
    console.log((ok ? 'GEÇTİ ' : 'KALDI ') + name, JSON.stringify({ dur: info.duration, w: info.width, h: info.height, audio: info.hasAudio, enc: r.encoder, ms: Date.now() - t0 }));
    if (!ok) failed++;
  } catch (e) { failed++; console.log('KALDI ' + name, e.message); }
}

console.log('Otomatik yakınlaştırmalar:', JSON.stringify(T.autoZooms(clicks, 12).map(z => [z.s.toFixed(2), z.e.toFixed(2)])));
await check('yatay', base(), { duration: 10, w: 1280, h: 720, audio: true });
const v = base(); v.edit.output = { aspect: '9:16', quality: 720, bg: '#101418' }; v.edit.camera.shape = 'rect';
await check('dikey', v, { duration: 10, w: 720, h: 1280, audio: true });
const r = base(); r.capture.region = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }; r.media.camera = null; r.media.mic = null; r.media.system = null; r.edit.output.aspect = '1:1';
await check('alan-sessiz', r, { duration: 10, w: 720, h: 720, audio: false });

// ---------- Teslim 2: altyazı, şablon, açılış/kapanış, ses, dikey bölünmüş, aralık ----------
const C = require('../src/shared/captions.js');
const words = [];
const text = 'Merhaba arkadaşlar bugün ııı yapay zekâ ile SEO başlıkları yazacağız. Şimdi şimdi ChatGPT açalım ve prompt yazalım.'.split(' ');
text.forEach((w, i) => words.push({ w, s: 0.5 + i * 0.55, e: 0.5 + i * 0.55 + 0.45 }));
fs.mkdirSync(path.join(dir, 'export-fonts'), { recursive: true });
for (const f of fs.readdirSync(path.join(dir, '..', '..', 'src', 'assets', 'fonts'))) fs.copyFileSync(path.join(dir, '..', '..', 'src', 'assets', 'fonts', f), path.join(dir, 'export-fonts', f));
const full = (aspect, layout, style) => {
  const p = base();
  p.edit.output = { aspect, quality: 720, bg: '#101418', layout };
  p.edit.audio = { denoise: true, normalize: true, duck: true };
  p.edit.captions = { on: true, style, pos: 'bottom', size: 1 };
  const { w: W, h: H } = T.outputSize(aspect, 720);
  const L = T.layoutRects(p.edit, W, H, 1920, 1080, true);
  fs.writeFileSync(path.join(dir, 'export-captions.ass'), C.buildAss(words, T.normalizeKeep(p.edit.keep, 12), p.edit.captions, W, H, L.split ? L.captionY : undefined));
  return p;
};
// Katman PNG'si ve açılış kareleri
await ff.run(['-y', '-f', 'lavfi', '-i', 'color=c=0x002058@0.95:s=600x110,format=rgba', '-frames:v', '1', path.join(dir, 'export-ov-1.png')]);
fs.mkdirSync(path.join(dir, 'export-intro'), { recursive: true });
await ff.run(['-y', '-f', 'lavfi', '-i', 'color=c=0x002058:s=1280x720:d=2:r=30', path.join(dir, 'export-intro', '%04d.jpg')]);
const assets2 = {
  ...assets, captions: 'export-captions.ass',
  overlays: [{ file: 'export-ov-1.png', el: { type: 'lower', s: 1, e: 6 }, box: { x: 36, y: 520, w: 600, h: 110, slide: 58 } }],
  intro: { pattern: 'export-intro/%04d.jpg', dur: 2 }, outro: { pattern: 'export-intro/%04d.jpg', dur: 2 },
};
async function check2(name, project, a, expect, range) {
  const out = path.join(dir, 'out-' + name + '.mp4');
  const t0 = Date.now();
  try {
    const r = await ff.exportVideo(project, dir, a, out, { range });
    const info = await ff.probe(out);
    const ok = Math.abs(info.duration - expect.duration) < 0.3 && info.width === expect.w && info.height === expect.h && info.hasAudio === expect.audio;
    console.log((ok ? 'GEÇTİ ' : 'KALDI ') + name, JSON.stringify({ dur: info.duration, w: info.width, h: info.height, audio: info.hasAudio, ms: Date.now() - t0 }));
    if (!ok) failed++;
  } catch (e) { failed++; console.log('KALDI ' + name, e.message.slice(0, 600)); }
}
await check2('tam-yatay', full('16:9', 'fit', 'karaoke'), assets2, { duration: 14, w: 1280, h: 720, audio: true });
await check2('dikey-bolunmus', full('9:16', 'split', 'big'), { ...assets2, intro: null, outro: null }, { duration: 10, w: 720, h: 1280, audio: true });
await check2('aralik-klasik', full('16:9', 'fit', 'classic'), { ...assets2, intro: null, outro: null }, { duration: 3, w: 1280, h: 720, audio: true }, { s: 1, e: 4.5 });
try {
  const p = full('16:9', 'fit', 'classic');
  await ff.audioPreview(p, dir, path.join(dir, 'out-ses.wav'), { s: 2, e: 7 });
  const info = await ff.probe(path.join(dir, 'out-ses.wav'));
  const ok = Math.abs(info.duration - 3) < 0.2 && info.hasAudio;
  console.log((ok ? 'GEÇTİ ' : 'KALDI ') + 'ses-onizleme', info.duration);
  if (!ok) failed++;
} catch (e) { failed++; console.log('KALDI ses-onizleme', e.message.slice(0, 400)); }
process.exit(failed ? 1 : 0);
