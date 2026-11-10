'use strict';
// Kayıt sırasında imleç konumunu, tıklamaları ve kaydırmaları kaydeder.
// Koordinatlar kaydedilen ekrana göre 0..1 aralığına çevrilir.
const { screen } = require('electron');

let hook = null;
try {
  hook = require('uiohook-napi').uIOhook;
} catch (e) {
  console.warn('Fare kancası yüklenemedi, tıklama tabanlı yakınlaştırma kapalı:', e.message);
}

let session = null;
let hookStarted = false;
const listeners = { wheel: [] };

function clockNow() {
  if (!session) return 0;
  const paused = session.pausedTotal + (session.pausedAt ? Date.now() - session.pausedAt : 0);
  return (Date.now() - session.start - paused) / 1000;
}

function normalize(p) {
  const b = session.bounds;
  return [(p.x - b.x) / b.width, (p.y - b.y) / b.height];
}

function onMouseDown(e) {
  if (!session || session.pausedAt) return;
  const [x, y] = normalize(screen.getCursorScreenPoint());
  if (x >= 0 && x <= 1 && y >= 0 && y <= 1) session.clicks.push([+clockNow().toFixed(3), +x.toFixed(4), +y.toFixed(4), e.button]);
}
function onWheel() {
  if (session && !session.pausedAt) session.scrolls.push(+clockNow().toFixed(3));
  for (const fn of listeners.wheel) fn();
}

function ensureHook() {
  if (!hook || hookStarted) return;
  try {
    hook.on('mousedown', onMouseDown);
    hook.on('wheel', onWheel);
    hook.start();
    hookStarted = true;
  } catch (e) {
    console.warn('Fare kancası başlatılamadı:', e.message);
    hook = null;
  }
}

function start(displayBounds) {
  ensureHook();
  session = { start: Date.now(), pausedTotal: 0, pausedAt: 0, bounds: displayBounds, moves: [], clicks: [], scrolls: [] };
  let last = '';
  session.timer = setInterval(() => {
    if (!session || session.pausedAt) return;
    const [x, y] = normalize(screen.getCursorScreenPoint());
    const key = x.toFixed(4) + ',' + y.toFixed(4);
    if (key === last) return;
    last = key;
    session.moves.push([+clockNow().toFixed(3), +x.toFixed(4), +y.toFixed(4)]);
  }, 33);
}

// Kaydın gerçek başlangıç anına hizalar (kayıt cihazları hazır olduğunda çağrılır).
function rebase() { if (session) { session.start = Date.now(); session.moves = []; session.clicks = []; session.scrolls = []; } }
function pause() { if (session && !session.pausedAt) session.pausedAt = Date.now(); }
function resume() { if (session?.pausedAt) { session.pausedTotal += Date.now() - session.pausedAt; session.pausedAt = 0; } }
function time() { return clockNow(); }

function stop() {
  if (!session) return null;
  clearInterval(session.timer);
  const data = { moves: session.moves, clicks: session.clicks, scrolls: session.scrolls, hook: !!hook };
  session = null;
  return data;
}

function onWheelEvent(fn) { listeners.wheel.push(fn); ensureHook(); }
function shutdown() { try { if (hookStarted) hook.stop(); } catch {} }

module.exports = { start, rebase, pause, resume, stop, time, onWheelEvent, shutdown, available: () => !!hook };
