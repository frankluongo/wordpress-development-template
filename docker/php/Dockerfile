# PHP-FPM image for local WordPress development.
# PHP_VERSION comes from .env so the stack can match the client's host (R2.4).
ARG PHP_VERSION=8.3

FROM mlocati/php-extension-installer:2.12 AS extension-installer
FROM composer:2.10 AS composer

FROM php:${PHP_VERSION}-fpm

ARG WP_CLI_VERSION=2.12.0

COPY --from=extension-installer /usr/bin/install-php-extensions /usr/local/bin/
COPY --from=composer /usr/bin/composer /usr/local/bin/composer

# Extensions WordPress recommends. Xdebug is installed but stays off until XDEBUG_MODE is set (R2.10).
RUN install-php-extensions bcmath exif gd imagick intl mysqli opcache zip xdebug

RUN apt-get update \
	&& apt-get install -y --no-install-recommends mariadb-client less rsync unzip zip \
	&& rm -rf /var/lib/apt/lists/* \
	# WP-CLI may call mysql/mysqldump; newer MariaDB clients only ship mariadb/mariadb-dump.
	&& for bin in mysql:mariadb mysqldump:mariadb-dump mysqlcheck:mariadb-check mysqladmin:mariadb-admin; do \
		[ -e "/usr/bin/${bin%%:*}" ] || ln -s "${bin#*:}" "/usr/bin/${bin%%:*}"; \
	done

RUN curl -fsSL -o /usr/local/bin/wp \
		"https://github.com/wp-cli/wp-cli/releases/download/v${WP_CLI_VERSION}/wp-cli-${WP_CLI_VERSION}.phar" \
	&& chmod +x /usr/local/bin/wp

COPY php.ini /usr/local/etc/php/conf.d/zz-wp-dev.ini
COPY xdebug.ini /usr/local/etc/php/conf.d/zz-xdebug.ini
COPY php-fpm.conf /usr/local/etc/php-fpm.d/zz-wp-dev.conf
COPY --chmod=755 mariadb-client-wrapper.sh /usr/local/bin/mariadb-client-wrapper
RUN for bin in mariadb mysql mariadb-dump mysqldump mariadb-check mysqlcheck mariadb-admin mysqladmin; do \
		ln -s mariadb-client-wrapper "/usr/local/bin/${bin}"; \
	done
COPY --chmod=755 entrypoint.sh /usr/local/bin/wp-dev-entrypoint

ENV WP_CLI_CACHE_DIR=/tmp/wp-cli-cache \
	COMPOSER_HOME=/tmp/composer \
	PAGER=cat

WORKDIR /var/www/html

ENTRYPOINT ["wp-dev-entrypoint"]
CMD ["php-fpm"]
