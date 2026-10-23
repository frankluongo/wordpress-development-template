import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ZipArchive } from 'archiver';
import yauzl from 'yauzl';

function openZip( file ) {
	return new Promise( ( resolvePromise, reject ) => {
		yauzl.open(
			file,
			{ lazyEntries: true, autoClose: false },
			( err, zip ) => ( err ? reject( err ) : resolvePromise( zip ) )
		);
	} );
}

/**
 * List the file names in a zip without extracting it.
 *
 * @param {string} file
 * @return {Promise<string[]>}
 */
export async function listZip( file ) {
	const zip = await openZip( file );
	const names = [];
	await new Promise( ( resolvePromise, reject ) => {
		zip.on( 'entry', ( entry ) => {
			names.push( entry.fileName );
			zip.readEntry();
		} );
		zip.on( 'end', resolvePromise );
		zip.on( 'error', reject );
		zip.readEntry();
	} );
	zip.close();
	return names;
}

/**
 * Extract entries that pass a filter. Paths that would escape the destination are skipped.
 *
 * @param {string}                  file
 * @param {string}                  destination
 * @param {(name: string) => boolean} filter
 * @return {Promise<number>} Number of files extracted.
 */
export async function extractZip( file, destination, filter = () => true ) {
	const root = resolve( destination );
	const zip = await openZip( file );
	let count = 0;

	await new Promise( ( resolvePromise, reject ) => {
		zip.on( 'entry', async ( entry ) => {
			try {
				const target = resolve( root, normalize( entry.fileName ) );
				const isDir = entry.fileName.endsWith( '/' );
				if (
					isDir ||
					! filter( entry.fileName ) ||
					! target.startsWith( root + sep )
				) {
					zip.readEntry();
					return;
				}
				mkdirSync( dirname( target ), { recursive: true } );
				const stream = await new Promise( ( res, rej ) =>
					zip.openReadStream( entry, ( err, s ) =>
						err ? rej( err ) : res( s )
					)
				);
				await pipeline( stream, createWriteStream( target ) );
				count++;
				zip.readEntry();
			} catch ( err ) {
				reject( err );
			}
		} );
		zip.on( 'end', resolvePromise );
		zip.on( 'error', reject );
		zip.readEntry();
	} );
	zip.close();
	return count;
}

/**
 * Zip a directory so its contents sit under `rootName/` in the archive.
 *
 * @param {string}   sourceDir
 * @param {string}   destination
 * @param {string}   rootName
 * @param {string[]} [files] Relative paths to include; defaults to everything.
 */
export async function zipDirectory( sourceDir, destination, rootName, files ) {
	mkdirSync( dirname( destination ), { recursive: true } );
	const archive = new ZipArchive( { zlib: { level: 9 } } );
	const output = createWriteStream( destination );
	const done = pipeline( archive, output );
	if ( files ) {
		for ( const rel of files ) {
			archive.file( join( sourceDir, rel ), {
				name: `${ rootName }/${ rel.split( sep ).join( '/' ) }`,
			} );
		}
	} else {
		archive.directory( sourceDir, rootName );
	}
	await archive.finalize();
	await done;
}
