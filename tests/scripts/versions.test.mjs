import assert from 'node:assert/strict';
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { readHeader } from '../../scripts/lib/headers.mjs';
import {
	applyWrites,
	planBump,
	planChangelog,
	readVersionLocations,
} from '../../scripts/lib/versions.mjs';

const ROOT = new URL( '../..', import.meta.url ).pathname;
const tmp = mkdtempSync( join( tmpdir(), 'wp-dev-versions-' ) );
after( () => rmSync( tmp, { recursive: true, force: true } ) );

function pluginCopy( version ) {
	const dir = join( tmp, `plugin-${ version }` );
	cpSync( join( ROOT, 'wp-content/plugins/starter-plugin' ), dir, {
		recursive: true,
		filter: ( src ) => ! /\/(build|vendor|node_modules)(\/|$)/.test( src ),
	} );
	const main = join( dir, 'starter-plugin.php' );
	for ( const file of [
		main,
		join( dir, 'readme.txt' ),
		join( dir, 'package.json' ),
	] ) {
		writeFileSync(
			file,
			readFileSync( file, 'utf8' ).replaceAll( '1.0.0', version )
		);
	}
	return { type: 'plugin', slug: 'starter-plugin', dir, mainFile: main };
}

test( 'a patch bump updates header, constant, package.json and Stable tag (AC7)', () => {
	const pkg = pluginCopy( '1.2.3' );
	applyWrites( planBump( pkg, '1.2.4' ) );
	const versions = readVersionLocations( pkg ).map( ( loc ) => [
		loc.label,
		loc.version,
		loc.matches,
	] );
	assert.deepEqual( versions, [
		[ 'plugin header Version', '1.2.4', 1 ],
		[ 'PHP version constant', '1.2.4', 1 ],
		[ 'package.json version', '1.2.4', 1 ],
		[ 'readme.txt Stable tag', '1.2.4', 1 ],
	] );
	assert.equal(
		readHeader( readFileSync( pkg.mainFile, 'utf8' ), 'Version' ),
		'1.2.4'
	);
} );

test( 'a bump aborts without writing when a location matches twice', () => {
	const pkg = pluginCopy( '2.0.0' );
	const before = readFileSync( pkg.mainFile, 'utf8' );
	writeFileSync(
		pkg.mainFile,
		before + "\ndefine( 'OTHER_VERSION', '2.0.0' );\n"
	);
	assert.throws( () => planBump( pkg, '2.0.1' ), /exactly one match/ );
	assert.match(
		readFileSync( join( pkg.dir, 'package.json' ), 'utf8' ),
		/"version": "2.0.0"/
	);
} );

test( 'changelog notes go into CHANGELOG.md and readme.txt', () => {
	const pkg = pluginCopy( '3.0.0' );
	applyWrites(
		planChangelog(
			pkg.dir,
			'3.0.1',
			'Fix a bug; Add a thing',
			'2026-01-02'
		)
	);
	assert.match(
		readFileSync( join( pkg.dir, 'CHANGELOG.md' ), 'utf8' ),
		/^# Changelog\n\n## 3\.0\.1 - 2026-01-02\n\n- Fix a bug\n- Add a thing\n\n## /
	);
	assert.match(
		readFileSync( join( pkg.dir, 'readme.txt' ), 'utf8' ),
		/== Changelog ==\n\n= 3\.0\.1 =\n\* Fix a bug\n\* Add a thing\n\n= 3\.0\.0 =/
	);
	assert.equal(
		planChangelog( pkg.dir, '3.0.2', '  ', '2026-01-02' ).size,
		0
	);
} );
