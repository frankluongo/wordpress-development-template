import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withBlock, stripBlock } from '../../scripts/lib/hosts.mjs';
import { parseWpConfigDb, shellQuote } from '../../scripts/lib/remote.mjs';
import {
	applyReplacements,
	replacementsFor,
	toPascal,
	toSlug,
} from '../../scripts/lib/scaffold.mjs';

test( 'slug and namespace helpers', () => {
	assert.equal( toSlug( 'Acme Corp & Co.' ), 'acme-corp-co' );
	assert.equal( toSlug( 'Café Déjà' ), 'cafe-deja' );
	assert.equal( toPascal( 'acme-corp' ), 'AcmeCorp' );
	assert.equal( toPascal( '9 lives' ), 'N9Lives' );
} );

test( 'starter tokens are replaced in PHP, JSON and CSS forms', () => {
	const replacements = replacementsFor( 'plugin', {
		slug: 'acme-plugin',
		name: 'Acme Plugin',
		namespace: 'Acme\\Plugin',
	} );
	const source = [
		'namespace StarterPlugin;',
		'"StarterPlugin\\\\": "src/"',
		"$prefix = 'StarterPlugin\\\\';",
		"define( 'STARTER_PLUGIN_VERSION', '1.0.0' );",
		"update_option( 'starter_plugin_version' );",
		'Plugin Name: Starter Plugin',
		'.wp-block-starter-plugin-example {}',
	].join( '\n' );
	assert.equal(
		applyReplacements( source, replacements ),
		[
			'namespace Acme\\Plugin;',
			'"Acme\\\\Plugin\\\\": "src/"',
			"$prefix = 'Acme\\\\Plugin\\\\';",
			"define( 'ACME_PLUGIN_VERSION', '1.0.0' );",
			"update_option( 'acme_plugin_version' );",
			'Plugin Name: Acme Plugin',
			'.wp-block-acme-plugin-example {}',
		].join( '\n' )
	);
} );

test( 'hosts block is idempotent and removable', () => {
	const base = '127.0.0.1 localhost\n';
	const once = withBlock( base, 'acme.test' );
	assert.equal( withBlock( once, 'acme.test' ), once );
	assert.match( once, /127\.0\.0\.1 hmr\.acme\.test/ );
	assert.equal( stripBlock( once, 'acme.test' ).trim(), base.trim() );
	const two = withBlock( once, 'other.test' );
	assert.equal(
		stripBlock( two, 'acme.test' ).includes( 'other.test' ),
		true
	);
} );

test( 'remote helpers', () => {
	assert.equal( shellQuote( "it's" ), `'it'\\''s'` );
	assert.deepEqual(
		parseWpConfigDb(
			"define( 'DB_NAME', 'site' );\ndefine('DB_USER', \"user\");\ndefine( 'DB_PASSWORD', 'p\\'w' );\ndefine( 'DB_HOST', 'localhost:3307' );"
		),
		{
			DB_NAME: 'site',
			DB_USER: 'user',
			DB_PASSWORD: "p'w",
			DB_HOST: 'localhost:3307',
		}
	);
} );
