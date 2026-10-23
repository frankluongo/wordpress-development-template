# Initial Implementation Plan: WordPress Development Template

Implements [INITIAL_FEATURE_SPEC.md](./INITIAL_FEATURE_SPEC.md). Requirement IDs (e.g. `R5.3`) and acceptance criteria (`AC3`) refer to that document.

## Approach

- **Host requirements:** Docker Desktop, Node 24+, Homebrew (for `mkcert`). No local PHP or Composer; anything PHP runs inside the `php` container.
- **Scripts:** all tooling is Node ESM scripts in `scripts/`, exposed as npm scripts. Scripts shell out to `docker compose exec php wp …` for WordPress operations, so WP-CLI is the single source of truth for database and plugin work.
- **Docker stack:** nginx + PHP-FPM per project. WordPress core lives in a named volume (fast on macOS). Only project-owned code (theme, plugin) is bind-mounted.
- **Shared proxy:** one Traefik container per machine owns ports 80/443. It terminates TLS with `mkcert` certificates and routes by hostname to each project's nginx, plus to the host-side asset dev server.
- **Assets:** npm workspaces for the theme and plugin. One root webpack config extends `@wordpress/scripts` and builds both, served by one dev server per project.
- **Third-party plugins:** a single JSON manifest processed by WP-CLI instead of Composer/WPackagist (see [Decision log](#decision-log)).

---

## Target Repository Layout

```
.
├── package.json                  # root: npm workspaces + all npm scripts
├── webpack.config.js             # extends @wordpress/scripts; builds theme + plugin
├── compose.yaml                  # project stack: nginx, php, db, mailpit, (dbadmin)
├── .env.example
├── wp-dependencies.json          # pinned WP core + third-party plugins/themes (R4.1)
├── composer.json                 # dev tooling only (phpcs, WPCS, phpunit)
├── .distignore                   # release zip exclusions (R8.6)
├── .editorconfig  .gitignore  .prettierrc  .eslintrc  .stylelintrc
├── docker/
│   ├── php/Dockerfile            # php:${PHP_VERSION}-fpm + extensions + wp-cli + composer + xdebug
│   ├── php/php.ini               # raised limits (R2.11)
│   ├── php/xdebug.ini
│   ├── php/entrypoint.sh         # downloads pinned core, installs WP on first run
│   ├── nginx/default.conf.template
│   ├── nginx/uploads-proxy.conf.template
│   └── wordpress/wp-config.php   # env-driven, mounted read-only
├── proxy/                        # shared proxy definition, installed to ~/.config/wp-dev-proxy
│   ├── compose.yaml
│   └── traefik.yml
├── scripts/
│   ├── lib/                      # env, docker exec, prompts, logging, fs helpers
│   ├── setup.mjs
│   ├── proxy.mjs
│   ├── db-import.mjs  db-export.mjs  db-restore.mjs  db-pull.mjs
│   ├── plugins-install.mjs  plugins-check.mjs
│   ├── release.mjs  zip.mjs  verify-zip.mjs
│   └── dev.mjs                   # writes/removes hot files, registers HMR route
├── wp-content/
│   ├── themes/starter-theme/     # workspace
│   └── plugins/starter-plugin/   # workspace
├── tests/
│   ├── scripts/                  # node:test unit tests for script helpers
│   └── fixtures/                 # sample dumps/zips (nested SQL, custom prefix)
├── .db/                          # git-ignored: imports/, backups/, exports/
├── premium-plugins/              # git-ignored: paid plugin zips (R4.2)
├── dist/                         # git-ignored: release zips
└── docs/
```

---

## Phase 0: Verification Spikes

Before any build-out, check the assumptions the rest of the plan depends on. Each spike ends with a short note appended to the [Decision log](#decision-log).

| # | Spike | Outcome needed |
|---|-------|----------------|
| 0.1 | **Newest official block tooling** (Decisions: Block tooling). Check whether `@wordpress/scripts` is still the recommended tool, or whether a newer official WordPress build tool has replaced it. Confirm the current `block.json` `apiVersion` and script-module support. | Package and version to use. |
| 0.2 | **Hot reload through the proxy.** Run `wp-scripts start --hot` (or its successor) on the host, routed through Traefik at `https://hmr.<slug>.test`. Confirm CSS HMR, JS fast refresh, and the websocket connection on the front end, in wp-admin, and **inside the block editor iframe**. Confirm `devServer.watchFiles` can trigger full reloads for PHP, `theme.json`, and `block.json`. | Go, or fall back to Vite for non-block assets (R6.7). |
| 0.3 | **Multi-config dev server.** Confirm one webpack dev server can serve both the theme and plugin configs. | One dev server, or one per workspace with separate HMR hostnames. |
| 0.4 | **Images on arm64.** Confirm `php:<version>-fpm` with `install-php-extensions`, MariaDB/MySQL, Mailpit, and Traefik v3 run natively on Apple Silicon for the PHP versions we expect (8.1–8.4). | Image tags. |
| 0.5 | **mkcert names.** Confirm a certificate for `<slug>.test` + `*.<slug>.test` is trusted by Chrome, Safari, and Firefox. Wildcards directly under a TLD, like `*.test`, are rejected, so certificates are issued per project. | Cert naming scheme. |

---

## Phase 1: Repository Skeleton

**Requirements:** R1.1–R1.5, R9.3

1. `git init` the repo. The template's own history is separate from client projects, which are created via "Use this template" or a fresh clone.
2. Add the root `package.json`:
   - `"private": true`, `"type": "module"`, `"engines": { "node": ">=24" }`.
   - `"workspaces": ["wp-content/themes/*", "wp-content/plugins/*"]`. Third-party plugins live in the Docker volume, not on disk, so the globs only match project-owned code.
3. Add `.gitignore` covering:
   - `.env`
   - `.db/`, `premium-plugins/`, `dist/`, `.release/`
   - `node_modules/`, `build/`, `vendor/`
   - `*.hot`, `certs/`
4. Add `.editorconfig` with WordPress conventions (tabs for PHP/JS/CSS, spaces for YAML/JSON/MD).
5. Add `.env.example` with every variable from the [Environment Variables](#environment-variables) table.
6. Add the `scripts/lib/` helpers that every later phase uses:
   - `env.mjs`: load/parse/update `.env` while preserving comments and order.
   - `docker.mjs`:
     - `compose(args)`
     - `wp(args, { capture })`, which wraps `docker compose exec -T php wp --allow-root …` and streams output.
     - `isRunning(service)`
   - `log.mjs`: consistent step/success/error output; `fail(msg)` exits non-zero.
   - `prompt.mjs`: thin wrapper over `@inquirer/prompts`, with a non-interactive mode for CI/flags.
   - `paths.mjs`: resolves theme and plugin directories from `.env` (`THEME_SLUG`, `PLUGIN_SLUG`; either may be empty, R1.3).

**Done when:** `npm install` succeeds and the skeleton is committed.

---

## Phase 2: Shared HTTPS Proxy and Local Domains

**Requirements:** R3.1–R3.7, R3.4a

### Proxy definition (`proxy/`)

- `compose.yaml` runs `traefik:v3` (tag pinned in Phase 0.4) with these settings:
  - Container name `wp-dev-proxy`, joined to an external Docker network `wp-dev-proxy`.
  - Ports `80:80` and `443:443`, and `restart: unless-stopped`.
  - Mounts the Docker socket read-only, plus `~/.config/wp-dev-proxy/certs` and `~/.config/wp-dev-proxy/dynamic`.
- `traefik.yml` configures the routing:
  - Entrypoints `web` (with a permanent redirect to `websecure`, R3.5) and `websecure`.
  - A Docker provider with `exposedByDefault: false` and network `wp-dev-proxy`.
  - A file provider watching `dynamic/`, where per-project TLS certs and host-side routes are registered.

### `scripts/proxy.mjs` (`proxy:up`, `proxy:down`, `proxy:status`)

- `up`:
  1. Copy `proxy/` to `~/.config/wp-dev-proxy/` if missing or older than the template's version. A `version` file is compared.
  2. Create the `wp-dev-proxy` network if missing.
  3. Run `docker compose -p wp-dev-proxy up -d`.
  4. Idempotent: no-op if already running.
- `down`: stops the proxy and warns if other project containers are still attached.
- The project `up` script calls `proxy up` first (R3.4a).

### Certificates (`scripts/lib/certs.mjs`, used by setup)

1. Check for `mkcert` and print `brew install mkcert nss` if missing.
2. Run `mkcert -install` once per machine. This prompts for the macOS keychain password; the script explains why first (R3.2).
3. Run `mkcert -cert-file ~/.config/wp-dev-proxy/certs/<slug>.pem -key-file …/<slug>-key.pem <slug>.test "*.<slug>.test"`.
4. Write `~/.config/wp-dev-proxy/dynamic/<slug>.yml` registering the cert under `tls.certificates`.

### Domains (`scripts/lib/hosts.mjs`)

- Add `<slug>.test`, `hmr.<slug>.test`, `mail.<slug>.test`, and `db.<slug>.test` to `/etc/hosts` pointing to `127.0.0.1`, inside a `# wp-dev:<slug> start/end` marker block.
- Use `sudo` with a clear prompt. The block is idempotent, and setup or `npm run domains:remove` can remove it.
- The README documents dnsmasq as an optional wildcard alternative (R3.3).

### Routing the host-side dev server (R3.6)

- `dev.mjs` writes `dynamic/<slug>-hmr.yml`. It holds a router for `hmr.<slug>.test` → service `http://host.docker.internal:${DEV_SERVER_PORT}`, with websocket passthrough on by default in Traefik.
- The dev server itself runs plain HTTP on the host. TLS is handled entirely by Traefik, so Node needs no certificates.

**Done when:** a placeholder `whoami` container labeled for `test.test` is reachable at `https://test.test` with no certificate warning, and HTTP redirects to HTTPS.

---

## Phase 3: Project Docker Stack

**Requirements:** R2.1–R2.11

### `compose.yaml`

- **Project name:** `name: ${COMPOSE_PROJECT_NAME}`, which defaults to the slug.
- **Networks:** `default`, plus the external `wp-dev-proxy`.
- **Volumes:** `wordpress` (core + third-party plugins/themes + uploads) and `db`.

Services:

**`php`**
- Built from `docker/php/Dockerfile` with build args `PHP_VERSION` and `WP_CLI_VERSION`.
- Volumes:
  - `wordpress:/var/www/html`
  - `./wp-content/themes/${THEME_SLUG}:/var/www/html/wp-content/themes/${THEME_SLUG}`, if set
  - `./wp-content/plugins/${PLUGIN_SLUG}:/var/www/html/wp-content/plugins/${PLUGIN_SLUG}`, if set
  - `./docker/wordpress/wp-config.php:/var/www/html/wp-config.php:ro`
  - `./premium-plugins:/premium-plugins:ro`
  - `./.db:/db`
  - `./:/project` (for Composer, phpcs, and release staging)
- Env: DB creds, `WP_HOME`, `TABLE_PREFIX`, `WP_ENVIRONMENT_TYPE=local`, `XDEBUG_MODE` (default `off`, R2.10), and SMTP to Mailpit.

**`nginx`**
- `nginx:stable-alpine`, with the same `wordpress` volume and bind mounts, read-only.
- Config from `docker/nginx/*.template` through the image's built-in `envsubst` templating.
- Traefik labels:
  - Router `Host(\`${SITE_DOMAIN}\`)` on `websecure` with `tls=true`
  - Service port 80
  - `traefik.docker.network=wp-dev-proxy`

**`db`**
- `mariadb:${DB_VERSION}` or `mysql:${DB_VERSION}`, selected by `DB_IMAGE` (R2.4), using the `db` volume.
- A healthcheck so `php` waits on `service_healthy`.

**`mailpit`**
- `axllent/mailpit`, with a Traefik label for `mail.${SITE_DOMAIN}` → port 8025 (R3.7).

**`dbadmin`**
- `adminer` or `phpmyadmin` under `profiles: ["tools"]`, labeled for `db.${SITE_DOMAIN}`.

The WP-CLI requirement (R2.2) is met by installing WP-CLI in the `php` image rather than running a separate container. It shares PHP config and volumes with no duplication; see the decision log.

### `docker/php/Dockerfile`

- Base: `php:${PHP_VERSION}-fpm`.
- `install-php-extensions` adds the extensions WordPress recommends:
  - `bcmath`, `exif`, `gd`, `imagick`, `intl`, `mysqli`, `opcache`, `zip`
  - `xdebug`: installed, but inert while `XDEBUG_MODE=off`
- Adds `wp-cli.phar`, `composer`, `mariadb-client` (for `wp db` commands), `unzip`, and `rsync`.
- Copies in `php.ini`, `xdebug.ini` (`xdebug.client_host=host.docker.internal`, `start_with_request=yes`), and the entrypoint.

### `docker/php/entrypoint.sh`

1. If `/var/www/html/wp-includes/version.php` is missing or doesn't match `WP_VERSION` from `wp-dependencies.json` (passed via env), run `wp core download --version=$WP_VERSION --skip-content --force` (R4.5).
2. Wait for the database.
3. If `wp core is-installed` fails:
   - Run `wp core install` with `.env` values (R2.8).
   - Run `plugins-install` logic: the shell entrypoint calls `wp` directly from a generated list, and the Node script remains the user-facing command.
   - Activate the project theme and plugin.
4. Start `php-fpm`.

### `docker/wordpress/wp-config.php`

- DB settings, `$table_prefix = getenv('TABLE_PREFIX') ?: 'wp_'`, `WP_HOME`, and `WP_SITEURL`.
- `WP_DEBUG`, `WP_DEBUG_LOG` (to `wp-content/debug.log`), and `WP_DEBUG_DISPLAY` false.
- `WP_ENVIRONMENT_TYPE`.
- `SCRIPT_DEBUG` true when a hot file exists, which `wp-scripts --hot` requires.
- Proxy awareness (R3.5): if `HTTP_X_FORWARDED_PROTO === 'https'`, set `$_SERVER['HTTPS'] = 'on'`.
- Salts from env, generated once by setup.

### `docker/nginx/default.conf.template`

- Standard managed-host WordPress config (R2.5):
  - `try_files $uri $uri/ /index.php?$args`
  - A PHP location to `php:9000`
  - `client_max_body_size ${PHP_UPLOAD_MAX}`, gzip, and denies for dotfiles and `xmlrpc.php`
- `include /etc/nginx/conf.d/includes/*.conf;` for optional fragments such as the uploads proxy.

### Uploads proxy (R5.8), `uploads-proxy.conf.template`

- `location ~ ^/wp-content/uploads/ { try_files $uri @production_uploads; }`
- `location @production_uploads { return 302 ${UPLOADS_PROXY_URL}$request_uri; }`
- A redirect is used rather than `proxy_pass`, so remote TLS and cookies don't matter.
- Enabled only when `UPLOADS_PROXY_URL` is non-empty: the `up` script renders or removes the fragment, then reloads nginx.

### npm scripts

| Script | Implementation |
|--------|----------------|
| `up` | `proxy up` → render nginx fragments → `docker compose up -d --build` → wait for `wp core is-installed` → print URLs |
| `down` | `docker compose down` |
| `reset` | Confirm → `docker compose down -v` → `up` (R2.7) |
| `wp` | `docker compose exec php wp --allow-root "$@"` |
| `logs` | `docker compose logs -f` plus `tail -F wp-content/debug.log` inside `php` |
| `shell` | `docker compose exec php bash` |

**Done when:** `npm run up` serves a fresh WordPress at `https://<slug>.test`. Mail sent with `wp eval 'wp_mail(...)'` appears in Mailpit. `npm run reset` returns a clean install. Changing `PHP_VERSION` in `.env` and running `up` rebuilds with that version.

---

## Phase 4: Starter Theme and Plugin

**Requirements:** R7.4–R7.6, R6.6

Both starters use placeholder tokens that setup replaces (Phase 8):

| Token | Example after setup |
|-------|---------------------|
| `starter-theme` / `starter-plugin` | `acme-theme` / `acme-plugin` (slug, text domain, directory) |
| `Starter Theme` / `Starter Plugin` | `Acme Theme` / `Acme Plugin` (display name) |
| `StarterTheme` / `StarterPlugin` | `Acme\Theme` / `Acme\Plugin` (PHP namespace) |
| `STARTER_THEME` / `STARTER_PLUGIN` | `ACME_THEME` / `ACME_PLUGIN` (constant prefix) |

### `wp-content/themes/starter-theme/`

```
style.css            # theme header incl. Version, Requires at least, Requires PHP, Text Domain
theme.json           # latest schema version
functions.php        # defines STARTER_THEME_VERSION, requires vendor/autoload.php, boots Theme class
templates/  parts/  patterns/  styles/
src/                 # JS/SCSS entry points (editor.js, frontend.js, style.scss, editor.scss)
inc/                 # PSR-4 root: Theme.php, Assets.php
composer.json        # PSR-4 autoload only, no runtime deps by default
package.json         # name, version (kept in sync by release), no scripts of its own
readme.txt  screenshot.png
```

### `wp-content/plugins/starter-plugin/`

```
starter-plugin.php   # plugin header incl. Version; defines STARTER_PLUGIN_VERSION; activation/deactivation hooks
src/                 # PSR-4 root: Plugin.php, Assets.php, Blocks.php
blocks/example/      # block.json (latest apiVersion), edit.js, save.js or render.php, view.js (script module), style.scss
assets/              # non-block JS/SCSS entry points
composer.json  package.json  readme.txt
```

### Version constant (R7.6)

- The PHP constant is the single runtime source.
- `release.mjs` updates header and constant together.
- Phase 10 adds a lint check (`scripts/check-versions.mjs`) that fails if they diverge.

### Dev/prod asset switch (R6.6), shared `Assets` class pattern

1. If `<package-dir>/build/.hot` exists, read the dev server URL from it and enqueue entry points from that URL, with the dependencies from the generated `*.asset.php`.
2. Otherwise enqueue `build/<entry>.js|css` with the version and dependencies from `build/<entry>.asset.php`.
3. Blocks are registered from `build/blocks/*/block.json` through `register_block_type()` (or `wp_register_block_metadata_collection` + `blocks-manifest.php`, if confirmed in spike 0.1). Under `--hot`, they pick up the dev server automatically.

**Done when:**
- With prebuilt assets, both starters activate cleanly.
- The example block can be inserted.
- The theme renders.
- `composer dump-autoload` inside the container produces working autoloaders.

---

## Phase 5: Asset Pipeline and Hot Reloading

**Requirements:** R6.1–R6.10, R3.6

### Root `webpack.config.js`

- Imports `@wordpress/scripts/config/webpack.config` (or the successor chosen in spike 0.1).
- Exports one config per existing workspace (theme and/or plugin, R1.3), each with:
  - `context` / `entry` pointing to that workspace's `src/` (theme), or `assets/` + `blocks/` (plugin)
  - `output.path` set to that workspace's `build/`
- Applies Sass/PostCSS through the defaults that ship with `@wordpress/scripts` (R6.8).

`devServer` overrides:
- `port: DEV_SERVER_PORT`, `host: '0.0.0.0'`, `allowedHosts: ['.test']`
- `client.webSocketURL: 'wss://hmr.<slug>.test/ws'`
- `headers: { 'Access-Control-Allow-Origin': '*' }` (the editor iframe loads cross-origin)
- `watchFiles` covering `**/*.php`, `theme.json`, `**/block.json`, `templates/**`, `parts/**`, `patterns/**`, with full page reload (R6.4)
- `watchOptions.poll` when `WATCH_POLL` is set (R6.10)

### `scripts/dev.mjs` (`npm run dev`)

1. Make sure the stack is up (`up` if not).
2. Write the Traefik dynamic route for `hmr.<slug>.test` (Phase 2).
3. Write `build/.hot`, containing `https://hmr.<slug>.test`, into each workspace.
4. Spawn `wp-scripts start --hot --config webpack.config.js`.
5. On `SIGINT`/exit: delete the hot files and the dynamic route, so PHP falls back to built assets automatically.

### Other scripts

- `npm run build` runs `wp-scripts build` with the same config and removes stale hot files.
- **If spike 0.2 fails:** non-block entry points move to Vite, with `vite-plugin-full-reload` for PHP and `@kucrut/vite-for-wp` or an equivalent manifest reader in `Assets`. Blocks stay on the official tooling. Record the reason in the decision log (R6.7).

**Done when:**
- AC2 passes: a stylesheet edit updates the front end and block editor without a reload, and a PHP template edit reloads automatically.
- Stopping `dev` leaves a site that loads built assets with no console errors.

---

## Phase 6: Production Parity (Third-Party Plugins)

**Requirements:** R4.1–R4.6

### `wp-dependencies.json`

```json
{
  "core": "6.x.y",
  "plugins": {
    "woocommerce": "9.x.y",
    "advanced-custom-fields-pro": { "source": "premium", "version": "6.x.y" }
  },
  "themes": {}
}
```

- A wordpress.org plugin or theme is written as `"slug": "version"`.
- A premium one is written as `{ "source": "premium", "version": "…" }` and resolved to `premium-plugins/<slug>-<version>.zip` or `premium-plugins/<slug>.zip`.

### `scripts/plugins-install.mjs` (`npm run plugins:install`)

1. Read the manifest and `wp plugin list --format=json`.
2. For each missing or mismatched entry:
   - wordpress.org: `wp plugin install <slug> --version=<v> --force`
   - premium: `wp plugin install /premium-plugins/<file>.zip --force`, but only when the zip exists.
3. Exit non-zero and list each missing premium zip with its expected filename (R4.2).
4. Leave activation state alone; the database decides it.

### `scripts/plugins-check.mjs` (`npm run plugins:check`)

1. Read `active_plugins` and `template` / `stylesheet` from the database through WP-CLI (`wp option get active_plugins --format=json`).
2. Compare them with the installed plugins and the manifest.
3. Print a table of each plugin with its status: OK, missing, version mismatch, or not in manifest.
4. For wordpress.org slugs not in the manifest, offer to add them. Look up the latest version with `wp plugin search`/the wp.org API and ask for confirmation, since the production version is unknown from the database alone. Prompt to update it later.
5. Run the import zip check (R4.6): if a full-site zip was imported (Phase 7), read each plugin's version from its main file header in the extracted files. Use those versions in the suggestions, and offer to copy premium plugin folders into `premium-plugins/` as zips.

**Done when:** AC6 passes, and `reset` reinstalls everything in the manifest.

---

## Phase 7: Database Import, Export, and Restore

**Requirements:** R5.1–R5.12

### `scripts/db-import.mjs` (`npm run db:import [file] [--sanitize] [--with-uploads]`)

**1. Resolve the source (R5.1, R5.2).**
- If no argument is given, list the newest `.zip`/`.sql`/`.sql.gz` in `.db/imports/`, plus `~/Downloads` when `IMPORT_SCAN_DOWNLOADS=true`.
- Confirm the file before continuing.

**2. Extract (`.zip`).**
- Unzip to `.db/tmp/<timestamp>/` with `yauzl`, or the `unzip` binary in the container.
- Recursively find `*.sql` / `*.sql.gz`. Prompt if there are several, and fail clearly if there are none (R5.11).
- Note whether `wp-content/uploads/` and `wp-content/plugins/` exist in the extracted tree.

**3. Inspect the dump** (streaming, first few MB):
- Table prefix: regex `CREATE TABLE \`(\w+?)options\`` (R5.5).
- Production URL: from `siteurl` in the `INSERT INTO \`<prefix>options\`` rows. Fall back to `PRODUCTION_URL` in `.env`, or ask.

**4. Back up (R5.4).**
- `wp db export /db/backups/<timestamp>-pre-import.sql.gz`.
- Also save the current `TABLE_PREFIX` beside it, in `<timestamp>.json`, so restore can put it back.

**5. Import.**
- `wp db reset --yes`, then `wp db import /db/tmp/…sql`, gunzipping first if needed.
- On failure, automatically run restore with the backup from step 4, then exit non-zero (R5.11).

**6. Update the prefix.**
- If the prefix differs, update `TABLE_PREFIX` in `.env` and recreate the `php` container with `docker compose up -d php`.

**7. Rewrite URLs (R5.3).**
- Use `wp search-replace <from> <to> --all-tables-with-prefix --precise --skip-columns=guid`.
- Run it for each variant: `https://` and `http://`, `www.` and bare, protocol-relative `//domain`, and JSON-escaped `https:\/\/domain`.
- Then `wp cache flush` and `wp rewrite flush`.

**8. Finish up.**
- **Admin access (R5.6):** if `LOCAL_ADMIN_USER` exists, `wp user update` its password and email. Otherwise `wp user create … --role=administrator`.
- **Plugins (R5.7):**
  - Activate the project theme and plugin.
  - `wp plugin deactivate` every slug in `LOCAL_DEACTIVATE_PLUGINS`, ignoring any that aren't installed.
  - Run `plugins:check`.
- **Uploads (R5.8):**
  - Default: set `UPLOADS_PROXY_URL` to the production URL and re-render the nginx fragment.
  - With `--with-uploads`, or when the developer accepts a prompt and the zip contained uploads: `docker compose cp` / rsync the uploads into the volume and clear `UPLOADS_PROXY_URL`.
- **Sanitize (`--sanitize`, R5.9):** run `scripts/sql/sanitize.sql` through `wp db query`. It:
  - Replaces non-admin user emails with `user<ID>@example.test`.
  - Sets all non-local-admin passwords to a random hash.
  - Truncates WooCommerce order/customer tables if present.
  - Blanks `admin_email`.
- **Clean up:** delete `.db/tmp/<timestamp>/`, and prune `.db/backups/` to `DB_BACKUPS_KEEP` (default 10) (R5.10).

**9. Print a summary:** production URL → local URL, prefix, plugins deactivated, missing plugins, and the login URL.

### Other scripts

- `db-export.mjs` (`npm run db:export`, R5.12): runs `wp db export /db/exports/<slug>-<timestamp>.sql.gz` and prints the path.
- `db-restore.mjs` (`npm run db:restore [file]`): picks the latest backup by default, restores `TABLE_PREFIX` from its JSON, imports it, and recreates `php` if the prefix changed.

### Tests (`tests/scripts/`, `node:test`)

- Unit tests for prefix/URL detection and SQL discovery in nested zips.
- Fixtures: a nested `.zip` with a custom `xyz_` prefix and an `https://www.` URL.
- An integration run of AC3–AC5 against the fixture.

**Done when:** AC3, AC4, and AC5 pass.

---

## Phase 8: Setup Script

**Requirements:** R7.1–R7.3, R7.7, R1.5

`scripts/setup.mjs` (`npm run setup`):

1. **Guard (R7.7):** if `.env` exists or no `starter-theme`/`starter-plugin` tokens remain, warn and exit.
2. **Prompt:**
   - Project name
   - Slug (derived from the name, editable)
   - Local domain (default `<slug>.test`)
   - Build: theme, plugin, or both
   - Theme slug, plugin slug
   - PHP namespace root, e.g. `Acme`
   - Production URL (optional)
   - PHP, database, and WordPress versions (defaults shown)
3. **Scaffold:**
   - Delete the unused starter (R7.2).
   - Rename the directories and the plugin main file.
   - Replace the tokens (Phase 4 table) across every text file under the kept starters and in the root config files.
   - Update the workspace `package.json` names.
4. **Write `.env`:** copy it from `.env.example`, fill in the answers, and generate salts and a random local admin password, printed once at the end.
5. **HTTPS and domains:** issue certificates and set up domains (Phase 2), explaining each `sudo` or keychain prompt first.
6. **Install:** `npm install`, then `npm run build`.
7. **Start:** `npm run up`, which installs WordPress, installs the manifest plugins, and activates the starters.
8. **Print:** the site URL, admin URL and credentials, Mailpit URL, and next steps (`npm run dev`, `npm run db:import`).

Non-interactive flags such as `--name`, `--theme-only`, and `--yes` exist for testing setup in CI and for scripted use.

**Done when:** AC1 passes, and two projects set up side by side both work (AC8, AC10).

---

## Phase 9: Release and Zip

**Requirements:** R8.1–R8.10

### `scripts/release.mjs` (`npm run release [--theme|--plugin|--both] [--patch|--minor|--major|--version=x.y.z] [--yes]`)

1. **Preflight:**
   - If the folder is a git repo and the tree is dirty, warn and confirm (R8.8).
   - Make sure the `php` container is running, since it's needed for Composer and verification.
2. **Choose (R8.1):** the target(s) and the bump. Show `current → next` per target with `semver.inc`, and confirm.
3. **Bump (R8.2)** with targeted regex replacements. Each replacement must match exactly once, or the release aborts before writing anything:
   - Theme `style.css`: ` * Version: x.y.z`. Plugin main file: ` * Version: x.y.z`.
   - The `define( 'STARTER_*_VERSION', 'x.y.z' )` constant.
   - The workspace `package.json` `version`.
   - `readme.txt` `Stable tag: x.y.z`, if present.
4. **Changelog (R8.3):** prompt for notes, which can be skipped.
   - Prepend `## x.y.z - YYYY-MM-DD` to the workspace `CHANGELOG.md`.
   - Prepend `= x.y.z =` to the `readme.txt` `== Changelog ==` section.
5. **Build (R8.4):** run `npm run build` and fail on any error.
6. **Package:** call `zip.mjs` (below).
7. **Verify (R8.7):** call `verify-zip.mjs` (below).
8. **Git (R8.8):** if this is a git repo, offer `git commit -am "Release <slug> x.y.z"` and `git tag <theme|plugin>-vx.y.z`.
9. **Print (R8.9):** the zip path and the upload steps. For a plugin: Plugins → Add New → Upload → choose the zip → "Replace current with uploaded". For a theme: Appearance → Themes → Add New → Upload.

### `scripts/zip.mjs` (`npm run zip [--theme|--plugin]`, R8.5, R8.6, R8.10)

1. Copy the workspace to `.release/<slug>/`, excluding `.distignore` patterns with the `ignore` package. Default excludes:
   - `src/`, `assets/` sources, `node_modules/`
   - `tests/`, dotfiles
   - `*.map`, `package*.json`, `composer.lock`
   - lint configs, `CHANGELOG.md`, `build/.hot`
2. Run `composer install --no-dev --optimize-autoloader` inside the container in `/project/.release/<slug>`.
3. Zip it with `archiver` to `dist/<slug>-<version>.zip`, keeping `<slug>/` as the top-level folder.
4. Delete `.release/`.

### `scripts/verify-zip.mjs` (R8.7)

Static checks:
- The header has a name and a version equal to the target version.
- The text domain matches the slug.
- No `build/.hot`.
- `vendor/autoload.php` exists if `composer.json` declares autoload.

Install test:
1. Start a throwaway stack with `docker compose -p <slug>-verify -f compose.yaml -f compose.verify.yaml up -d`. `compose.verify.yaml` swaps in fresh volumes, no bind mounts, and no Traefik labels.
2. Run `wp core install`, then `wp plugin install /dist/<zip> --activate` or `wp theme install … --activate`.
3. Fail if WP-CLI reports errors or `debug.log` contains PHP fatals or warnings from the package path.
4. Tear down with `-v`.

**Done when:** AC7 passes. Uploading the zip through wp-admin on a clean install replaces an older version in place.

---

## Phase 10: Code Quality

**Requirements:** R9.1–R9.4

1. Root `composer.json` (dev only): `squizlabs/php_codesniffer`, `wp-coding-standards/wpcs`, `phpcompatibility/phpcompatibility-wp`, `dealerdirect/phpcodesniffer-composer-installer`.
   - `phpcs.xml.dist` scoped to the theme and plugin.
   - Text domain and prefix checks configured from `.env`.
   - `testVersion` set from `PHP_VERSION`.
2. JS/CSS:
   - Use `wp-scripts lint-js`, `lint-style`, and `format`, with the WordPress configs.
   - Add a root `.prettierrc` extending `@wordpress/prettier-config`.
3. Root npm scripts:
   - `lint`: phpcs in the container, then JS, then style, then `check-versions`.
   - `lint:fix`, and `format`.
4. *(Nice to have, R9.4)* PHPUnit with `wp-phpunit` and the `yoast/phpunit-polyfills`.
   - A `test` service profile with its own test database.
   - `npm run test:php`.

**Done when:** `npm run lint` passes on the fresh starters, and a deliberate violation fails it.

---

## Phase 11: Documentation

**Requirements:** R11.1–R11.4

- **`README.md`:** prerequisites, quick start (`setup` → `dev`), the command table, a `.env` reference generated from `.env.example` comments, and troubleshooting:
  - mkcert trust, and Firefox needing `nss`
  - `/etc/hosts` and dnsmasq
  - ports 80/443 in use (another local server such as MAMP, Valet, or Local)
  - file watching and `WATCH_POLL`
  - Xdebug setup for VS Code (`.vscode/launch.json` with path mappings)
- **`docs/guides/importing-a-client-database.md`:**
  - Where common hosts' and backup plugins' downloads put the SQL file (UpdraftPlus, All-in-One WP Migration caveats, host control panels).
  - What the import changes, and how to restore.
- **`docs/guides/matching-production.md`:**
  - Reading the production core and PHP versions from Site Health.
  - Exporting the plugin list.
  - Adding premium plugins.
- **`docs/guides/releasing.md`:** the release walkthrough and the manual upload steps.

---

## Phase 12: Nice-to-Haves (after AC1–AC10 pass)

- `db:pull <env>` (R5.13):
  - Uses `REMOTE_<ENV>_SSH`, `REMOTE_<ENV>_PATH`, and `REMOTE_<ENV>_URL` from `.env`.
  - Runs `ssh … "wp db export - | gzip"` straight into `.db/imports/`, falling back to `mysqldump`, then hands off to `db-import.mjs`.
- `uploads:pull <env>`: rsync over SSH into the volume.
- PHPUnit (R9.4), if not done in Phase 10.

---

## Environment Variables

| Variable | Default | Used by |
|----------|---------|---------|
| `COMPOSE_PROJECT_NAME` | `<slug>` | compose |
| `SITE_DOMAIN` | `<slug>.test` | proxy, nginx, wp-config |
| `SITE_TITLE` | project name | install |
| `THEME_SLUG` / `PLUGIN_SLUG` | from setup (empty = not used) | compose, scripts |
| `PHP_VERSION` | `8.3` | Dockerfile |
| `WP_VERSION` | from `wp-dependencies.json` | entrypoint |
| `DB_IMAGE` / `DB_VERSION` | `mariadb` / `10.11` | compose |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` / `DB_ROOT_PASSWORD` | `wordpress` / … | compose, wp-config |
| `TABLE_PREFIX` | `wp_` | wp-config; updated by import |
| `LOCAL_ADMIN_USER` / `LOCAL_ADMIN_PASSWORD` / `LOCAL_ADMIN_EMAIL` | `admin` / generated / `admin@<slug>.test` | install, import |
| `PRODUCTION_URL` | empty | import fallback |
| `UPLOADS_PROXY_URL` | empty (set by import) | nginx |
| `LOCAL_DEACTIVATE_PLUGINS` | `wp-rocket,w3-total-cache,wp-super-cache,litespeed-cache,wordfence,sucuri-scanner,wp-mail-smtp,updraftplus,jetpack` | import |
| `IMPORT_SCAN_DOWNLOADS` | `true` | import |
| `DB_BACKUPS_KEEP` | `10` | import |
| `XDEBUG_MODE` | `off` | php |
| `PHP_UPLOAD_MAX` / `PHP_MEMORY_LIMIT` / `PHP_MAX_EXECUTION_TIME` | `256M` / `512M` / `300` | php.ini, nginx |
| `DEV_SERVER_PORT` | `8887`, chosen by setup to avoid other projects | dev |
| `WATCH_POLL` | empty | dev |
| `WP_AUTH_KEY` … `WP_NONCE_SALT` | generated | wp-config |

---

## Milestones

| Milestone | Phases | Proves |
|-----------|--------|--------|
| **M1: Site runs** | 0, 1, 2, 3 | HTTPS WordPress in Docker on a custom domain |
| **M2: Develop** | 4, 5 | Starters plus hot reloading (AC2) |
| **M3: Client data** | 6, 7 | Zip import, restore, production plugins (AC3–AC6) |
| **M4: Template** | 8 | One-command setup, multiple projects (AC1, AC8, AC10) |
| **M5: Ship** | 9 | Versioned release zips (AC7) |
| **M6: Polish** | 10, 11, 12 | Lint, docs, nice-to-haves (AC9 audited here) |

Phase 8 (setup) comes after the features it wires together. Until then, phases are tested with a hand-written `.env` and the starters under their placeholder names.

---

## Risks

| Risk | Mitigation |
|------|------------|
| HMR websocket or CORS fails inside the block editor iframe through Traefik | Spike 0.2 first; Vite fallback for non-block assets (R6.7) |
| Ports 80/443 already taken by other local tools | `proxy up` detects this and names the process; README troubleshooting |
| `/etc/hosts` edits need `sudo` | Explain before prompting, keep a marker block for clean removal, document dnsmasq |
| Very large dumps are slow through `docker exec` streaming | Import from the bind-mounted `/db` path inside the container, not stdin |
| Search-replace misses URLs in page-builder data (base64, custom encodings) | Cover the common escaped variants; document limits; `plugins:check` flags page builders known to need their own tools |
| `wp-scripts --hot` requires `SCRIPT_DEBUG` and React Fast Refresh only covers React | wp-config sets `SCRIPT_DEBUG` from the hot file; plain JS falls back to a full reload (R6.3) |
| Premium plugin versions unknown after a database-only import | Ask for the version and record it in the manifest; read versions from full-site zips when available (R4.6) |

## Decision Log

| Decision | Reason |
|----------|--------|
| JSON manifest + WP-CLI instead of Composer/WPackagist for third-party plugins | One manifest handles both wordpress.org and premium zips, which WPackagist can't. WP-CLI already pins versions, and there's no Composer vendor/installer-path setup to maintain. The spec says "preferably" Composer, so this is allowed. |
| WP-CLI in the `php` image, not its own container | Same PHP version, extensions, volumes, and config with no duplication. Satisfies R2.2. |
| Core in a named volume, project code bind-mounted | Bind-mounting all of core is slow on macOS Docker. Only code being edited needs live mounts. |
| TLS terminated at Traefik; dev server is plain HTTP on the host | Node needs no certificates. One certificate per project covers the site, HMR, mail, and database UI subdomains. |
| Uploads proxied with a 302 redirect, not `proxy_pass` | Avoids remote TLS, cookie, and host-header issues; simpler nginx config. |
| **Spike 0.1:** `@wordpress/scripts` 37 | Still the official block tooling. `@wordpress/build` (0.x) is an esbuild watcher for Gutenberg-style packages with no HMR, so it doesn't replace it. Blocks use `apiVersion: 3`, `theme.json` version 3, and `viewScriptModule` (built with `WP_EXPERIMENTAL_MODULES`). Registration uses `wp_register_block_types_from_metadata_collection()` with `--blocks-manifest` (WP 6.8+). |
| **Spike 0.2:** hot reload through the proxy — go, no Vite | Through Traefik: assets are served from `hmr.<domain>` with CORS, the WebSocket upgrades (101), stylesheet edits send hot updates without a reload, and PHP/template edits send a full reload. Verified at the protocol level (dev-server WebSocket messages, routed requests). In-browser checks, especially inside the editor iframe, are still to do by hand (see below). mini-css-extract only swaps `<link>`s in the top document, so a small dev-only helper (`scripts/dev/editor-canvas-hmr.js`) refreshes `build/` stylesheets inside `iframe[name="editor-canvas"]` after each update. |
| **Spike 0.3:** one dev server | webpack-cli starts one server per config that has `devServer`, so only the first config gets one and it serves the whole multi-compiler. Each config's `publicPath` is its real `/wp-content/…/build/…/` path on `hmr.<domain>`, so packages never collide. wp-scripts' shared `runtime.js` under `--hot` is turned off (`runtimeChunk: false`) so entries stay self-contained, as in production. |
| **Spike 0.4:** images on arm64 | `php:<ver>-fpm` (Debian) + `install-php-extensions` 2.12, `mariadb:10.11`, `mysql:8.x`, `axllent/mailpit:v1.31`, `traefik:v3.7.16`, `nginx:stable-alpine`, `adminer:5.5.1`: all native arm64. The Debian MariaDB 11.8 client requires TLS, which the local MariaDB lacks, and WP-CLI runs it with `--no-defaults`. Small wrappers in `/usr/local/bin` add `--skip-ssl`. |
| **Spike 0.5:** certificate names | One mkcert certificate per project for `<domain>` + `*.<domain>`, registered with Traefik through a file-provider `dynamic/<domain>.yml`. Browser trust still needs checking by hand once `mkcert -install` has run. |
| Dev server bound to `127.0.0.1` | Docker Desktop's `host.docker.internal` reaches host loopback, so the dev server isn't exposed on the LAN. |
| Traefik labels in list form | Compose interpolates variables in label values but not in mapping keys. Map-form labels gave every project the same router name and broke AC8. |
| WP-CLI runs as `www-data`, not `--allow-root` | Files that WP-CLI creates (plugins, uploads) stay writable by PHP-FPM. |
| Dev build replaced on exit | Dev bundles depend on `wp-react-refresh-runtime`, which WordPress only registers with `SCRIPT_DEBUG`. When `npm run dev` stops it runs a production build, so the site never loads dev assets without the dev server. |
| Uploads proxy kept after `--with-uploads` | The plan cleared `UPLOADS_PROXY_URL` after copying media. Keeping it costs nothing (it only applies to missing files) and covers media not in the zip. |
| Dumps filtered before import | Host dumps often contain `USE`, `DEFINER`, GTID statements, or MySQL 8 collations that fail on a non-root MariaDB user. They're stripped or mapped in a filtered copy only when present. |
| Setup also handles collaborators | With renamed starters and no `.env`, `npm run setup` skips the questions and does only the local steps (`.env`, certificate, hosts, install, start). R7.7 still holds: with a `.env` it warns and exits. |
