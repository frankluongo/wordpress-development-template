# Importing a client database

`npm run db:import` replaces your local database with a copy of the client's site, and rewrites it so it works at your local HTTPS domain.

## 1. Get a backup

Any of these works:

| Source | What to download |
|--------|------------------|
| **Host control panel** (cPanel, Plesk, SiteGround, Kinsta, WP Engine, Flywheel…) | A full-site backup `.zip`, or a database export (`.sql` / `.sql.gz`). Full-site zips often nest the SQL file, e.g. `backup/public_html/wp-content/mysql.sql` or `database/site.sql`; the import finds it wherever it is. |
| **phpMyAdmin** | Export → Quick → SQL. Compressed (`.sql.gz`) or plain is fine. |
| **UpdraftPlus** | The *Database* file (`backup_…-db.gz`). Plugin, theme and upload archives are separate zips; you only need them for premium plugins or local media. |
| **WP-CLI on the server** | `wp db export - \| gzip > site.sql.gz` |
| **All-in-One WP Migration** | `.wpress` files are a proprietary format and **not supported**. Use phpMyAdmin or the host's export instead. |
| **Duplicator** | The archive `.zip` contains `dup-installer/dup-database__*.sql`; import the zip directly. |

Save it to `.db/imports/` or leave it in `~/Downloads`.

## 2. Import it

```sh
npm run db:import -- ~/Downloads/client-backup.zip
```

Run it without a path to pick from the newest files in `.db/imports/` and `~/Downloads`.

Options:

- `--with-uploads`: when the zip contains `wp-content/uploads`, copy the media into the local site instead of loading it from production.
- `--sanitize`: scrub personal data (see below).
- `--yes`: don't ask questions (uses defaults).

## What the import does

1. **Finds the SQL file**, including in nested folders, and asks if there is more than one.
2. **Inspects the dump.** It detects the table prefix and the production URL (from `home`/`siteurl`, falling back to `PRODUCTION_URL` in `.env`). It also removes statements that would fail locally: `USE`/`CREATE DATABASE`, `DEFINER` clauses, GTID settings, and MySQL 8 collations when you run MariaDB.
3. **Backs up your current database** to `.db/backups/` (with the `.env` values it depends on).
4. **Imports.** If MySQL rejects the dump, your previous database is restored automatically.
5. **Matches the table prefix**, updating `TABLE_PREFIX` in `.env` and restarting PHP.
6. **Rewrites URLs** from production to `https://<your domain>` with WP-CLI's serialization-safe `search-replace`. It covers `https` and `http`, `www` and bare domains, protocol-relative `//domain`, JSON-escaped `https:\/\/domain`, and URL-encoded forms.
7. **Makes the site usable locally:**
   - creates or resets your local admin (`LOCAL_ADMIN_USER` / `LOCAL_ADMIN_PASSWORD`);
   - activates your theme and plugin;
   - deactivates plugins that misbehave locally (`LOCAL_DEACTIVATE_PLUGINS`: caching, security, SMTP, backup).
8. **Media:** missing files under `/wp-content/uploads/` redirect to the production site, so images show without downloading anything. Files you copied with `--with-uploads` are served locally.
9. **Checks plugins** (`npm run plugins:check`): lists plugins active on production but missing locally, and offers to add them to `wp-dependencies.json`. If the zip includes `wp-content/plugins`, versions are read from it, and premium plugins can be saved straight into `premium-plugins/`.

## Undo

```sh
npm run db:restore
```

This restores the most recent pre-import backup, including the table prefix and uploads setting. Pass a path to restore an older backup from `.db/backups/`. The newest `DB_BACKUPS_KEEP` backups (default 10) are kept.

## Sanitizing personal data

`--sanitize` runs [`scripts/sql/sanitize.sql`](../../scripts/sql/sanitize.sql) after the import. It:

- replaces every user's email (except the local admin's) with `user<ID>@example.test` and scrambles their passwords;
- removes billing and shipping details from user meta;
- anonymizes comment authors' emails and IPs;
- deletes WooCommerce orders and empties order, customer and session tables;
- sets the site admin email to your local admin's.

Edit the SQL file to cover project-specific data.

## Pulling over SSH

If you have SSH access, add the server to `.env`:

```sh
REMOTE_PRODUCTION_SSH=user@example.com
REMOTE_PRODUCTION_PATH=/var/www/html
REMOTE_PRODUCTION_URL=https://example.com
```

Then run `npm run db:pull -- production`. It exports with WP-CLI on the server, or with `mysqldump` and the credentials from the server's `wp-config.php`, and imports the result as above. `npm run uploads:pull -- production` copies the uploads folder with rsync.

## Limits

- Page builders that store URLs base64-encoded or in custom formats may keep some production URLs. Check the builder's own "replace URL" tool.
- Multisite databases aren't supported.
