<?php
/**
 * Starter Theme bootstrap.
 *
 * @package StarterTheme
 */

defined( 'ABSPATH' ) || exit;

// Kept in sync with the `Version:` header in style.css by `npm run release` (R7.6).
define( 'STARTER_THEME_VERSION', '1.0.0' );
define( 'STARTER_THEME_DIR', __DIR__ );

if ( file_exists( __DIR__ . '/vendor/autoload.php' ) ) {
	require_once __DIR__ . '/vendor/autoload.php';
} else {
	// Fallback PSR-4 autoloader so the theme still loads before `composer install` has run.
	spl_autoload_register(
		static function ( $class_name ) {
			$prefix = 'StarterTheme\\';
			if ( 0 === strpos( $class_name, $prefix ) ) {
				$file = __DIR__ . '/inc/' . str_replace( '\\', '/', substr( $class_name, strlen( $prefix ) ) ) . '.php';
				if ( file_exists( $file ) ) {
					require_once $file;
				}
			}
		}
	);
}

StarterTheme\Theme::boot();
