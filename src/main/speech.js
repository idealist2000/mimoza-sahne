'use strict';
// Konuşmayı yazıya dökme (whisper.cpp), model indirme ve sessizlik bulma.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ff = require('./ffmpeg.js');

const MODELS = {
  base: { file: 'ggml-base.bin', label: 'Hızlı', mb: 142, url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin' },
  small: { file: 'ggml-small.bin', label: 'Doğru', mb: 466, url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin' },
};

let whisperPath = process.env.MIMOZA_WHISPER || 'whisper-cli';
let modelDir = null;
let fetchImpl = globalThis.fetch;
function configure({ whisper, models, fetch }) {
  if (whisper) whisperPath = whisper;
  if (models) { modelDir = models; fs.mkdirSync(modelDir, { recursive: true }); }
  if (fetch) fetchImpl = fetch;
}

function modelPath(key) {
  const m = MODELS[key] || MODELS.small;
  if (process.env.MIMOZA_WHISPER_MODEL) return process.env.MIMOZA_WHISPER_MODEL;
  return path.join(modelDir, m.file);
}
function modelStatus() {
  return Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, { ...m, ready: fs.existsSync(modelPath(k)) }]));
}

// Modeli indirir. İlerleme: onProgress(0..1)
async function ensureModel(key, { onProgress, signal } = {}) {
  const file = modelPath(key);
  if (fs.existsSync(file)) return file;
  const m = MODELS[key] || MODELS.small;
  const part = file + '.part';
  const res = await fetchImpl(m.url, { signal, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error('Model indirilemedi (HTTP ' + res.status + '). İnternet bağlantınızı kontrol edin.');
  const total = Number(res.headers.get('content-length')) || m.mb * 1024 * 1024;
  const out = fs.createWriteStream(part);
  let got = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
      onProgress?.(Math.min(0.999, got / total));
    }
    await new Promise((r, j) => out.end(e => (e ? j(e) : r())));
  } catch (e) {
    out.destroy();
    try { fs.unlinkSync(part); } catch {}
    throw signal?.aborted ? new Error('İptal edildi.') : new Error('Model indirilemedi: ' + e.message);
  }
  if (got < 10 * 1024 * 1024) { try { fs.unlinkSync(part); } catch {} throw new Error('Model dosyası eksik indi. Tekrar deneyin.'); }
  fs.renameSync(part, file);
  return file;
}

// Konuşmanın bulunduğu kanal: mikrofon, yoksa bilgisayar sesi / video sesi.
function voiceTrack(project) {
  const m = project.media;
  if (m.mic) return { key: 'mic', ...m.mic };
  if (m.system) return { key: 'system', ...m.system };
  return null;
}

const HALLUCINATIONS = [/^altyaz[ıi]/i, /^m\.?k\.?$/i, /^\[.*\]$/, /^\(.*\)$/, /^\*.*\*$/, /^♪+$/];

// whisper-cli JSON çıktısını kelimelere çevirir (-ml 1 -sow ile her parça bir kelimedir).
function parseWhisperJson(data, offset = 0) {
  const words = [];
  for (const seg of data.transcription || []) {
    const text = String(seg.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const s = (seg.offsets?.from ?? 0) / 1000 + offset;
    const e = (seg.offsets?.to ?? 0) / 1000 + offset;
    // Bir parça birden çok kelime içerebilir: süreyi harf sayısına göre paylaştır.
    const parts = text.split(' ').filter(Boolean);
    const total = parts.reduce((n, p) => n + p.length, 0) || 1;
    let t = s;
    for (const p of parts) {
      const d = (e - s) * p.length / total;
      words.push({ w: p, s: +t.toFixed(3), e: +(t + d).toFixed(3) });
      t += d;
    }
  }
  // "Altyazı M.K." gibi bilinen uydurmaları ve köşeli parantezli etiketleri çıkar.
  const clean = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i].w;
    if (/^altyaz[ıi]$/i.test(w) && words[i + 1] && /^m\.?k\.?$/i.test(words[i + 1].w)) { i++; continue; }
    if (HALLUCINATIONS.slice(2).some(r => r.test(w))) continue;
    clean.push(words[i]);
  }
  // Çakışan zamanları düzelt
  for (let i = 1; i < clean.length; i++) if (clean[i].s < clean[i - 1].e) clean[i].s = clean[i - 1].e;
  for (const w of clean) if (w.e < w.s + 0.04) w.e = +(w.s + 0.04).toFixed(3);
  return clean;
}

