// Yeni sürümü parça parça yükler (sunucunun yükleme sınırına takılmaz).
(function () {
  const $ = id => document.getElementById(id);
  const file = $('msy-file');
  if (!file) return;
  const status = t => { $('msy-status').textContent = t; };
  file.addEventListener('change', () => {
    const m = file.files[0] && file.files[0].name.match(/(\d+\.\d+\.\d+)/);
    if (m) $('msy-version').value = m[1];
  });

  async function post(data) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(data)) fd.append(k, v);
    fd.append('nonce', MSY.nonce);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(MSY.ajax, { method: 'POST', body: fd, credentials: 'same-origin' });
        const json = await res.json();
        return json;
      } catch (e) {
        if (attempt === 3) throw new Error('Bağlantı koptu. İnternetinizi kontrol edip tekrar deneyin.');
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }

  async function sendFile(f, kind, id, onProgress) {
    const size = Number(MSY.chunk) || 1048576;
    let offset = 0, index = 0;
    while (offset < f.size) {
      const blob = f.slice(offset, offset + size);
      const res = await post({ action: 'msy_chunk', id, kind, index, offset, chunk: new File([blob], 'parca.bin') });
      if (!res || !res.success) {
        const have = res && res.data && res.data.have;
        if (typeof have === 'number' && have !== offset) { offset = have; continue; }
        throw new Error((res && (res.data && (res.data.msg || res.data))) || 'Parça yüklenemedi.');
      }
      offset = res.data.have;
      index++;
      onProgress(offset / f.size);
    }
  }

  $('msy-go').addEventListener('click', async () => {
    const f = file.files[0];
    const version = $('msy-version').value.trim();
    if (!f) return status('Önce kurulum dosyasını seçin.');
    if (!/^\d+\.\d+\.\d+$/.test(version)) return status('Sürümü 1.3.0 biçiminde yazın.');
    if (MSY.current && !confirm(`Yayındaki ${MSY.current} sürümü ${version} ile değiştirilecek. Programlar bir sonraki açılışta güncellenecek. Devam edilsin mi?`)) return;
    const id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
    $('msy-go').disabled = true;
    $('msy-bar').hidden = false;
    const bar = $('msy-bar').firstElementChild;
    try {
      const bm = $('msy-blockmap').files[0];
      if (bm) { status('Fark dosyası yükleniyor…'); await sendFile(bm, 'blockmap', id, () => {}); }
      await sendFile(f, 'exe', id, p => {
        bar.style.width = (p * 100).toFixed(1) + '%';
        status(`Yükleniyor: %${Math.floor(p * 100)} (${(f.size * p / 1048576).toFixed(0)} / ${(f.size / 1048576).toFixed(0)} MB)`);
      });
      status('Doğrulanıyor ve yayına alınıyor…');
      const res = await post({ action: 'msy_finish', id, version, size: f.size, notes: $('msy-notes').value });
      if (!res || !res.success) throw new Error((res && res.data) || 'Yayına alınamadı.');
      status(`Sürüm ${res.data.version} yayında (${res.data.size}). Programlar bir sonraki açılışta güncellenecek.`);
      setTimeout(() => location.reload(), 2500);
    } catch (e) {
      status('Hata: ' + e.message);
    } finally {
      $('msy-go').disabled = false;
    }
  });
})();
