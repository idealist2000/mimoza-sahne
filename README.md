# Mimoza Sahne

Mimoza Bilişim'in ücretsiz, açık kaynak ekran kaydı ve kurgu stüdyosu. Windows için masaüstü uygulaması.

Ekranınızı, kameranızı, mikrofonunuzu ve bilgisayar sesini **ayrı kanallara** kaydedin. Kayıt bitince proje Camtasia tarzı kurgu ekranında açılır. Tıkladığınız yerlere otomatik yakınlaşma, imleç vurgusu, bulanıklaştırma ve kamera yerleşimini orada düzenleyip hızlı MP4 olarak dışa aktarın.

## Kurulum

1. [Son sürüm sayfasından](https://github.com/idealist2000/mimoza-sahne/releases/latest) `Mimoza-Sahne-Kurulum-x.y.z.exe` dosyasını indirin.
2. Çift tıklayıp kurun. Kurulum bitince masaüstünde ve Başlat menüsünde **Mimoza Sahne** kısayolu oluşur.
3. Program dijital imzalı olmadığı için Windows ilk açılışta "Windows bilgisayarınızı korudu" uyarısı gösterebilir. **Ek bilgi → Yine de çalıştır** deyin.

Node.js, FFmpeg veya başka bir araç kurmanız gerekmez. Hepsi programla birlikte gelir.

## Hafif mod

Kayıt hazırlığı ekranındaki **Bilgisayar durumu** kartı boş belleği ve en çok bellek kullanan programları gösterir. 8 GB ve altı bilgisayarlarda veya bellek azken **hafif mod** kendiliğinden açılır: 720p ekran, düşük çözünürlüklü kamera, saniyede 24 kare; dışa aktarma ve altyazı daha az çekirdek kullanır. Boş bellek kritik seviyedeyse kayıt başlamadan uyarı verilir, kayıt sırasında bellek azalırsa kontrol çubuğunda "Bellek az!" yazar.

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

## Altyazı ve metinden kurgu

**Metin** sekmesinde dili (Türkçe, İngilizce veya otomatik) ve doğruluğu seçip **Altyazı oluştur** deyin. Konuşma bu bilgisayarda [whisper.cpp](https://github.com/ggml-org/whisper.cpp) ile yazıya dökülür, ses internete gönderilmez. Model ilk kullanımda bir kez indirilir: "Doğru" 466 MB, "Hızlı" 142 MB.

- Kelimeye tıklayınca video o ana gider. Kelimeleri sürükleyerek seçip `Delete`'e basınca o kısım videodan kesilir. Kesilen kelimenin üstü çizili görünür; seçip tekrar `Delete` ile geri getirilir.
- Kelimeye çift tıklayıp düzeltebilirsiniz.
- Üç altyazı stili: **Klasik** (koyu kutu), **Vurgulu** (söylenen kelime sarı, Reels/Shorts tarzı), **Büyük** (ortada, büyük harf). Altyazı Montserrat yazı tipiyle videoya gömülür; isterseniz ayrıca SRT dosyası kaydedilir.
- Alt bant görünürken altyazı otomatik olarak yukarı kayar.

## Temizlik

- **Kesim önerileri:** Uzun sessizlikler, dolgu sesleri ("ııı", "eee", "hmm"), dolgu kelimeleri ("şey", "yani", "hani"), yazıya dökülmemiş tereddüt sesleri ve tekrarlanan sözler. Hiçbiri kendiliğinden kesilmez; her öneriyi dinleyip seçer, sonra **Seçilenleri kes** dersiniz. `Ctrl+Z` ile geri alınır.
- **Ses iyileştirme:** Gürültü azaltma, YouTube seviyesinde ses dengeleme (-14 LUFS) ve konuşurken bilgisayar sesini kısma. **10 sn işlenmiş sesi dinle** düğmesiyle sonucu dışa aktarmadan duyabilirsiniz.

## Mimoza şablonları

**Şablonlar** sekmesinde sarı-lacivert marka öğeleri:

- **Alt bant:** Logo, ad ve unvan ("Onur Kalafat · SEO ve Yapay Zekâ Uzmanı"). Unvan her video için değiştirilebilir, örneğin "İngilizce Öğretmeni".
- **Konu başlığı** ve **bölüm kartları**. Kayıtta koyduğunuz bölüm işaretlerinden tek tıkla kart üretilir.
- **Köşede web sitesi** (tüm video boyunca).
- **Açılış** (logo, başlık, alt başlık; 4 sn) ve **kapanış** (abone ol düğmesi ve iletişim bilgileri; 5 sn). Önizle düğmesiyle izleyebilirsiniz.

Şablonlar zaman çizelgesinde kendi kanalındadır; kenarlarından tutup süresini, sağ panelden yazılarını değiştirin.

## Kısa klip

- Dikey 9:16 biçiminde **"Ekran üstte, kamera altta"** düzeni.
- Oynatma çizgisini getirip `I` ile başlangıcı, `O` ile bitişi seçin. Dışa aktarırken **Yalnızca seçili aralık** deyin.

## Dışa aktarma

Yatay 16:9 (YouTube), dikey 9:16 (Shorts, Reels) veya kare 1:1, 1080p ya da 720p MP4. Program bilgisayarınızdaki donanım kodlayıcıyı (Intel Quick Sync, NVIDIA veya AMD) otomatik bulur ve kullanır. Bulamazsa işlemciyle kodlar. Dışa aktarma video süresini beklemez ve arka planda çalışır.

## Otomatik güncelleme ve indirme sayfası

`wordpress/mimoza-sahne-yayin` klasöründeki WordPress eklentisi iki iş yapar:

- **İndirme sayfası:** Bir sayfaya `[mimoza_sahne]` kısa kodunu ekleyin. Mimoza Bilişim renklerinde, ad ve e-posta isteyen, KVKK onaylı bir indirme kutusu çıkar. İndirenler panelde listelenir ve CSV olarak alınabilir.
- **Güncelleme sunucusu:** WordPress panelinde **Mimoza Sahne → Sürüm ve güncelleme** sayfasından yeni kurulum dosyasını yükleyin. Dosya parça parça yüklenir, sunucunun yükleme sınırına takılmaz. Program her açılışta `https://mimozabilisim.com/mimoza-sahne-guncelleme/latest.yml` adresine bakar; yeni sürüm varsa arka planda indirir ve "Yeniden başlat ve güncelle" düğmesi gösterir. Kayıt sürerken indirme ve kurulum yapılmaz.

## Geliştirme

```
npm install
node scripts/fetch-ffmpeg.js   # Windows paketine girecek FFmpeg (ve whisper.cpp yönergesi)
npm start                      # geliştirme modunda çalıştır (sistemdeki ffmpeg kullanılır)
npm test                       # dışa aktarma motoru testleri
npm run dist                   # Windows kurulum dosyası (dist/)
```

Önceki tarayıcı sürümünün kodu `eski-tarayici-surumu/` klasöründedir. YouTube yükleme, yapay zekâ taslakları ve canlı yayın sonraki sürümlerde masaüstü uygulamasına taşınacak.

## Yol haritası

- **Sıradaki:** Yeşil perdesiz kamera arka planı (bulanıklaştırma veya görselle değiştirme).
- **Teslim 3:** OpenAI, Claude, Gemini, You.com ve Ollama ile başlık-açıklama-etiket, YouTube'a yükleme ve canlı yayın.

## Teşekkür

Mimoza Sahne, Erhan Meydan'ın [Kilnframe](https://github.com/erhanmeydan/kilnframe) projesinden ilham aldı.

## Lisans

[MIT](LICENSE)
