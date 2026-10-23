// node scripts/verify-zip.mjs <zip> [-- --theme|--plugin]
// Checks a release zip (R8.7): headers, version, text domain, no dev files, and that it
// installs and activates cleanly on a throwaway WordPress with the dev server off.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './lib/args.mjs';
import { extractZip, listZip } from './lib/archive.mjs';
import { exec } from './lib/docker.mjs';
import { loadEnv } from './lib/env.mjs';
import { readHeader } from './lib/headers.mjs';
import { info, run, step, success } from './lib/log.mjs';
import { getPackages, ROOT } from './lib/paths.mjs';

/**
 * Static checks on the zip's contents.
 *
 * @param {{type: string, slug: string}} pkg
 * @param {string} zipPath
 * @param {string} version
 * @return {Promise<string[]>} Problems found.
 */
export async function staticChecks( pkg, zipPath, version ) {
	const problems = [];
	const names = await listZip( zipPath );
	const mainRel = pkg.type === 'theme' ? 'style.css' : `${ pkg.slug }.php`;

	if ( names.some( ( name ) => ! name.startsWith( `${ pkg.slug }/` ) ) ) {
		problems.push(
			`Every file must be inside a top-level "${ pkg.slug }/" folder.`
		);
	}
	if ( ! names.includes( `${ pkg.slug }/${ mainRel }` ) ) {
		problems.push( `Missing ${ pkg.slug }/${ mainRel }.` );
		return problems;
	}
	for ( const name of names ) {
		if (
			/\/build\/\.hot$|\/node_modules\/|\.map$|\/\.git\//.test( name )
		) {
			problems.push( `Dev file included: ${ name }` );
		}
	}

	const dir = mkdtempSync( join( tmpdir(), 'wp-dev-verify-' ) );
	try {
		await extractZip( zipPath, dir, ( name ) =>
			[
				`${ pkg.slug }/${ mainRel }`,
				`${ pkg.slug }/composer.json`,
			].includes( name )
		);
		const main = readFileSync( join( dir, pkg.slug, mainRel ), 'utf8' );
		const nameField = pkg.type === 'theme' ? 'Theme Name' : 'Plugin Name';
		if ( ! readHeader( main, nameField ) ) {
			problems.push( `Missing "${ nameField }:" header.` );
		}
		const headerVersion = readHeader( main, 'Version' );
		if ( headerVersion !== version ) {
			problems.push(
				`Header Version is ${ headerVersion ?? 'missing' }, expected ${ version }.`
			);
		}
		const textDomain = readHeader( main, 'Text Domain' );
		if ( textDomain !== pkg.slug ) {
			problems.push(
				`Text Domain is ${ textDomain ?? 'missing' }, expected ${ pkg.slug }.`
			);
		}
		if ( names.includes( `${ pkg.slug }/composer.json` ) ) {
			const composer = JSON.parse(
				readFileSync( join( dir, pkg.slug, 'composer.json' ), 'utf8' )
			);
			if (
				composer.autoload &&
				! names.includes( `${ pkg.slug }/vendor/autoload.php` )
			) {
				problems.push(
					'composer.json declares autoload but vendor/autoload.php is missing.'
				);
			}
		}
	} finally {
		rmSync( dir, { recursive: true, force: true } );
	}
	return problems;
}

/**
 * Install and activate the zip on a throwaway WordPress.
 *
 * @param {{type: string, slug: string}} pkg
 * @param {string} zipPath Must be in dist/.
 * @return {Promise<string[]>} Problems found.
 */
