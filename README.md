# WordPress Development Template

A starting point for building a custom WordPress **block theme** and/or **plugin** for a client. One command gives you:

- WordPress in Docker (nginx + PHP-FPM + MariaDB/MySQL + Mailpit), matching the client's production versions.
- HTTPS on a local domain such as `https://acme.test`, with a trusted certificate.
- Hot reloading: CSS updates in place, PHP and template edits reload the page, including in the block editor.
- One-command import of a client's database from a downloaded backup `.zip`.
- One-command versioned release zips, ready to upload in wp-admin.

Several projects can run at once; a single shared proxy routes each domain to its project.

## Prerequisites

- macOS (Apple Silicon or Intel) with [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js](https://nodejs.org/) 24.15 or newer
- [Homebrew](https://brew.sh/), for `mkcert`: `brew install mkcert nss` (`nss` makes Firefox trust the certificates)

You don't need PHP, Composer or MySQL on your machine; they run in containers.

## Quick start

**New project** (from "Use this template" or a fresh clone):

```sh
npm install
npm run setup    # asks for the project name, slugs, namespace and versions
npm run dev      # hot reloading while you work
```

`setup` renames the starter theme and plugin, writes `.env`, creates an HTTPS certificate, adds the domain to `/etc/hosts` (it explains before asking for your password), builds the assets, and starts the site. At the end it prints the site URL and the admin login.

**Existing project** (a collaborator's clone): run the same `npm install && npm run setup`. Because the starters are already renamed, setup skips the questions and only does the local steps.

## Commands

| Command | What it does |
|---------|--------------|
| `npm run setup` | First-time setup (runs once per machine; see above) |
| `npm run up` | Start the site (and the shared proxy). `-- --tools` also starts a database UI at `https://db.<domain>` |
| `npm run down` | Stop the site's containers. Data is kept |
| `npm run reset` | Delete this site's database and WordPress files, then reinstall from scratch. Your code is kept |
| `npm run dev` | Asset dev server with hot reloading. Ctrl+C stops it and rebuilds production assets |
| `npm run build` | Production build of the theme and plugin assets |
| `npm run wp -- <args>` | Run WP-CLI, e.g. `npm run wp -- plugin list` |
| `npm run shell` | Bash shell in the PHP container |
| `npm run logs` | Follow container logs and `wp-content/debug.log` |
| `npm run db:import [file]` | Replace the local database with a client's `.zip`, `.sql` or `.sql.gz`. Options: `--sanitize`, `--with-uploads` |
| `npm run db:export` | Export the local database to `.db/exports/` |
| `npm run db:restore [file]` | Restore the most recent pre-import backup (or a given one) |
| `npm run db:pull -- <env>` | Export a remote database over SSH and import it |
| `npm run uploads:pull -- <env>` | Copy a remote server's uploads into the local site over SSH |
| `npm run plugins:install` | Install the plugins and themes listed in `wp-dependencies.json` |
| `npm run plugins:check` | Compare the database's active plugins/themes with what's installed and declared |
| `npm run release` | Bump the version, build, and create a verified release zip. Options: `--theme`, `--plugin`, `--both`, `--patch`, `--minor`, `--major`, `--version=x.y.z`, `--note="…"`, `--yes` |
| `npm run zip` | Package the current version without bumping. Options: `--theme`, `--plugin` |
| `npm run lint` | PHP_CodeSniffer (WordPress standards), ESLint, Stylelint and a version-sync check |
| `npm run lint:fix` / `npm run format` | Fix what can be fixed automatically / format JS and CSS |
| `npm test` | Unit tests for the tooling scripts |
| `npm run test:integration` | Import and restore the sample client backup on the running site |
| `npm run proxy:up` / `proxy:down` / `proxy:status` | Manage the shared HTTPS proxy (`up` starts it for you) |
| `npm run domains:add` / `domains:remove` | Add or remove this project's certificate and `/etc/hosts` entries |

Pass options after `--`, e.g. `npm run release -- --plugin --patch`.

## How it fits together

```
wp-content/themes/<theme-slug>/     your block theme (bind-mounted into the container)
wp-content/plugins/<plugin-slug>/   your plugin (bind-mounted)
wp-dependencies.json                pinned WordPress core + third-party plugins/themes
premium-plugins/                    paid plugin zips (git-ignored)
.db/                                imports, backups, exports (git-ignored)
docker/                             PHP image, nginx config, wp-config.php
proxy/                              the shared Traefik proxy, installed to ~/.config/wp-dev-proxy
scripts/                            everything behind the npm commands
```

- **WordPress core and third-party plugins** live in a Docker volume, not in the repo. Only your theme and plugin are mounted from disk, which keeps Docker fast on macOS.
- **The shared proxy** (Traefik) owns ports 80 and 443 for every project on the machine. Each project's nginx container registers its domain with Docker labels, so `npm run reset` or `down` in one project never touches another.
- **Assets** are built with `@wordpress/scripts`. Each package has:
  - `blocks/`: every `block.json` is built to `build/blocks/` and registered from the generated `blocks-manifest.php`.
  - `src/` (theme) or `assets/` (plugin): top-level `.js` files are entry points, built to `build/assets/`.
- **Dev/production switch:** while `npm run dev` runs it writes `build/.hot`. The theme's and plugin's `Assets` classes see the file and load assets from `https://hmr.<domain>`. When the file is gone they load the built files. No code changes are needed either way.

## Theme and plugin

The starters are meant to be edited:

- **Theme:** `theme.json`, `templates/`, `parts/`, `patterns/`, `styles/`, plus PHP classes in `inc/` (PSR-4, namespace `<Namespace>\Theme`). `src/frontend.js` and `src/frontend.scss` load on the front end and in the editor canvas; `src/editor.js` and `src/editor.scss` load in the editor UI.
- **Plugin:** the main class lives in `src/Plugin.php` (namespace `<Namespace>\Plugin`), with an example interactive block in `blocks/example/` (`block.json`, a PHP render template, and an Interactivity API script module).

Each package defines one version constant (`<SLUG>_VERSION`) next to its header. `npm run release` keeps the header, constant, `package.json` and `readme.txt` in sync, and `npm run lint` fails if they drift.

## `.env` reference

`.env.example` documents every setting and is shared with your team; `.env` holds your machine's copy and secrets, and is never committed.

| Variable | Default | Purpose |
|----------|---------|---------|
| `COMPOSE_PROJECT_NAME` | project slug | Docker project name; unique per project |
| `SITE_DOMAIN` | `<slug>.test` | Local domain; `hmr.`, `mail.` and `db.` subdomains are added |
| `SITE_TITLE` | project name | Title for fresh installs |
| `THEME_SLUG` / `PLUGIN_SLUG` | from setup | Folder names; empty if the project has no theme or no plugin |
| `PHP_VERSION` | `8.3` | PHP version (8.1–8.4). Run `npm run up` after changing it |
| `WP_VERSION` | empty | Overrides `core` in `wp-dependencies.json` |
| `WP_CLI_VERSION` | `2.12.0` | WP-CLI in the PHP image |
| `DB_IMAGE` / `DB_VERSION` | `mariadb` / `10.11` | `mariadb` or `mysql`, and the image tag |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` / `DB_ROOT_PASSWORD` | `wordpress` / `wordpress` / `wordpress` / `root` | Local database credentials |
| `TABLE_PREFIX` | `wp_` | Updated automatically by `db:import` |
| `LOCAL_ADMIN_USER` / `LOCAL_ADMIN_PASSWORD` / `LOCAL_ADMIN_EMAIL` | `admin` / generated / `admin@<domain>` | Created on install and reset after every import |
| `PRODUCTION_URL` | empty | Used when an import can't detect the production URL |
| `UPLOADS_PROXY_URL` | set by import | Missing media is redirected here; empty turns it off |
| `LOCAL_DEACTIVATE_PLUGINS` | caching, security, SMTP, backup plugins | Deactivated after each import |
| `IMPORT_SCAN_DOWNLOADS` | `true` | `db:import` with no file also looks in `~/Downloads` |
| `DB_BACKUPS_KEEP` | `10` | Pre-import backups kept in `.db/backups` |
| `XDEBUG_MODE` | `off` | e.g. `debug`; run `npm run up` after changing it |
| `PHP_UPLOAD_MAX` / `PHP_MEMORY_LIMIT` / `PHP_MAX_EXECUTION_TIME` | `256M` / `512M` / `300` | PHP limits (also nginx's upload limit) |
| `DEV_SERVER_PORT` | chosen by setup | Host port for `npm run dev`; unique per project |
| `WATCH_POLL` | empty | Poll interval in ms if file changes aren't detected |
| `REMOTE_<ENV>_SSH` / `_PATH` / `_URL` | empty | For `db:pull` and `uploads:pull`, e.g. `REMOTE_PRODUCTION_SSH=user@host` |
| `WP_AUTH_KEY` … `WP_NONCE_SALT` | generated | WordPress salts |

## Guides

- [Importing a client database](docs/guides/importing-a-client-database.md)
- [Matching production](docs/guides/matching-production.md): core, PHP, database and plugin versions, and premium plugins
- [Releasing](docs/guides/releasing.md): versioning and uploading the zip

## Troubleshooting

**The browser says the certificate isn't trusted.**
Run `mkcert -install` and restart the browser. Firefox also needs `brew install nss`, then `mkcert -install` again. Then run `npm run domains:add` to re-issue this project's certificate.

**`https://<domain>` doesn't resolve.**
Check `/etc/hosts` for a `# wp-dev:<domain>` block, or run `npm run domains:add`. A VPN or DNS profile can override `/etc/hosts`; try with it off.
Instead of `/etc/hosts` you can resolve every `.test` domain with dnsmasq:

```sh
brew install dnsmasq
echo 'address=/.test/127.0.0.1' >> "$(brew --prefix)/etc/dnsmasq.conf"
sudo brew services start dnsmasq
sudo mkdir -p /etc/resolver && echo 'nameserver 127.0.0.1' | sudo tee /etc/resolver/test
```

**"Ports 80/443 are already in use".**
Another local server holds them (MAMP, Laravel Valet, Local, Apache, or another proxy). Stop it, then run `npm run up` again. `sudo lsof -nP -iTCP:80 -iTCP:443 -sTCP:LISTEN` shows what's listening.

**CSS or PHP changes aren't picked up.**
Make sure `npm run dev` is running and that you're on `https://<domain>`. If file events are missed (network drives, some sync tools), set `WATCH_POLL=500` in `.env` and restart `npm run dev`.

**Hot reloading stopped after closing the terminal.**
If `npm run dev` didn't exit cleanly, `build/.hot` may be left behind. Run `npm run build`, which clears it.

**Step debugging with Xdebug.**
Set `XDEBUG_MODE=debug` in `.env`, run `npm run up`, then start "Listen for Xdebug (Docker)" in VS Code (`.vscode/launch.json`, with the PHP Debug extension installed). Set it back to `off` when you're done, because Xdebug slows every request.

**Something else.**
`npm run logs` shows PHP errors (`debug.log`) and container output. `npm run reset` rebuilds the environment from scratch without touching your code.
