# Mimoza Sahne

Mimoza Bilişim'in ücretsiz, açık kaynak ekran kaydı ve kurgu stüdyosu. Windows için masaüstü uygulaması.

Ekranınızı, kameranızı, mikrofonunuzu ve bilgisayar sesini **ayrı kanallara** kaydedin. Kayıt bitince proje Camtasia tarzı kurgu ekranında açılır. Tıkladığınız yerlere otomatik yakınlaşma, imleç vurgusu, bulanıklaştırma ve kamera yerleşimini orada düzenleyip hızlı MP4 olarak dışa aktarın.

## Kurulum

1. [Son sürüm sayfasından](https://github.com/idealist2000/mimoza-sahne/releases/latest) `Mimoza-Sahne-Kurulum-x.y.z.exe` dosyasını indirin.
2. Çift tıklayıp kurun. Kurulum bitince masaüstünde ve Başlat menüsünde **Mimoza Sahne** kısayolu oluşur.
3. Program dijital imzalı olmadığı için Windows ilk açılışta "Windows bilgisayarınızı korudu" uyarısı gösterebilir. **Ek bilgi → Yine de çalıştır** deyin.

Node.js, FFmpeg veya başka bir araç kurmanız gerekmez. Hepsi programla birlikte gelir.

## Kayıt

- **Tüm ekran, alan veya pencere** kaydı. Alan seçerken ekranın üzerinde fareyle dikdörtgen çizersiniz.
- Kayıt başlayınca stüdyo penceresi kenara çekilir. Ekranın üstünde **küçük bir kontrol çubuğu** kalır. Bu çubuk kayda girmez (Windows 10 sürüm 2004 ve sonrası).
- Sabit duran ekranlarda da video kısalmaz, ses kaymaz. Görüntü sabit 30 kare/sn kaydedilir.
- Kayıt doğrudan diske yazılır. Uzun kayıtlar belleği doldurmaz.

### Kayıt sırasında kısayollar

Bu tuşlar başka bir programdayken de çalışır.

| Kısayol | İşlev |
|---|---|
| `F9` | Duraklat / sürdür |
| `F10` | Kaydı bitir |
| `Ctrl+Alt+D` | Çizim modu (akıllı tahta). `Esc` ile çıkılır |
| `Ctrl+Alt+C` | Tahtayı temizle |
| `Ctrl+Alt+Z` | Son çizimi geri al |
| `Ctrl+Alt+M` | Bölüm işareti koy |
| `Ctrl+Alt+G` | Gizlilik perdesi (ekranı örter, bu aralıkta ses dışa aktarımda kısılır) |
| `Ctrl+Alt+K` | Ders kartını göster / gizle |
| `Ctrl+Alt+N` | Sıradaki kart |
| `Ctrl+Alt+U` | Mikrofonu kapat / aç |

### Akıllı tahta

Kalem, fosforlu kalem, ok, kutu, spot ışığı ve silgi. **Geçici** seçeneği açıkken çizimler 3 saniye sonra veya sayfayı kaydırdığınızda kendiliğinden silinir. Çizimler kayda girer. Pencere kaydında çizim kullanılamaz.

### Ders profilleri ve kartlar

Yapay zekâ, SEO, Google Ads, İngilizce ve Genel anlatım profilleri. Kayıttan önce her satıra bir kart yazın, alanları `|` ile ayırın:

```
Bir blog yazısı için 5 başlık öner | ChatGPT 5 başlık verdi | Başlıkları arama hacmiyle doğrula
```

Yapay zekâ profili prompt ve yanıtı yan yana, İngilizce profili kelime-anlam-örnek, Google Ads profili kampanya akışı olarak gösterir.

## Kurgu

- **Çok kanallı zaman çizelgesi:** Yakınlaştırma, bulanıklaştırma, ekran, kamera, mikrofon ve bilgisayar sesi ayrı kanallarda.
- **Kesme:** Oynatma çizgisini istediğiniz yere getirip `S` ile bölün, parçayı seçip `Delete` ile silin.
- **Otomatik yakınlaştırma:** Kayıtta tıkladığınız yerlere yumuşak geçişli yakınlaşmalar otomatik eklenir. Süresini kenarlarından sürükleyerek, yakınlaşılacak yeri önizlemede tıklayarak değiştirin. `Z` ile elle ekleyin.
- **Bulanıklaştırma:** API anahtarı, e-posta veya hesap bilgisi görünen alanı `B` ile gizleyin.
- **Kamera:** Önizlemede sürükleyerek taşıyın, fare tekerleğiyle büyütün. Daire, kare veya geniş şekil seçin.
- **İmleç vurgusu ve tıklama efekti.**
- Her kanal için ses seviyesi ve sessize alma.
- Proje her değişiklikte otomatik kaydedilir. `Ctrl+Z` / `Ctrl+Y` ile geri alıp yineleyin.

Projeler `Belgeler\Mimoza Sahne\Projeler` klasöründe durur. Her kanalın ham kaydı proje klasöründe ayrı dosya olarak saklanır.

## Dışa aktarma

Yatay 16:9 (YouTube), dikey 9:16 (Shorts, Reels) veya kare 1:1, 1080p ya da 720p MP4. Program bilgisayarınızdaki donanım kodlayıcıyı (Intel Quick Sync, NVIDIA veya AMD) otomatik bulur ve kullanır. Bulamazsa işlemciyle kodlar. Dışa aktarma video süresini beklemez ve arka planda çalışır.

## Geliştirme

```
npm install
node scripts/fetch-ffmpeg.js   # Windows paketine girecek FFmpeg
npm start                      # geliştirme modunda çalıştır (sistemdeki ffmpeg kullanılır)
npm test                       # dışa aktarma motoru testleri
npm run dist                   # Windows kurulum dosyası (dist/)
```

Önceki tarayıcı sürümünün kodu `eski-tarayici-surumu/` klasöründedir. YouTube yükleme, yapay zekâ taslakları ve canlı yayın sonraki sürümlerde masaüstü uygulamasına taşınacak.

## Yol haritası

- **Teslim 2:** Tek tıkla Türkçe/İngilizce altyazı, metinden kesme, sessizlik ve "ııı" temizleme, gürültü azaltma, Mimoza marka şablonları, yeşil perdesiz arka plan, uzun videodan dikey kısa klip.
- **Teslim 3:** OpenAI, Claude, Gemini, You.com ve Ollama ile başlık-açıklama-etiket, YouTube'a yükleme ve canlı yayın.

## Teşekkür

Mimoza Sahne, Erhan Meydan'ın [Kilnframe](https://github.com/erhanmeydan/kilnframe) projesinden ilham aldı.

## Lisans

[MIT](LICENSE)
