import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compare, pluginSlug, STATUS } from '../../scripts/lib/compare.mjs';
import { findPremiumZip, normalizeEntry } from '../../scripts/lib/plugins.mjs';

test( 'pluginSlug handles folder and single-file plugins', () => {
	assert.equal( pluginSlug( 'akismet/akismet.php' ), 'akismet' );
	assert.equal( pluginSlug( 'hello.php' ), 'hello' );
} );

test( 'compare reports missing, mismatched, unlisted and project items (AC6)', () => {
	const rows = compare( {
		active: [ 'akismet', 'acf-pro', 'woocommerce', 'acme-plugin', 'extra' ],
		installed: {
			akismet: '5.3',
			woocommerce: '9.0.0',
			'acme-plugin': '1.0.0',
			extra: '1.0',
		},
		manifest: {
			akismet: '5.3',
			woocommerce: '9.1.0',
			'acf-pro': { source: 'premium', version: '6.4.0' },
		},
		projectSlug: 'acme-plugin',
		importVersions: { extra: '1.2' },
	} );
	const status = Object.fromEntries(
		rows.map( ( r ) => [ r.slug, r.status ] )
	);
	assert.deepEqual( status, {
		'acf-pro': STATUS.MISSING,
		'acme-plugin': STATUS.PROJECT,
		akismet: STATUS.OK,
		extra: STATUS.UNLISTED,
		woocommerce: STATUS.MISMATCH,
	} );
	assert.equal( rows.find( ( r ) => r.slug === 'extra' ).expected, '1.2' );
} );

test( 'manifest entries and premium zip names', () => {
	assert.deepEqual( normalizeEntry( 'a', '1.0' ), {
		slug: 'a',
		version: '1.0',
		source: 'wordpress.org',
	} );
	assert.deepEqual(
		normalizeEntry( 'b', { source: 'premium', version: '2.0' } ),
		{
			slug: 'b',
			version: '2.0',
			source: 'premium',
		}
	);
	assert.equal(
		findPremiumZip( 'b', '2.0', [ 'b.zip', 'b-2.0.zip' ] ),
		'b-2.0.zip'
	);
	assert.equal( findPremiumZip( 'b', '2.0', [ 'b.zip' ] ), 'b.zip' );
	assert.equal( findPremiumZip( 'b', '2.0', [ 'b-1.0.zip' ] ), null );
} );
