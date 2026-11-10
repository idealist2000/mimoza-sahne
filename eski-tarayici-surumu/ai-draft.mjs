const modelPattern = /^[a-z0-9][a-z0-9._:/-]{0,119}$/i;

export async function generateDraft({ provider, key, model, topic, script, chapters }) {
  if (![key, topic, script, chapters].every(value => typeof value === 'string') ||
      key.length > 512 || topic.length > 200 || script.length > 16000 || chapters.length > 2000 ||
      typeof model !== 'string' || (provider !== 'you' && !modelPattern.test(model)) ||
      (!topic.trim() && !script.trim())) {
    throw new Error('Modeli, konuyu ve metin uzunluğunu kontrol edin.');
  }
  if (provider !== 'ollama' && !key.trim()) throw new Error('Bu sağlayıcı için API anahtarı girin.');
  const prompt = [
    'Türkçe YouTube yayın editörüsün. Verilen içerikle uyumlu üç başlık ve kapak yazısı, açıklama ve en çok sekiz etiket hazırla.',
    'İzlenme veya CTR garantisi verme. Verilmeyen zaman damgalarını, kaynakları ve bilgileri uydurma.',
    'Konu: ' + topic,
    'Konuşma metni: ' + script,
    'Gerçek bölüm işaretleri: ' + chapters,
  ].join('\n\n');
  const headers = { 'Content-Type': 'application/json' };
  let request;
  switch (provider) {
    case 'openai':
      headers.Authorization = 'Bearer ' + key;
      request = ['https://api.openai.com/v1/chat/completions', { model, messages: [{ role: 'user', content: prompt }] },
        data => data.choices?.[0]?.message?.content];
      break;
    case 'claude':
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
      request = ['https://api.anthropic.com/v1/messages', { model, max_tokens: 1100, messages: [{ role: 'user', content: prompt }] },
        data => data.content?.filter(block => block.type === 'text').map(block => block.text).join('\n')];
      break;
    case 'gemini':
      if (model.includes('/') || model.includes(':')) throw new Error('Gemini model adını kontrol edin.');
      headers['x-goog-api-key'] = key;
      request = ['https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
        { contents: [{ parts: [{ text: prompt }] }] }, data => data.candidates?.[0]?.content?.parts?.map(part => part.text).join('\n')];
      break;
    case 'you':
      headers['X-API-Key'] = key;
      request = ['https://api.you.com/v1/answer', { query: prompt.slice(0, 3500) }, data => {
        const sources = Array.isArray(data.citations) ? data.citations.map(item => item?.url || item?.source)
          .filter(source => typeof source === 'string' && /^https?:\/\//.test(source)).slice(0, 8) : [];
        return data.answer && data.answer + (sources.length ? '\n\nKaynaklar\n' + sources.join('\n') : '');
      }];
      break;
    case 'ollama':
      if (/cloud/i.test(model) || model.includes('/')) throw new Error('Yerel Ollama modeli seçin.');
      const listing = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000) });
      if (!listing.ok) throw new Error('Ollama model listesi alınamadı.');
      const installed = (await listing.json()).models?.find(item => item.name === model || item.name === model + ':latest');
      if (!installed?.size || installed.remote_host || installed.remote_model) throw new Error('Ollama’da yerel olarak indirilmiş bir model seçin.');
      request = ['http://127.0.0.1:11434/api/chat', { model: installed.name, stream: false, messages: [{ role: 'user', content: prompt }] },
        data => data.message?.content];
      break;
    default:
      throw new Error('Geçerli bir sağlayıcı seçin.');
  }
  const [url, body, read] = request;
  const response = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000), redirect: 'error',
  });
  if (!response.ok) throw new Error('Sağlayıcı isteği reddetti (HTTP ' + response.status + '). Anahtarı, modeli ve kotayı kontrol edin.');
  const result = read(await response.json());
  if (typeof result !== 'string' || !result.trim()) throw new Error('Sağlayıcı metin döndürmedi.');
  return result.slice(0, 18000);
}
