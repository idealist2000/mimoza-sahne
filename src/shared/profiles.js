// Ders profilleri: her profil kendi kart alanlarını ve kart görünümünü tanımlar.
(function (root) {
  'use strict';
  const profiles = {
    ai: {
      name: 'Yapay zekâ',
      fields: ['Prompt', 'Yanıt', 'Kontrol'],
      layout: 'compare',
      example: 'Bir blog yazısı için 5 başlık öner | ChatGPT 5 başlık verdi | Başlıkları arama hacmiyle doğrula',
      tips: 'Tıkladığınız yerler kurguda otomatik yakınlaşır. API anahtarı gibi bilgileri kurguda bulanıklaştırabilirsiniz.',
    },
    seo: {
      name: 'SEO',
      fields: ['Sayfa', 'Sorun', 'Çözüm'],
      layout: 'rows',
      example: 'Kategori sayfası | Başlık etiketi zayıf | Arama niyetine göre yeniden yaz',
      tips: 'Arama sonuçlarında önemli satırları fosforlu kalemle işaretleyin.',
    },
    ads: {
      name: 'Google Ads',
      fields: ['Kampanya', 'Reklam grubu', 'Hedef'],
      layout: 'flow',
      example: 'Arama kampanyası | Marka aramaları | Randevu formu',
      tips: 'Müşteri hesabı açarken Ctrl+Alt+G ile gizlilik perdesini kullanın.',
    },
    english: {
      name: 'İngilizce',
      fields: ['Kelime', 'Anlamı', 'Örnek cümle'],
      layout: 'vocab',
      example: 'take notes | not almak | I always take notes in class.',
      tips: 'Her kelime için bir kart hazırlayın. Ctrl+Alt+N ile sıradaki karta geçin.',
    },
    general: {
      name: 'Genel anlatım',
      fields: ['Başlık', 'Açıklama'],
      layout: 'rows',
      example: 'Bugünkü konu | Adım adım uygulama',
      tips: '',
    },
  };
  // Kart metnini alanlara böler: "a | b | c"
  function parseCards(text) {
    return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      .map(l => l.split('|').map(x => x.trim()));
  }
  const api = { profiles, parseCards };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Profiles = api;
})(typeof window !== 'undefined' ? window : globalThis);
