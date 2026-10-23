<?php
/**
 * Plugin Name:       Starter Plugin
 * Description:       Custom functionality for this project.
 * Version:           1.0.0
 * Requires at least: 6.8
 * Requires PHP:      8.1
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       starter-plugin
 * Domain Path:       /languages
 *
 * @package StarterPlugin
 */

defined( 'ABSPATH' ) || exit;

// Kept in sync with the `Version:` header above by `npm run release` (R7.6).
define( 'STARTER_PLUGIN_VERSION', '1.0.0' );
define( 'STARTER_PLUGIN_FILE', __FILE__ );
define( 'STARTER_PLUGIN_DIR', __DIR__ );

if ( file_exists( __DIR__ . '/vendor/autoload.php' ) ) {
	require_once __DIR__ . '/vendor/autoload.php';
} else {
	// Fallback PSR-4 autoloader so the plugin still loads before `composer install` has run.
	spl_autoload_register(
		static function ( $class_name ) {
			$prefix = 'StarterPlugin\\';
			if ( 0 === strpos( $class_name, $prefix ) ) {
				$file = __DIR__ . '/src/' . str_replace( '\\', '/', substr( $class_name, strlen( $prefix ) ) ) . '.php';
				if ( file_exists( $file ) ) {
					require_once $file;
				}
			}
		}
	);
}

register_activation_hook( __FILE__, array( StarterPlugin\Plugin::class, 'activate' ) );
register_deactivation_hook( __FILE__, array( StarterPlugin\Plugin::class, 'deactivate' ) );

StarterPlugin\Plugin::instance()->register();
