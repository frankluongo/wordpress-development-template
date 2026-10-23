import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every place a package's version lives (R8.2). Each regex must match exactly once.
 * Group 1 is the text before the version, group 2 the version.
 *
 * @param {{type: 'theme'|'plugin', dir: string, mainFile: string}} pkg
 * @return {{label: string, file: string, pattern?: RegExp, json?: boolean, optional?: boolean}[]}
 */
export function versionLocations( pkg ) {
	const header = /^([ \t/*]*Version:[ \t]*)([^\s*]+)/gm;
	const constant =
		/(define\(\s*['"][A-Z0-9_]+_VERSION['"]\s*,\s*['"])([^'"]+)/g;
	return [
		{
			label:
				pkg.type === 'theme'
					? 'style.css Version'
					: 'plugin header Version',
			file: pkg.mainFile,
			pattern: header,
		},
		{
			label: 'PHP version constant',
			file:
				pkg.type === 'theme'
					? join( pkg.dir, 'functions.php' )
					: pkg.mainFile,
			pattern: constant,
		},
		{
			label: 'package.json version',
			file: join( pkg.dir, 'package.json' ),
			json: true,
			optional: true,
		},
		{
			label: 'readme.txt Stable tag',
			file: join( pkg.dir, 'readme.txt' ),
			pattern: /^(Stable tag:[ \t]*)(\S+)/gim,
			optional: true,
		},
	];
}

/**
 * Read the version from each location.
 *
 * @param {Parameters<typeof versionLocations>[0]} pkg
 * @return {{label: string, file: string, version: string|null, matches: number}[]}
 */
export function readVersionLocations( pkg ) {
	return versionLocations( pkg )
		.filter( ( loc ) => ! loc.optional || existsSync( loc.file ) )
		.map( ( loc ) => {
			if ( ! existsSync( loc.file ) ) {
				return { ...loc, version: null, matches: 0 };
			}
			const text = readFileSync( loc.file, 'utf8' );
			if ( loc.json ) {
				const version = JSON.parse( text ).version ?? null;
				return { ...loc, version, matches: version ? 1 : 0 };
			}
			const matches = [ ...text.matchAll( loc.pattern ) ];
			return {
				...loc,
				version: matches[ 0 ]?.[ 2 ] ?? null,
				matches: matches.length,
			};
		} );
}

/**
 * The package's version, from its main file header.
 *
 * @param {Parameters<typeof versionLocations>[0]} pkg
 */
export function currentVersion( pkg ) {
	const [ header ] = readVersionLocations( pkg );
	if ( ! header.version ) {
		throw new Error( `No Version: header found in ${ header.file }` );
	}
	return header.version;
}

/**
 * Compute updated file contents for a version bump without writing anything.
 * Throws if any required location doesn't match exactly once.
 *
 * @param {Parameters<typeof versionLocations>[0]} pkg
 * @param {string} version
 * @return {Map<string, string>} file → new contents
 */
export function planBump( pkg, version ) {
	const writes = new Map();
	for ( const loc of versionLocations( pkg ) ) {
		if ( ! existsSync( loc.file ) ) {
			if ( loc.optional ) {
				continue;
			}
			throw new Error( `${ loc.label }: ${ loc.file } not found` );
		}
		const text = writes.get( loc.file ) ?? readFileSync( loc.file, 'utf8' );
		if ( loc.json ) {
			const data = JSON.parse( text );
			data.version = version;
			writes.set( loc.file, JSON.stringify( data, null, 2 ) + '\n' );
			continue;
		}
		const count = [ ...text.matchAll( loc.pattern ) ].length;
		if ( count !== 1 ) {
			throw new Error(
				`${ loc.label }: expected exactly one match in ${ loc.file }, found ${ count }. Nothing was changed.`
			);
		}
		writes.set(
			loc.file,
			text.replace(
				loc.pattern,
				( _, before ) => `${ before }${ version }`
			)
		);
	}
	return writes;
}

/**
 * Write a planned bump.
 *
 * @param {Map<string,string>} writes
 */
export function applyWrites( writes ) {
	for ( const [ file, contents ] of writes ) {
		writeFileSync( file, contents );
	}
}

/**
 * Prepend a changelog entry to CHANGELOG.md and readme.txt (R8.3).
 *
 * @param {string} dir
 * @param {string} version
 * @param {string} note
 * @param {string} date YYYY-MM-DD
 * @return {Map<string,string>}
 */
export function planChangelog( dir, version, note, date ) {
	const writes = new Map();
	const lines = note
		.split( /\n|;\s*/ )
		.map( ( line ) => line.trim().replace( /^[-*]\s*/, '' ) )
		.filter( Boolean );
	if ( ! lines.length ) {
		return writes;
	}

	const changelog = join( dir, 'CHANGELOG.md' );
	const existing = existsSync( changelog )
		? readFileSync( changelog, 'utf8' )
		: '# Changelog\n';
	const entry = `## ${ version } - ${ date }\n\n${ lines.map( ( l ) => `- ${ l }` ).join( '\n' ) }\n`;
	const updated = /^# .*\n/.test( existing )
		? existing.replace( /^(# .*\n)\n?/, `$1\n${ entry }\n` )
		: `# Changelog\n\n${ entry }\n${ existing }`;
	writes.set( changelog, updated );

	const readme = join( dir, 'readme.txt' );
	if ( existsSync( readme ) ) {
		const text = readFileSync( readme, 'utf8' );
		if ( /^== Changelog ==[ \t]*\r?\n/m.test( text ) ) {
			writes.set(
				readme,
				text.replace(
					/^(== Changelog ==[ \t]*\r?\n)\r?\n?/m,
					`$1\n= ${ version } =\n${ lines.map( ( l ) => `* ${ l }` ).join( '\n' ) }\n\n`
				)
			);
		}
	}
	return writes;
}
