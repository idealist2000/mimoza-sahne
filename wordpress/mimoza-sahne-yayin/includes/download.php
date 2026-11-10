<?php
// İndirme kutusu (kısa kod), form işleme, indirme bağlantısı ve güncelleme adresi.
if (!defined('ABSPATH')) exit;

class MSY_Download {
    // Programın güncelleme için baktığı adres: https://site/mimoza-sahne-guncelleme/latest.yml
    const UPDATE_PATH = '/mimoza-sahne-guncelleme/';
    // Sabit indirme adresi: https://site/mimoza-sahne-indir/?t=<anahtar>
    const DOWNLOAD_PATH = '/mimoza-sahne-indir/';

    public static function init() {
        add_shortcode('mimoza_sahne', [__CLASS__, 'shortcode']);
        add_action('init', [__CLASS__, 'route'], 1);
        add_action('admin_post_nopriv_msy_form', [__CLASS__, 'handle_form']);
        add_action('admin_post_msy_form', [__CLASS__, 'handle_form']);
    }

    public static function update_base() { return home_url(self::UPDATE_PATH); }

    private static function path() {
        $uri = isset($_SERVER['REQUEST_URI']) ? wp_unslash($_SERVER['REQUEST_URI']) : '';
        $p = (string) parse_url($uri, PHP_URL_PATH);
        $home = (string) parse_url(home_url('/'), PHP_URL_PATH);
        if ($home && $home !== '/' && strpos($p, rtrim($home, '/')) === 0) $p = substr($p, strlen(rtrim($home, '/')));
        return $p;
    }

    private static function nocache() {
        nocache_headers();
        header('X-LiteSpeed-Cache-Control: no-cache');
        header('X-Robots-Tag: noindex');
    }

    public static function route() {
        $p = self::path();
        // Güncelleme bilgisi
        if ($p === self::UPDATE_PATH . 'latest.yml') {
            $r = MSY_Store::current();
            self::nocache();
            if (!$r) { status_header(404); exit; }
            update_option('msy_update_checks', (int) get_option('msy_update_checks', 0) + 1, false);
            header('Content-Type: text/yaml; charset=utf-8');
            echo MSY_Store::latest_yml($r);
            exit;
        }
        // İndirme: geçerli anahtar varsa en son sürüme yönlendir
        if (rtrim($p, '/') . '/' === self::DOWNLOAD_PATH) {
            self::nocache();
            $r = MSY_Store::current();
            $id = self::verify_token(isset($_GET['t']) ? sanitize_text_field(wp_unslash($_GET['t'])) : '');
            if (!$r || !$id) {
                $page = MSY_Store::settings()['sayfa_url'] ?? '';
                wp_safe_redirect($page ? $page : home_url('/'));
                exit;
            }
            global $wpdb;
            $t = MSY_Store::table();
            $wpdb->query($wpdb->prepare("UPDATE $t SET son_indirme = %s, surum = %s WHERE id = %d", current_time('mysql'), $r['version'], $id));
            wp_redirect(MSY_Store::url() . rawurlencode($r['file']), 302);
            exit;
        }
    }

    public static function token($id) {
        $sig = substr(hash_hmac('sha256', 'msy|' . $id, wp_salt('auth')), 0, 20);
        return $id . '-' . $sig;
    }
    public static function verify_token($t) {
        if (!preg_match('/^(\d+)-([a-f0-9]{20})$/', $t, $m)) return 0;
        return hash_equals(self::token((int) $m[1]), $t) ? (int) $m[1] : 0;
    }
    public static function link($id) { return add_query_arg('t', self::token($id), home_url(self::DOWNLOAD_PATH)); }

