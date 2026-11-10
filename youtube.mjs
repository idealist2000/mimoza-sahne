import { createHash, randomBytes } from 'node:crypto';

const api = 'https://www.googleapis.com/youtube/v3/';
const scopes = 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload';
let pending;
let connection;
let upload;

const random = () => randomBytes(32).toString('base64url');
const client = () => ({
  client_id: process.env.MIMOZA_GOOGLE_CLIENT_ID ?? '',
  client_secret: process.env.MIMOZA_GOOGLE_CLIENT_SECRET ?? '',
});

async function google(url, options = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(18000), redirect: 'error', ...options,
  });
  if (!response.ok) throw new Error('Google isteği başarısız (HTTP ' + response.status + ').');
  return response;
}

async function tokenRequest(params) {
  return (await google('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({ ...client(), ...params }),
  })).json();
}

async function access() {
  if (!connection) throw new Error('Önce YouTube kanalınızı bağlayın.');
  if (Date.now() >= connection.expiry - 60000) {
    if (!connection.refresh) throw new Error('Oturum süresi doldu. Kanalı yeniden bağlayın.');
    const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: connection.refresh });
    connection.token = data.access_token;
    connection.expiry = Date.now() + data.expires_in * 1000;
  }
  return { Authorization: 'Bearer ' + connection.token };
}

export async function youtube(req, url, send, json, origin, readJson) {
  try {
    if (req.method === 'GET' && url.pathname === '/youtube/callback') {
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      if (!pending || pending.state !== state || pending.expiry < Date.now() || !code) {
        return send(400, 'text/plain', 'Google bağlantısı tamamlanmadı. Mimoza Sahne’ye dönüp tekrar deneyin.');
      }
      const { verifier } = pending;
      pending = undefined;
      const data = await tokenRequest({
        grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: origin + '/youtube/callback',
      });
      const channel = (await (await google(api + 'channels?part=snippet&mine=true&maxResults=1', {
        headers: { Authorization: 'Bearer ' + data.access_token },
      })).json()).items?.[0];
      if (!channel) throw new Error('Bu Google hesabında kullanılabilir YouTube kanalı bulunamadı.');
      connection = { token: data.access_token, refresh: data.refresh_token, expiry: Date.now() + data.expires_in * 1000, id: channel.id, title: channel.snippet.title };
      upload = undefined;
      return send(200, 'text/plain', 'YouTube kanalı bağlandı. Bu sekmeyi kapatıp Mimoza Sahne’ye dönün.');
    }
    if (req.method !== 'POST' || req.headers.origin !== origin) return json(403, { error: 'Geçersiz YouTube isteği.' });
    switch (url.pathname) {
      case '/youtube/connect': {
        if (!client().client_id || !client().client_secret) return json(503, { error: 'Google Cloud masaüstü OAuth bilgileri eksik. README’ye bakın.' });
        const state = random(), verifier = random();
        pending = { state, verifier, expiry: Date.now() + 300000 };
        const params = new URLSearchParams({
          client_id: client().client_id, redirect_uri: origin + '/youtube/callback',
          response_type: 'code', scope: scopes, state, access_type: 'offline', prompt: 'consent select_account',
          code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
        });
        return json(200, { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params });
      }
      case '/youtube/channel':
        return json(200, { channel: connection ? { id: connection.id, title: connection.title } : null });
      case '/youtube/disconnect':
        pending = undefined;
        connection = undefined;
        upload = undefined;
        return json(200, { channel: null });
      case '/youtube/prepare': {
        const input = await readJson(req);
        if (!input || typeof input.title !== 'string' || input.title.length > 100 || !input.title.trim() ||
            typeof input.description !== 'string' || input.description.length > 5000 ||
            !Array.isArray(input.tags) || input.tags.some(tag => typeof tag !== 'string' || !tag.trim()) ||
            input.tags.join(',').length > 400 || !['video/mp4', 'video/webm'].includes(input.type) ||
            !Number.isSafeInteger(input.size) || input.size < 1 || input.size > 2_000_000_000) {
          return json(400, { error: 'Başlığı, açıklamayı, etiketleri ve video boyutunu kontrol edin.' });
        }
        if (upload?.busy) return json(409, { error: 'Başka bir video yükleniyor.' });
        const headers = {
          ...await access(), 'Content-Type': 'application/json',
          'X-Upload-Content-Type': input.type, 'X-Upload-Content-Length': String(input.size),
        };
        const response = await google('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
          method: 'POST', headers,
          body: JSON.stringify({
            snippet: { title: input.title.trim(), description: input.description, tags: input.tags, categoryId: '27', defaultLanguage: input.language === 'en' ? 'en' : 'tr' },
            status: { privacyStatus: 'private', selfDeclaredMadeForKids: input.forKids === true },
          }),
        });
        const location = new URL(response.headers.get('location'));
        if (location.origin !== 'https://www.googleapis.com' || !location.pathname.startsWith('/upload/youtube/')) throw new Error('Beklenmeyen yükleme adresi.');
        upload = { id: random(), location: location.href, size: input.size, type: input.type, busy: false, expiry: Date.now() + 900000 };
        return json(200, { id: upload.id });
      }
      case '/youtube/upload': {
        const job = upload;
        if (!job || job.id !== req.headers['x-mimoza-upload'] || job.busy || job.expiry < Date.now() ||
            Number(req.headers['content-length']) !== job.size) return json(409, { error: 'Yükleme oturumu geçersiz. Dosyayı yeniden seçin.' });
        job.busy = true;
        try {
          const response = await google(job.location, {
            method: 'PUT', headers: { ...await access(), 'Content-Type': job.type, 'Content-Length': String(job.size) },
            body: req, duplex: 'half', signal: AbortSignal.timeout(3600000),
          });
          const result = await response.json();
          if (typeof result.id !== 'string' || !/^[a-z0-9_-]{11}$/i.test(result.id)) throw new Error('YouTube video kimliğini döndürmedi.');
          return json(200, { id: result.id });
        } finally { if (upload === job) upload = undefined; }
      }
      default: return json(404, { error: 'YouTube işlemi bulunamadı.' });
    }
  } catch (error) {
    if (url.pathname === '/youtube/callback') return send(502, 'text/plain', error.message);
    return json(502, { error: error.message });
  }
}
