// npm run zip [-- --theme|--plugin] [-- --no-build]
// Package the current version as dist/<slug>-<version>.zip without bumping (R8.5, R8.6, R8.10).
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ignore from 'ignore';
import { parseArgs } from './lib/args.mjs';
import { zipDirectory } from './lib/archive.mjs';
import { assertDocker, assertRunning, compose, exec } from './lib/docker.mjs';
import { loadEnv } from './lib/env.mjs';
import { run, step, success } from './lib/log.mjs';
import { DIST_DIR, getPackages, RELEASE_DIR, ROOT } from './lib/paths.mjs';
import { currentVersion } from './lib/versions.mjs';
import { verifyZip } from './verify-zip.mjs';

/**
 * Files in a package that belong in its release zip, honouring .distignore (root, then package).
 *
 * @param {string} dir
 * @return {string[]} Paths relative to dir.
 */
export function distFiles( dir ) {
	const ig = ignore();
	for ( const file of [
		join( ROOT, '.distignore' ),
		join( dir, '.distignore' ),
	] ) {
		if ( existsSync( file ) ) {
			ig.add( readFileSync( file, 'utf8' ) );
		}
	}
	// Production vendor/ is installed fresh in the staging copy.
	ig.add( [ 'node_modules/', 'vendor/' ] );

	const files = [];
	const walk = ( current ) => {
		for ( const entry of readdirSync( current, { withFileTypes: true } ) ) {
			const abs = join( current, entry.name );
			const rel = relative( dir, abs );
			if ( ig.ignores( entry.isDirectory() ? `${ rel }/` : rel ) ) {
				continue;
			}
			if ( entry.isDirectory() ) {
				walk( abs );
			} else {
				files.push( rel );
			}
		}
	};
	walk( dir );
	return files.sort();
}

/**
 * Build a release zip for one package.
 *
 * @param {ReturnType<typeof getPackages>[number]} pkg
 * @param {{verify?: boolean}} options
 * @return {Promise<string>} Zip path.
 */
export async function packageZip( pkg, { verify = true } = {} ) {
	if ( existsSync( join( pkg.dir, 'build/.hot' ) ) ) {
		throw new Error(
			'build/ holds dev-server assets. Stop `npm run dev`, then run `npm run build`.'
		);
	}
	const version = currentVersion( pkg );
	const stage = join( RELEASE_DIR, pkg.slug );
	const zipPath = join( DIST_DIR, `${ pkg.slug }-${ version }.zip` );

	step( `Packaging ${ pkg.slug } ${ version }` );
	rmSync( stage, { recursive: true, force: true } );
	for ( const rel of distFiles( pkg.dir ) ) {
		mkdirSync( join( stage, rel, '..' ), { recursive: true } );
		copyFileSync( join( pkg.dir, rel ), join( stage, rel ) );
	}

	if ( existsSync( join( stage, 'composer.json' ) ) ) {
		step( 'Installing production Composer dependencies' );
		await compose(
			[
				'exec',
				'-T',
				'-w',
				`/project/${ relative( ROOT, stage ) }`,
				'php',
				'composer',
				'install',
				'--no-dev',
				'--optimize-autoloader',
				'--no-interaction',
				'--quiet',
			],
			{ quiet: true }
		);
		rmSync( join( stage, 'composer.lock' ), { force: true } );
	}

	rmSync( zipPath, { force: true } );
	await zipDirectory( stage, zipPath, pkg.slug );
	rmSync( RELEASE_DIR, { recursive: true, force: true } );

	if ( verify ) {
		try {
			await verifyZip( pkg, zipPath, version );
		} catch ( err ) {
			// Don't leave a broken zip where it could be uploaded.
			rmSync( zipPath, { force: true } );
			throw err;
		}
	}
	success( `Created ${ relative( ROOT, zipPath ) }` );
	return zipPath;
}

/**
 * Packages selected by --theme / --plugin (both when neither is given).
 *
 * @param {{theme?: boolean, plugin?: boolean}} flags
 */
export function selectPackages( flags ) {
	const packages = getPackages( loadEnv() );
	const wanted = packages.filter(
		( pkg ) =>
			( ! flags.theme && ! flags.plugin ) ||
			( flags.theme && pkg.type === 'theme' ) ||
			( flags.plugin && pkg.type === 'plugin' )
	);
	if ( ! wanted.length ) {
		throw new Error(
			'No matching theme or plugin. Check THEME_SLUG and PLUGIN_SLUG in .env.'
		);
	}
	return wanted;
}

if (
	process.argv[ 1 ] &&
	import.meta.url === pathToFileURL( process.argv[ 1 ] ).href
) {
	run( async () => {
		const { values } = parseArgs( {
			theme: { type: 'boolean' },
			plugin: { type: 'boolean' },
			'no-build': { type: 'boolean' },
			'no-verify': { type: 'boolean' },
		} );
		const packages = selectPackages( values );
		assertDocker();
		await assertRunning();
		if ( ! values[ 'no-build' ] ) {
			await exec( 'node', [ 'scripts/build.mjs' ] );
		}
		for ( const pkg of packages ) {
			await packageZip( pkg, { verify: ! values[ 'no-verify' ] } );
		}
	} );
}
