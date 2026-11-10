<?php
/**
 * Plugin Name: Mimoza Sahne Yayın
 * Description: Mimoza Sahne programının indirme sayfası (e-postalı, KVKK uyumlu) ve otomatik güncelleme sunucusu. Yeni sürümü panelden yükleyin; programlar kendiliğinden güncellenir.
 * Version: 1.0.0
 * Author: Mimoza Bilişim
 * Author URI: https://mimozabilisim.com
 * License: MIT
 * Text Domain: mimoza-sahne-yayin
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) exit;

define('MSY_VERSION', '1.0.0');
define('MSY_DIR', plugin_dir_path(__FILE__));
define('MSY_URL', plugin_dir_url(__FILE__));

require_once MSY_DIR . 'includes/store.php';
require_once MSY_DIR . 'includes/admin.php';
require_once MSY_DIR . 'includes/download.php';

register_activation_hook(__FILE__, ['MSY_Store', 'install']);
add_action('plugins_loaded', ['MSY_Store', 'maybe_upgrade']);
