'use strict';
// Bellek durumu ve en çok bellek kullanan programlar (hafif mod için).
const os = require('node:os');
const { execFile } = require('node:child_process');

const GB = 1024 ** 3;

// Bilinen ağır programlar: görünen ad
const KNOWN = {
  'chatgpt.exe': 'ChatGPT', 'claude.exe': 'Claude', 'chrome.exe': 'Google Chrome', 'msedge.exe': 'Microsoft Edge',
  'firefox.exe': 'Firefox', 'opera.exe': 'Opera', 'code.exe': 'VS Code', 'pycharm64.exe': 'PyCharm', 'teams.exe': 'Teams',
  'ms-teams.exe': 'Teams', 'slack.exe': 'Slack', 'discord.exe': 'Discord', 'whatsapp.exe': 'WhatsApp', 'spotify.exe': 'Spotify',
  'obs64.exe': 'OBS', 'photoshop.exe': 'Photoshop', 'adobe premiere pro.exe': 'Premiere Pro', 'codex.exe': 'Codex', 'zoom.exe': 'Zoom',
  'vmmem': 'Sanal makine (WSL / Claude çalışma alanı)', 'vmmemwsl': 'Sanal makine (WSL)',
};

function memory() {
  const total = os.totalmem(), free = os.freemem();
  return { totalGB: +(total / GB).toFixed(1), freeGB: +(free / GB).toFixed(2), usedPct: Math.round((1 - free / total) * 100), cpus: os.cpus().length };
}

// Windows'ta tasklist ile programların bellek kullanımını toplar (en çok kullanan 6 program).
function heavyApps() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise(resolve => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 6000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err || !out) return resolve([]);
      const sums = new Map();
      for (const line of String(out).split(/\r?\n/)) {
        const cols = line.match(/"([^"]*)"/g);
        if (!cols || cols.length < 5) continue;
        const name = cols[0].slice(1, -1).toLowerCase();
        const kb = +cols[4].slice(1, -1).replace(/[^\d]/g, '');
        if (!kb) continue;
        sums.set(name, (sums.get(name) || 0) + kb);
      }
      const list = [...sums.entries()]
        .filter(([n]) => !n.startsWith('mimoza sahne'))
        .map(([n, kb]) => ({ exe: n, name: KNOWN[n] || n.replace(/\.exe$/, ''), mb: Math.round(kb / 1024), known: !!KNOWN[n] }))
        .filter(a => a.mb >= 250)
        .sort((a, b) => b.mb - a.mb)
        .slice(0, 6);
      resolve(list);
    });
  });
}

// Önerilen ayarlar: boş bellek az ise hafif mod
function recommendation(m) {
  if (m.freeGB < 1.2) return { level: 'critical', light: true };
  if (m.freeGB < 2.5) return { level: 'low', light: true };
  // 8 GB ve altı bilgisayarlarda hafif mod varsayılan olarak açık gelir.
  if (m.totalGB <= 8.5) return { level: 'ok', light: true };
  return { level: 'ok', light: false };
}

module.exports = { memory, heavyApps, recommendation };
