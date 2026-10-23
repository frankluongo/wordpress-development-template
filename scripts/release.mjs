// npm run release [-- --theme|--plugin|--both] [-- --patch|--minor|--major|--version=x.y.z] [-- --note="…"] [-- --yes]
//
// Bumps every version location, updates changelogs, builds, packages and verifies
// dist/<slug>-<version>.zip, and optionally commits and tags (R8.1–R8.9).
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import semver from 'semver';
import { parseArgs } from './lib/args.mjs';
import { assertDocker, assertRunning, exec } from './lib/docker.mjs';
import { color, info, run, step, success, warn } from './lib/log.mjs';
import { ROOT } from './lib/paths.mjs';
import { confirm, input, select } from './lib/prompt.mjs';
import {
	applyWrites,
	currentVersion,
	planBump,
	planChangelog,
} from './lib/versions.mjs';
import { packageZip, selectPackages } from './zip.mjs';

async function git( args, options = {} ) {
	return exec( 'git', args, { capture: true, allowFail: true, ...options } );
}

async function isGitRepo() {
	const { code } = await git( [
		'rev-parse',
		'--is-inside-work-tree',
	] ).catch( () => ( { code: 1 } ) );
	return code === 0;
}

run( async () => {
	const { values } = parseArgs( {
		theme: { type: 'boolean' },
		plugin: { type: 'boolean' },
		both: { type: 'boolean' },
		patch: { type: 'boolean' },
		minor: { type: 'boolean' },
		major: { type: 'boolean' },
		version: { type: 'string' },
		note: { type: 'string' },
	} );

	// 1. Preflight.
	assertDocker();
	await assertRunning();
	const inGit = await isGitRepo();
	if ( inGit ) {
		const { stdout } = await git( [ 'status', '--porcelain' ] );
		if ( stdout.trim() ) {
			warn(
				'You have uncommitted changes. They will be included in the release build.'
			);
			if (
				! values.yes &&
				! ( await confirm( 'Continue anyway?', false ) )
			) {
				throw new Error( 'Release cancelled.' );
			}
		}
	}

	// 2. Choose what to release and the bump (R8.1).
	let packages;
	if ( values.theme || values.plugin || values.both ) {
		packages = selectPackages( values.both ? {} : values );
	} else {
		const all = selectPackages( {} );
		const choice =
			all.length === 1
				? all[ 0 ].type
				: await select( 'What do you want to release?', [
						{ name: 'Plugin', value: 'plugin' },
						{ name: 'Theme', value: 'theme' },
						{ name: 'Both', value: 'both' },
					] );
		packages = all.filter(
			( pkg ) => choice === 'both' || pkg.type === choice
		);
	}

	let bump = [ 'major', 'minor', 'patch' ].find(
		( level ) => values[ level ]
	);
	let exact = values.version;
	if ( exact && ! semver.valid( exact ) ) {
		throw new Error(
			`--version=${ exact } is not a valid version (x.y.z).`
		);
	}
	if ( ! bump && ! exact ) {
		const example = currentVersion( packages[ 0 ] );
		bump = await select(
			'Version bump?',
			[
				{
					name: `Patch  ${ example } → ${ semver.inc( example, 'patch' ) }  (fixes)`,
					value: 'patch',
				},
				{
					name: `Minor  ${ example } → ${ semver.inc( example, 'minor' ) }  (features)`,
					value: 'minor',
				},
				{
					name: `Major  ${ example } → ${ semver.inc( example, 'major' ) }  (breaking changes)`,
					value: 'major',
				},
				{ name: 'Exact version…', value: 'exact' },
			],
			'patch'
		);
		if ( bump === 'exact' ) {
			exact = await input( 'New version', {
				validate: ( v ) => Boolean( semver.valid( v ) ) || 'Use x.y.z',
			} );
		}
	}

	const plans = packages.map( ( pkg ) => {
		const from = currentVersion( pkg );
		const to =
			exact || semver.inc( semver.coerce( from )?.version ?? from, bump );
		if ( ! to ) {
			throw new Error( `Can't bump ${ pkg.slug } from "${ from }".` );
		}
		return { pkg, from, to };
	} );
	for ( const { pkg, from, to } of plans ) {
		info(
			`${ pkg.type } ${ color.bold( pkg.slug ) }: ${ from } → ${ color.green( to ) }`
		);
	}
	if ( ! values.yes && ! ( await confirm( 'Proceed?', true ) ) ) {
		throw new Error( 'Release cancelled.' );
	}

	// 3–4. Bump and changelog. Every match is checked before anything is written (R8.2, R8.3).
	const note =
		values.note ??
		( values.yes
			? ''
			: await input(
					'Changelog note (optional, separate items with ";")',
					{ default: '' }
				) );
	const date = new Date().toISOString().slice( 0, 10 );
	const writes = new Map();
	for ( const { pkg, to } of plans ) {
		for ( const [ file, contents ] of planBump( pkg, to ) ) {
			writes.set( file, contents );
		}
	}
	applyWrites( writes );
	for ( const { pkg, to } of plans ) {
		applyWrites( planChangelog( pkg.dir, to, note, date ) );
	}
	success( 'Versions updated' );

	// 5. Production build (R8.4).
	await exec( 'node', [ 'scripts/build.mjs' ] );

	// 6–7. Package and verify (R8.5–R8.7).
	const zips = [];
	for ( const { pkg } of plans ) {
		zips.push( { pkg, path: await packageZip( pkg ) } );
	}

	// 8. Git (R8.8).
	if (
		inGit &&
		( values.yes ||
			( await confirm(
				'Commit the version bump and create tag(s)?',
				true
			) ) )
	) {
		const files = plans.flatMap( ( { pkg } ) =>
			[
				pkg.mainFile,
				join( pkg.dir, 'functions.php' ),
				join( pkg.dir, 'package.json' ),
				join( pkg.dir, 'readme.txt' ),
				join( pkg.dir, 'CHANGELOG.md' ),
			]
				.filter( existsSync )
				.map( ( file ) => relative( ROOT, file ) )
		);
		await exec( 'git', [ 'add', ...new Set( files ) ], { quiet: true } );
		const message = plans
			.map( ( { pkg, to } ) => `${ pkg.slug } ${ to }` )
			.join( ', ' );
		await exec( 'git', [ 'commit', '-m', `Release ${ message }` ], {
			quiet: true,
		} );
		for ( const { pkg, to } of plans ) {
			await exec( 'git', [ 'tag', `${ pkg.type }-v${ to }` ], {
				quiet: true,
			} );
		}
		success(
			`Committed and tagged ${ plans.map( ( { pkg, to } ) => `${ pkg.type }-v${ to }` ).join( ', ' ) }`
		);
	} else if ( ! inGit ) {
		info( 'Not a git repository; skipping commit and tag.' );
	}

	// 9. Upload instructions (R8.9).
	console.log( '' );
	for ( const { pkg, path } of zips ) {
		success( relative( ROOT, path ) );
		if ( pkg.type === 'plugin' ) {
			info(
				'Upload: wp-admin → Plugins → Add New Plugin → Upload Plugin → choose the zip → Install Now,'
			);
			info( '        then "Replace current with uploaded".' );
		} else {
			info(
				'Upload: wp-admin → Appearance → Themes → Add New Theme → Upload Theme → choose the zip → Install Now,'
			);
			info( '        then "Replace active with uploaded".' );
		}
	}
	step( 'Done' );
} );
