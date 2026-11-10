// Windows kurulum paketine girecek FFmpeg'i indirir (vendor/win/ffmpeg.exe).
// Kullanım: node scripts/fetch-ffmpeg.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const https = require('node:https');

const url = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64.gz';
const outDir = path.join(__dirname, '..', 'vendor', 'win');
const out = path.join(outDir, 'ffmpeg.exe');

function get(u, cb) {
  https.get(u, res => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return get(res.headers.location, cb);
    if (res.statusCode !== 200) throw new Error('İndirme başarısız: HTTP ' + res.statusCode);
    cb(res);
  }).on('error', e => { throw e; });
}

if (fs.existsSync(out)) { console.log('FFmpeg zaten var:', out); process.exit(0); }
fs.mkdirSync(outDir, { recursive: true });
console.log('FFmpeg indiriliyor…');
get(url, res => {
  res.pipe(zlib.createGunzip()).pipe(fs.createWriteStream(out)).on('finish', () => console.log('Hazır:', out));
});
