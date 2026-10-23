# Matching production

The closer your local stack is to the client's server, the fewer surprises at deploy time. Everything below is set per project and committed (except premium plugin zips).

## Find the production versions

In the client's wp-admin, open **Tools → Site Health → Info**:

| Section | What to copy | Where it goes |
|---------|--------------|---------------|
| WordPress | Version | `"core"` in `wp-dependencies.json` |
| Server | PHP version | `PHP_VERSION` in `.env` and `.env.example` |
| Database | Server version, e.g. `10.6.18-MariaDB` or `8.0.36` | `DB_IMAGE` (`mariadb` or `mysql`) and `DB_VERSION` (e.g. `10.6`, `8.0`) |
| Active Plugins | Each plugin and its version | `"plugins"` in `wp-dependencies.json` |
| Active Theme / Parent Theme | Name and version | `"themes"` (only if it isn't your project theme) |

Site Health's **Copy site info to clipboard** button copies all of it as text.

With SSH access, WP-CLI gives the same information:

```sh
wp core version
wp eval 'echo PHP_VERSION;'
wp db query 'SELECT VERSION();'
wp plugin list --fields=name,version,status
```

After changing `PHP_VERSION`, `DB_IMAGE`/`DB_VERSION` or the core version, run `npm run up`. A database engine change needs `npm run reset`, since data files aren't compatible between engines.

## Declare plugins and themes

`wp-dependencies.json` pins every third-party plugin and theme:

```json
{
  "core": "6.8.3",
  "plugins": {
    "woocommerce": "9.8.5",
    "wordpress-seo": "25.2",
    "advanced-custom-fields-pro": { "source": "premium", "version": "6.4.2" }
  },
  "themes": {}
}
```

- **wordpress.org** plugins and themes are `"slug": "version"`. The slug is the folder name and the part of the URL after `wordpress.org/plugins/`.
- **Premium** ones are `{ "source": "premium", "version": "…" }` (see below).

Run `npm run plugins:install` to install anything missing or at a different version. It also runs on `npm run up` and after `npm run reset`. Activation is left to the database.

After importing a client database, `npm run plugins:check` compares the active plugins with this file and offers to add what's missing.

## Premium plugins

Paid plugins can't be downloaded automatically and must never be committed.

1. Download the exact production version from the vendor's account page, or from the client's server or a full-site backup.
2. Save it as `premium-plugins/<slug>-<version>.zip` (or `<slug>.zip`). The zip's top folder must be the plugin slug.
3. Declare it in `wp-dependencies.json` as above.

On a new machine, `npm run plugins:install` lists exactly which zips are missing and what to name them. When a client backup zip includes `wp-content/plugins`, `db:import` offers to save premium plugins from it into `premium-plugins/` for you.

## The web server

Local requests go through nginx with settings common on managed WordPress hosts: pretty permalinks, gzip, and a large upload size. If production runs Apache with custom `.htaccess` rules, add the equivalent rules to `docker/nginx/default.conf.template`.
