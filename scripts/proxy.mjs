// npm run proxy:up | proxy:down | proxy:status
import { assertDocker } from './lib/docker.mjs';
import { info, run, success, warn } from './lib/log.mjs';
import { proxyDown, proxyStatus, proxyUp } from './lib/proxy.mjs';

run( async () => {
	const command = process.argv[ 2 ];
	assertDocker();

	switch ( command ) {
		case 'up':
			await proxyUp();
			success( 'Shared proxy is running' );
			break;
		case 'down':
			await proxyDown();
			break;
		case 'status': {
			const status = await proxyStatus();
			if ( status.running ) {
				success( 'Shared proxy is running' );
			} else {
				warn(
					'Shared proxy is not running. Start it with `npm run proxy:up`.'
				);
			}
			info( `Config: ${ status.dir }` );
			break;
		}
		default:
			throw new Error( 'Usage: node scripts/proxy.mjs <up|down|status>' );
	}
} );
