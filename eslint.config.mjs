import wpScriptsConfig from '@wordpress/scripts/config/eslint.config.cjs';

export default [
	{
		ignores: [ '**/build/**', '**/vendor/**', 'dist/**', '.release/**' ],
	},
	...wpScriptsConfig,
	{
		// @wordpress/* packages are provided by WordPress at runtime (the dependency
		// extraction plugin maps them to script handles), so they aren't installed.
		files: [ 'wp-content/**/*.{js,jsx,ts,tsx}' ],
		rules: {
			'import/no-unresolved': [ 'error', { ignore: [ '^@wordpress/' ] } ],
			'import/no-extraneous-dependencies': 'off',
		},
	},
	{
		// Node tooling scripts.
		files: [ 'scripts/**/*.mjs', 'tests/**/*.mjs', '*.config.{js,mjs}' ],
		languageOptions: {
			globals: {
				process: 'readonly',
				console: 'readonly',
				URL: 'readonly',
			},
		},
		rules: {
			// Tooling JSDoc documents intent; it isn't published API docs.
			'jsdoc/check-line-alignment': 'off',
			'jsdoc/require-returns-description': 'off',
			'jsdoc/check-types': 'off',
			'jsdoc/reject-any-type': 'off',
			// Tooling tests use Node's built-in runner, not Vitest.
			'vitest/no-import-node-test': 'off',
			'no-console': 'off',
			'import/no-unresolved': 'off',
			'import/no-extraneous-dependencies': 'off',
		},
	},
];
