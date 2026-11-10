<?php
// Yönetim paneli: durum, yeni sürüm yükleme (parça parça), aboneler, ayarlar.
if (!defined('ABSPATH')) exit;

class MSY_Admin {
    public static function init() {
        add_action('admin_menu', [__CLASS__, 'menu']);
        add_action('wp_ajax_msy_chunk', [__CLASS__, 'ajax_chunk']);
        add_action('wp_ajax_msy_finish', [__CLASS__, 'ajax_finish']);
        add_action('admin_post_msy_csv', [__CLASS__, 'csv']);
        add_action('admin_post_msy_save', [__CLASS__, 'save_settings']);
    }

    public static function menu() {
        add_menu_page('Mimoza Sahne', 'Mimoza Sahne', 'manage_options', 'mimoza-sahne', [__CLASS__, 'page'], 'dashicons-video-alt2', 58);
    }

    // Sunucunun kabul ettiği en büyük parça (PHP yükleme sınırının altında kalır)
    private static function chunk_size() {
        $max = (int) wp_max_upload_size();
        return max(512 * 1024, min(8 * 1048576, (int) floor($max * 0.8)));
    }

    public static function page() {
        if (!current_user_can('manage_options')) return;
        $tab = isset($_GET['tab']) ? sanitize_key($_GET['tab']) : 'surum';
        $r = MSY_Store::current();
        $st = MSY_Store::count_downloads();
        wp_enqueue_script('msy-admin', MSY_URL . 'assets/admin.js', [], MSY_VERSION, true);
        wp_localize_script('msy-admin', 'MSY', [
            'ajax' => admin_url('admin-ajax.php'), 'nonce' => wp_create_nonce('msy_upload'), 'chunk' => self::chunk_size(),
            'current' => $r ? $r['version'] : '',
        ]);
        $base = admin_url('admin.php?page=mimoza-sahne');
        echo '<div class="wrap msy-admin"><h1>Mimoza Sahne</h1>';
        echo '<style>.msy-admin .card{max-width:860px}.msy-stats{display:flex;gap:16px;flex-wrap:wrap}.msy-stats div{background:#fff;border:1px solid #dcdcde;border-radius:6px;padding:12px 16px;min-width:140px}.msy-stats b{display:block;font-size:22px}.msy-bar{height:12px;background:#e5e5e5;border-radius:6px;overflow:hidden;max-width:520px}.msy-bar i{display:block;height:100%;width:0;background:#FED501}.msy-code{font-family:monospace;background:#f6f7f7;padding:2px 6px}</style>';
        echo '<nav class="nav-tab-wrapper">';
        foreach (['surum' => 'Sürüm ve güncelleme', 'aboneler' => 'İndirenler', 'ayarlar' => 'Ayarlar'] as $k => $v) {
            echo '<a class="nav-tab' . ($tab === $k ? ' nav-tab-active' : '') . '" href="' . esc_url(add_query_arg('tab', $k, $base)) . '">' . esc_html($v) . '</a>';
        }
        echo '</nav>';

        if ($tab === 'surum') {
            echo '<div class="msy-stats" style="margin:16px 0">';
            echo '<div><b>' . ($r ? esc_html($r['version']) : '—') . '</b>Yayındaki sürüm</div>';
            echo '<div><b>' . (int) $st['kisi'] . '</b>İndiren kişi</div>';
            echo '<div><b>' . (int) $st['indirme'] . '</b>Toplam indirme</div>';
            echo '<div><b>' . (int) $st['bulten'] . '</b>Bülten onayı</div>';
            echo '<div><b>' . (int) $st['guncelleme'] . '</b>Güncelleme denetimi</div>';
            echo '</div>';
            echo '<div class="card"><h2>Yeni sürüm yükle</h2>';
            echo '<p>Masaüstünüzdeki <b>Mimoza-Sahne-Kurulum-x.y.z.exe</b> dosyasını seçip <b>Yayına al</b> deyin. Dosya küçük parçalar hâlinde yüklenir, sunucunun yükleme sınırına takılmaz. Yayına alınca programlar bir sonraki açılışta kendiliğinden güncellenir.</p>';
            echo '<table class="form-table"><tr><th>Kurulum dosyası</th><td><input type="file" id="msy-file" accept=".exe"></td></tr>';
            echo '<tr><th>Fark dosyası <span style="font-weight:400">(isteğe bağlı)</span></th><td><input type="file" id="msy-blockmap" accept=".blockmap"><p class="description">Aynı adlı <span class="msy-code">.blockmap</span> dosyası. Yüklerseniz güncellemede yalnızca değişen parçalar iner.</p></td></tr>';
            echo '<tr><th>Sürüm</th><td><input type="text" id="msy-version" class="regular-text" placeholder="1.3.0"><p class="description">Dosya adından otomatik doldurulur.</p></td></tr>';
            echo '<tr><th>Yenilikler</th><td><textarea id="msy-notes" rows="4" class="large-text" placeholder="Programdaki güncelleme bildiriminde görünür."></textarea></td></tr></table>';
            echo '<p><button class="button button-primary" id="msy-go">Yayına al</button></p>';
            echo '<div class="msy-bar" hidden id="msy-bar"><i></i></div><p id="msy-status"></p></div>';
            echo '<div class="card"><h2>Bilgiler</h2>';
            echo '<p>İndirme kutusu için sayfaya şu kısa kodu ekleyin: <span class="msy-code">[mimoza_sahne]</span></p>';
            echo '<p>Programın güncelleme adresi: <span class="msy-code">' . esc_html(MSY_Download::update_base()) . '</span></p>';
            echo '<p>Sunucunun tek seferde kabul ettiği en büyük dosya: ' . esc_html(size_format(wp_max_upload_size())) . ' (yükleme ' . esc_html(size_format(self::chunk_size())) . '\'lık parçalarla yapılır).</p>';
            if ($r) echo '<p>Yayındaki dosya: <a href="' . esc_url(MSY_Store::url() . $r['file']) . '">' . esc_html($r['file']) . '</a> · ' . esc_html(size_format($r['size'])) . ' · ' . esc_html(wp_date('j F Y H:i', $r['time'])) . '</p>';
            $h = (array) get_option('msy_history', []);
            if ($h) {
                echo '<p><b>Geçmiş:</b> ';
                echo esc_html(implode(' · ', array_map(fn($x) => $x['version'] . ' (' . wp_date('j M', $x['time']) . ')', array_slice($h, 0, 8))));
                echo '</p>';
            }
            echo '</div>';
        } elseif ($tab === 'aboneler') {
            global $wpdb;
            $t = MSY_Store::table();
            $rows = $wpdb->get_results("SELECT * FROM $t ORDER BY son_indirme DESC LIMIT 300");
            echo '<p style="margin:16px 0"><a class="button" href="' . esc_url(wp_nonce_url(admin_url('admin-post.php?action=msy_csv'), 'msy_csv')) . '">CSV olarak indir</a> <span class="description">Bülten gönderirken yalnızca "Bülten: evet" olanlara yazın.</span></p>';
            echo '<table class="widefat striped"><thead><tr><th>Ad</th><th>E-posta</th><th>Amaç</th><th>Bülten</th><th>İndirme</th><th>Sürüm</th><th>Son indirme</th></tr></thead><tbody>';
            if (!$rows) echo '<tr><td colspan="7">Henüz kimse indirmedi.</td></tr>';
            foreach ($rows as $row) {
                echo '<tr><td>' . esc_html($row->ad) . '</td><td><a href="mailto:' . esc_attr($row->eposta) . '">' . esc_html($row->eposta) . '</a></td><td>' . esc_html($row->amac) . '</td><td>' . ($row->bulten ? 'evet' : '—') . '</td><td>' . (int) $row->indirme . '</td><td>' . esc_html($row->surum) . '</td><td>' . esc_html($row->son_indirme) . '</td></tr>';
            }
            echo '</tbody></table>';
        } else {
            $s = MSY_Store::settings();
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '"><input type="hidden" name="action" value="msy_save">';
            wp_nonce_field('msy_save');
            echo '<table class="form-table">';
            $f = function ($key, $label, $type = 'text', $desc = '') use ($s) {
                echo '<tr><th><label for="msy-' . esc_attr($key) . '">' . esc_html($label) . '</label></th><td>';
                if ($type === 'textarea') echo '<textarea id="msy-' . esc_attr($key) . '" name="' . esc_attr($key) . '" rows="10" class="large-text">' . esc_textarea($s[$key] ?? '') . '</textarea>';
                else echo '<input id="msy-' . esc_attr($key) . '" type="' . esc_attr($type) . '" name="' . esc_attr($key) . '" value="' . esc_attr($s[$key] ?? '') . '" class="regular-text">';
                if ($desc) echo '<p class="description">' . wp_kses_post($desc) . '</p>';
                echo '</td></tr>';
            };
            $f('baslik', 'Kutu başlığı');
            $f('aciklama', 'Kutu açıklaması');
            $f('sayfa_url', 'İndirme sayfasının adresi', 'url', 'Geçersiz bağlantıyla gelenler buraya yönlendirilir. Örn. https://mimozabilisim.com/mimoza-sahne/');
            $f('kvkk_url', 'Aydınlatma metni sayfası', 'url', 'Boş bırakırsanız kutunun altında kısa bir aydınlatma metni gösterilir.');
            $f('gonderen', 'E-posta gönderen adı');
            $f('eposta_konu', 'E-posta konusu');
            $f('eposta_metin', 'E-posta metni', 'textarea', 'Kullanılabilir alanlar: <span class="msy-code">{ad}</span> <span class="msy-code">{baglanti}</span> <span class="msy-code">{surum}</span>. E-postalar ulaşmıyorsa bir SMTP eklentisi kurun (ör. WP Mail SMTP).');
            echo '</table>';
            submit_button('Kaydet');
            echo '</form>';
        }
        echo '</div>';
    }

