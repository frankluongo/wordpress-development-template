// npm run uploads:pull -- <env>
// Copy wp-content/uploads from a remote server into the local site over SSH (rsync).
// A cache in .db/uploads/<env> keeps later pulls incremental.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertDocker, assertRunning, compose, exec } from './lib/docker.mjs';
import { loadEnv } from './lib/env.mjs';
import { parseArgs } from './lib/args.mjs';
import { run, step, success } from './lib/log.mjs';
import { DB_DIR } from './lib/paths.mjs';
import { remoteConfig } from './lib/remote.mjs';

run( async () => {
	const { positionals } = parseArgs();
	const env = loadEnv();
	const remote = remoteConfig( env, positionals[ 0 ] );
	assertDocker();
	await assertRunning();

	const cache = join( DB_DIR, 'uploads', positionals[ 0 ] );
	mkdirSync( cache, { recursive: true } );

	step( `Downloading uploads from ${ remote.ssh }` );
	await exec( 'rsync', [
		'-az',
		'--delete',
		`${ remote.ssh }:${ remote.path.replace( /\/+$/, '' ) }/wp-content/uploads/`,
		`${ cache }/`,
	] );

	step( 'Copying them into the site' );
	await compose(
		[
			'exec',
			'-T',
			'php',
			'bash',
			'-c',
			'rsync -a "$1" /var/www/html/wp-content/uploads/ && chown -R www-data:www-data /var/www/html/wp-content/uploads',
			'bash',
			`/db/uploads/${ positionals[ 0 ] }/`,
		],
		{ quiet: true }
	);
	success( 'Uploads copied. Missing files still fall back to production.' );
} );
