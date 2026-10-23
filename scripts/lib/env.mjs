import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths.mjs';

export const ENV_PATH = join( ROOT, '.env' );
export const ENV_EXAMPLE_PATH = join( ROOT, '.env.example' );

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function unquote( raw ) {
	const value = raw.trim();
	if (
		value.length >= 2 &&
		( value[ 0 ] === '"' || value[ 0 ] === "'" ) &&
		value.at( -1 ) === value[ 0 ]
	) {
		return value.slice( 1, -1 );
	}
	// Strip trailing inline comments on unquoted values.
	return value.replace( /\s+#.*$/, '' );
}

function quote( value ) {
	const str = String( value ?? '' );
	return /[\s#"'$]/.test( str ) ? `"${ str.replace( /"/g, '\\"' ) }"` : str;
}

/**
 * Parse dotenv text into key/value pairs.
 *
 * @param {string} text
 * @return {Record<string,string>}
 */
export function parseEnv( text ) {
	const env = {};
	for ( const line of text.split( /\r?\n/ ) ) {
		const match = line.match( LINE );
		if ( match ) {
			env[ match[ 1 ] ] = unquote( match[ 2 ] );
		}
	}
	return env;
}

/**
 * Apply updates to dotenv text, keeping comments and order. Unknown keys are appended.
 *
 * @param {string}                text
 * @param {Record<string,string>} updates
 * @return {string}
 */
export function updateEnvText( text, updates ) {
	const pending = new Map( Object.entries( updates ) );
	const lines = text.split( /\r?\n/ ).map( ( line ) => {
		const match = line.match( LINE );
		if ( match && pending.has( match[ 1 ] ) ) {
			const value = pending.get( match[ 1 ] );
			pending.delete( match[ 1 ] );
			return `${ match[ 1 ] }=${ quote( value ) }`;
		}
		return line;
	} );
	if ( pending.size ) {
		if ( lines.at( -1 ) === '' ) {
			lines.pop();
		}
		for ( const [ key, value ] of pending ) {
			lines.push( `${ key }=${ quote( value ) }` );
		}
		lines.push( '' );
	}
	return lines.join( '\n' );
}

export function hasEnv() {
	return existsSync( ENV_PATH );
}

/**
 * Load .env merged over .env.example defaults.
 *
 * @param {{required?: boolean}} options
 * @return {Record<string,string>}
 */
export function loadEnv( { required = true } = {} ) {
	if ( ! hasEnv() && required ) {
		throw new Error(
			'No .env file found. Run `npm run setup` first, or copy .env.example to .env.'
		);
	}
	const defaults = existsSync( ENV_EXAMPLE_PATH )
		? parseEnv( readFileSync( ENV_EXAMPLE_PATH, 'utf8' ) )
		: {};
	const local = hasEnv() ? parseEnv( readFileSync( ENV_PATH, 'utf8' ) ) : {};
	return { ...defaults, ...local };
}

/**
 * Write updates into .env in place.
 *
 * @param {Record<string,string>} updates
 */
export function setEnv( updates ) {
	const text = readFileSync( ENV_PATH, 'utf8' );
	writeFileSync( ENV_PATH, updateEnvText( text, updates ) );
}

/**
 * The local site URL.
 *
 * @param {Record<string,string>} env
 */
export function siteUrl( env ) {
	return `https://${ env.SITE_DOMAIN }`;
}
