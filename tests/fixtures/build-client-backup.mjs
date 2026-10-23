// Builds tests/fixtures/client-backup.zip from a plain `wp db export` of a local site.
//
//   node tests/fixtures/build-client-backup.mjs <dump.sql> <local-url>
//
// The fixture mimics a host's full-site backup (AC3–AC6):
//   client-backup/database/xyz-site.sql      nested SQL, `xyz_` prefix, https://www. URLs,
//                                            a USE statement and a MySQL 8 collation
//   client-backup/public_html/wp-content/    uploads and a premium plugin (fake-premium 2.3.4)
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipDirectory } from '../../scripts/lib/archive.mjs';

const [ dumpPath, localUrl ] = process.argv.slice( 2 );
if ( ! dumpPath || ! localUrl ) {
	console.error(
		'Usage: node tests/fixtures/build-client-backup.mjs <dump.sql> <local-url>'
	);
	process.exit( 1 );
}

export const PRODUCTION_URL = 'https://www.client-example.com';
const PREFIX_KEYS = [
	'user_roles',
	'capabilities',
	'user_level',
	'user-settings',
	'user-settings-time',
	'dashboard_quick_press_last_post_id',
	'persisted_preferences',
];

const local = localUrl.replace( /\/+$/, '' );
// JSON-escaped (https:\/\/…) as it appears in a SQL dump, where backslashes are doubled.
const escape = ( url ) => url.replaceAll( '/', '\\\\/' );

let sql = readFileSync( dumpPath, 'utf8' )
	.replaceAll( '`wp_', '`xyz_' )
	.replace(
		new RegExp( `'wp_(${ PREFIX_KEYS.join( '|' ) })'`, 'g' ),
		"'xyz_$1'"
	)
	.replaceAll( local, PRODUCTION_URL )
	.replaceAll( escape( local ), escape( PRODUCTION_URL ) );

// Fix PHP serialized string lengths changed by the URL swap (s:<len>:\"…\";).
sql = sql.replace( /s:(\d+):\\"((?:(?!\\";).)*)\\";/g, ( _, len, content ) => {
	const raw = content.replace( /\\(.)/g, '$1' );
	return `s:${ Buffer.byteLength( raw ) }:\\"${ content }\\";`;
} );

// Things real host dumps contain that must be filtered on import.
sql = sql.replace( /(\n-- Table structure)/, '\nUSE `client_db`;\n$1' );
sql = sql.replace(
	/COLLATE=utf8mb4_unicode_520_ci|COLLATE=utf8mb4_unicode_ci/,
	'COLLATE=utf8mb4_0900_ai_ci'
);

const stage = mkdtempSync( join( tmpdir(), 'client-backup-' ) );
const root = join( stage, 'client-backup' );
const files = {
	'database/xyz-site.sql': sql,
	'public_html/wp-content/uploads/2024/01/photo.jpg': 'not really a jpeg\n',
	'public_html/wp-content/plugins/fake-premium/fake-premium.php':
		'<?php\n/**\n * Plugin Name: Fake Premium\n * Version: 2.3.4\n */\n',
};
for ( const [ rel, contents ] of Object.entries( files ) ) {
	mkdirSync( dirname( join( root, rel ) ), { recursive: true } );
	writeFileSync( join( root, rel ), contents );
}

const out = join(
	dirname( fileURLToPath( import.meta.url ) ),
	'client-backup.zip'
);
rmSync( out, { force: true } );
await zipDirectory( root, out, 'client-backup' );
rmSync( stage, { recursive: true, force: true } );
console.log( `Wrote ${ out }` );