    private static function check() {
        if (!current_user_can('manage_options')) wp_send_json_error('Yetkiniz yok.', 403);
        check_ajax_referer('msy_upload', 'nonce');
    }
    private static function upload_id() {
        $id = isset($_POST['id']) ? preg_replace('/[^a-z0-9]/', '', strtolower(wp_unslash($_POST['id']))) : '';
        if (strlen($id) < 8 || strlen($id) > 40) wp_send_json_error('Geçersiz yükleme.');
        return $id;
    }

    // Bir parça: dosyanın sonuna eklenir
    public static function ajax_chunk() {
        self::check();
        $id = self::upload_id();
        $kind = isset($_POST['kind']) && $_POST['kind'] === 'blockmap' ? 'blockmap' : 'exe';
        $index = isset($_POST['index']) ? (int) $_POST['index'] : -1;
        if (empty($_FILES['chunk']['tmp_name']) || !is_uploaded_file($_FILES['chunk']['tmp_name'])) wp_send_json_error('Parça alınamadı. Sunucu yükleme sınırını kontrol edin.');
        $path = MSY_Store::tmp_dir() . '/' . $id . '.' . $kind;
        if ($index === 0) @unlink($path);
        $expected = file_exists($path) ? filesize($path) : 0;
        $offset = isset($_POST['offset']) ? (int) $_POST['offset'] : 0;
        if ($offset !== $expected) wp_send_json_error(['msg' => 'Parça sırası bozuldu.', 'have' => $expected]);
        $in = fopen($_FILES['chunk']['tmp_name'], 'rb');
        $out = fopen($path, 'ab');
        if (!$in || !$out) wp_send_json_error('Geçici dosya yazılamadı.');
        stream_copy_to_stream($in, $out);
        fclose($in); fclose($out);
        clearstatcache(true, $path);
        wp_send_json_success(['have' => filesize($path)]);
    }

