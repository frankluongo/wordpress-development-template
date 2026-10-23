# Releasing

Releases are uploaded manually through wp-admin. `npm run release` prepares a zip that installs over the existing theme or plugin.

## Run a release

```sh
npm run release
```

It asks:

1. **What to release:** theme, plugin, or both.
2. **The version bump:** patch (fixes), minor (features), major (breaking changes), or an exact version. It shows `current → new` before changing anything.
3. **A changelog note** (optional). Separate items with `;`.

Or pass everything as flags:

```sh
npm run release -- --plugin --patch --note="Fix checkout button; Add FAQ block"
npm run release -- --both --version=2.0.0 --yes
```

## What it does

1. Warns if git has uncommitted changes.
2. **Bumps every version location together:** the `Version:` header (`style.css` or the main plugin file), the PHP `<SLUG>_VERSION` constant, `package.json`, and `readme.txt`'s `Stable tag`. If any location can't be matched exactly once, it stops before writing anything.
3. Adds the note to `CHANGELOG.md` and the `== Changelog ==` section of `readme.txt`.
4. Runs a production build.
5. **Packages** `dist/<slug>-<version>.zip`:
   - The top-level folder is the slug, so WordPress recognizes it as an update.
   - It contains only runtime files: PHP, templates, `theme.json`/`block.json`, built assets, production `vendor/`, translations, `readme.txt` and screenshots.
   - It leaves out sources, `node_modules`, tests, dotfiles, source maps and tooling config. Adjust the list in `.distignore`; a `.distignore` inside the theme or plugin folder adds to it.
6. **Verifies the zip:** checks the headers, version and text domain, then installs and activates it on a throwaway WordPress with no dev server. PHP errors from your code fail the release, and the broken zip is deleted.
7. In a git repository, offers to commit the bump and tag it `plugin-v1.2.4` / `theme-v1.2.4`.

To package the current version again without bumping (to re-upload, or to test), run `npm run zip` (options: `--theme`, `--plugin`).

## Upload it

**Plugin:** wp-admin → **Plugins → Add New Plugin → Upload Plugin**, choose the zip, then **Install Now**. WordPress shows the current and uploaded versions; click **Replace current with uploaded**.

**Theme:** wp-admin → **Appearance → Themes → Add New Theme → Upload Theme**, choose the zip, then **Install Now** and **Replace active with uploaded**.

Before uploading to a live site, back it up (most hosts have a one-click backup), and consider testing on the host's staging site first.
