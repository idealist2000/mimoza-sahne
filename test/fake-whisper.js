#!/usr/bin/env node
// Test için sahte whisper-cli: gerçek aracın -oj çıktı biçimini üretir.
const fs = require('fs');
const args = process.argv.slice(2);
const of = args[args.indexOf('-of') + 1];
for (const need of ['-m', '-f', '-l', '-ml', '-sow', '-oj']) if (!args.includes(need)) { console.error('eksik ' + need); process.exit(2); }
const text = 'Merhaba arkadaşlar, bugün ııı yapay zekâ ile SEO başlıkları yazacağız. Şimdi şimdi ChatGPT açalım. Yani bir prompt yazalım ve sonuçları kontrol edelim.';
const ws = text.split(' ');
const transcription = [];
let t = 300;
ws.forEach((w, i) => {
  const d = 280 + (w.length * 25);
  transcription.push({ timestamps: {}, offsets: { from: t, to: t + d }, text: ' ' + w });
  t += d + (i === 5 ? 1400 : 120);
});
transcription.push({ offsets: { from: t, to: t + 900 }, text: ' Altyazı' }, { offsets: { from: t + 900, to: t + 1500 }, text: ' M.K.' });
for (let p = 0; p <= 100; p += 20) process.stderr.write(`whisper_print_progress_callback: progress = ${p}%\n`);
fs.writeFileSync(of + '.json', JSON.stringify({ result: { language: 'tr' }, transcription }));
