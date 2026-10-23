# Initial Feature Spec: WordPress Development Template

## Summary

Turn this repository into a reusable starting point for building custom WordPress **themes** and **plugins**. Cloning the template and running one command should give a developer a working local WordPress site in Docker, served over HTTPS on a custom local domain. The site should match the client's production environment as closely as possible, mount the theme and plugin source code live, and hot reload front-end assets. Importing a client's database from a downloaded `.zip` should be simple, and so should producing a versioned, uploadable release `.zip` of the theme or plugin.

## Goals

1. **Containerized WordPress.** No local PHP, MySQL, or web server required; only Docker and Node.
2. **Production parity.** PHP, WordPress, web server, and third-party plugins match the client's production site as closely as practical.
3. **Template-ready.** A new project can be started from this repo and renamed to a client/project slug in minutes.
4. **Client database import.** Override the local database with a client's database from a downloaded `.zip` (or `.sql`/`.sql.gz`) in one command, with URLs rewritten for local use.
5. **Hot reloading.** CSS/JS changes apply in the browser without a manual refresh; PHP/template changes trigger an automatic full reload.
6. **Manual release workflow.** One command bumps the version, builds, and produces a `.zip` ready to upload through wp-admin.

## Non-Goals (for this iteration)

- CI/CD or automated deployment to the client's server. Releases are uploaded manually.
- Pushing a local database *to* a remote environment.
- Multisite support.
- Host-specific APIs (WP Engine, Kinsta, Pantheon, etc.).

## Users

- **Primary:** a developer building a custom theme and/or plugin for a client site, working on macOS (Apple Silicon) with Docker Desktop.
- **Secondary:** collaborators who clone an existing project created from this template and need to get running quickly.

## Decisions

| Topic | Decision |
|-------|----------|
| Web server | **nginx + PHP-FPM**, matching most managed WordPress hosts. |
| Block tooling | **Newest official WordPress tooling.** Use the current major of `@wordpress/scripts` with `block.json` (latest `apiVersion`), script modules, and the Interactivity API. At implementation time, check whether a newer official WordPress build tool has replaced it, and use that if so. |
| Theme type | **Block (FSE) theme only.** No classic-theme option. |
| Local URL | **HTTPS on a custom local domain** (e.g. `https://<project-slug>.test`) with locally trusted certificates. |
| Reverse proxy | **One shared proxy for all projects on the machine**, routing by hostname. |
| Premium plugins | **Never committed.** Zips are kept locally per machine and re-downloaded as needed. |
| Database import | **Primary workflow is a downloaded `.zip`** that overrides the local database. SSH pull is a nice-to-have. |
| Third-party plugins | **Match production.** Plugins, themes, and WordPress core versions are declared per project and installed automatically. |
| Task runner | **npm scripts** as the single entry point, documented in the README. |

---

## Requirements

### 1. Repository Structure

| ID | Requirement |
|----|-------------|
| R1.1 | The repo contains only project-owned code and config: a starter theme, a starter plugin, Docker config, scripts, a dependency manifest for third-party plugins, and docs. WordPress core and third-party plugin code are **not** committed. |
| R1.2 | The starter theme lives at `wp-content/themes/<theme-slug>/` and the starter plugin at `wp-content/plugins/<plugin-slug>/`. These paths mirror a real WordPress install. |
| R1.3 | A project can contain a theme only, a plugin only, or both. Removing one must not break the tooling. |
| R1.4 | `.gitignore` excludes WordPress core, third-party plugins/themes, uploads, database dumps and imports, certificates, `node_modules`, build output, release zips, and `.env`. |
| R1.5 | A `.env.example` documents every configurable value; `.env` is created from it on first setup. |

### 2. Docker Environment

| ID | Requirement |
|----|-------------|
| R2.1 | `npm run up` starts a working WordPress site at `https://<project-slug>.test` (domain configurable in `.env`). |
| R2.2 | Services: **nginx**, **PHP-FPM** (with the PHP extensions WordPress recommends), **database** (MariaDB or MySQL, matching production), **WP-CLI**, and **Mailpit** (catches outgoing mail). **phpMyAdmin/Adminer** is optional via a Compose profile. |
| R2.3 | All images run natively on Apple Silicon (arm64) and on x86_64. |
| R2.4 | PHP version, WordPress core version, and database engine/version are configurable via `.env` so the local stack can match the client's host. |
| R2.5 | nginx config follows common managed-host conventions (pretty permalinks, `try_files`, upload size limits, gzip) and is easy to customize per project. |
| R2.6 | The theme and plugin directories are bind-mounted into the container so edits are reflected immediately without rebuilding. |
| R2.7 | Database data persists across restarts in a named volume. `npm run reset` fully destroys and reinstalls the environment. |
| R2.8 | On first run, WordPress is installed automatically (site title and admin user/password from `.env`), declared third-party plugins are installed (R4), and the starter theme and plugin are activated. |
| R2.9 | `WP_DEBUG`, `WP_DEBUG_LOG`, and `WP_ENVIRONMENT_TYPE=local` are enabled by default; the debug log is easy to tail. |
| R2.10 | Xdebug is available but **off by default**, toggleable via `.env` without editing Compose files. |
| R2.11 | PHP limits suitable for large client sites (upload size, memory limit, max execution time) are raised above defaults. |

