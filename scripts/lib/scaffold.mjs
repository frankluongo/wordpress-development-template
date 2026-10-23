import {
	existsSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const STARTER_THEME = 'starter-theme';
export const STARTER_PLUGIN = 'starter-plugin';

const TEXT_EXTENSIONS = new Set( [
	'.php',
	'.js',
	'.jsx',
	'.ts',
	'.tsx',
	'.mjs',
	'.json',
	'.scss',
	'.css',
	'.html',
	'.txt',
	'.md',
	'.xml',
	'.yml',
	'.yaml',
	'.pot',
] );

/**
 * "Acme Corp" → "acme-corp"
 *
 * @param {string} value
 */
export const toSlug = ( value ) =>
	value
		.normalize( 'NFKD' )
		.replace( /\p{Diacritic}/gu, '' )
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' );

/**
 * "acme-corp" → "AcmeCorp"
 *
 * @param {string} value
 */
export const toPascal = ( value ) =>
	toSlug( value )
		.split( '-' )
		.filter( Boolean )
		.map( ( part ) => part[ 0 ].toUpperCase() + part.slice( 1 ) )
		.join( '' )
		.replace( /^(\d)/, 'N$1' );

/**
 * "acme-theme" → "ACME_THEME"
 *
 * @param {string} slug
 */
export const toConstant = ( slug ) => slug.toUpperCase().replace( /-/g, '_' );

/**
 * "acme-theme" → "acme_theme"
 *
 * @param {string} slug
 */
export const toSnake = ( slug ) => slug.replace( /-/g, '_' );

/**
 * Token replacements for one starter (Phase 4 table). Order matters: specific tokens first.
 *
 * @param {'theme'|'plugin'} type
 * @param {{slug: string, name: string, namespace: string}} target namespace like "Acme\\Theme"
 * @return {[string, string][]}
 */
export function replacementsFor( type, { slug, name, namespace } ) {
	const starter = type === 'theme' ? STARTER_THEME : STARTER_PLUGIN;
	const pascal = type === 'theme' ? 'StarterTheme' : 'StarterPlugin';
	const display = type === 'theme' ? 'Starter Theme' : 'Starter Plugin';
	return [
		// Escaped namespaces in JSON and PHP strings ("StarterTheme\\").
		[ `${ pascal }\\\\`, namespace.replaceAll( '\\', '\\\\' ) + '\\\\' ],
		[ pascal, namespace ],
		[ toConstant( starter ), toConstant( slug ) ],
		[ toSnake( starter ), toSnake( slug ) ],
		[ display, name ],
		[ starter, slug ],
	];
}

/**
 * Apply replacements to text.
 *
 * @param {string}             text
 * @param {[string, string][]} replacements
 */
export function applyReplacements( text, replacements ) {
	return replacements.reduce(
		( out, [ from, to ] ) => out.replaceAll( from, to ),
		text
	);
}

/**
 * Replace tokens in every text file under a directory.
 *
 * @param {string}             dir
 * @param {[string, string][]} replacements
 */
export function replaceInTree( dir, replacements ) {
	for ( const entry of readdirSync( dir, { withFileTypes: true } ) ) {
		const path = join( dir, entry.name );
		if ( entry.isDirectory() ) {
			if (
				! [ 'node_modules', 'vendor', 'build' ].includes( entry.name )
			) {
				replaceInTree( path, replacements );
			}
		} else if (
			TEXT_EXTENSIONS.has( extname( entry.name ) ) &&
			statSync( path ).size < 2 * 1024 * 1024
		) {
			const text = readFileSync( path, 'utf8' );
			const next = applyReplacements( text, replacements );
			if ( next !== text ) {
				writeFileSync( path, next );
			}
		}
	}
}

/**
 * Rename a starter to its project slug and replace its tokens.
 *
 * @param {string}           root    wp-content directory.
 * @param {'theme'|'plugin'} type
 * @param {{slug: string, name: string, namespace: string}} target
 */
export function scaffoldStarter( root, type, target ) {
	const starter = type === 'theme' ? STARTER_THEME : STARTER_PLUGIN;
	const from = join( root, `${ type }s`, starter );
	const to = join( root, `${ type }s`, target.slug );
	rmSync( join( from, 'build' ), { recursive: true, force: true } );
	rmSync( join( from, 'vendor' ), { recursive: true, force: true } );
	replaceInTree( from, replacementsFor( type, target ) );
	if ( type === 'plugin' && target.slug !== starter ) {
		renameSync(
			join( from, `${ starter }.php` ),
			join( from, `${ target.slug }.php` )
		);
	}
	if ( from !== to ) {
		renameSync( from, to );
	}
}

/**
 * Whether the starters still carry their placeholder names.
 *
 * @param {string} root wp-content directory.
 */
export function hasStarterTokens( root ) {
	return (
		existsSync( join( root, 'themes', STARTER_THEME ) ) ||
		existsSync( join( root, 'plugins', STARTER_PLUGIN ) )
	);
}

/** WordPress-style salt. */
export function salt() {
	const chars =
		'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#%^&*()-_[]{}<>~+=,.;:/?|';
	return [ ...randomBytes( 64 ) ]
		.map( ( byte ) => chars[ byte % chars.length ] )
		.join( '' );
}

/**
 * Random alphanumeric password.
 *
 * @param {number} length
 */
export function password( length = 20 ) {
	const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	return [ ...randomBytes( length ) ]
		.map( ( byte ) => chars[ byte % chars.length ] )
		.join( '' );
}
