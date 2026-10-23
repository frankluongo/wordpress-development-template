// npm run dev: asset dev server with hot reloading alongside the running site (R6.1).
//
// 1. Starts the site if it isn't running.
// 2. Routes https://hmr.<domain> through the shared proxy to the dev server on the host (R3.6).
// 3. Writes build/.hot in each package so PHP loads assets from the dev server (R6.6).
// 4. Runs `wp-scripts start --hot`. On exit, the hot files and route are removed and a
//    production build replaces the dev build, so the site falls back to built assets.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { assertDocker, isRunning } from './lib/docker.mjs';
import { loadEnv, siteUrl } from './lib/env.mjs';
import { color, info, run, success } from './lib/log.mjs';
import { getPackages, ROOT } from './lib/paths.mjs';
import { proxyUp, removeHmrRoute, writeHmrRoute } from './lib/proxy.mjs';
import { startSite } from './lib/site.mjs';

function assertPortFree( port ) {
	return new Promise( ( resolve, reject ) => {
		const server = createServer();
		server.once( 'error', () =>
			reject(
				new Error(
					`Port ${ port } is already in use (another \`npm run dev\`?). Stop it, or change DEV_SERVER_PORT in .env.`
				)
			)
		);
		server.listen( port, '127.0.0.1', () => server.close( resolve ) );
	} );
}

run( async () => {
	const env = loadEnv();
	const port = Number( env.DEV_SERVER_PORT ) || 8887;
	const origin = `https://hmr.${ env.SITE_DOMAIN }`;
	const packages = getPackages( env );

	assertDocker();
	await assertPortFree( port );

	if ( await isRunning( 'php' ) ) {
		await proxyUp();
	} else {
		await startSite( env );
	}

	const hotFiles = packages.map( ( pkg ) => join( pkg.dir, 'build/.hot' ) );
	let cleanedUp = false;
	const cleanUp = () => {
		if ( cleanedUp ) {
			return;
		}
		cleanedUp = true;
		hotFiles.forEach( ( file ) => rmSync( file, { force: true } ) );
		removeHmrRoute( env.SITE_DOMAIN );
		// The dev build depends on the React Refresh runtime, which WordPress only loads
		// with SCRIPT_DEBUG, so replace it with a production build.
		info( 'Dev server stopped. Rebuilding production assets…' );
		spawnSync( process.execPath, [ 'scripts/build.mjs' ], {
			cwd: ROOT,
			stdio: 'inherit',
		} );
	};
	process.on( 'exit', cleanUp );

	writeHmrRoute( env.SITE_DOMAIN, port );
	for ( const file of hotFiles ) {
		mkdirSync( join( file, '..' ), { recursive: true } );
		writeFileSync( file, origin + '\n' );
	}

	success( `Dev server: ${ origin } → 127.0.0.1:${ port }` );
	info(
		`Open ${ color.bold( siteUrl( env ) ) }. CSS updates in place; PHP and template changes reload the page.`
	);
	info(
		'Press Ctrl+C to stop. The site keeps running and switches back to the built assets.'
	);

	// Own process group, so stopping it also stops the webpack process wp-scripts spawns.
	const wpScripts = createRequire( import.meta.url ).resolve(
		'@wordpress/scripts/bin/wp-scripts.js'
	);
	const child = spawn(
		process.execPath,
		[ wpScripts, 'start', '--hot', '--config', 'webpack.config.js' ],
		{
			cwd: ROOT,
			stdio: 'inherit',
			detached: true,
		}
	);

	let stopping = false;
	for ( const signal of [ 'SIGINT', 'SIGTERM', 'SIGHUP' ] ) {
		process.on( signal, () => {
			stopping = true;
			try {
				process.kill( -child.pid, 'SIGTERM' );
			} catch {
				// Already gone.
			}
		} );
	}

	child.on( 'exit', ( code ) => {
		cleanUp();
		process.exit( stopping ? 0 : ( code ?? 0 ) );
	} );
} );
