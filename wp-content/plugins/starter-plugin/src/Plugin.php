<?php
/**
 * Main plugin class.
 *
 * @package StarterPlugin
 */

namespace StarterPlugin;

defined( 'ABSPATH' ) || exit;

/**
 * Wires up the plugin's features.
 */
final class Plugin {

	/**
	 * Shared instance.
	 *
	 * @var Plugin|null
	 */
	private static ?Plugin $instance = null;

	/**
	 * Get the shared instance.
	 */
	public static function instance(): Plugin {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Hook everything up.
	 */
	public function register(): void {
		add_action( 'init', array( $this, 'load_textdomain' ) );

		( new Assets( STARTER_PLUGIN_DIR, plugins_url( '', STARTER_PLUGIN_FILE ), STARTER_PLUGIN_VERSION ) )->register();
		( new Blocks( STARTER_PLUGIN_DIR ) )->register();
	}

	/**
	 * Load translations.
	 */
	public function load_textdomain(): void {
		load_plugin_textdomain( 'starter-plugin', false, dirname( plugin_basename( STARTER_PLUGIN_FILE ) ) . '/languages' );
	}

	/**
	 * Runs on plugin activation.
	 */
	public static function activate(): void {
		update_option( 'starter_plugin_version', STARTER_PLUGIN_VERSION );
		flush_rewrite_rules();
	}

	/**
	 * Runs on plugin deactivation.
	 */
	public static function deactivate(): void {
		flush_rewrite_rules();
	}
}