    // Yükleme bitti: doğrula ve yayına al
    public static function ajax_finish() {
        self::check();
        @set_time_limit(300);
        $id = self::upload_id();
        $version = isset($_POST['version']) ? sanitize_text_field(wp_unslash($_POST['version'])) : '';
        if (!preg_match('/^\d+\.\d+\.\d+$/', $version)) wp_send_json_error('Sürüm 1.3.0 biçiminde olmalı.');
        $cur = MSY_Store::current();
        if ($cur && version_compare($version, $cur['version'], '<=')) wp_send_json_error('Bu sürüm yayındaki sürümden (' . $cur['version'] . ') yeni olmalı. Programlar yalnızca daha yeni sürüme güncellenir.');
        $size = isset($_POST['size']) ? (int) $_POST['size'] : 0;
        $exe = MSY_Store::tmp_dir() . '/' . $id . '.exe';
        clearstatcache();
        if (!file_exists($exe) || filesize($exe) !== $size || $size < 1048576) wp_send_json_error('Dosya eksik yüklendi. Tekrar deneyin.');
        $fh = fopen($exe, 'rb');
        $magic = fread($fh, 2);
        fclose($fh);
        if ($magic !== 'MZ') { @unlink($exe); wp_send_json_error('Bu bir Windows kurulum dosyası değil.'); }
        $bm = MSY_Store::tmp_dir() . '/' . $id . '.blockmap';
        $notes = isset($_POST['notes']) ? sanitize_textarea_field(wp_unslash($_POST['notes'])) : '';
        $r = MSY_Store::publish($exe, $version, $notes, file_exists($bm) ? $bm : null);
        if (is_wp_error($r)) wp_send_json_error($r->get_error_message());
        foreach (glob(MSY_Store::tmp_dir() . '/*') as $f) { if (is_file($f) && basename($f) !== 'index.html' && basename($f) !== '.htaccess' && filemtime($f) < time() - 86400) @unlink($f); }
        wp_send_json_success(['version' => $r['version'], 'size' => size_format($r['size'])]);
    }

