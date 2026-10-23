// npm run up [-- --tools] [-- --no-build]
import { parseArgs } from './lib/args.mjs';
import { assertDocker } from './lib/docker.mjs';
import { loadEnv } from './lib/env.mjs';
import { run } from './lib/log.mjs';
import { startSite } from './lib/site.mjs';

run( async () => {
	const { values } = parseArgs( {
		tools: { type: 'boolean' },
		'no-build': { type: 'boolean' },
	} );
	assertDocker();
	const { missingPremium } = await startSite( loadEnv(), {
		tools: values.tools,
		build: ! values[ 'no-build' ],
	} );
	if ( missingPremium.length ) {
		process.exitCode = 1;
	}
} );
