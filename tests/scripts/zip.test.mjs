import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distFiles } from '../../scripts/zip.mjs';

const ROOT = new URL( '../..', import.meta.url ).pathname;

test( 'release zips contain runtime files only (R8.6)', () => {
	const files = distFiles( `${ ROOT }wp-content/plugins/starter-plugin` );
	assert.ok( files.includes( 'starter-plugin.php' ) );
	assert.ok( files.includes( 'readme.txt' ) );
	assert.ok( files.includes( 'src/Plugin.php' ) );
	for ( const file of files ) {
		assert.doesNotMatch(
			file,
			/^(assets|blocks|node_modules|vendor)\//,
			file
		);
		assert.doesNotMatch(
			file,
			/(^|\/)\.|\.map$|^package\.json$|^CHANGELOG\.md$/,
			file
		);
	}

	const theme = distFiles( `${ ROOT }wp-content/themes/starter-theme` );
	assert.ok( theme.includes( 'style.css' ) );
	assert.ok( theme.includes( 'theme.json' ) );
	assert.ok( theme.includes( 'templates/index.html' ) );
	assert.ok(
		! theme.some( ( file ) => /^src\/.*\.(js|scss)$/.test( file ) )
	);
} );
