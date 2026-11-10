# Mimoza Sahne

Mimoza Bilişim’in ücretsiz, açık kaynak video aracı. Ekranınızı ve kameranızı kaydedin, hareketli başlıklar ekleyin ve yayına hazırlayın.

## Windows’ta başlatma

1. Node.js 22 veya daha yeni bir sürüm kurun. Chrome veya Edge kullanın.
2. Kurulum dosyanız varsa **Mimoza-Sahne-Kurulum.cmd** dosyasını çalıştırın. Program kullanıcı hesabınızın Yerel Uygulama Verileri klasörüne kurulur ve masaüstünde **Mimoza Sahne** kısayolu oluşur.
3. Kaynak koddan çalıştırmak için **baslat.cmd** dosyasını açın. Alternatif olarak `node server.mjs` çalıştırıp [yerel uygulamayı](http://127.0.0.1:4178) açın.

## Video hazırlama

- **Kayıt stüdyosu:** Ekran, pencere veya sekme seçin. Kameranızı köşede gösterebilir, mikrofonu ve tarayıcının sunduğu ekran sesini kayda alabilirsiniz. Ekran kaydederken stüdyoyu ikinci ekranda ya da ekranınızın bir bölümünde görünür tutun. Tarayıcı, gizlenen sekmelerin görüntü işleme hızını düşürebilir.
- **Sanal arka plan:** Kamera için bir görsel seçerseniz yeşil perde alanları bu görselle değiştirilir. Odayı otomatik ayırmak için yapay zekâ segmentasyonu kullanılmıyor.
- **Başlıklar:** SRT dosyası yükleyin, konuşma metnini yapıştırın veya başlıkları elle ekleyin. SRT zamanları kullanılır. Düz metinde her satıra eşit süre ayrılır.
- **Dışa aktarma:** Yatay, dikey veya kare boyut seçin. İsterseniz başlangıç ve bitiş zamanını belirleyin. WebM veya tarayıcınız destekliyorsa MP4 indirin. Geçerli kareyi kapak için PNG olarak kaydedebilirsiniz.
- **Yerel yapay zekâ:** [Ollama](https://ollama.com/) çalışıyorsa ve yerel bir metin modeli indirdiyseniz model adını girin. Model, en fazla 120 altyazı satırından Türkçe başlıklar önerir. Hızlı plan ve kayıt için Ollama ya da API anahtarı gerekmez.

Kaynağı hemen indir, kaydedilmiş veya yüklenmiş dosyayı yeniden işlemeye sokmadan indirir. Kayıt sırasında videoya işlenen çizimler ve kartlar korunur. Sonradan eklenen başlıklar, kesit ve boyut değişiklikleri için Düzenlenmiş videoyu indir seçeneğini kullanın. Bu dışa aktarma gerçek zamanlıdır ve sekmeyi açık tutmanız gerekir. Video tarayıcıda işlenir. Ollama seçeneği sadece altyazı metnini yerel Ollama’ya iletir.

## Kilnframe ve özellik farkları

Mimoza Sahne, Erhan Meydan’ın [Kilnframe](https://github.com/erhanmeydan/kilnframe) projesinden ilham aldı. Özellikle konuşmadaki önemli anları görsel vurgularla öne çıkarma fikri çıkış noktamız oldu. Mimoza Sahne, Mimoza Bilişim için bağımsız olarak yazıldı.

Otomatik altyazı isteğe bağlı yerel araçlarla çalışır. Ayrı kayıt kanalları, yerel Windows kayıt motoru ve sistem genelinde kısayollar, otomatik kesim, gürültü temizleme, sesle düzeltme, gelişmiş renk araçları, üretken müzik, çok stilli 3B animasyonlar ve kurgu programı entegrasyonları henüz bulunmuyor. Erhan Meydan’ın [Desktop duyurusu](https://kilnframe.com/) ve yayımladığı eklenti farklı ürün kapsamlarına sahip.

## Kurulum dosyası üretme

Windows PowerShell’de `powershell -NoProfile -File .\build-installer.ps1` çalıştırın. `dist\Mimoza-Sahne-Kurulum.cmd` oluşur. Kurulum dosyası uygulama kodunu içerir ve sistemde kurulu Node.js’i kullanır.

## Lisans

[MIT](LICENSE).

## Stüdyo ve ders araçları

- **Stüdyoyu tam ekran aç** tarayıcıyı tam ekran yapar. Kayıt sırasında aynı sekmede Alt+P duraklatır veya sürdürür, Alt+D durdurur, Alt+G gizlilik sahnesine geçer, Alt+T tahtayı temizler, Alt+B bölüm işareti koyar. Bu kısayollar Mimoza Sahne odaktayken çalışır.
- İngilizce, SEO, Google Ads ve yapay zekâ profilleri farklı kart alanları sunar. Kartta alanları dikey çizgi ile ayırın. Geçici kalem çizgileri önizlemede kaydırınca veya yedi saniye sonra kalkar. Tahta, kart ve sahneler kayıt görüntüsüne işlenir. Gizlilik sahnesi görüntüyü örter ve kayıt ile yayın seslerini susturur.
- **Yayın hazırlığı** düğmesi yerel bir başlık, kapak yazısı, açıklama, bölüm ve etiket taslağı oluşturur. Bölüm işaretleri son kayda aittir. Başlık önerilerini içerik ve izleyici kitlesine göre düzenleyin.

## İsteğe bağlı bağlantılar

**Yerel altyazı.** FFmpeg ve whisper.cpp komut satırı aracını kurun. PowerShell'de sunucuyu başlatmadan önce aşağıdaki ortam değişkenlerini ayarlayın. Çok dilli bir model Türkçe ve İngilizce için uygundur.

```powershell
$env:MIMOZA_FFMPEG = 'C:\araclar\ffmpeg.exe'
$env:MIMOZA_WHISPER = 'C:\araclar\whisper-cli.exe'
$env:MIMOZA_WHISPER_MODEL = 'C:\araclar\ggml-base.bin'
node server.mjs
```

FFmpeg ve whisper-cli PATH üzerindeyse ilk iki satır isteğe bağlıdır. En fazla 300 MB kaynak video ile çalışır. Çıkan SRT metni düzenleyicide açılır.

**Yapay zekâ taslağı.** Ollama, OpenAI, Claude, Gemini veya You.com Answer API seçebilirsiniz. Bulut sağlayıcıları için API anahtarınızı girin ve metnin gönderilmesine izin verin. You.com için model alanını boş bırakın. Kredi ve harcamalar sağlayıcı hesabınızda yönetilir. Uygulama API anahtarını dosyaya kaydetmez.

**YouTube kanalı.** Kendi Google Cloud projenizde YouTube Data API v3'ü açın ve masaüstü OAuth istemcisi oluşturun. Test modundaysa Google hesabınızı test kullanıcısı olarak ekleyin. İstemci bilgilerini GitHub'a eklemeyin.

```powershell
$env:MIMOZA_GOOGLE_CLIENT_ID = 'istemci-kimligi'
$env:MIMOZA_GOOGLE_CLIENT_SECRET = 'istemci-parolasi'
node server.mjs
```

Yerel uygulamada Google bağlantısını tamamlayın ve kanalı kontrol edin. Dışa aktardığınız MP4 veya WebM dosyasını seçip başlık, açıklama, etiket, dil ve hedef kitleyi girin. Uygulama videoyu **gizli** yükler. Son yayın ve zamanlama işlemlerini Studio'da yapabilirsiniz. Kanal bağlantısı uygulama oturumu boyunca bellekte tutulur.

**YouTube canlı sinyal.** FFmpeg'in libx264, AAC ve RTMPS desteği olan bir derlemesini kullanın. YouTube Studio'da yayın etkin bir kanalda, otomatik başlatma kapalı bir test yayını hazırlayın. Mimoza Sahne'de yerel kaydı başlatıp yayın anahtarını girin ve sinyali gönderin. Yayının önizlemesini ve başlatma işlemini YouTube Studio'da kontrol edin. Yerel kaydı durdurmak Mimoza Sahne'nin sinyalini de keser. Yayının sona erdiğini Studio'da doğrulayın. Tarayıcı arka planda görüntü işleme hızını düşürebilir, bu yüzden ikinci ekran veya görünür stüdyo penceresiyle test edin.



