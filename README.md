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

Dışa aktarma gerçek zamanlıdır ve sekmeyi açık tutmanız gerekir. Video tarayıcıda işlenir. Ollama seçeneği sadece altyazı metnini yerel Ollama’ya iletir.

## Kilnframe ve özellik farkları

Mimoza Sahne, Erhan Meydan’ın [Kilnframe](https://github.com/erhanmeydan/kilnframe) projesinden ilham aldı. Özellikle konuşmadaki önemli anları görsel vurgularla öne çıkarma fikri çıkış noktamız oldu. Mimoza Sahne, Mimoza Bilişim için bağımsız olarak yazıldı.

Bu sürümde konuşmayı otomatik yazıya dökme, tekrar ve sessizliklerin otomatik kesilmesi, gürültü temizleme, sesle düzeltme, gelişmiş renk araçları, üretken müzik, kodla üretilen çok stilli 3B animasyonlar ve Premiere Pro, Resolve Studio veya FilmCraft entegrasyonu henüz bulunmuyor. Erhan Meydan’ın [Desktop duyurusu](https://kilnframe.com/) ve yayımladığı eklenti farklı ürün kapsamlarına sahip.

## Kurulum dosyası üretme

Windows PowerShell’de `powershell -NoProfile -File .\build-installer.ps1` çalıştırın. `dist\Mimoza-Sahne-Kurulum.cmd` oluşur. Kurulum dosyası uygulama kodunu içerir ve sistemde kurulu Node.js’i kullanır.

## Lisans

[MIT](LICENSE).