    public static function csv() {
        if (!current_user_can('manage_options')) wp_die('Yetkiniz yok.');
        check_admin_referer('msy_csv');
        global $wpdb;
        $t = MSY_Store::table();
        $rows = $wpdb->get_results("SELECT ad, eposta, amac, bulten, indirme, surum, olusturma, son_indirme FROM $t ORDER BY id", ARRAY_A);
        nocache_headers();
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename=mimoza-sahne-indirenler-' . gmdate('Y-m-d') . '.csv');
        $out = fopen('php://output', 'w');
        fwrite($out, "\xEF\xBB\xBF");
        fputcsv($out, ['Ad', 'E-posta', 'Amaç', 'Bülten', 'İndirme', 'Sürüm', 'İlk indirme', 'Son indirme'], ';');
        foreach ($rows as $r) { $r['bulten'] = $r['bulten'] ? 'evet' : 'hayır'; fputcsv($out, array_values($r), ';'); }
        fclose($out);
        exit;
    }

    public static function save_settings() {
        if (!current_user_can('manage_options')) wp_die('Yetkiniz yok.');
        check_admin_referer('msy_save');
        $s = MSY_Store::settings();
        foreach (['baslik', 'aciklama', 'gonderen', 'eposta_konu'] as $k) $s[$k] = sanitize_text_field(wp_unslash($_POST[$k] ?? ''));
        foreach (['kvkk_url', 'sayfa_url'] as $k) $s[$k] = esc_url_raw(wp_unslash($_POST[$k] ?? ''));
        $s['eposta_metin'] = sanitize_textarea_field(wp_unslash($_POST['eposta_metin'] ?? ''));
        update_option('msy_settings', $s);
        wp_safe_redirect(admin_url('admin.php?page=mimoza-sahne&tab=ayarlar&kaydedildi=1'));
        exit;
    }
}
MSY_Admin::init();