### 3. HTTPS & Local Domains

| ID | Requirement |
|----|-------------|
| R3.1 | The site is served over HTTPS with a certificate trusted by the browser and the OS (no security warnings), generated with `mkcert` or equivalent. |
| R3.2 | Setup generates the certificate and installs the local CA once per machine, with clear instructions for any step that needs `sudo`. |
| R3.3 | The local domain resolves to the machine, either through an `/etc/hosts` entry managed by setup or through a documented wildcard `.test` resolver (dnsmasq). |
| R3.4 | Multiple projects run at the same time, each on its own domain, without port conflicts. A **single shared reverse proxy** (e.g. Traefik or Caddy) owns ports 80/443 on the machine and routes requests to each project by hostname. |
| R3.4a | The shared proxy lives outside any single project: it is started once per machine (`npm run proxy:up`, also run automatically by `up` if it isn't running) and survives individual projects being stopped or reset. Projects join it through a shared Docker network and register their domain through container labels or generated config. No manual proxy edits are needed per project. |
| R3.5 | HTTP requests redirect to HTTPS. WordPress is configured so `is_ssl()` is true behind the proxy, avoiding mixed content and redirect loops. |
| R3.6 | The asset dev server (R6) is also served over HTTPS with the same trusted certificate, so hot reloading works without mixed-content errors. |
| R3.7 | Mailpit and the optional database UI are reachable on HTTPS subdomains or documented ports. |

### 4. Production Parity: Third-Party Plugins, Themes & Core

| ID | Requirement |
|----|-------------|
| R4.1 | Each project declares its third-party plugins and themes with **pinned versions** in a manifest, preferably Composer with WPackagist for free wordpress.org plugins and themes. |
| R4.2 | **Premium/commercial plugins** (not on wordpress.org) are supported by placing their `.zip` files in a designated directory. That directory is always git-ignored, and premium plugin code is never committed. The manifest references them by slug and version, so `plugins:install` can report exactly which zips are missing on a new machine. |
| R4.3 | `npm run plugins:install` installs everything in the manifest into the container. It runs automatically on first setup and after `npm run reset`. |
| R4.4 | `npm run plugins:check` compares the database's active plugins and themes (e.g. after a client import) with what is installed locally. It reports anything missing or version-mismatched and offers to add missing wordpress.org plugins to the manifest. |
| R4.5 | WordPress core is pinned to the production version (R2.4), and the README explains how to find the production versions of core, PHP, the database, and each plugin. |
| R4.6 | When a database import `.zip` also contains plugin or theme files (e.g. a full-site backup), the import can optionally use them to fill in missing premium plugins (R5.7). |

### 5. Client Database Import

| ID | Requirement |
|----|-------------|
| R5.1 | **Import from `.zip` (primary):** `npm run db:import <path-to-file>` accepts a `.zip`, `.sql`, or `.sql.gz`. For a `.zip`, it locates the `.sql` file(s) inside (including nested folders, as host and backup-plugin exports often have) and prompts if there is more than one. It then **replaces** the local database with the contents. |
| R5.2 | If no path is given, the command uses the most recent `.zip`/`.sql`/`.sql.gz` in a configured import folder (default `.db/imports/`, and optionally `~/Downloads`) after confirming the file name with the developer. |
| R5.3 | After import, all URLs are rewritten from the production URL to the local HTTPS URL using a serialization-safe search-replace (`wp search-replace`) that covers `http`/`https` and `www` variants. The production URL comes from `.env` or is detected from the dump's `siteurl`. |
| R5.4 | The local database is **backed up automatically** before every import. `npm run db:restore` restores the most recent backup. |
| R5.5 | The import detects the dump's table prefix and updates the local configuration to match. |
| R5.6 | After import, the tooling makes sure the developer can log in by creating or resetting a local admin user from `.env` credentials. |
| R5.7 | After import, the tooling activates the project's theme and plugin, runs `plugins:check` (R4.4), and deactivates plugins that cause problems locally (caching, CDN, security/firewall, SMTP, backup). The list of plugins to deactivate is configurable. |
| R5.8 | **Uploads:** missing media is proxied from the production site by default, so nothing needs downloading. If the import `.zip` contains `wp-content/uploads`, the developer can choose to extract it locally instead. |
| R5.9 | Optional sanitization step scrubs personal data (customer emails, user passwords, order data) when client data should not stay on a dev machine. |
| R5.10 | Import files and backups are stored in git-ignored directories, and old backups are pruned to a configurable count. |
| R5.11 | Commands fail loudly with a clear message on a missing file, a zip with no SQL file, or an import error. A failed import leaves the previous database restorable. |
| R5.12 | `npm run db:export` exports the local database to a `.sql.gz`. |
| R5.13 | *(Nice to have)* `npm run db:pull <env>` exports the database over SSH (WP-CLI on the remote) and passes it to the same import pipeline. Remote connection details live in `.env`. |

### 6. Hot Reloading & Asset Build

| ID | Requirement |
|----|-------------|
| R6.1 | `npm run dev` starts the asset dev server(s) alongside the running Docker site. |
| R6.2 | **CSS changes** are injected without a page reload. |
| R6.3 | **JS changes** use hot module replacement where supported, otherwise a full reload. |
| R6.4 | **PHP, template, `theme.json`, and `block.json` changes** trigger an automatic full browser reload. |
| R6.5 | Hot reloading works on the front end, in wp-admin, and in the block editor (including the editor iframe). |
| R6.6 | The theme and plugin PHP detect whether the dev server is running (e.g. via a "hot" file) and load assets from it if so; otherwise they load built, hashed assets from the build manifest / `*.asset.php` files. Switching between modes needs no code changes. |
| R6.7 | **Blocks** are built with the newest official WordPress block tooling (see Decisions). **Non-block theme and plugin assets** use the same tooling, unless it cannot meet R6.2–R6.5. In that case Vite is used for non-block assets, and the reason is documented. |
| R6.8 | Sass/PostCSS support for stylesheets. |
| R6.9 | `npm run build` produces production-ready, minified assets for both theme and plugin. |
| R6.10 | File watching works reliably with Docker Desktop bind mounts on macOS (polling fallback configurable). |

### 7. Template Setup & Scaffolding

| ID | Requirement |
|----|-------------|
| R7.1 | `npm run setup` asks for project name, local domain, theme slug, plugin slug, PHP namespace, and text domain. It then renames all files, headers, namespaces, text domains, and constants accordingly. |
| R7.2 | Setup lets the developer choose theme only, plugin only, or both, and removes the unused starter. |
| R7.3 | Setup creates `.env`, generates HTTPS certificates (R3.2), configures the local domain (R3.3), and starts the environment. |
| R7.4 | Starter **theme:** a minimal block (FSE) theme with `theme.json`, `templates/`, `parts/`, `patterns/`, `functions.php`, asset loading wired to R6.6, and a clear place for PHP classes (PSR-4 autoloading via Composer). |
| R7.5 | Starter **plugin:** a minimal plugin with a namespaced main class, PSR-4 autoloading, activation/deactivation hooks, asset loading wired to R6.6, and an example custom block. |
| R7.6 | Theme and plugin each define a single PHP version constant, read from the file header or kept in sync with it, and use it for cache-busting non-built assets. |
| R7.7 | Setup is meant to run once. Re-running it on a configured project warns and exits. |

### 8. Release (Versioned Zip for Manual Upload)

| ID | Requirement |
|----|-------------|
| R8.1 | `npm run release` prompts for **what to release** (theme, plugin, or both) and the **version bump** (patch / minor / major, or an exact version). It shows the current version and the new version before proceeding. Non-interactive flags are also supported (e.g. `npm run release -- --plugin --minor`). |
| R8.2 | The bump updates **every place the version lives**, keeping them in sync: the `Version:` header in `style.css` (theme) or the main plugin file (plugin), the PHP version constant (R7.6), `package.json`, and `readme.txt` `Stable tag` if present. |
| R8.3 | The release prompts for a short changelog note and prepends it to `CHANGELOG.md` (and to the `readme.txt` changelog section if present). The note can be skipped. |
| R8.4 | The release runs a production build (R6.9) and installs Composer dependencies without dev packages before packaging. |
| R8.5 | The release produces `dist/<slug>-<version>.zip` whose **top-level folder is the slug** (e.g. `my-plugin/`), so uploading it in wp-admin offers "Replace current with uploaded" and updates the existing theme/plugin in place. |
| R8.6 | The zip contains only runtime files: PHP, templates, `theme.json`/`block.json`, built assets, production `vendor/`, translations, `readme.txt`, and screenshots. It excludes source assets, `node_modules`, tests, dotfiles, and lint configs. The exclusion list is configurable (e.g. a `.distignore` file). |
| R8.7 | Before packaging, the release validates the build: required file headers are present, the version in the header matches the new version, and the zip installs and activates cleanly in a throwaway local WordPress with the dev server off. |
| R8.8 | If the project is a git repository, the release offers to commit the version bump and create a tag (`theme-v1.2.3` / `plugin-v1.2.3`). It warns if there are uncommitted changes. Without git, this step is skipped. |
| R8.9 | The release prints the path to the zip and a short reminder of the manual upload steps. |
| R8.10 | `npm run zip` packages the current version without bumping, for re-uploading or testing. |

### 9. Code Quality

| ID | Requirement |
|----|-------------|
| R9.1 | PHP_CodeSniffer with WordPress Coding Standards, runnable via npm script inside Docker, so no local PHP is needed. |
| R9.2 | ESLint, Stylelint, and Prettier configured for JS/CSS (using the WordPress-provided configs where available). |
| R9.3 | `.editorconfig` included. |
| R9.4 | *(Nice to have)* PHPUnit scaffolding with the WordPress test suite running in Docker. |

### 10. Developer Commands

All tasks are npm scripts, documented in the README.

| Command | Purpose |
|---------|---------|
| `setup` | First-time project scaffolding (R7) |
| `proxy:up` / `proxy:down` | Start / stop the shared HTTPS reverse proxy (R3.4a) |
| `up` / `down` | Start / stop containers |
| `reset` | Destroy containers and volumes, reinstall fresh |
| `dev` | Start asset dev server with hot reload |
| `build` | Production asset build |
| `wp -- <args>` | Run WP-CLI inside the container |
| `db:import [file]` | Replace the local database from a `.zip`, `.sql`, or `.sql.gz` |
| `db:export` | Export the local database |
| `db:restore` | Restore the most recent pre-import backup |
| `db:pull <env>` | *(Nice to have)* Pull and import over SSH |
| `plugins:install` | Install third-party plugins/themes from the manifest |
| `plugins:check` | Compare the database's active plugins with what is installed locally |
| `release` | Bump version, build, and zip theme/plugin for upload |
| `zip` | Zip current version without bumping |
| `logs` | Tail container and WordPress debug logs |
| `lint` / `format` | Run linters / formatters |

### 11. Documentation

| ID | Requirement |
|----|-------------|
| R11.1 | README covers prerequisites, quick start, all commands, `.env` reference, and troubleshooting (certificate trust, domain resolution, port conflicts, file-watching issues). |
| R11.2 | A guide for importing a client database from a downloaded `.zip`, including where common hosts and backup plugins put their exports. |
| R11.3 | A guide for matching production: finding the versions of core, PHP, and plugins, and adding premium plugins. |
| R11.4 | A guide for the release workflow: running `release` and uploading the zip in wp-admin. |

---

## Acceptance Criteria

1. From a fresh clone on macOS with only Docker Desktop and Node installed, `npm run setup` followed by `npm run dev` yields a running site at `https://<project-slug>.test` with no certificate warnings and with the renamed starter theme and plugin active.
2. Editing a stylesheet updates the open page without a reload, in both the front end and the block editor. Editing a PHP template reloads the page automatically.
3. `npm run db:import ~/Downloads/client-backup.zip` replaces the local database with the client's, rewrites URLs to the local HTTPS domain, and lets the developer log in to wp-admin. Client media displays through the proxy without downloading uploads.
4. The import works for a zip with the SQL file in a nested folder and a non-default table prefix.
5. After any import, `npm run db:restore` returns the site to its prior state.
6. After import, `npm run plugins:check` lists any plugin active on production but missing locally. Running `plugins:install` after adding the plugin to the manifest resolves it.
7. `npm run release -- --plugin --patch` takes a plugin from `1.2.3` to `1.2.4` in the header, the constant, `package.json`, and `readme.txt`. It also produces `dist/<plugin-slug>-1.2.4.zip`, which updates the existing plugin in place when uploaded through wp-admin on a clean WordPress install.
8. Two projects created from the template run at the same time on different local domains.
9. No secrets, database dumps, certificates, premium plugin zips, or uploads are committed.
10. Stopping or resetting one project does not interrupt another project's site.

## Open Questions

None. All questions are resolved in [Decisions](#decisions).
