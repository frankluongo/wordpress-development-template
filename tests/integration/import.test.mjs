// AC3–AC5 against the client-backup fixture, on the running local stack.
// Run with `npm run test:integration` (needs `npm run up` first). Restores the database after.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { loadEnv } from '../../scripts/lib/env.mjs';
import { ROOT } from '../../scripts/lib/paths.mjs';

const FIXTURE = new URL( '../fixtures/client-backup.zip', import.meta.url )
	.pathname;
const skip = process.env.WP_DEV_INTEGRATION
	? false
	: 'set WP_DEV_INTEGRATION=1 (npm run test:integration)';

const node = ( ...args ) =>
	execFileSync( process.execPath, args, { cwd: ROOT, encoding: 'utf8' } );
const wp = ( ...args ) =>
	execFileSync(
		'docker',
		[ 'compose', 'exec', '-T', '-u', 'www-data', 'php', 'wp', ...args ],
		{
			cwd: ROOT,
			encoding: 'utf8',
		}
	).trim();
const curlStatus = ( url, domain ) =>
	execFileSync(
		'curl',
		[
			'-sk',
			'-o',
			'/dev/null',
			'-w',
			'%{http_code} %{redirect_url}',
			'--resolve',
			`${ domain }:443:127.0.0.1`,
			url,
		],
		{ encoding: 'utf8' }
	);

test( 'import a nested, prefixed client zip and restore it', { skip }, () => {
	const before = loadEnv();
	const localUrl = `https://${ before.SITE_DOMAIN }`;
	const siteurlBefore = wp( 'option', 'get', 'siteurl' );

	node( 'scripts/db-import.mjs', FIXTURE, '--yes' );
	const after = loadEnv();

	// AC4: prefix detected and applied.
	assert.equal( after.TABLE_PREFIX, 'xyz_' );
	assert.match( wp( 'db', 'tables' ), /^xyz_options$/m );

	// AC3: URLs rewritten (plain, serialized and JSON-escaped), admin can log in, media proxied.
	assert.equal( wp( 'option', 'get', 'home' ), localUrl );
	assert.match(
		wp( 'option', 'get', 'client_settings', '--format=json' ),
		new RegExp( before.SITE_DOMAIN.replace( '.', '\\.' ) )
	);
	assert.equal(
		wp( 'post', 'meta', 'get', '1', '_builder_data' ),
		`{"link":"https:\\/\\/${ before.SITE_DOMAIN }\\/about\\/"}`
	);
	assert.match(
		wp(
			'eval',
			`echo wp_check_password( '${ after.LOCAL_ADMIN_PASSWORD || 'password' }', get_user_by( 'login', '${ after.LOCAL_ADMIN_USER || 'admin' }' )->user_pass ) ? 'yes' : 'no';`
		),
		/yes/
	);
	assert.equal( after.UPLOADS_PROXY_URL, 'https://www.client-example.com' );
	assert.equal(
		curlStatus(
			`${ localUrl }/wp-content/uploads/2024/01/missing.jpg`,
			before.SITE_DOMAIN
		),
		'302 https://www.client-example.com/wp-content/uploads/2024/01/missing.jpg'
	);

	// AC5: restore returns to the previous state.
	node( 'scripts/db-restore.mjs', '--yes' );
	const restored = loadEnv();
	assert.equal( restored.TABLE_PREFIX, before.TABLE_PREFIX );
	assert.equal( restored.UPLOADS_PROXY_URL, before.UPLOADS_PROXY_URL );
	assert.equal( wp( 'option', 'get', 'siteurl' ), siteurlBefore );
} );
