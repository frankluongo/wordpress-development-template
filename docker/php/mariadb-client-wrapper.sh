#!/bin/sh
# Installed as /usr/local/bin/{mariadb,mysql,mariadb-dump,mysqldump,...} ahead of /usr/bin.
# Newer MariaDB clients require TLS by default; the local database has none, and WP-CLI
# runs clients with --no-defaults, so option files can't turn it off. Add --skip-ssl here.
real="/usr/bin/$(basename "$0")"
case "$1" in
	--no-defaults | --print-defaults | --defaults-file=* | --defaults-extra-file=* | --defaults-group-suffix=*)
		# These must stay first.
		first="$1"
		shift
		exec "$real" "$first" --skip-ssl "$@"
		;;
esac
exec "$real" --skip-ssl "$@"
