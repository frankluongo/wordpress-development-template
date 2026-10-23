import assert from 'node:assert/strict';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { extractZip } from '../../scripts/lib/archive.mjs';
import {
	detectPrefixes,
	filterDumpLine,
	findSqlFiles,
	inspectDump,
	readOptionFromInsert,
	searchReplacePairs,
	writeFilteredDump,
} from '../../scripts/lib/dump.mjs';

const FIXTURE = new URL( '../fixtures/client-backup.zip', import.meta.url )
	.pathname;
const tmp = mkdtempSync( join( tmpdir(), 'wp-dev-test-' ) );
after( () => rmSync( tmp, { recursive: true, force: true } ) );

test( 'detectPrefixes needs both options and posts tables', () => {
	assert.deepEqual(
		detectPrefixes( [
			'xyz_options',
			'xyz_posts',
			'xyz_wc_options',
			'other_options',
		] ),
		[ 'xyz_' ]
	);
	assert.deepEqual( detectPrefixes( [ 'wp_posts' ] ), [] );
} );

test( 'readOptionFromInsert finds values in single- and multi-row inserts', () => {
	const line =
		"INSERT INTO `wp_options` VALUES (1,'siteurl','https://example.com','yes'),(2,'home','https://www.example.com','yes');";
	assert.equal(
		readOptionFromInsert( line, 'siteurl' ),
		'https://example.com'
	);
	assert.equal(
		readOptionFromInsert( line, 'home' ),
		'https://www.example.com'
	);
	assert.equal(
		readOptionFromInsert(
			"(5,'blogname','It\\'s mine','yes')",
			'blogname'
		),
		"It's mine"
	);
} );

test( 'searchReplacePairs covers schemes, www, escaped and encoded forms', () => {
	const pairs = searchReplacePairs(
		'https://www.example.com',
		'https://acme.test'
	);
	const map = new Map( pairs );
	assert.equal( map.get( 'https://www.example.com' ), 'https://acme.test' );
	assert.equal( map.get( 'http://example.com' ), 'https://acme.test' );
	assert.equal(
		map.get( 'https:\\/\\/www.example.com' ),
		'https:\\/\\/acme.test'
	);
	assert.equal(
		map.get( 'https%3A%2F%2Fexample.com' ),
		'https%3A%2F%2Facme.test'
	);
	assert.equal( map.get( '//www.example.com' ), '//acme.test' );
	// Scheme-qualified pairs run before protocol-relative ones.
	const keys = pairs.map( ( [ from ] ) => from );
	assert.ok(
		keys.indexOf( 'https://example.com' ) < keys.indexOf( '//example.com' )
	);
} );

test( 'searchReplacePairs keeps a subdirectory path', () => {
	const map = new Map(
		searchReplacePairs( 'https://example.com/blog/', 'https://acme.test' )
	);
	assert.equal( map.get( 'https://example.com/blog' ), 'https://acme.test' );
} );

test( 'filterDumpLine drops database switches and fixes MySQL 8 collations', () => {
	assert.equal( filterDumpLine( 'USE `client_db`;' ), null );
	assert.equal( filterDumpLine( 'CREATE DATABASE `x`;' ), null );
	assert.equal( filterDumpLine( "SET @@GLOBAL.GTID_PURGED='abc';" ), null );
	assert.equal(
		filterDumpLine(
			') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;'
		),
		') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;'
	);
	assert.equal(
		filterDumpLine( 'COLLATE=utf8mb4_0900_ai_ci;', false ),
		'COLLATE=utf8mb4_0900_ai_ci;'
	);
	// DEFINER clauses need SUPER; SQL SECURITY DEFINER on its own is fine.
	assert.equal(
		filterDumpLine(
			'/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */ VIEW v'
		),
		'/*!50013 SQL SECURITY DEFINER */ VIEW v'
	);
	assert.equal(
		filterDumpLine( '/*!50017 DEFINER=`root`@`%`*/ /*!50003 TRIGGER t */' ),
		'/*!50003 TRIGGER t */'
	);
} );

test( 'the client-backup fixture: nested SQL, xyz_ prefix, www URL (AC4)', async () => {
	const dir = join( tmp, 'fixture' );
	await extractZip( FIXTURE, dir );
	const files = findSqlFiles( dir );
	assert.equal( files.length, 1 );
	assert.match( files[ 0 ], /client-backup\/database\/xyz-site\.sql$/ );

	const dump = await inspectDump( files[ 0 ] );
	assert.deepEqual( dump.prefixes, [ 'xyz_' ] );
	assert.equal( dump.urls.xyz_.siteurl, 'https://www.client-example.com' );
	assert.equal( dump.needsFilter, true );
	assert.equal( dump.contents( 'https:\\/\\/www.client-example.com' ), true );
	assert.equal(
		dump.contents( 'https%3A%2F%2Fwww.client-example.com' ),
		false
	);

	const filtered = join( tmp, 'filtered.sql.gz' );
	await writeFilteredDump( files[ 0 ], filtered, true );
	const clean = await inspectDump( filtered );
	assert.equal( clean.needsFilter, false );
	assert.deepEqual( clean.prefixes, [ 'xyz_' ] );
} );

test( 'findSqlFiles ignores __MACOSX and AppleDouble files', () => {
	const dir = join( tmp, 'nested' );
	mkdirSync( join( dir, '__MACOSX/db' ), { recursive: true } );
	mkdirSync( join( dir, 'a/b' ), { recursive: true } );
	writeFileSync( join( dir, '__MACOSX/db/x.sql' ), '' );
	writeFileSync( join( dir, 'a/b/._site.sql' ), '' );
	writeFileSync( join( dir, 'a/b/site.sql.gz' ), '' );
	writeFileSync( join( dir, 'a/backup-db.gz' ), '' );
	assert.deepEqual(
		findSqlFiles( dir ).map( ( f ) => f.slice( dir.length + 1 ) ),
		[ 'a/b/site.sql.gz', 'a/backup-db.gz' ]
	);
	assert.ok( readFileSync( FIXTURE ).length > 0 );
} );
