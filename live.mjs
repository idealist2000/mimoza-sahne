import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

let current;
let last;
const endpoint = 'rtmps://a.rtmps.youtube.com:443/live2/';

function state(session, status) {
  return { id: session.id, status };
}

function finish(session, status) {
  clearTimeout(session.timer);
  last = state(session, status);
  if (current === session) current = undefined;
}

function watchdog(session) {
  clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    session.process.kill();
    finish(session, 'error');
  }, 20000);
  session.timer.unref();
}

export async function live(req, json, origin) {
  if (req.headers.origin !== origin || req.method !== 'POST') return json(403, { error: 'Geçersiz yayın isteği.' });
  if (req.url === '/live/start') {
    if (current) return json(409, { error: 'Bir canlı yayın akışı zaten açık.' });
    const key = req.headers['x-mimoza-stream-key'];
    if (typeof key !== 'string' || !/^[a-z0-9-]{8,128}$/i.test(key)) return json(400, { error: 'YouTube yayın anahtarını kontrol edin.' });
    const child = spawn(process.env.MIMOZA_FFMPEG || 'ffmpeg', [
      '-nostdin', '-loglevel', 'error', '-f', 'webm', '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
      '-b:v', '2500k', '-maxrate', '3000k', '-bufsize', '6000k', '-g', '60',
      '-c:a', 'aac', '-b:a', '128k', '-f', 'flv', endpoint + key,
    ], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const session = { id: randomUUID(), process: child, pending: false, stopping: false };
    current = session;
    child.stdin.on('error', () => { child.kill(); finish(session, 'error'); });
    child.once('exit', code => finish(session, session.stopping && code === 0 ? 'ended' : 'error'));
    child.once('error', () => finish(session, 'error'));
    const spawned = await new Promise(resolve => { child.once('spawn', () => resolve(true)); child.once('error', () => resolve(false)); });
    if (!spawned) return json(503, { error: 'FFmpeg bulunamadı. Canlı yayın kurulumu için README’ye bakın.' });
    watchdog(session);
    return json(200, state(session, 'sending'));
  }
  const id = req.headers['x-mimoza-live-id'];
  const session = current;
  if (typeof id !== 'string' || !session || id !== session.id) {
    if (last?.id === id && req.url === '/live/stop') return json(200, last);
    return json(409, { error: 'Yayın bağlantısı kapandı. YouTube Studio’daki yayın durumunu kontrol edin.' });
  }
  if (req.url === '/live/stop') {
    session.stopping = true;
    session.process.stdin.end();
    watchdog(session);
    return json(200, state(session, 'closing'));
  }
  if (req.url !== '/live/chunk' || session.pending || session.stopping) return json(409, { error: 'Yayın parçası gönderilemedi.' });
  const size = Number(req.headers['content-length']);
  if (!Number.isSafeInteger(size) || size < 1 || size > 2 * 1024 * 1024) {
    return json(413, { error: 'Yayın parçası çok büyük.' });
  }
  session.pending = true;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    await new Promise((resolve, reject) => session.process.stdin.write(Buffer.concat(chunks), error => error ? reject(error) : resolve()));
    watchdog(session);
    return json(200, state(session, 'sending'));
  } catch {
    session.process.kill();
    finish(session, 'error');
    return json(502, { error: 'Yayın aktarımı durdu. FFmpeg ve YouTube Studio’yu kontrol edin.' });
  } finally { session.pending = false; }
}
