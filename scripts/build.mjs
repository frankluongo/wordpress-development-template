// npm run build: production assets for the theme and plugin (R6.9).
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from './lib/docker.mjs';
import { loadEnv } from './lib/env.mjs';
import { run, step, success } from './lib/log.mjs';
import { getPackages } from './lib/paths.mjs';

run( async () => {
	const packages = getPackages( loadEnv( { required: false } ) );

	// Output cleaning is off in the shared config (script and module builds share folders),
	// so clear stale files, including any leftover build/.hot, here.
	for ( const pkg of packages ) {
		rmSync( join( pkg.dir, 'build' ), { recursive: true, force: true } );
	}

	step( `Building ${ packages.map( ( pkg ) => pkg.slug ).join( ' and ' ) }` );
	await exec(
		'npx',
		[ 'wp-scripts', 'build', '--config', 'webpack.config.js' ],
		{
			env: { NODE_ENV: 'production' },
		}
	);
	success( 'Build complete' );
} );
