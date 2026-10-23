// npm run db:pull -- <env> [-- --sanitize]
// Export a remote database over SSH and import it with the db:import pipeline (R5.13).
// Uses WP-CLI on the server, or mysqldump with the credentials from its wp-config.php.
import { createWriteStream, mkdirSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, relative } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { timestamp } from './lib/backups.mjs';
import { exec } from './lib/docker.mjs';
import { loadEnv } from './lib/env.mjs';
import { info, run, step, success, warn } from './lib/log.mjs';
import { IMPORTS_DIR, ROOT } from './lib/paths.mjs';
import { parseWpConfigDb, remoteConfig, shellQuote } from './lib/remote.mjs';

/**
 * Run a command over SSH, streaming stdout into a file.
 *
 * @param {string} host
 * @param {string} command
 * @param {string} file
 * @return {Promise<number>} Exit code.
 */
function sshToFile( host, command, file ) {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( 'ssh', [ host, command ], {
			stdio: [ 'inherit', 'pipe', 'inherit' ],
		} );
		const out = createWriteStream( file );
		child.stdout.pipe( out );
		child.on( 'error', reject );
		child.on( 'close', ( code ) => out.end( () => resolve( code ) ) );
	} );
}

run( async () => {
	const { values, positionals } = parseArgs( {
		sanitize: { type: 'boolean' },
	} );
	const env = loadEnv();
	const remote = remoteConfig( env, positionals[ 0 ] );

	mkdirSync( IMPORTS_DIR, { recursive: true } );
	const file = join(
		IMPORTS_DIR,
		`${ positionals[ 0 ] }-${ timestamp() }.sql.gz`
	);
	const cd = `cd ${ shellQuote( remote.path ) }`;

	step( `Exporting the database from ${ remote.ssh } with WP-CLI` );
	let code = await sshToFile(
		remote.ssh,
		`${ cd } && set -o pipefail 2>/dev/null; wp db export - | gzip`,
		file
	);

	if ( code !== 0 || statSync( file ).size < 100 ) {
		warn(
			'WP-CLI export failed; trying mysqldump with the wp-config.php credentials.'
		);
		const { stdout } = await exec(
			'ssh',
			[ remote.ssh, `${ cd } && cat wp-config.php` ],
			{ capture: true }
		);
		const db = parseWpConfigDb( stdout );
		if ( ! db.DB_NAME || ! db.DB_USER ) {
			rmSync( file, { force: true } );
			throw new Error(
				`Couldn't read DB_* settings from ${ remote.path }/wp-config.php.`
			);
		}
		const [ host, port ] = ( db.DB_HOST || 'localhost' ).split( ':' );
		const dump = [
			`MYSQL_PWD=${ shellQuote( db.DB_PASSWORD ?? '' ) }`,
			'mysqldump --single-transaction --quick --no-tablespaces',
			`-h ${ shellQuote( host ) }`,
			port ? `-P ${ shellQuote( port ) }` : '',
			`-u ${ shellQuote( db.DB_USER ) }`,
			shellQuote( db.DB_NAME ),
		]
			.filter( Boolean )
			.join( ' ' );
		code = await sshToFile(
			remote.ssh,
			`set -o pipefail 2>/dev/null; ${ dump } | gzip`,
			file
		);
		if ( code !== 0 ) {
			rmSync( file, { force: true } );
			throw new Error( 'mysqldump failed on the server.' );
		}
	}
	success( `Downloaded ${ relative( ROOT, file ) }` );

	info( 'Importing it' );
	await exec( 'node', [
		'scripts/db-import.mjs',
		file,
		'--yes',
		...( values.sanitize ? [ '--sanitize' ] : [] ),
	] );
} );
