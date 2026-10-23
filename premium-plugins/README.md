# Premium plugins

Put zips of paid plugins and themes here. Everything in this folder except this README is git-ignored, so premium code is never committed (R4.2).

Name each zip `<slug>-<version>.zip` (or `<slug>.zip`) to match its entry in `wp-dependencies.json`:

```json
"plugins": {
  "advanced-custom-fields-pro": { "source": "premium", "version": "6.4.2" }
}
```

→ `premium-plugins/advanced-custom-fields-pro-6.4.2.zip`

`npm run plugins:install` lists any zips that are missing.