    public static function handle_form() {
        $back = isset($_POST['msy_back']) ? esc_url_raw(wp_unslash($_POST['msy_back'])) : home_url('/');
        $back = wp_validate_redirect($back, home_url('/'));
        $fail = function ($code) use ($back) { wp_safe_redirect(add_query_arg('msy_hata', $code, $back) . '#mimoza-sahne'); exit; };
        // Bot önlemi: gizli alan dolu olmamalı ve form en az 3 saniye açık kalmış olmalı
        if (!empty($_POST['msy_web'])) $fail('bot');
        // Sayfa önbellekte olabileceği için süre tarayıcıda ölçülür (JavaScript'siz botlar geçemez).
        $el = isset($_POST['msy_el']) ? (float) $_POST['msy_el'] : 0;
        if ($el < 3) $fail('bot');
        $ad = sanitize_text_field(wp_unslash($_POST['msy_ad'] ?? ''));
        $eposta = sanitize_email(wp_unslash($_POST['msy_eposta'] ?? ''));
        $amac = sanitize_text_field(wp_unslash($_POST['msy_amac'] ?? ''));
        $kvkk = !empty($_POST['msy_kvkk']);
        $bulten = !empty($_POST['msy_bulten']);
        if (!$ad || !is_email($eposta)) $fail('eksik');
        if (!$kvkk) $fail('kvkk');
        $r = MSY_Store::current();
        if (!$r) $fail('surum');
        $id = MSY_Store::add_subscriber(mb_substr($ad, 0, 120), $eposta, mb_substr($amac, 0, 60), $bulten, $r['version']);
        $link = self::link($id);
        $s = MSY_Store::settings();
        $body = strtr($s['eposta_metin'], ['{ad}' => $ad, '{baglanti}' => $link, '{surum}' => $r['version']]);
        $headers = [];
        if (!empty($s['gonderen'])) $headers[] = 'From: ' . wp_specialchars_decode($s['gonderen']) . ' <' . get_option('admin_email') . '>';
        $headers[] = 'Reply-To: ' . get_option('admin_email');
        wp_mail($eposta, $s['eposta_konu'], $body, $headers);
        wp_safe_redirect(add_query_arg('msy_t', self::token($id), $back) . '#mimoza-sahne');
        exit;
    }

