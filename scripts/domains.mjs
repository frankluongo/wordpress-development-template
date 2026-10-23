// npm run domains:add | domains:remove
// Manages this project's /etc/hosts entries and HTTPS certificate.
import { ensureCertificate } from './lib/certs.mjs';
import { loadEnv } from './lib/env.mjs';
import { addHosts, removeHosts } from './lib/hosts.mjs';
import { run } from './lib/log.mjs';
import { removeDynamic, removeHmrRoute } from './lib/proxy.mjs';

run( async () => {
	const env = loadEnv();
	const domain = env.SITE_DOMAIN;

	switch ( process.argv[ 2 ] ) {
		case 'add':
			await ensureCertificate( domain );
			await addHosts( domain );
			break;
		case 'remove':
			await removeHosts( domain );
			removeDynamic( domain );
			removeHmrRoute( domain );
			break;
		default:
			throw new Error( 'Usage: node scripts/domains.mjs <add|remove>' );
	}
} );
