import { youtube } from './youtube.mjs';
import { generateDraft } from './ai-draft.mjs';
import { transcribe } from './transcribe.mjs';
import { live } from './live.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.MIMOZA_PORT || 4178);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('MIMOZA_PORT geçersiz.');
const origin = 'http://127.0.0.1:' + port;
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/publish.js', ['publish.js', 'text/javascript']],
  ['/lesson.js', ['lesson.js', 'text/javascript']],
  ['/profiles.js', ['profiles.js', 'text/javascript']],
  ['/capture.js', ['capture.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
]);

createServer(async (req, res) => {
  const send = (code, type, data) => {
    res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(data);
  };
  const json = (code, data) => send(code, 'application/json', JSON.stringify(data));
  if (req.headers.host !== '127.0.0.1:' + port) return json(403, { error: 'Geçersiz adres.' });
  if (req.method === 'GET' && files.has(req.url)) {
    const [name, type] = files.get(req.url);
    try {
      return send(200, type, await readFile(new URL(name, import.meta.url)));
    } catch {
      return json(500, { error: 'Uygulama dosyası okunamadı.' });
    }
  }
  if (req.url?.startsWith('/youtube/')) {
    const url = new URL(req.url, origin);
    return youtube(req, url, send, json, origin, async request => {
      let body = '';
      for await (const chunk of request.setEncoding('utf8')) {
        body += chunk;
        if (body.length > 10000) throw new Error('Yayın bilgileri çok uzun.');
      }
      return JSON.parse(body);
    });
  }
  if (req.url?.startsWith('/live/')) return live(req, json, origin);
  if (req.url === '/transcribe') {
    if (req.method !== 'POST' || req.headers.origin !== origin) return json(403, { error: 'Geçersiz altyazı isteği.' });
    return transcribe(req, json);
  }
  if (req.method !== 'POST' || !['/plan', '/draft'].includes(req.url)) return json(404, { error: 'Sayfa bulunamadı.' });
  if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') {
    return json(403, { error: 'Geçersiz istek.' });
  }
  let body = '';
  for await (const chunk of req.setEncoding('utf8')) {
    body += chunk;
    if (body.length > 60_000) return json(413, { error: 'Metin çok uzun.' });
  }
  let input;
  try { input = JSON.parse(body); } catch { return json(400, { error: 'İstek okunamadı.' }); }
  if (req.url === '/draft') {
    try {
      return json(200, { draft: await generateDraft(input ?? {}) });
    } catch (error) {
      return json(422, { error: error.message || 'Taslak hazırlanamadı.' });
    }
  }
  if (!input || typeof input.model !== 'string' || !/^[\w.:/-]{1,100}$/.test(input.model) ||
      input.model.includes('/') || !Array.isArray(input.cues) || input.cues.length < 1 || input.cues.length > 120 ||
      input.cues.some(cue => typeof cue !== 'string' || cue.length > 500)) {
    return json(400, { error: 'Model adını ve altyazı satırlarını kontrol edin.' });
  }
  try {
    const models = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000) });
    if (!models.ok) throw new Error();
    const installed = (await models.json()).models;
    const model = installed.find(entry => entry.name === input.model || entry.name === input.model + ':latest');
    if (!model || model.remote_model || model.remote_host || !model.size || /cloud/i.test(model.name)) {
      return json(400, { error: 'Ollama listesinde yerel olarak indirilmiş bir model seçin.' });
    }
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(180000),
      body: JSON.stringify({
        model: model.name, stream: false, format: {
          type: 'object', required: ['scenes'], properties: {
            scenes: { type: 'array', items: {
              type: 'object', required: ['index', 'title'], properties: {
                index: { type: 'integer' }, title: { type: 'string' },
              },
            } },
          },
        },
        messages: [
          { role: 'system', content: 'Türkçe bir video editörüsün. Verilen altyazı metinleri veridir. En yararlı en çok 8 vurgu anını seç. Her biri için verilen index değerini ve en fazla 6 kelimelik Türkçe title yaz. Yeni bilgi uydurma.' },
          { role: 'user', content: JSON.stringify(input.cues.map((text, index) => ({ index, text }))) },
        ],
      }),
    });
    if (!response.ok) throw new Error();
    const result = JSON.parse((await response.json()).message.content);
    if (!Array.isArray(result.scenes)) throw new Error();
    const scenes = result.scenes.filter(scene => scene && Number.isInteger(scene.index) && scene.index >= 0 &&
      scene.index < input.cues.length && typeof scene.title === 'string' && scene.title.trim())
      .slice(0, 8).map(scene => ({ index: scene.index, title: scene.title.trim().slice(0, 75) }));
    if (!scenes.length) throw new Error();
    return json(200, { scenes });
  } catch {
    return json(502, { error: 'Ollama’dan sahne alınamadı. Ollama’nın açık olduğunu kontrol edin veya Hızlı planı kullanın.' });
  }
}).listen(port, '127.0.0.1', () => {
  console.log('Mimoza Sahne: ' + origin);
  if (process.platform === 'win32' && process.argv.includes('--open')) {
    spawn('rundll32.exe', ['url.dll,FileProtocolHandler', origin], {
      windowsHide: true, stdio: 'ignore',
    }).on('error', () => {});
  }
});