    public static function shortcode($atts = []) {
        $s = MSY_Store::settings();
        $r = MSY_Store::current();
        wp_enqueue_style('msy-front', MSY_URL . 'assets/front.css', [], MSY_VERSION);
        $mb = $r ? number_format_i18n($r['size'] / 1048576, 0) . ' MB' : '';
        ob_start();
        echo '<div class="msy-box" id="mimoza-sahne">';
        echo '<div class="msy-head"><img src="' . esc_url(MSY_URL . 'assets/logo.png') . '" alt="Mimoza Bilişim" width="64" height="64"><div>';
        echo '<p class="msy-brand">MİMOZA BİLİŞİM</p><h2>' . esc_html($s['baslik']) . '</h2><p>' . esc_html($s['aciklama']) . '</p></div></div>';
        if ($r) echo '<p class="msy-meta">Sürüm ' . esc_html($r['version']) . ' · ' . esc_html($mb) . ' · Windows 10/11 · Reklamsız, filigransız, ücretsiz</p>';

        $tok = isset($_GET['msy_t']) ? sanitize_text_field(wp_unslash($_GET['msy_t'])) : '';
        if ($tok && ($id = self::verify_token($tok)) && $r) {
            $link = self::link($id);
            echo '<div class="msy-ok"><strong>Teşekkürler! İndirme başlıyor.</strong>';
            echo '<p>Başlamazsa düğmeye basın. Bağlantıyı e-postanıza da gönderdik.</p>';
            echo '<a class="msy-btn" href="' . esc_url($link) . '">Mimoza Sahne\'yi indir (' . esc_html($mb) . ')</a>';
            echo '<p class="msy-small">Kurulum: dosyaya çift tıklayın. Windows "bilgisayarınızı korudu" derse "Ek bilgi" ve "Yine de çalıştır" deyin. Program bundan sonra kendiliğinden güncellenir.</p></div>';
            echo '<script>setTimeout(function(){location.href=' . wp_json_encode($link) . ';},1200);</script>';
            echo '</div>';
            return ob_get_clean();
        }
        if (!$r) { echo '<p class="msy-err">İndirme yakında açılacak.</p></div>'; return ob_get_clean(); }

        $errs = ['eksik' => 'Lütfen adınızı ve geçerli bir e-posta adresi yazın.', 'kvkk' => 'Devam etmek için aydınlatma metnini onaylayın.', 'bot' => 'Form çok hızlı gönderildi, lütfen tekrar deneyin.', 'surum' => 'Şu anda indirilebilir sürüm yok.'];
        $err = isset($_GET['msy_hata']) ? sanitize_key(wp_unslash($_GET['msy_hata'])) : '';
        if ($err && isset($errs[$err])) echo '<p class="msy-err">' . esc_html($errs[$err]) . '</p>';
        $back = remove_query_arg(['msy_hata', 'msy_t'], (is_ssl() ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? '') . ($_SERVER['REQUEST_URI'] ?? ''));
        $kvkk_link = $s['kvkk_url'] ? '<a href="' . esc_url($s['kvkk_url']) . '" target="_blank" rel="noopener">Aydınlatma metnini</a>' : '<a href="#msy-kvkk">Aydınlatma metnini</a>';
        ?>
        <form class="msy-form" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="msy_form">
            <input type="hidden" name="msy_back" value="<?php echo esc_attr($back); ?>">
            <input type="hidden" name="msy_el" value="0" class="msy-el">
            <p class="msy-hp" aria-hidden="true"><label>Web sitesi <input type="text" name="msy_web" tabindex="-1" autocomplete="off"></label></p>
            <div class="msy-row">
                <label>Adınız <input type="text" name="msy_ad" required maxlength="120" autocomplete="name"></label>
                <label>E-posta adresiniz <input type="email" name="msy_eposta" required maxlength="190" autocomplete="email"></label>
            </div>
            <label>Ne tür videolar hazırlıyorsunuz? <span class="msy-opt">(isteğe bağlı)</span>
                <select name="msy_amac">
                    <option value="">Seçin</option><option>Ders / eğitim</option><option>YouTube</option><option>Şirket tanıtımı</option><option>Sosyal medya (Reels, Shorts)</option><option>Diğer</option>
                </select>
            </label>
            <label class="msy-check"><input type="checkbox" name="msy_kvkk" value="1" required> <span><?php echo wp_kses_post($kvkk_link); ?> okudum, indirme bağlantısının e-postama gönderilmesini kabul ediyorum.</span></label>
            <label class="msy-check"><input type="checkbox" name="msy_bulten" value="1"> <span>Yeni sürüm ve video ipuçları e-postaları almak istiyorum. <span class="msy-opt">(isteğe bağlı)</span></span></label>
            <button type="submit" class="msy-btn">Ücretsiz indir</button>
        </form>
        <?php if (!$s['kvkk_url']) : ?>
        <details class="msy-kvkk" id="msy-kvkk"><summary>Aydınlatma metni</summary>
            <p>Mimoza Sahne indirme formunda verdiğiniz ad ve e-posta adresi, 6698 sayılı KVKK kapsamında veri sorumlusu Mimoza Bilişim tarafından işlenir. Bu bilgiler indirme bağlantısını göndermek ve program hakkındaki sorularınızı yanıtlamak amacıyla, talebinizin yerine getirilmesi için zorunlu olması hukuki sebebine dayanılarak işlenir. Bülten kutusunu işaretlerseniz e-posta adresiniz, açık rızanıza dayanılarak yeni sürüm ve içerik bildirimleri için kullanılır; dilediğiniz an ayrılabilirsiniz. Verileriniz üçüncü kişilerle paylaşılmaz. KVKK'nın 11. maddesindeki haklarınız için <?php echo esc_html(get_option('admin_email')); ?> adresine yazabilirsiniz.</p>
        </details>
        <?php endif; ?>
        <script>(function(){var s=Date.now();document.querySelectorAll('.msy-form').forEach(function(f){f.addEventListener('submit',function(){f.querySelector('.msy-el').value=((Date.now()-s)/1000).toFixed(1);});});})();</script>
        </div>
        <?php
        return ob_get_clean();
    }
}
MSY_Download::init();
