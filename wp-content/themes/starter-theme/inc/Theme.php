<?php
/**
 * Theme setup.
 *
 * @package StarterTheme
 */

namespace StarterTheme;

defined( 'ABSPATH' ) || exit;

/**
 * Registers theme supports and assets.
 */
final class Theme {

	/**
	 * Boot the theme.
	 */
	public static function boot(): void {
		( new self() )->register();
	}

	/**
	 * Hook everything up.
	 */
	public function register(): void {
		add_action( 'after_setup_theme', array( $this, 'setup' ) );

		( new Assets( STARTER_THEME_DIR, get_template_directory_uri(), STARTER_THEME_VERSION ) )->register();
	}

	/**
	 * Theme supports and translations.
	 */
	public function setup(): void {
		load_theme_textdomain( 'starter-theme', STARTER_THEME_DIR . '/languages' );

		add_theme_support( 'wp-block-styles' );
		add_theme_support( 'editor-styles' );
		add_theme_support( 'responsive-embeds' );
	}
}