function runWhisper(args, { onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(whisperPath, args, { windowsHide: true, cwd: path.dirname(whisperPath) === '.' ? undefined : path.dirname(whisperPath) });
    try { if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
    let err = '';
    const onData = d => {
      const s = String(d);
      err += s;
      if (err.length > 100000) err = err.slice(-50000);
      const m = s.match(/progress\s*=\s*(\d+)%/g);
      if (m) onProgress?.(+m[m.length - 1].match(/(\d+)/)[1] / 100);
    };
    child.stderr.on('data', onData);
    child.stdout.on('data', onData);
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', e => reject(new Error('Yazıya dökme aracı çalıştırılamadı: ' + e.message)));
    child.on('close', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new Error('İptal edildi.'));
      if (code === 0) resolve(err);
      else reject(new Error('Yazıya dökme başarısız (' + code + '): ' + err.split('\n').filter(Boolean).slice(-3).join(' | ')));
    });
  });
}

const PROMPTS = {
  tr: 'Iıı, eee, şey... Merhaba, bugün yapay zekâ, SEO ve Google Ads konularını anlatacağım. Hmm, yani şimdi bakalım.',
  en: 'Umm, uh, so... Hello, today I am going to talk about AI, SEO and Google Ads. Hmm, you know, let\'s see.',
};

// Projenin konuşma kanalını yazıya döker. Dönüş: { words, lang, model }
async function transcribe(project, dir, { lang = 'tr', model = 'small', onProgress, signal } = {}) {
  const voice = voiceTrack(project);
  if (!voice) throw new Error('Bu projede ses kanalı yok.');
  const progress = (phase, p) => onProgress?.({ phase, p });
  const mfile = await ensureModel(model, { onProgress: p => progress('Model indiriliyor (' + (MODELS[model]?.mb || '') + ' MB, yalnızca bir kez)', p), signal });
  // Türkçe karakterli yollardan kaçınmak için geçici klasör kullan.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mimoza-stt-'));
  try {
    progress('Ses hazırlanıyor', 0);
    const wav = path.join(tmp, 'ses.wav');
    await ff.run(['-y', '-i', path.join(dir, voice.file), '-vn', '-ac', '1', '-ar', '16000', '-af', 'highpass=f=70,dynaudnorm=f=150:g=11', '-c:a', 'pcm_s16le', wav], { signal });
    // Fiziksel çekirdek sayısı kadar iş parçacığı yeterli; fazlası bilgisayarı kilitler.
    const threads = Math.max(2, Math.min(4, os.cpus().length - 2));
    const base = path.join(tmp, 'sonuc');
    const args = ['-m', mfile, '-f', wav, '-l', lang, '-t', String(threads), '-ml', '1', '-sow', '-oj', '-of', base, '-pp', '-bs', model === 'small' ? '2' : '1', '-bo', '2', '-mc', '64'];
    if (PROMPTS[lang]) args.push('--prompt', PROMPTS[lang]);
    progress('Konuşma yazıya dökülüyor', 0);
    try {
      await runWhisper(args, { onProgress: p => progress('Konuşma yazıya dökülüyor', p), signal });
    } catch (e) {
      if (signal?.aborted || !PROMPTS[lang]) throw e;
      // Komut satırı ipucu sorun çıkarırsa ipucu olmadan tekrar dene.
      await runWhisper(args.slice(0, args.indexOf('--prompt')), { onProgress: p => progress('Konuşma yazıya dökülüyor', p), signal });
    }
    const data = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
    const words = parseWhisperJson(data, voice.offset || 0);
    if (!words.length) throw new Error('Konuşma algılanamadı. Mikrofon kanalında ses olduğunu kontrol edin.');
    return { words, lang: data.result?.language || lang, model, track: voice.key, created: new Date().toISOString() };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Sessizlikler (kaynak zamanında)
async function silences(project, dir, { noise = -35, min = 0.6 } = {}) {
  const voice = voiceTrack(project);
  if (!voice) return [];
  let stderr = '';
  try {
    ({ stderr } = await ff.run(['-i', path.join(dir, voice.file), '-vn', '-af', `highpass=f=80,silencedetect=noise=${noise}dB:d=${min}`, '-f', 'null', '-']));
  } catch (e) { stderr = e.stderr || ''; }
  const out = [];
  let start = null;
  for (const line of stderr.split('\n')) {
    const a = line.match(/silence_start:\s*(-?[\d.]+)/);
    const b = line.match(/silence_end:\s*([\d.]+)/);
    if (a) start = Math.max(0, +a[1]);
    if (b && start !== null) { out.push({ s: +(start + (voice.offset || 0)).toFixed(3), e: +(+b[1] + (voice.offset || 0)).toFixed(3) }); start = null; }
  }
  if (start !== null) out.push({ s: +(start + (voice.offset || 0)).toFixed(3), e: +((voice.duration || start) + (voice.offset || 0)).toFixed(3) });
  return out;
}

module.exports = { MODELS, configure, modelStatus, ensureModel, transcribe, silences, parseWhisperJson, voiceTrack };
