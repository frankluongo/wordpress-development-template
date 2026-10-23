// npm run check-versions: fail if a package's version differs between its header,
// PHP constant, package.json and readme.txt Stable tag (R7.6).
import { loadEnv } from './lib/env.mjs';
import { fail, run, success, table } from './lib/log.mjs';
import { getPackages } from './lib/paths.mjs';
import { readVersionLocations } from './lib/versions.mjs';

run( async () => {
	let ok = true;
	for ( const pkg of getPackages( loadEnv( { required: false } ) ) ) {
		const locations = readVersionLocations( pkg );
		const versions = new Set( locations.map( ( loc ) => loc.version ) );
		const broken = locations.some( ( loc ) => loc.matches !== 1 );
		if ( versions.size !== 1 || broken ) {
			ok = false;
			console.log( `\n${ pkg.slug }:` );
			table(
				[ 'Location', 'Version', 'Matches' ],
				locations.map( ( loc ) => [
					loc.label,
					loc.version ?? '-',
					String( loc.matches ),
				] )
			);
		}
	}
	if ( ! ok ) {
		fail(
			'Versions are out of sync. `npm run release` keeps them aligned.'
		);
	}
	success( 'Versions are in sync' );
} );
