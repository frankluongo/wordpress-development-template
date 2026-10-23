import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { compose, wp } from './docker.mjs';
import { loadEnv, setEnv } from './env.mjs';
import { applyNginxIncludes } from './nginx.mjs';
import { step, success } from './log.mjs';
import { BACKUPS_DIR, toContainerPath } from './paths.mjs';
import { waitForReady } from './site.mjs';

export const timestamp = () =>
	new Date().toISOString().replace( /[:.]/g, '-' ).slice( 0, 19 );

/** .env values that a database depends on, saved alongside each backup. */
const ENV_KEYS = [ 'TABLE_PREFIX', 'UPLOADS_PROXY_URL' ];

/**
 * Export the current database to .db/backups (R5.4).
 *
 * @param {string} label
 * @return {Promise<string>} Host path of the backup.
 */
export async function createBackup( label = 'pre-import' ) {
	mkdirSync( BACKUPS_DIR, { recursive: true } );
	const name = `${ timestamp() }-${ label }`;
	const file = join( BACKUPS_DIR, `${ name }.sql.gz` );
	step(
		`Backing up the current database to .db/backups/${ basename( file ) }`
	);
	await exportDatabase( file );

	const env = loadEnv();
	writeFileSync(
		join( BACKUPS_DIR, `${ name }.json` ),
		JSON.stringify(
			Object.fromEntries(
				ENV_KEYS.map( ( key ) => [ key, env[ key ] ?? '' ] )
			),
			null,
			2
		) + '\n'
	);
	return file;
}

/**
 * Export the database to a gzipped file under .db/.
 *
 * @param {string} file Host path.
 */
export async function exportDatabase( file ) {
	const target = toContainerPath( file );
	await compose(
		[
			'exec',
			'-T',
			'-u',
			'www-data',
			'php',
			'bash',
			'-c',
			'set -o pipefail; wp db export - --add-drop-table | gzip > "$1"',
			'bash',
			target,
		],
		{ quiet: true }
	);
}

/**
 * Replace the database with a dump file under .db/ (plain or gzipped).
 *
 * @param {string} file Host path.
 */
export async function importDatabase( file ) {
	const target = toContainerPath( file );
	await wp( [ 'db', 'reset', '--yes' ], { quiet: true } );
	const reader = /\.gz$/i.test( file ) ? 'gunzip -c "$1"' : 'cat "$1"';
	const { code, stderr, stdout } = await compose(
		[
			'exec',
			'-T',
			'-u',
			'www-data',
			'php',
			'bash',
			'-c',
			`set -o pipefail; ${ reader } | wp db import -`,
			'bash',
			target,
		],
		{ quiet: true, allowFail: true }
	);
	if ( code !== 0 ) {
		const detail = ( stderr || stdout )
			.trim()
			.split( '\n' )
			.filter( ( line ) => ! /^-+$/.test( line ) )
			.slice( -4 )
			.join( '\n' );
		throw new Error( `MySQL rejected ${ basename( file ) }:\n${ detail }` );
	}
}

/**
 * Backups, newest first.
 *
 * @return {string[]}
 */
export function listBackups() {
	if ( ! existsSync( BACKUPS_DIR ) ) {
		return [];
	}
	return readdirSync( BACKUPS_DIR )
		.filter( ( name ) => name.endsWith( '.sql.gz' ) )
		.map( ( name ) => join( BACKUPS_DIR, name ) )
		.sort( ( a, b ) => statSync( b ).mtimeMs - statSync( a ).mtimeMs );
}

/**
 * Delete all but the newest `keep` backups (R5.10).
 *
 * @param {number} keep
 */
export function pruneBackups( keep ) {
	for ( const file of listBackups().slice( Math.max( keep, 1 ) ) ) {
		rmSync( file, { force: true } );
		rmSync( file.replace( /\.sql\.gz$/, '.json' ), { force: true } );
	}
}

/**
 * Apply .env changes the php container depends on, recreating it if needed.
 *
 * @param {Record<string,string>} updates
 */
export async function applyEnvChanges( updates ) {
	const env = loadEnv();
	const changed = Object.fromEntries(
		Object.entries( updates ).filter(
			( [ key, value ] ) => env[ key ] !== value
		)
	);
	if ( ! Object.keys( changed ).length ) {
		return;
	}
	setEnv( changed );
	if ( 'TABLE_PREFIX' in changed ) {
		step( `Switching the table prefix to ${ changed.TABLE_PREFIX }` );
		await compose( [ 'up', '-d', 'php' ], { quiet: true } );
		await waitForReady();
	}
	if ( 'UPLOADS_PROXY_URL' in changed ) {
		await applyNginxIncludes( loadEnv() );
	}
}

/**
 * Restore a backup and the .env values saved with it.
 *
 * @param {string} file
 */
export async function restoreBackup( file ) {
	step( `Restoring ${ basename( file ) }` );
	await importDatabase( file );
	const sidecar = file.replace( /\.sql\.gz$/, '.json' );
	if ( existsSync( sidecar ) ) {
		await applyEnvChanges( JSON.parse( readFileSync( sidecar, 'utf8' ) ) );
	}
	await wp( [ 'cache', 'flush' ], { quiet: true, allowFail: true } );
	success( `Restored ${ basename( file ) }` );
}
