import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

let working = false;
const maxBytes = 300 * 1024 * 1024;

function run(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: 'ignore', signal: AbortSignal.timeout(600000) });
    child.once('error', () => reject(new Error('Yerel araç çalışmadı. FFmpeg, whisper-cli ve model ayarlarını kontrol edin.')));
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Yerel altyazı üretilemedi. Video biçimini ve Whisper modelini kontrol edin.')));
  });
}

export async function transcribe(req, json) {
  if (!process.env.MIMOZA_WHISPER_MODEL) return json(503, { error: 'Yerel altyazı için MIMOZA_WHISPER_MODEL ayarlanmamış. README’deki kuruluma bakın.' });
  if (working) return json(409, { error: 'Başka bir altyazı işlemi sürüyor.' });
  const size = Number(req.headers['content-length']);
  if (!Number.isSafeInteger(size) || size < 1 || size > maxBytes) return json(413, { error: 'Video en fazla 300 MB olabilir.' });
  const language = req.headers['x-mimoza-language'];
  if (!['tr', 'en', 'auto'].includes(language)) return json(400, { error: 'Altyazı dilini seçin.' });
  working = true;
  let dir;
  try {
    dir = await mkdtemp(join(tmpdir(), 'mimoza-caption-'));
    const input = join(dir, 'video');
    const wav = join(dir, 'voice.wav');
    const result = join(dir, 'captions');
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > maxBytes ? new Error('Video çok büyük.') : null, chunk);
      },
    });
    await pipeline(req, limiter, createWriteStream(input));
    await run(process.env.MIMOZA_FFMPEG || 'ffmpeg', ['-nostdin', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    await run(process.env.MIMOZA_WHISPER || 'whisper-cli', ['-m', process.env.MIMOZA_WHISPER_MODEL, '-f', wav, '-l', language, '-osrt', '-of', result]);
    const srt = await readFile(result + '.srt', 'utf8');
    if (!srt.trim()) throw new Error('Konuşma algılanmadı.');
    return json(200, { srt });
  } catch (error) {
    if (!req.destroyed || req.complete) return json(422, { error: error.message });
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    working = false;
  }
}