export async function installCheck( pkg, zipPath ) {
	const env = loadEnv();
	const project = `${ env.COMPOSE_PROJECT_NAME }-verify`;
	const dc = ( args, options = {} ) =>
		exec(
			'docker',
			[
				'compose',
				'-p',
				project,
				'-f',
				join( ROOT, 'compose.verify.yaml' ),
				...args,
			],
			{
				quiet: true,
				...options,
			}
		);
	const wpVerify = ( args, options ) =>
		dc( [ 'exec', '-T', '-u', 'www-data', 'php', 'wp', ...args ], options );

	const problems = [];
	try {
		step( 'Installing the zip on a throwaway WordPress' );
		await dc( [ 'up', '-d', '--wait' ] );
		const result = await wpVerify(
			[
				pkg.type,
				'install',
				`/dist/${ basename( zipPath ) }`,
				'--activate',
			],
			{
				capture: true,
				allowFail: true,
			}
		);
		if ( result.code !== 0 ) {
			problems.push(
				`Install/activate failed:\n${ ( result.stderr || result.stdout ).trim() }`
			);
		}
		// Load WordPress once more with the package active, so any fatal shows up in debug.log.
		const status = await wpVerify(
			pkg.type === 'theme'
				? [ 'theme', 'status', pkg.slug ]
				: [ 'plugin', 'status', pkg.slug ],
			{ capture: true, allowFail: true }
		);
		if ( status.code !== 0 || /Fatal error/i.test( status.stderr ) ) {
			problems.push(
				`WordPress failed to load with ${ pkg.slug } active:\n${ status.stderr.trim() }`
			);
		}
		const { stdout: log } = await dc(
			[
				'exec',
				'-T',
				'php',
				'sh',
				'-c',
				'cat wp-content/debug.log 2>/dev/null || true',
			],
			{ capture: true, allowFail: true }
		);
		const ownLines = log
			.split( '\n' )
			.filter(
				( line ) =>
					/PHP (Fatal|Parse|Warning|Deprecated|Notice)/.test(
						line
					) && line.includes( `/${ pkg.slug }/` )
			);
		if ( ownLines.length ) {
			problems.push(
				`PHP errors from ${ pkg.slug }:\n${ ownLines.slice( 0, 10 ).join( '\n' ) }`
			);
		}
	} finally {
		await dc( [ 'down', '-v', '--remove-orphans' ], { allowFail: true } );
	}
	return problems;
}

/**
 * Run all checks; throws when any fail.
 *
 * @param {{type: string, slug: string}} pkg
 * @param {string} zipPath
 * @param {string} version
 */
export async function verifyZip( pkg, zipPath, version ) {
	step( `Verifying ${ basename( zipPath ) }` );
	const problems = await staticChecks( pkg, zipPath, version );
	if ( ! problems.length ) {
		problems.push( ...( await installCheck( pkg, zipPath ) ) );
	}
	if ( problems.length ) {
		problems.forEach( ( problem ) => info( `- ${ problem }` ) );
		throw new Error( `${ basename( zipPath ) } failed verification.` );
	}
	success( `${ basename( zipPath ) } installs and activates cleanly` );
}

if (
	process.argv[ 1 ] &&
	import.meta.url === pathToFileURL( process.argv[ 1 ] ).href
) {
	run( async () => {
		const { values, positionals } = parseArgs( {
			theme: { type: 'boolean' },
			plugin: { type: 'boolean' },
		} );
		const zipPath = positionals[ 0 ];
		if ( ! zipPath ) {
			throw new Error(
				'Usage: node scripts/verify-zip.mjs dist/<slug>-<version>.zip'
			);
		}
		const pkg = getPackages( loadEnv() ).find(
			( p ) =>
				basename( zipPath ).startsWith( `${ p.slug }-` ) &&
				( ! values.theme || p.type === 'theme' ) &&
				( ! values.plugin || p.type === 'plugin' )
		);
		if ( ! pkg ) {
			throw new Error(
				`No theme or plugin in this project matches ${ basename( zipPath ) }.`
			);
		}
		const version = basename( zipPath ).slice(
			pkg.slug.length + 1,
			-'.zip'.length
		);
		await verifyZip( pkg, zipPath, version );
	} );
}
