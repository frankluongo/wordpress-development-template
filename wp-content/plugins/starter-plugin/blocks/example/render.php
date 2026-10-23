<?php
/**
 * Front-end markup for the Example block, made interactive by view.js.
 *
 * @package StarterPlugin
 *
 * @var array $attributes Block attributes.
 */

defined( 'ABSPATH' ) || exit;

$starter_plugin_message_id = wp_unique_id( 'starter-plugin-example-' );
?>
<div
	<?php echo get_block_wrapper_attributes(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
	data-wp-interactive="starter-plugin/example"
	<?php echo wp_interactivity_data_wp_context( array( 'isOpen' => false ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
>
	<button
		type="button"
		class="wp-block-starter-plugin-example__button"
		aria-controls="<?php echo esc_attr( $starter_plugin_message_id ); ?>"
		data-wp-on--click="actions.toggle"
		data-wp-bind--aria-expanded="context.isOpen"
	>
		<?php echo esc_html( $attributes['label'] ?? '' ); ?>
	</button>
	<p
		id="<?php echo esc_attr( $starter_plugin_message_id ); ?>"
		class="wp-block-starter-plugin-example__message"
		data-wp-bind--hidden="!context.isOpen"
		hidden
	>
		<?php echo esc_html( $attributes['message'] ?? '' ); ?>
	</p>
</div>
