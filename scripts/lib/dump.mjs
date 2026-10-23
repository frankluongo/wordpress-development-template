import { createReadStream, createWriteStream, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

/** File names treated as database dumps. UpdraftPlus names its dumps *-db.gz. */
export const DUMP_PATTERN = /(\.sql|\.sql\.gz|-db\.gz)$/i;
export const IMPORT_PATTERN = /(\.zip|\.sql|\.sql\.gz|-db\.gz)$/i;

export const isGzip = ( file ) => /\.gz$/i.test( file );

/**
 * Recursively find SQL dumps under a directory (R5.1: nested folders are common).
 *
 * @param {string} dir
 * @return {string[]}
 */
export function findSqlFiles( dir ) {
	const found = [];
	for ( const entry of readdirSync( dir, { withFileTypes: true } ) ) {
		const path = join( dir, entry.name );
		if ( entry.isDirectory() ) {
			if ( entry.name !== '__MACOSX' ) {
				found.push( ...findSqlFiles( path ) );
			}
		} else if (
			DUMP_PATTERN.test( entry.name ) &&
			! entry.name.startsWith( '._' )
		) {
			found.push( path );
		}
	}
	return found.sort();
}

const SAMPLE_LIMIT = 64 * 1024 * 1024;
const CREATE_TABLE = /^CREATE TABLE(?: IF NOT EXISTS)?\s+`?([A-Za-z0-9_$]+)`?/i;
const INSERT_OPTIONS =
	/^INSERT\s+(?:IGNORE\s+)?INTO\s+`?([A-Za-z0-9_$]*?)options`?/i;
const OPTION_VALUE = ( name ) =>
	new RegExp(
		`\\(\\s*'?\\d+'?\\s*,\\s*'${ name }'\\s*,\\s*'((?:[^'\\\\]|\\\\.)*)'`
	);

/** Statements that break imports into a different server or database (see filterDumpLine). */
const PROBLEM_LINE =
	/^(USE\s|CREATE DATABASE|SET @@GLOBAL\.GTID_PURGED|SET @@SESSION\.SQL_LOG_BIN)|utf8mb4_0900_|DEFINER=/i;

/**
 * Choose the WordPress table prefix from a dump's table names (R5.5).
 * A prefix counts when both <prefix>options and <prefix>posts exist.
 *
 * @param {string[]} tables
 * @return {string[]} Candidate prefixes, most likely first.
 */
export function detectPrefixes( tables ) {
	const names = new Set( tables );
	const prefixes = tables
		.filter( ( name ) => name.endsWith( 'options' ) )
		.map( ( name ) => name.slice( 0, -'options'.length ) )
		.filter( ( prefix ) => names.has( `${ prefix }posts` ) );
	return [ ...new Set( prefixes ) ];
}

/**
 * Read an option value from one INSERT line.
 *
 * @param {string} line
 * @param {string} name
 */
export function readOptionFromInsert( line, name ) {
	const match = line.match( OPTION_VALUE( name ) );
	return match ? match[ 1 ].replace( /\\(.)/g, '$1' ) : null;
}

/**
 * Stream a dump once, collecting table names, siteurl/home per prefix, and whether it
 * contains statements that need filtering.
 *
 * @param {string} file
 * @return {Promise<{tables: string[], prefixes: string[], urls: Record<string, {siteurl?: string, home?: string}>, needsFilter: boolean, contents: (needle: string) => boolean}>}
 */
export async function inspectDump( file ) {
	const tables = [];
	const urls = {};
	let needsFilter = false;
	const sample = [];
	let sampled = 0;

	let input = createReadStream( file );
	if ( isGzip( file ) ) {
		input = input.pipe( createGunzip() );
	}
	const lines = createInterface( { input, crlfDelay: Infinity } );
	// INSERT statements may span many lines (newer mariadb-dump writes one row per line).
	let inInsert = false;
	let optionsPrefix = null;

	for await ( const line of lines ) {
		const create = line.match( CREATE_TABLE );
		if ( create ) {
			tables.push( create[ 1 ] );
			continue;
		}
		if ( ! needsFilter && PROBLEM_LINE.test( line ) ) {
			needsFilter = true;
		}
		if ( /^INSERT\s/i.test( line ) ) {
			inInsert = true;
			optionsPrefix = line.match( INSERT_OPTIONS )?.[ 1 ] ?? null;
		}
		if ( inInsert ) {
			if ( optionsPrefix !== null ) {
				urls[ optionsPrefix ] ??= {};
				for ( const name of [ 'siteurl', 'home' ] ) {
					urls[ optionsPrefix ][ name ] ??=
						readOptionFromInsert( line, name ) ?? undefined;
				}
			}
			// Keep a bounded sample of row data for URL-variant detection.
			if ( sampled < SAMPLE_LIMIT ) {
				sample.push( line );
				sampled += line.length;
			}
			if ( /;\s*$/.test( line ) ) {
				inInsert = false;
				optionsPrefix = null;
			}
		}
	}

	const haystack = sample.join( '\n' );
	return {
		tables,
		prefixes: detectPrefixes( tables ),
		urls,
		needsFilter,
		// Values are SQL-escaped in the dump. Past the sample limit, assume every variant occurs.
		contents: ( needle ) =>
			sampled >= SAMPLE_LIMIT ||
			haystack.includes(
				needle.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" )
			),
	};
}

/**
 * Clean one line of a dump so it imports into the local database:
 * drop USE/CREATE DATABASE (they'd switch databases), GTID and binlog settings (need
 * SUPER), DEFINER clauses, and map MySQL 8 collations MariaDB doesn't know.
 *
 * @param {string}  line
 * @param {boolean} mariadb Whether the local server is MariaDB.
 * @return {string|null} The line, or null to drop it.
 */
export function filterDumpLine( line, mariadb = true ) {
	if (
		/^(USE\s|CREATE DATABASE|SET @@GLOBAL\.GTID_PURGED|SET @@SESSION\.SQL_LOG_BIN)/i.test(
			line
		)
	) {
		return null;
	}
	let out = line
		.replace( /\/\*!\d+\s+DEFINER=\S+\s*\*\/\s*/gi, '' )
		.replace( /DEFINER=`[^`]*`@`[^`]*`\s*/gi, '' );
	if ( mariadb ) {
		out = out.replace( /utf8mb4_0900_[a-z_]+/gi, 'utf8mb4_unicode_ci' );
	}
	return out;
}

/**
 * Write a filtered, gzipped copy of a dump.
 *
 * @param {string}  source
 * @param {string}  destination Ends in .sql.gz.
 * @param {boolean} mariadb
 */
export async function writeFilteredDump( source, destination, mariadb ) {
	let input = createReadStream( source );
	if ( isGzip( source ) ) {
		input = input.pipe( createGunzip() );
	}
	const lines = createInterface( { input, crlfDelay: Infinity } );
	async function* filtered() {
		for await ( const line of lines ) {
			const out = filterDumpLine( line, mariadb );
			if ( out !== null ) {
				yield out + '\n';
			}
		}
	}
	await pipeline( filtered, createGzip(), createWriteStream( destination ) );
}

/**
 * Split a URL into its parts for search-replace.
 *
 * @param {string} url
 */
function parseUrl( url ) {
	const { host, pathname } = new URL( url );
	return { host, path: pathname.replace( /\/+$/, '' ) };
}

/**
 * Search-replace pairs that move a site from its production URL to the local one (R5.3):
 * https and http, www and bare host, protocol-relative, JSON-escaped and URL-encoded.
 * Longer, more specific pairs come first.
 *
 * @param {string} productionUrl
 * @param {string} localUrl  https://<domain>
 * @return {[string, string][]}
 */
export function searchReplacePairs( productionUrl, localUrl ) {
	const prod = parseUrl( productionUrl );
	const local = parseUrl( localUrl );
	const bare = prod.host.replace( /^www\./, '' );
	const hosts = [ `www.${ bare }`, bare ];

	const pairs = [];
	for ( const host of hosts ) {
		const from = host + prod.path;
		const to = local.host + local.path;
		pairs.push(
			[ `https://${ from }`, `https://${ to }` ],
			[ `http://${ from }`, `https://${ to }` ],
			[
				`https:\\/\\/${ from.replaceAll( '/', '\\/' ) }`,
				`https:\\/\\/${ to.replaceAll( '/', '\\/' ) }`,
			],
			[
				`http:\\/\\/${ from.replaceAll( '/', '\\/' ) }`,
				`https:\\/\\/${ to.replaceAll( '/', '\\/' ) }`,
			],
			[
				`https%3A%2F%2F${ encodeURIComponent( from ) }`,
				`https%3A%2F%2F${ encodeURIComponent( to ) }`,
			],
			[
				`http%3A%2F%2F${ encodeURIComponent( from ) }`,
				`https%3A%2F%2F${ encodeURIComponent( to ) }`,
			],
			[ `//${ from }`, `//${ to }` ]
		);
	}
	return pairs.filter( ( [ from, to ] ) => from !== to );
}
