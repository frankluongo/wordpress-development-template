#!/bin/sh
# Prepares WordPress before php-fpm starts:
#   1. downloads the pinned core version into the `wordpress` volume (R4.5),
#   2. waits for the database,
#   3. installs WordPress and activates the project theme/plugin on first run (R2.8).
# Third-party plugins from wp-dependencies.json are installed by `npm run up` afterwards.
set -e

cd /var/www/html
rm -f /tmp/wp-dev-ready

wp_cli() {
	runuser -u www-data -- wp "$@"
}

# Docker creates bind-mount parent directories as root; WordPress needs to write to them.
mkdir -p wp-content/plugins wp-content/themes wp-content/mu-plugins wp-content/uploads wp-content/upgrade
chown www-data:www-data . wp-content wp-content/plugins wp-content/themes wp-content/mu-plugins wp-content/upgrade
chown -R www-data:www-data wp-content/uploads 2>/dev/null || true

# Skip setup for one-off commands (e.g. `docker compose run php bash`).
if [ "$1" != "php-fpm" ]; then
	exec "$@"
fi

installed_version=""
if [ -f wp-includes/version.php ]; then
	installed_version=$(sed -n "s/^\$wp_version = '\(.*\)';/\1/p" wp-includes/version.php)
fi

if [ -z "$installed_version" ] || { [ "$WP_VERSION" != "latest" ] && [ "$installed_version" != "$WP_VERSION" ]; }; then
	echo "[wp-dev] Downloading WordPress ${WP_VERSION} (installed: ${installed_version:-none})"
	if [ "$WP_VERSION" = "latest" ]; then
		wp_cli core download --skip-content --force
	else
		wp_cli core download --version="$WP_VERSION" --skip-content --force
	fi
fi

echo "[wp-dev] Waiting for the database"
tries=0
until wp_cli db query "SELECT 1" >/dev/null 2>&1; do
	tries=$((tries + 1))
	if [ "$tries" -ge 60 ]; then
		echo "[wp-dev] The database did not become available. Check \`docker compose logs db\`." >&2
		exit 1
	fi
	sleep 2
done

if ! wp_cli core is-installed >/dev/null 2>&1; then
	echo "[wp-dev] Installing WordPress at https://${SITE_DOMAIN}"
	wp_cli core install \
		--url="https://${SITE_DOMAIN}" \
		--title="${SITE_TITLE:-WordPress}" \
		--admin_user="${LOCAL_ADMIN_USER:-admin}" \
		--admin_password="${LOCAL_ADMIN_PASSWORD:-password}" \
		--admin_email="${LOCAL_ADMIN_EMAIL:-admin@${SITE_DOMAIN}}" \
		--skip-email
	wp_cli rewrite structure '/%postname%/' --hard >/dev/null

	if [ -n "$THEME_SLUG" ] && [ -f "wp-content/themes/${THEME_SLUG}/style.css" ]; then
		wp_cli theme activate "$THEME_SLUG" || true
	fi
	if [ -n "$PLUGIN_SLUG" ] && [ -f "wp-content/plugins/${PLUGIN_SLUG}/${PLUGIN_SLUG}.php" ]; then
		wp_cli plugin activate "$PLUGIN_SLUG" || true
	fi
fi

# Follow WordPress's debug log into the container output, so `npm run logs`
# (docker compose logs) shows PHP notices next to everything else.
touch wp-content/debug.log && chown www-data:www-data wp-content/debug.log
tail -n 0 -F wp-content/debug.log 2>/dev/null | sed -u 's/^/[debug.log] /' &

touch /tmp/wp-dev-ready
echo "[wp-dev] Ready"

exec docker-php-entrypoint "$@"
