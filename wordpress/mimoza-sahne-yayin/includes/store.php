<?php
// Sürüm dosyaları, abone tablosu ve ayarlar.
if (!defined('ABSPATH')) exit;

class MSY_Store {
    const DB_VERSION = '1';

    // Güncelleme klasörü: wp-content/uploads/mimoza-sahne/  (programlar latest.yml'yi buradan okur)
    public static function dir() {
        $u = wp_upload_dir();
        $d = trailingslashit($u['basedir']) . 'mimoza-sahne';
        if (!is_dir($d)) {
            wp_mkdir_p($d);
            // Dizin listelemeyi kapat
            @file_put_contents($d . '/index.html', '');
        }
        return $d;
    }
    public static function url() {
        $u = wp_upload_dir();
        return trailingslashit(set_url_scheme($u['baseurl'])) . 'mimoza-sahne/';
    }
    public static function tmp_dir() {
        $d = self::dir() . '/.yukleme';
        if (!is_dir($d)) { wp_mkdir_p($d); @file_put_contents($d . '/index.html', ''); @file_put_contents($d . '/.htaccess', "Deny from all\n"); }
        return $d;
    }

    public static function table() {
        global $wpdb;
        return $wpdb->prefix . 'mimoza_sahne_aboneler';
    }

    public static function install() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $t = self::table();
        $charset = $wpdb->get_charset_collate();
        dbDelta("CREATE TABLE $t (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            ad varchar(120) NOT NULL DEFAULT '',
            eposta varchar(190) NOT NULL DEFAULT '',
            amac varchar(60) NOT NULL DEFAULT '',
            bulten tinyint(1) NOT NULL DEFAULT 0,
            indirme int(11) NOT NULL DEFAULT 1,
            surum varchar(30) NOT NULL DEFAULT '',
            ip_hash varchar(64) NOT NULL DEFAULT '',
            olusturma datetime NOT NULL DEFAULT '1970-01-01 00:00:00',
            son_indirme datetime NOT NULL DEFAULT '1970-01-01 00:00:00',
            PRIMARY KEY  (id),
            KEY eposta (eposta)
        ) $charset;");
        update_option('msy_db_version', self::DB_VERSION);
        self::dir();
        if (!get_option('msy_settings')) update_option('msy_settings', self::defaults());
    }
    public static function maybe_upgrade() {
        if (get_option('msy_db_version') !== self::DB_VERSION) self::install();
    }

    public static function defaults() {
        return [
            'baslik' => 'Mimoza Sahne\'yi ücretsiz indirin',
            'aciklama' => 'Ekran kaydı, Türkçe otomatik altyazı ve video kurgusu. Windows 10 ve 11 için.',
            'kvkk_url' => '',
            'sayfa_url' => '',
            'gonderen' => get_bloginfo('name'),
            'eposta_konu' => 'Mimoza Sahne indirme bağlantınız',
            'eposta_metin' => "Merhaba {ad},\n\nMimoza Sahne'yi indirdiğiniz için teşekkürler. İndirme bağlantınız:\n{baglanti}\n\nKurulum: dosyaya çift tıklayın. Windows \"bilgisayarınızı korudu\" uyarısı verirse \"Ek bilgi\" ve \"Yine de çalıştır\" deyin. Program bundan sonra kendiliğinden güncellenir.\n\nVideolarınızı birlikte hazırlamak isterseniz bu e-postayı yanıtlamanız yeterli.\n\nMimoza Bilişim",
        ];
    }
    public static function settings() {
        return wp_parse_args((array) get_option('msy_settings', []), self::defaults());
    }

    // Yayındaki sürüm: ['version','file','size','sha512','date','notes']
    public static function current() {
        $r = get_option('msy_release');
        return is_array($r) && !empty($r['file']) && file_exists(self::dir() . '/' . $r['file']) ? $r : null;
    }

    // electron-updater'ın okuduğu latest.yml (dosya adresi mutlak: kurulum dosyası doğrudan sunucudan iner)
    public static function latest_yml($release) {
        $abs = self::url() . $release['file'];
        $yml = "version: {$release['version']}\n"
            . "files:\n"
            . "  - url: {$abs}\n"
            . "    sha512: {$release['sha512']}\n"
            . "    size: {$release['size']}\n"
            . "path: {$release['file']}\n"
            . "sha512: {$release['sha512']}\n"
            . "releaseDate: '" . gmdate('Y-m-d\TH:i:s.000\Z', $release['time']) . "'\n";
        if (!empty($release['notes'])) {
            $notes = str_replace(["\r\n", "\r"], "\n", $release['notes']);
            $yml .= "releaseNotes: |\n  " . str_replace("\n", "\n  ", $notes) . "\n";
        }
        return $yml;
    }
    public static function write_latest_yml($release) {
        file_put_contents(self::dir() . '/latest.yml', self::latest_yml($release));
    }

    // Yüklenen kurulum dosyasını yayına alır; eski sürümlerden yalnızca bir öncekini saklar.
    public static function publish($tmp_path, $version, $notes, $blockmap_tmp = null) {
        $file = 'Mimoza-Sahne-Kurulum-' . $version . '.exe';
        $dest = self::dir() . '/' . $file;
        if (!@rename($tmp_path, $dest)) {
            if (!@copy($tmp_path, $dest)) return new WP_Error('msy_move', 'Dosya güncelleme klasörüne taşınamadı. Klasör izinlerini kontrol edin.');
            @unlink($tmp_path);
        }
        if ($blockmap_tmp && file_exists($blockmap_tmp)) { @rename($blockmap_tmp, $dest . '.blockmap'); }
        $release = [
            'version' => $version,
            'file' => $file,
            'size' => filesize($dest),
            'sha512' => base64_encode(hash_file('sha512', $dest, true)),
            'time' => time(),
            'notes' => $notes,
        ];
        $prev = self::current();
        update_option('msy_release', $release, false);
        self::write_latest_yml($release);
        // "Son sürüm" adıyla sabit bir kopya bağlantısı: indirme sayfasında hep bu kullanılır
        $history = (array) get_option('msy_history', []);
        array_unshift($history, ['version' => $version, 'time' => $release['time'], 'size' => $release['size']]);
        update_option('msy_history', array_slice($history, 0, 20), false);
        // Fark güncellemesi için bir önceki sürümü sakla, daha eskileri sil
        $keep = [$file, $file . '.blockmap'];
        if ($prev) { $keep[] = $prev['file']; $keep[] = $prev['file'] . '.blockmap'; }
        foreach (glob(self::dir() . '/Mimoza-Sahne-Kurulum-*.exe*') as $f) {
            if (!in_array(basename($f), $keep, true)) @unlink($f);
        }
        return $release;
    }

    public static function add_subscriber($ad, $eposta, $amac, $bulten, $surum) {
        global $wpdb;
        $t = self::table();
        $now = current_time('mysql');
        $ip = isset($_SERVER['REMOTE_ADDR']) ? hash('sha256', wp_salt() . $_SERVER['REMOTE_ADDR']) : '';
        $row = $wpdb->get_row($wpdb->prepare("SELECT id, bulten FROM $t WHERE eposta = %s", $eposta));
        if ($row) {
            $wpdb->query($wpdb->prepare("UPDATE $t SET ad = %s, amac = %s, bulten = %d, indirme = indirme + 1, surum = %s, son_indirme = %s WHERE id = %d",
                $ad, $amac, ($bulten || $row->bulten) ? 1 : 0, $surum, $now, $row->id));
            return (int) $row->id;
        }
        $wpdb->insert($t, ['ad' => $ad, 'eposta' => $eposta, 'amac' => $amac, 'bulten' => $bulten ? 1 : 0, 'indirme' => 1,
            'surum' => $surum, 'ip_hash' => $ip, 'olusturma' => $now, 'son_indirme' => $now]);
        return (int) $wpdb->insert_id;
    }

    public static function count_downloads() {
        global $wpdb;
        $t = self::table();
        return [
            'kisi' => (int) $wpdb->get_var("SELECT COUNT(*) FROM $t"),
            'indirme' => (int) $wpdb->get_var("SELECT COALESCE(SUM(indirme),0) FROM $t"),
            'bulten' => (int) $wpdb->get_var("SELECT COUNT(*) FROM $t WHERE bulten = 1"),
            'guncelleme' => (int) get_option('msy_update_checks', 0),
        ];
    }
}
