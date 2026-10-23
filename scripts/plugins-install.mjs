// npm run plugins:install: install third-party plugins/themes from wp-dependencies.json (R4.3).
import { assertDocker, assertRunning } from './lib/docker.mjs';
import { run, success } from './lib/log.mjs';
import { installFromManifest } from './lib/plugins.mjs';

run( async () => {
	assertDocker();
	await assertRunning();
	const { installed, missingPremium } = await installFromManifest();
	if ( missingPremium.length ) {
		throw new Error(
			`${ missingPremium.length } premium zip(s) missing. See the list above.`
		);
	}
	if ( ! installed.length ) {
		success( 'Everything in wp-dependencies.json is already installed' );
	}
} );
