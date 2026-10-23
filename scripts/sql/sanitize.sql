-- Scrubs personal data after `npm run db:import -- --sanitize` (R5.9).
-- {{prefix}}, {{admin_user}} and {{admin_email}} are filled in by the import script.
-- WooCommerce order and customer tables are truncated separately when they exist.

-- User emails and passwords (except the local admin).
UPDATE `{{prefix}}users`
	SET user_email = CONCAT('user', ID, '@example.test'),
		user_pass = MD5(CONCAT(RAND(), UUID()))
	WHERE user_login <> '{{admin_user}}';

-- Billing/shipping details stored on users.
DELETE FROM `{{prefix}}usermeta`
	WHERE meta_key LIKE 'billing\_%' OR meta_key LIKE 'shipping\_%';

-- Comment author details.
UPDATE `{{prefix}}comments`
	SET comment_author_email = CONCAT('commenter', comment_ID, '@example.test'),
		comment_author_IP = '';

-- Legacy (post-based) WooCommerce orders and subscriptions.
DELETE pm FROM `{{prefix}}postmeta` pm
	JOIN `{{prefix}}posts` p ON p.ID = pm.post_id
	WHERE p.post_type IN ('shop_order', 'shop_order_refund', 'shop_subscription');
DELETE FROM `{{prefix}}posts`
	WHERE post_type IN ('shop_order', 'shop_order_refund', 'shop_subscription');

-- Site admin email, so nothing is sent to the client.
UPDATE `{{prefix}}options`
	SET option_value = '{{admin_email}}'
	WHERE option_name IN ('admin_email', 'new_admin_email');
