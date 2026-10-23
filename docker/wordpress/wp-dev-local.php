<?php
/**
 * Plugin Name: Local Development
 * Description: Routes outgoing mail to Mailpit. Loaded only in the local Docker stack.
 *
 * @package wp-dev-template
 */

add_action(
	'phpmailer_init',
	static function ( $phpmailer ) {
		$phpmailer->isSMTP();
		$phpmailer->Host     = getenv( 'SMTP_HOST' ) ? getenv( 'SMTP_HOST' ) : 'mailpit'; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
		$phpmailer->Port     = (int) ( getenv( 'SMTP_PORT' ) ? getenv( 'SMTP_PORT' ) : 1025 ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
		$phpmailer->SMTPAuth = false; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
		$phpmailer->SMTPAutoTLS = false; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase
	}
);
