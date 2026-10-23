// npm run reset: destroy this project's containers and volumes, then reinstall (R2.7).
// Other projects and the shared proxy are untouched.
import { parseArgs } from './lib/args.mjs';
import { assertDocker, compose } from './lib/docker.mjs';
import { loadEnv } from './lib/env.mjs';
import { run, step } from './lib/log.mjs';
import { confirm } from './lib/prompt.mjs';
import { startSite } from './lib/site.mjs';

run( async () => {
	const { values } = parseArgs( { tools: { type: 'boolean' } } );
	const env = loadEnv();
	assertDocker();

	const ok =
		values.yes ||
		( await confirm(
			`This deletes the ${ env.COMPOSE_PROJECT_NAME } database and WordPress files (your theme/plugin code is kept). Continue?`,
			false
		) );
	if ( ! ok ) {
		throw new Error( 'Reset cancelled.' );
	}

	step( 'Removing containers and volumes' );
	await compose( [ '--profile', 'tools', 'down', '-v', '--remove-orphans' ] );
	await startSite( env, { tools: values.tools } );
} );
