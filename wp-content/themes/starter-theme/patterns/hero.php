<?php
/**
 * Title: Hero
 * Slug: starter-theme/hero
 * Categories: banner, featured
 * Description: A full-width introduction with a heading, text, and a button.
 *
 * @package StarterTheme
 */

?>
<!-- wp:group {"align":"full","backgroundColor":"muted","style":{"spacing":{"padding":{"top":"6rem","bottom":"6rem"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull has-muted-background-color has-background" style="padding-top:6rem;padding-bottom:6rem">
	<!-- wp:heading {"level":1,"fontSize":"x-large"} -->
	<h1 class="wp-block-heading has-x-large-font-size"><?php esc_html_e( 'A clear headline for the page', 'starter-theme' ); ?></h1>
	<!-- /wp:heading -->

	<!-- wp:paragraph -->
	<p><?php esc_html_e( 'One or two sentences that explain what this site offers.', 'starter-theme' ); ?></p>
	<!-- /wp:paragraph -->

	<!-- wp:buttons -->
	<div class="wp-block-buttons">
		<!-- wp:button -->
		<div class="wp-block-button"><a class="wp-block-button__link wp-element-button"><?php esc_html_e( 'Get started', 'starter-theme' ); ?></a></div>
		<!-- /wp:button -->
	</div>
	<!-- /wp:buttons -->
</div>
<!-- /wp:group -->
