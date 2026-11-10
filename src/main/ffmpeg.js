'use strict';
// FFmpeg işlemleri: düzeltme (remux), ses dalgası, kodlayıcı algılama ve dışa aktarma.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../shared/timeline.js');
const Templates = require('../shared/templates.js');

let ffmpegPath = process.env.MIMOZA_FFMPEG || 'ffmpeg';
function setFfmpegPath(p) { if (p) ffmpegPath = p; }
function getFfmpegPath() { return ffmpegPath; }

function run(args, { onStderr, onStdout, signal, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', ...args], { windowsHide: true, cwd });
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
// project: proje verisi, dir: proje klasörü
// assets: { ring, click, mask, overlays: [{ file, el, box }], intro: { pattern, dur }, outro: { pattern, dur }, captions: 'dosya.ass' }
// Filtre grafiğindeki dosyalar proje klasörüne göre görelidir (FFmpeg proje klasöründe çalışır).
// opts: { quality, range: {s,e}, audioOnly }
function buildExport(project, dir, assets, outFile, encoder, opts = {}) {
  const ed = project.edit;
  const media = project.media;
  const screen = media.screen;
  const srcDur = screen.duration;
  const keep = T.clipKeep(T.normalizeKeep(ed.keep, srcDur), opts.range);
  if (!keep.length) throw new Error('Dışa aktarılacak bölüm boş.');
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
  const audio = ed.audio || {};
  const sel = keep.map(k => `between(t,${T.ffNum(k.s)},${T.ffNum(k.e)})`).join('+');
  let n = 0;
  const next = () => 'v' + (++n);

  if (!opts.audioOnly) inputs.screen = addInput(screen.file, 0);

  // ---------- Ses ----------
  const audioIns = [];
  for (const key of ['mic', 'system']) {
    const m = media[key];
    const tr = ed.tracks[key] || {};
    if (!m || tr.mute) continue;
    const i = !opts.audioOnly && m.file === screen.file ? inputs.screen : addInput(m.file, m.offset || 0);
    audioIns.push({ key, i, volume: tr.volume ?? 1 });
  }
  let audioLabel = null;
  if (audioIns.length) {
    const mutes = ed.mutes || [];
    const chain = {};
    for (const a of audioIns) {
      let f = `[${a.i}:a]aresample=48000:async=1:first_pts=0,aformat=channel_layouts=stereo`;
      if (a.key === 'mic' && audio.denoise) f += ',highpass=f=80,afftdn=nr=14:nf=-32:tn=1';
      f += `,volume=${T.ffNum(a.volume)}`;
      for (const m of mutes) f += `,volume=0:enable='between(t,${T.ffNum(m.s)},${T.ffNum(m.e)})'`;
      chain[a.key] = 'a_' + a.key;
      filters.push(f + `[${chain[a.key]}]`);
    }
    // Konuşurken bilgisayar sesini kıs (mikrofon yan zincir olarak kullanılır)
    if (audio.duck && chain.mic && chain.system) {
      filters.push(`[${chain.mic}]asplit=2[a_micm][a_micsc]`);
      filters.push(`[${chain.system}][a_micsc]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=400:makeup=1[a_sysd]`);
      chain.mic = 'a_micm';
      chain.system = 'a_sysd';
    }
    const labels = Object.values(chain).map(l => `[${l}]`);
    const mix = labels.length > 1 ? `${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,` : `${labels[0]}anull,`;
    let af = `${mix}apad,atrim=0:${T.ffNum(srcDur)},aselect='${sel}',asetpts=N/SR/TB`;
    if (audio.normalize) af += ',loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000';
    filters.push(af + '[amain]');
    audioLabel = 'amain';
  }

  if (opts.audioOnly) {
    if (!audioLabel) throw new Error('Bu projede ses yok.');
    args.push('-filter_complex_script', 'export-graph.txt');
    fs.writeFileSync(path.join(dir, 'export-graph.txt'), filters.join(';\n'));
    args.push('-map', '[amain]', '-t', outDur.toFixed(3), '-c:a', 'pcm_s16le', outFile);
    return { args, outDur, size: null };
  }

  // ---------- Görüntü ----------
  const cam = media.camera && ed.camera.visible ? media.camera : null;
  if (cam) inputs.camera = addInput(cam.file, cam.offset || 0);
  const cursor = project.cursorData;
  const useCursor = cursor && project.capture.kind !== 'window' && project.capture.kind !== 'import';
  if (useCursor && ed.cursor.highlight) inputs.ring = addInput(assets.ring, 0, ['-loop', '1', '-framerate', String(fps), '-t', T.ffNum(srcDur + 0.5)]);
  if (useCursor && ed.cursor.clicks && cursor.clicks.length) inputs.click = addInput(assets.click, 0, ['-loop', '1', '-framerate', String(fps), '-t', T.ffNum(srcDur + 0.5)]);

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

  // İmleç halkası (sendcmd ile konum güncellenir)
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
    fs.writeFileSync(path.join(dir, 'export-cursor.cmd'), (lines.join('\n') || '0.0 overlay@ring x -1000;') + '\n');
    const o = next();
    filters.push(`[${cur}]sendcmd=f=export-cursor.cmd[${o}]`);
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
  const L = T.layoutRects(ed, OW, OH, SW, SH, !!cam);
  {
    const o = next();
    const bg = (ed.output.bg || '#101418').replace('#', '0x');
    const f = L.screen;
    filters.push(`[${cur}]scale=${f.w}:${f.h}:flags=lanczos,pad=${OW}:${OH}:${f.x}:${f.y}:color=${bg},setsar=1[${o}]`);
    cur = o;
  }

  // Kamera
  if (cam) {
    const camAspect = cam.width && cam.height ? cam.width / cam.height : 16 / 9;
    const r = L.split ? L.cam : T.cameraRect(ed.camera, OW, OH, camAspect);
    const shape = L.split ? 'rect' : ed.camera.shape;
    const c1 = next(), o = next();
    let cf = `[${inputs.camera}:v]fps=${fps},`;
    cf += shape === 'rect' ? `scale=${r.w}:${r.h}:force_original_aspect_ratio=increase,crop=${r.w}:${r.h}` :
      `crop='min(iw,ih)':'min(iw,ih)',scale=${r.w}:${r.h}`;
    if (ed.camera.mirror) cf += ',hflip';
    cf += ',format=rgba';
    if (!L.split && assets.mask) {
      inputs.mask = addInput(assets.mask, 0, ['-loop', '1', '-framerate', String(fps), '-t', T.ffNum(srcDur + 0.5)]);
      const m = next(), mm = next();
      filters.push(`[${inputs.mask}:v]scale=${r.w}:${r.h},format=gray[${m}]`);
      filters.push(cf + `[${mm}]`);
      filters.push(`[${mm}][${m}]alphamerge[${c1}]`);
    } else filters.push(cf + `[${c1}]`);
    filters.push(`[${cur}][${c1}]overlay=${r.x}:${r.y}:eof_action=pass:shortest=0[${o}]`);
    cur = o;
  }

  // Şablon katmanları (alt bant, başlık, bölüm, köşe)
  for (const ov of assets.overlays || []) {
    const i = addInput(ov.file, 0, ['-loop', '1', '-framerate', String(fps), '-t', T.ffNum(srcDur + 0.5)]);
    const an = Templates.ffAnim(ov.el, ov.box.x, ov.box.slide);
    const a = next(), o = next();
    filters.push(`[${i}:v]format=rgba,fade=t=in:st=${T.ffNum(an.inStart)}:d=${T.ffNum(an.inDur)}:alpha=1,fade=t=out:st=${T.ffNum(an.outStart)}:d=${T.ffNum(an.outDur)}:alpha=1[${a}]`);
    filters.push(`[${cur}][${a}]overlay=x='${an.x}':y=${ov.box.y}:eval=frame:shortest=0:eof_action=pass:enable='between(t,${T.ffNum(ov.el.s)},${T.ffNum(ov.el.e)})'[${o}]`);
    cur = o;
  }

  // Altyazı (libass)
  if (assets.captions) {
    const o = next();
    filters.push(`[${cur}]subtitles=filename=${assets.captions}:fontsdir=export-fonts[${o}]`);
    cur = o;
  }

  // Kesimler
  filters.push(`[${cur}]select='${sel}',setpts=N/FRAME_RATE/TB,format=${encoder.pix}[vmain]`);

  // Açılış ve kapanış
  const parts = [];
  const silent = d => {
    const l = 'sil' + parts.length;
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${T.ffNum(d)}[${l}]`);
    return l;
  };
  const card = (c, name) => {
    const i = addInput(c.pattern, 0, ['-framerate', String(fps)]);
    filters.push(`[${i}:v]scale=${OW}:${OH},setsar=1,fps=${fps},format=${encoder.pix}[${name}]`);
    parts.push({ v: name, a: audioLabel ? silent(c.dur) : null });
  };
  if (assets.intro) card(assets.intro, 'vintro');
  parts.push({ v: 'vmain', a: audioLabel });
  if (assets.outro) card(assets.outro, 'voutro');
  let total = outDur + (assets.intro?.dur || 0) + (assets.outro?.dur || 0);
  let vOut = 'vmain', aOut = audioLabel;
  if (parts.length > 1) {
    const ins = parts.map(p => `[${p.v}]` + (audioLabel ? `[${p.a}]` : '')).join('');
    filters.push(`${ins}concat=n=${parts.length}:v=1:a=${audioLabel ? 1 : 0}[vout]` + (audioLabel ? '[aout]' : ''));
    vOut = 'vout';
    aOut = audioLabel ? 'aout' : null;
  }

  args.push('-filter_complex_script', 'export-graph.txt');
  fs.writeFileSync(path.join(dir, 'export-graph.txt'), filters.join(';\n'));
  args.push('-map', `[${vOut}]`);
  if (aOut) args.push('-map', `[${aOut}]`, '-c:a', 'aac', '-b:a', '160k');
  const q = opts.quality === 'high' ? 20 : 24;
  args.push(...encoder.args(q), '-r', String(fps), '-t', total.toFixed(3), '-movflags', '+faststart', outFile);
  return { args, outDur: total, size: { w: OW, h: OH } };
}

const TEMP = ['export-graph.txt', 'export-cursor.cmd'];
function cleanTemp(dir) { for (const f of TEMP) { try { fs.unlinkSync(path.join(dir, f)); } catch {} } }

async function exportVideo(project, dir, assets, outFile, { onProgress, signal, quality, range } = {}) {
  let encoder = await detectEncoder();
  const attempt = async enc => {
    const { args, outDur } = buildExport(project, dir, assets, outFile, enc, { quality, range });
    await run(['-progress', 'pipe:1', '-nostats', ...args], {
      signal, cwd: dir,
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
    if (signal?.aborted || encoder.name === 'libx264') { cleanTemp(dir); throw e; }
    // Donanım kodlayıcı başarısız olursa işlemciyle tekrar dene.
    encoderCache = { name: 'libx264', label: 'İşlemci (libx264)', args: q => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(q - 2)], pix: 'yuv420p' };
    encoder = encoderCache;
    try { await attempt(encoder); } finally { cleanTemp(dir); }
  }
  cleanTemp(dir);
  onProgress?.(1, encoder.label);
  return { encoder: encoder.label };
}

// İşlenmiş sesin kısa önizlemesi (gürültü azaltma, dengeleme, kısma)
async function audioPreview(project, dir, outFile, range) {
  const { args } = buildExport(project, dir, {}, outFile, null, { audioOnly: true, range });
  try { await run(args, { cwd: dir }); } finally { cleanTemp(dir); }
  return outFile;
}

module.exports = { setFfmpegPath, getFfmpegPath, run, probe, finalizeRecording, audioPeaks, thumbnail, detectEncoder, buildExport, exportVideo, audioPreview };
