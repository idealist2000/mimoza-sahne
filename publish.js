import { chapterText } from './lesson.js';
import { profiles } from './profiles.js';

const $ = id => document.getElementById(id);
const topic = $('publish-topic');
const output = $('publish-draft');
const status = text => { $('publish-status').textContent = text; };

$('publish-local').onclick = () => {
  const subject = topic.value.trim();
  if (!subject) return status('Önce video konusunu yazın.');
  const name = profiles[$('lesson-profile').value].name;
  const notes = $('script').value.trim();
  const chapters = chapterText();
  output.value = [
    'BAŞLIK ÖNERİLERİ',
    subject + ' | Uygulamalı ' + name + ' Dersi',
    subject + ' Nasıl Yapılır? Adım Adım',
    subject + ' | Örneklerle Anlatım',
    '',
    'KAPAK YAZISI', subject.slice(0, 54),
    '',
    'AÇIKLAMA', 'Bu derste ' + subject + ' konusunu örneklerle ele alıyoruz.',
    notes && 'Ders notu: ' + notes.replace(/\s+/g, ' ').slice(0, 300),
    chapters && '\nBÖLÜMLER\n' + chapters,
    '',
    'ETİKETLER', [subject, name, name + ' dersi', 'Türkçe eğitim', 'Mimoza Bilişim'].join(', '),
  ].filter(value => value !== false).join('\n');
  status('Yerel taslak hazır. Yayınlamadan önce içeriği gözden geçirin.');
};

$('publish-ai').onclick = async () => {
  const provider = $('publish-provider').value;
  if (provider !== 'ollama' && !$('publish-share').checked) {
    return status('Bulut sağlayıcısına konu ve metin göndermeye izin verin.');
  }
  $('publish-ai').disabled = true;
  status('Taslak hazırlanıyor…');
  try {
    const response = await fetch('/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider, key: $('publish-key').value.trim(), model: $('publish-model').value.trim(),
        topic: topic.value.trim(), script: $('script').value.trim().slice(0, 16000), chapters: chapterText(),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    output.value = data.draft;
    status('Yapay zekâ taslağı hazır. Başlıkları ve kaynakları kontrol edin.');
  } catch (error) { status(error.message); }
  finally { $('publish-ai').disabled = false; }
};
$('publish-copy').onclick = async () => {
  try {
    if (!output.value.trim()) return status('Önce bir taslak hazırlayın.');
    await navigator.clipboard.writeText(output.value);
    status('Taslak panoya kopyalandı.');
  } catch { status('Kopyalama izni alınamadı. Taslak metnini elle seçip kopyalayabilirsiniz.'); }
};

const youtubeStatus = text => { $('youtube-status').textContent = text; };
async function youtube(action, body, headers) {
  const response = await fetch('/youtube/' + action, { method: 'POST', body, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
async function checkChannel() {
  const { channel } = await youtube('channel');
  $('youtube-channel').textContent = channel ? 'Bağlı kanal: ' + channel.title : 'Bağlı kanal yok.';
  return channel;
}
$('youtube-connect').onclick = async () => {
  const windowRef = window.open('about:blank', '_blank');
  if (!windowRef) return youtubeStatus('Google bağlantısı için açılır pencereye izin verin.');
  windowRef.opener = null;
  try {
    const { url } = await youtube('connect');
    windowRef.location.replace(url);
    youtubeStatus('Google onayını tamamlayıp Bağlantıyı kontrol et düğmesine basın.');
  } catch (error) { windowRef.close(); youtubeStatus(error.message); }
};
$('youtube-check').onclick = () => checkChannel().catch(error => youtubeStatus(error.message));
$('youtube-disconnect').onclick = async () => {
  try { await youtube('disconnect'); await checkChannel(); youtubeStatus('Yerel oturum temizlendi.'); }
  catch (error) { youtubeStatus(error.message); }
};
$('youtube-upload').onclick = async () => {
  const file = $('youtube-file').files[0];
  const title = $('youtube-title').value.trim();
  const forKids = $('youtube-kids').value;
  if (!file || !title || !forKids) return youtubeStatus('Video, başlık ve hedef kitle seçin.');
  const type = file.type || (file.name.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4');
  $('youtube-upload').disabled = true;
  $('youtube-result').hidden = true;
  try {
    const channel = await checkChannel();
    if (!channel) throw new Error('Önce YouTube kanalınızı bağlayın.');
    youtubeStatus(channel.title + ' kanalına gizli yükleniyor…');
    const { id } = await youtube('prepare', JSON.stringify({
      title, type, size: file.size, forKids: forKids === 'yes',
      description: $('youtube-description').value.trim(),
      tags: $('youtube-tags').value.split(',').map(tag => tag.trim()).filter(Boolean),
      language: $('youtube-language').value,
    }), { 'Content-Type': 'application/json' });
    const result = await youtube('upload', file, { 'x-mimoza-upload': id });
    $('youtube-result').href = 'https://studio.youtube.com/video/' + result.id + '/edit';
    $('youtube-result').hidden = false;
    youtubeStatus('Gizli video yüklendi. Son ayarları Studio’da gözden geçirin.');
  } catch (error) { youtubeStatus(error.message); }
  finally { $('youtube-upload').disabled = false; }
};
