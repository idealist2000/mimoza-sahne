'use strict';
// FFmpeg işlemleri: düzeltme (remux), ses dalgası, kodlayıcı algılama ve dışa aktarma.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../shared/timeline.js');

let ffmpegPath = process.env.MIMOZA_FFMPEG || 'ffmpeg';
function setFfmpegPath(p) { if (p) ffmpegPath = p; }
function getFfmpegPath() { return ffmpegPath; }

function run(args, { onStderr, onStdout, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', ...args], { windowsHide: true });
    let err = '';
    const out = [];
    child.stderr.on('data', d => { err += d; if (err.length > 200000) err = err.slice(-100000); onStderr?.(String(d)); });
    child.stdout.on('data', d => { if (onStdout) onStdout(d); else out.push(d); });
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', e => reject(new Error('FFmpeg çalıştırılamadı: ' + e.message)));
    child.on('close', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new Error('İptal edildi.'));
      if (code === 0) resolve({ stderr: err, stdout: Buffer.concat(out) });
      else {
        const e = new Error('FFmpeg hatası (' + code + '): ' + err.split('\n').filter(Boolean).slice(-4).join(' | '));
        e.stderr = err;
        reject(e);
      }
    });
  });
}

// Dosya bilgisi: süre, boyut, ses var mı, video kodeği.
async function probe(file) {
  let stderr = '';
  try { await run(['-i', file]); } catch (e) { stderr = e.stderr || ''; }
  const dur = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const vid = stderr.match(/Stream #\S+.*Video:\s*(\w+)[^\n]*?,\s*(\d{2,5})x(\d{2,5})/);
  return {
    duration: dur ? (+dur[1]) * 3600 + (+dur[2]) * 60 + parseFloat(dur[3]) : NaN,
    hasVideo: !!vid,
    codec: vid ? vid[1] : null,
    width: vid ? +vid[2] : 0,
    height: vid ? +vid[3] : 0,
    hasAudio: /Stream #\S+.*Audio:/.test(stderr),
  };
}

// MediaRecorder dosyalarında süre bilgisi olmaz. Yeniden paketleyip aranabilir yaparız.
// H.264 kayıtlar MP4'e, VP8/Opus kayıtlar WebM'e paketlenir.
async function finalizeRecording(rawFile, kind) {
  const info0 = await probe(rawFile);
  const isH264 = info0.codec === 'h264';
  const ext = kind === 'audio' ? '.webm' : isH264 ? '.mp4' : '.webm';
  const out = rawFile.replace(/\.raw\.\w+$/, '') + ext;
  const args = ['-y', '-fflags', '+genpts', '-i', rawFile, '-c', 'copy'];
  if (ext === '.mp4') args.push('-movflags', '+faststart');
  try {
    await run([...args, out]);
  } catch {
    // Paketleme başarısız olursa yeniden kodla (yavaş ama güvenli).
    const enc = kind === 'audio' ? ['-c:a', 'libopus', '-b:a', '128k'] : ['-c:v', 'libvpx', '-b:v', '4M', '-deadline', 'realtime', '-cpu-used', '8', '-an'];
    await run(['-y', '-i', rawFile, ...enc, out.replace(/\.mp4$/, '.webm')]);
  }
  const finalFile = fs.existsSync(out) ? out : out.replace(/\.mp4$/, '.webm');
  const info = await probe(finalFile);
  try { fs.unlinkSync(rawFile); } catch {}
  return { file: path.basename(finalFile), ...info };
}

// Ses dalgası: saniyede 25 değer (0..255).
async function audioPeaks(file, rate = 25) {
  const { stdout } = await run(['-i', file, '-vn', '-ac', '1', '-ar', String(rate * 40), '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1']);
  const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
  const peaks = [];
  for (let i = 0; i < samples.length; i += 40) {
    let max = 0;
    for (let j = i; j < Math.min(samples.length, i + 40); j++) max = Math.max(max, Math.abs(samples[j]));
    peaks.push(Math.min(255, Math.round(Math.sqrt(max / 32768) * 255)));
  }
  return peaks;
}

// Video karesinden küçük resim (kapak/önizleme için)
async function thumbnail(file, at, out) {
  await run(['-y', '-ss', String(Math.max(0, at)), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', out]);
  return out;
}

// ---------- Donanım kodlayıcı algılama ----------
let encoderCache;
async function detectEncoder() {
  if (encoderCache) return encoderCache;
  const candidates = [
    { name: 'h264_qsv', label: 'Intel Quick Sync (donanım)', args: q => ['-c:v', 'h264_qsv', '-preset', 'faster', '-global_quality', String(q), '-look_ahead', '0'], pix: 'nv12' },
    { name: 'h264_nvenc', label: 'NVIDIA NVENC (donanım)', args: q => ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', String(q)], pix: 'yuv420p' },
    { name: 'h264_amf', label: 'AMD AMF (donanım)', args: q => ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', String(q - 2), '-qp_p', String(q)], pix: 'yuv420p' },
  ];
  for (const c of candidates) {
    try {
      await run(['-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=0.3', '-pix_fmt', c.pix, ...c.args(24), '-f', 'null', '-']);
      encoderCache = c;
      return c;
    } catch {}
  }
  encoderCache = { name: 'libx264', label: 'İşlemci (libx264)', args: q => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(q - 2)], pix: 'yuv420p' };
  return encoderCache;
}

// ---------- Dışa aktarma ----------
// project: proje verisi, dir: proje klasörü, assets: { ring, click, mask } PNG yolları
function buildExport(project, dir, assets, outFile, encoder, quality) {
  const ed = project.edit;
  const media = project.media;
  const screen = media.screen;
  const srcDur = screen.duration;
  const keep = T.normalizeKeep(ed.keep, srcDur);
  const outDur = T.outputDuration(keep);
  const { w: OW, h: OH } = T.outputSize(ed.output.aspect, ed.output.quality);
  const fps = 30;
  const args = ['-y'];
  const filters = [];
  let idx = 0;
  const inputs = {};
  const addInput = (file, offset, extra = []) => {
    if (offset > 0.0005) args.push('-itsoffset', offset.toFixed(4));
    else if (offset < -0.0005) args.push('-ss', (-offset).toFixed(4));
    args.push(...extra, '-i', path.isAbsolute(file) ? file : path.join(dir, file));
    return idx++;
  };
  inputs.screen = addInput(screen.file, 0);
  const cam = media.camera && ed.camera.visible ? media.camera : null;
  if (cam) inputs.camera = addInput(cam.file, cam.offset || 0);
  const audioIns = [];
  for (const key of ['mic', 'system']) {
    const m = media[key];
    const tr = ed.tracks[key] || {};
    if (!m || tr.mute) continue;
    const i = m.file === screen.file ? inputs.screen : addInput(m.file, m.offset || 0);
    audioIns.push({ key, i, volume: tr.volume ?? 1 });
  }
  const cursor = project.cursorData;
  const useCursor = cursor && project.capture.kind !== 'window' && project.capture.kind !== 'import';
  if (useCursor && ed.cursor.highlight) inputs.ring = addInput(assets.ring, 0, ['-loop', '1', '-framerate', String(fps)]);
  if (useCursor && ed.cursor.clicks && cursor.clicks.length) inputs.click = addInput(assets.click, 0, ['-loop', '1', '-framerate', String(fps)]);
  if (cam && assets.mask) inputs.mask = addInput(assets.mask, 0, ['-loop', '1', '-framerate', String(fps)]);

  // Ekran katmanı
  const region = project.capture.region;
  let SW = screen.width, SH = screen.height;
  let v = `[${inputs.screen}:v]fps=${fps},setpts=PTS-STARTPTS`;
  if (region) {
    const rx = Math.round(region.x * SW / 2) * 2, ry = Math.round(region.y * SH / 2) * 2;
    const rw = Math.max(16, Math.round(region.w * SW / 2) * 2), rh = Math.max(16, Math.round(region.h * SH / 2) * 2);
    v += `,crop=${rw}:${rh}:${rx}:${ry}`;
    SW = rw; SH = rh;
  }
  v += ',format=yuv420p[scr0]';
  filters.push(v);
  let cur = 'scr0';
  let n = 0;
  const next = () => 'v' + (++n);

  // İmleç halkası (sendcmd ile konum güncellenir)
  let cmdFile = null;
  if (inputs.ring !== undefined || inputs.click !== undefined) {
    const ringSize = Math.round(Math.min(SW, SH) * 0.055 * (ed.cursor.size || 1) / 2) * 2;
    const clickSize = Math.round(ringSize * 1.6 / 2) * 2;
    const lines = [];
    const toPx = (x, y, size) => [Math.round(x * SW - size / 2), Math.round(y * SH - size / 2)];
    if (inputs.ring !== undefined) {
      let last = '';
      for (const [t, x, y] of cursor.moves) {
        const [px, py] = toPx(x, y, ringSize);
        const key = px + ',' + py;
        if (key === last) continue;
        last = key;
        lines.push(`${t.toFixed(3)} overlay@ring x ${px}, overlay@ring y ${py};`);
      }
    }
    if (inputs.click !== undefined) {
      for (const [t, x, y] of cursor.clicks) {
        const [px, py] = toPx(x, y, clickSize);
        lines.push(`${Math.max(0, t - 0.01).toFixed(3)} overlay@click x ${px}, overlay@click y ${py};`);
      }
    }
    lines.sort((a, b) => parseFloat(a) - parseFloat(b));
    cmdFile = path.join(dir, 'export-cursor.cmd');
    fs.writeFileSync(cmdFile, lines.join('\n') + '\n');
    const sc = cmdFile.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    const o = next();
    filters.push(`[${cur}]sendcmd=f='${sc}'[${o}]`);
    cur = o;
    if (inputs.ring !== undefined) {
      const r = next(), o2 = next();
      filters.push(`[${inputs.ring}:v]scale=${ringSize}:${ringSize},format=rgba[${r}]`);
      filters.push(`[${cur}][${r}]overlay@ring=x=-1000:y=-1000:eof_action=repeat:shortest=0[${o2}]`);
      cur = o2;
    }
    if (inputs.click !== undefined) {
      const r = next(), o2 = next();
      const enable = cursor.clicks.map(([t]) => `between(t,${T.ffNum(t)},${T.ffNum(t + 0.35)})`).join('+');
      filters.push(`[${inputs.click}:v]scale=${clickSize}:${clickSize},format=rgba[${r}]`);
      filters.push(`[${cur}][${r}]overlay@click=x=-1000:y=-1000:eof_action=repeat:shortest=0:enable='${enable}'[${o2}]`);
      cur = o2;
    }
  }

  // Bulanıklaştırma alanları
  for (const b of ed.blurs || []) {
    const bx = Math.round(T.clamp(b.x, 0, 1) * SW / 2) * 2, by = Math.round(T.clamp(b.y, 0, 1) * SH / 2) * 2;
    const bw = Math.max(8, Math.min(SW - bx, Math.round(b.w * SW / 2) * 2));
    const bh = Math.max(8, Math.min(SH - by, Math.round(b.h * SH / 2) * 2));
    const radius = Math.max(2, Math.min(Math.floor(Math.min(bw, bh) / 2) - 1, Math.round((b.strength || 20) * Math.min(SW, SH) / 1080)));
    const a = next(), c = next(), d = next(), o = next();
    filters.push(`[${cur}]split[${a}][${c}]`);
    filters.push(`[${c}]crop=${bw}:${bh}:${bx}:${by},boxblur=${radius}:3[${d}]`);
    filters.push(`[${a}][${d}]overlay=${bx}:${by}:enable='between(t,${T.ffNum(b.s)},${T.ffNum(b.e)})'[${o}]`);
    cur = o;
  }

  // Yakınlaştırma: kareyi büyüt, ilgili alanı kes.
  const zx = T.ffZoomExpressions(ed.zooms);
  if (zx) {
    const o = next();
    filters.push(`[${cur}]scale=w='trunc(iw*(${zx.scale})/2)*2':h='trunc(ih*(${zx.scale})/2)*2':eval=frame:flags=bicubic,` +
      `crop=w=${SW}:h=${SH}:x='clip((${zx.cx})*iw-${SW}/2,0,iw-${SW})':y='clip((${zx.cy})*ih-${SH}/2,0,ih-${SH})'[${o}]`);
    cur = o;
  }

  // Çıktı karesine yerleştir
  const pad = ed.output.aspect === '16:9' ? 0 : Math.round(Math.min(OW, OH) * 0.03);
  const fit = T.fitRect(SW, SH, OW, OH, pad);
  {
    const o = next();
    const bg = (ed.output.bg || '#101418').replace('#', '0x');
    filters.push(`[${cur}]scale=${fit.w}:${fit.h}:flags=lanczos,pad=${OW}:${OH}:${fit.x}:${fit.y}:color=${bg}[${o}]`);
    cur = o;
  }

  // Kamera
  if (cam) {
    const camAspect = cam.width && cam.height ? cam.width / cam.height : 16 / 9;
    const r = T.cameraRect(ed.camera, OW, OH, camAspect);
    const c1 = next(), o = next();
    let cf = `[${inputs.camera}:v]fps=${fps},`;
    cf += ed.camera.shape === 'rect' ? `scale=${r.w}:${r.h}:force_original_aspect_ratio=increase,crop=${r.w}:${r.h}` :
      `crop='min(iw,ih)':'min(iw,ih)',scale=${r.w}:${r.h}`;
    if (ed.camera.mirror) cf += ',hflip';
    cf += ',format=rgba';
    if (inputs.mask !== undefined) {
      const m = next(), mm = next();
      filters.push(`[${inputs.mask}:v]scale=${r.w}:${r.h},format=gray[${m}]`);
      filters.push(cf + `[${mm}]`);
      filters.push(`[${mm}][${m}]alphamerge[${c1}]`);
    } else filters.push(cf + `[${c1}]`);
    filters.push(`[${cur}][${c1}]overlay=${r.x}:${r.y}:eof_action=pass:shortest=0[${o}]`);
    cur = o;
  }

  // Kesimler
  const sel = keep.map(k => `between(t,${T.ffNum(k.s)},${T.ffNum(k.e)})`).join('+');
  filters.push(`[${cur}]select='${sel}',setpts=N/FRAME_RATE/TB,format=${encoder.pix}[vout]`);

  // Ses
  const mutes = ed.mutes || [];
  if (audioIns.length) {
    const labels = [];
    for (const a of audioIns) {
      const l = 'a_' + a.key;
      let f = `[${a.i}:a]aresample=48000:async=1:first_pts=0,aformat=channel_layouts=stereo,volume=${T.ffNum(a.volume)}`;
      for (const m of mutes) f += `,volume=0:enable='between(t,${T.ffNum(m.s)},${T.ffNum(m.e)})'`;
      filters.push(f + `[${l}]`);
      labels.push(`[${l}]`);
    }
    const mix = labels.length > 1 ? `${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,` : `${labels[0]}`;
    filters.push(`${mix}${labels.length > 1 ? '' : 'anull,'}apad,atrim=0:${T.ffNum(srcDur)},aselect='${sel}',asetpts=N/SR/TB[aout]`);
  }

  args.push('-filter_complex_script', path.join(dir, 'export-graph.txt'));
  fs.writeFileSync(path.join(dir, 'export-graph.txt'), filters.join(';\n'));
  args.push('-map', '[vout]');
  if (audioIns.length) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '160k');
  const q = quality === 'high' ? 20 : 24;
  args.push(...encoder.args(q), '-r', String(fps), '-t', outDur.toFixed(3), '-movflags', '+faststart', outFile);
  return { args, outDur, size: { w: OW, h: OH } };
}

async function exportVideo(project, dir, assets, outFile, { onProgress, signal, quality } = {}) {
  let encoder = await detectEncoder();
  const attempt = async enc => {
    const { args, outDur } = buildExport(project, dir, assets, outFile, enc, quality);
    await run(['-progress', 'pipe:1', '-nostats', ...args], {
      signal,
      onStdout: d => {
        const m = String(d).match(/out_time_us=(\d+)/g);
        if (m) {
          const us = +m[m.length - 1].split('=')[1];
          onProgress?.(Math.min(0.999, us / 1e6 / outDur), enc.label);
        }
      },
    });
  };
  try {
    await attempt(encoder);
  } catch (e) {
    if (signal?.aborted || encoder.name === 'libx264') throw e;
    // Donanım kodlayıcı başarısız olursa işlemciyle tekrar dene.
    encoderCache = { name: 'libx264', label: 'İşlemci (libx264)', args: q => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(q - 2)], pix: 'yuv420p' };
    encoder = encoderCache;
    await attempt(encoder);
  }
  onProgress?.(1, encoder.label);
  for (const f of ['export-graph.txt', 'export-cursor.cmd']) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
  return { encoder: encoder.label };
}

module.exports = { setFfmpegPath, getFfmpegPath, run, probe, finalizeRecording, audioPeaks, thumbnail, detectEncoder, buildExport, exportVideo };
