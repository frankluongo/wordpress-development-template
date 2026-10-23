import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read a WordPress file header field (e.g. "Version") from file contents.
 *
 * @param {string} text
 * @param {string} field
 * @return {string|null}
 */
export function readHeader( text, field ) {
	const head = text.slice( 0, 8192 );
	const pattern = new RegExp(
		`^[ \\t/*#@]*${ field.replace( / /g, '\\s+' ) }:(.*)$`,
		'mi'
	);
	const match = head.match( pattern );
	return match ? match[ 1 ].replace( /\s*(?:\*\/|\?>).*$/, '' ).trim() : null;
}

/**
 * Find a plugin's main file (the top-level PHP file with a "Plugin Name" header).
 *
 * @param {string} dir Plugin directory.
 * @return {string|null}
 */
export function findPluginMainFile( dir ) {
	if ( ! existsSync( dir ) ) {
		return null;
	}
	for ( const name of readdirSync( dir )
		.filter( ( f ) => f.endsWith( '.php' ) )
		.sort() ) {
		const file = join( dir, name );
		if ( readHeader( readFileSync( file, 'utf8' ), 'Plugin Name' ) ) {
			return file;
		}
	}
	return null;
}

/**
 * Versions of every plugin (or theme) in a wp-content/plugins (or themes) directory.
 *
 * @param {string}             dir
 * @param {'plugin'|'theme'}   type
 * @return {Record<string,string>}
 */
export function readVersions( dir, type ) {
	if ( ! existsSync( dir ) ) {
		return {};
	}
	const versions = {};
	for ( const entry of readdirSync( dir, { withFileTypes: true } ) ) {
		if ( ! entry.isDirectory() ) {
			continue;
		}
		const main =
			type === 'theme'
				? join( dir, entry.name, 'style.css' )
				: findPluginMainFile( join( dir, entry.name ) );
		if ( main && existsSync( main ) ) {
			const version = readHeader(
				readFileSync( main, 'utf8' ),
				'Version'
			);
			if ( version ) {
				versions[ entry.name ] = version;
			}
		}
	}
	return versions;
}
