import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(
	dirname( fileURLToPath( import.meta.url ) ),
	'../..'
);

export const DB_DIR = join( ROOT, '.db' );
export const IMPORTS_DIR = join( DB_DIR, 'imports' );
export const BACKUPS_DIR = join( DB_DIR, 'backups' );
export const EXPORTS_DIR = join( DB_DIR, 'exports' );
export const TMP_DIR = join( DB_DIR, 'tmp' );
export const PREMIUM_DIR = join( ROOT, 'premium-plugins' );
export const DIST_DIR = join( ROOT, 'dist' );
export const RELEASE_DIR = join( ROOT, '.release' );
export const MANIFEST_PATH = join( ROOT, 'wp-dependencies.json' );

/**
 * Translate a path under the project root to its path inside the php container.
 *
 * @param {string} hostPath
 */
export function toContainerPath( hostPath ) {
	const abs = resolve( hostPath );
	if ( abs.startsWith( DB_DIR ) ) {
		return '/db' + abs.slice( DB_DIR.length );
	}
	if ( abs.startsWith( ROOT ) ) {
		return '/project' + abs.slice( ROOT.length );
	}
	throw new Error(
		`${ hostPath } is outside the project and not visible to Docker.`
	);
}

/**
 * The project's theme and/or plugin, resolved from .env. Either may be absent (R1.3).
 *
 * @param {Record<string,string>} env
 * @return {{type: 'theme'|'plugin', slug: string, dir: string, mainFile: string}[]}
 */
export function getPackages( env ) {
	const packages = [];
	if ( env.THEME_SLUG ) {
		const dir = join( ROOT, 'wp-content/themes', env.THEME_SLUG );
		if ( existsSync( dir ) ) {
			packages.push( {
				type: 'theme',
				slug: env.THEME_SLUG,
				dir,
				mainFile: join( dir, 'style.css' ),
			} );
		}
	}
	if ( env.PLUGIN_SLUG ) {
		const dir = join( ROOT, 'wp-content/plugins', env.PLUGIN_SLUG );
		if ( existsSync( dir ) ) {
			packages.push( {
				type: 'plugin',
				slug: env.PLUGIN_SLUG,
				dir,
				mainFile: join( dir, `${ env.PLUGIN_SLUG }.php` ),
			} );
		}
	}
	return packages;
}
