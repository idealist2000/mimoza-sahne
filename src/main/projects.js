'use strict';
// Proje klasörleri: Belgeler/Mimoza Sahne/Projeler/<tarih-saat>/project.json
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

function root() {
  const dir = path.join(app.getPath('documents'), 'Mimoza Sahne', 'Projeler');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function create(name) {
  const id = stamp();
  const dir = path.join(root(), id);
  fs.mkdirSync(dir, { recursive: true });
  return { id, dir, name: name || 'Kayıt ' + id.replace('_', ' ').replace(/-(\d\d)-(\d\d)$/, ':$1') };
}

function dirOf(id) {
  if (!/^[\w.-]+$/.test(id)) throw new Error('Geçersiz proje.');
  return path.join(root(), id);
}

function load(id) {
  const dir = dirOf(id);
  const project = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
  const cursorFile = path.join(dir, 'cursor.json');
  project.cursorData = fs.existsSync(cursorFile) ? JSON.parse(fs.readFileSync(cursorFile, 'utf8')) : null;
  for (const key of ['mic', 'system']) {
    const peaksFile = path.join(dir, key + '.peaks.json');
    if (project.media[key] && fs.existsSync(peaksFile)) project.media[key].peaks = JSON.parse(fs.readFileSync(peaksFile, 'utf8'));
  }
  project.dir = dir;
  return project;
}

function save(project) {
  const dir = dirOf(project.id);
  const copy = { ...project, media: { ...project.media }, savedAt: new Date().toISOString() };
  delete copy.cursorData;
  delete copy.dir;
  for (const key of ['mic', 'system']) if (copy.media[key]) { copy.media[key] = { ...copy.media[key] }; delete copy.media[key].peaks; }
  const tmp = path.join(dir, 'project.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(copy, null, 1));
  fs.renameSync(tmp, path.join(dir, 'project.json'));
  return copy.savedAt;
}

function list() {
  const dir = root();
  const out = [];
  for (const id of fs.readdirSync(dir)) {
    const file = path.join(dir, id, 'project.json');
    if (!fs.existsSync(file)) continue;
    try {
      const p = JSON.parse(fs.readFileSync(file, 'utf8'));
      const thumb = path.join(dir, id, 'thumb.jpg');
      out.push({ id, name: p.name, created: p.created, savedAt: p.savedAt, duration: p.media?.screen?.duration || 0, thumb: fs.existsSync(thumb) ? thumb : null });
    } catch {}
  }
  return out.sort((a, b) => String(b.savedAt || b.created).localeCompare(String(a.savedAt || a.created)));
}

function defaultEdit(project) {
  const hasCam = !!project.media.camera;
  return {
    keep: [{ s: 0, e: project.media.screen.duration }],
    zooms: [],
    blurs: [],
    mutes: (project.privacy || []).map(p => ({ s: p.s, e: p.e })),
    camera: { visible: hasCam, x: 0.97, y: 0.94, size: 0.26, shape: 'circle', mirror: true },
    tracks: { mic: { volume: 1, mute: false }, system: { volume: 0.7, mute: false } },
    output: { aspect: '16:9', quality: 1080, bg: '#101418' },
    cursor: { highlight: true, clicks: true, size: 1 },
  };
}

module.exports = { root, create, dirOf, load, save, list, defaultEdit };
