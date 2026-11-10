'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = channel => fn => {
  const listener = (e, ...args) => fn(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('mimoza', {
  info: () => ipcRenderer.invoke('app:info'),
  sysStatus: withApps => ipcRenderer.invoke('sys:status', withApps),
  update: {
    state: () => ipcRenderer.invoke('update:state'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: on('update:status'),
  },
  settings: { get: () => ipcRenderer.invoke('settings:get'), set: patch => ipcRenderer.invoke('settings:set', patch) },
  encoder: () => ipcRenderer.invoke('encoder:detect'),
  showInFolder: p => ipcRenderer.invoke('shell:show', p),
  openProjectFolder: id => ipcRenderer.invoke('shell:open-project-folder', id),
  sources: () => ipcRenderer.invoke('sources:list'),
  selectRegion: displayId => ipcRenderer.invoke('region:select', displayId),
  rec: {
    prepare: config => ipcRenderer.invoke('rec:prepare', config),
    config: () => ipcRenderer.invoke('rec:config'),
    openTrack: (name, mime) => ipcRenderer.invoke('rec:open-track', name, mime),
    chunk: (id, data) => ipcRenderer.send('rec:chunk', id, data),
    started: () => ipcRenderer.invoke('rec:started'),
    time: () => ipcRenderer.invoke('rec:time'),
    paused: p => ipcRenderer.send('rec:paused', p),
    finish: meta => ipcRenderer.invoke('rec:finish', meta),
    cancel: () => ipcRenderer.invoke('rec:cancel'),
    resize: h => ipcRenderer.send('rec:resize', h),
    barLayout: (compact, h) => ipcRenderer.send('bar:layout', compact, h),
    barDrag: (phase, x, y) => ipcRenderer.send('bar:drag', phase, x, y),
    onCmd: on('cmd'),
  },
  overlay: {
    send: msg => ipcRenderer.send('overlay:send', msg),
    onMessage: on('overlay'),
    emit: msg => ipcRenderer.send('overlay:event', msg),
    onEvent: on('overlay-event'),
  },
  region: { onImage: on('region:image'), done: rect => ipcRenderer.send('region:done', rect) },
  project: {
    list: () => ipcRenderer.invoke('project:list'),
    load: id => ipcRenderer.invoke('project:load', id),
    save: p => ipcRenderer.invoke('project:save', p),
    rename: (id, name) => ipcRenderer.invoke('project:rename', id, name),
    remove: id => ipcRenderer.invoke('project:delete', id),
    import: () => ipcRenderer.invoke('project:import'),
    onOpen: on('project:open'),
    onProcessing: on('processing'),
  },
  speech: {
    models: () => ipcRenderer.invoke('speech:models'),
    transcribe: (id, opts) => ipcRenderer.invoke('speech:transcribe', id, opts),
    cancel: () => ipcRenderer.invoke('speech:cancel'),
    silences: id => ipcRenderer.invoke('speech:silences', id),
    onProgress: on('speech:progress'),
  },
  audioPreview: (id, project, range) => ipcRenderer.invoke('audio:preview', id, project, range),
  saveSrt: (name, text) => ipcRenderer.invoke('srt:save', name, text),
  exporter: {
    frame: (id, kind, i, data) => ipcRenderer.invoke('export:frame', id, kind, i, data),
    start: (id, project, assets, options) => ipcRenderer.invoke('export:start', id, project, assets, options),
    cancel: () => ipcRenderer.invoke('export:cancel'),
    onProgress: on('export:progress'),
  },
});
