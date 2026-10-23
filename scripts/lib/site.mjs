import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { compose, exec, wp } from './docker.mjs';
import { siteUrl } from './env.mjs';
import { applyNginxIncludes } from './nginx.mjs';
import { color, info, step, success, warn } from './log.mjs';
import {
	BACKUPS_DIR,
	EXPORTS_DIR,
	getPackages,
	IMPORTS_DIR,
	PREMIUM_DIR,
	ROOT,
} from './paths.mjs';
import { installFromManifest } from './plugins.mjs';
import { DYNAMIC_DIR, proxyUp } from './proxy.mjs';

/**
 * Wait until the php entrypoint has finished installing WordPress.
 *
 * @param {number} timeoutMs
 */
export async function waitForReady( timeoutMs = 10 * 60 * 1000 ) {
	const started = Date.now();
	while ( Date.now() - started < timeoutMs ) {
		const { stdout } = await compose(
			[ 'ps', '-a', 'php', '--format', '{{.State}} {{.Health}}' ],
			{
				capture: true,
				allowFail: true,
			}
		);
		const [ state, health ] = stdout.trim().split( /\s+/ );
		if ( health === 'healthy' ) {
			return;
		}
		if ( state === 'exited' || state === 'dead' ) {
			const { stdout: logs } = await compose(
				[ 'logs', '--tail=30', 'php' ],
				{ capture: true, allowFail: true }
			);
			throw new Error(
				`The php container stopped while starting:\n${ logs }`
			);
		}
		await sleep( 1500 );
	}
	throw new Error(
		'Timed out waiting for WordPress to install. Check `npm run logs`.'
	);
}

/**
 * Generate Composer autoloaders for the theme and plugin if they're missing.
 *
 * @param {Record<string,string>} env
 */
async function ensureAutoloaders( env ) {
	for ( const pkg of getPackages( env ) ) {
		if (
			existsSync( join( pkg.dir, 'composer.json' ) ) &&
			! existsSync( join( pkg.dir, 'vendor/autoload.php' ) )
		) {
			step( `Installing Composer autoloader for ${ pkg.slug }` );
			await compose(
				[
					'exec',
					'-T',
					'-w',
					`/project/${ pkg.dir.slice( ROOT.length + 1 ) }`,
					'php',
					'composer',
					'install',
					'--no-interaction',
					'--quiet',
				],
				{ quiet: true }
			);
		}
	}
}

/**
 * Start the project (R2.1): shared proxy, containers, WordPress install, manifest plugins.
 *
 * @param {Record<string,string>} env
 * @param {{tools?: boolean, build?: boolean}} options
 */
export async function startSite( env, { tools = false, build = true } = {} ) {
	await proxyUp();

	if ( ! existsSync( join( DYNAMIC_DIR, `${ env.SITE_DOMAIN }.yml` ) ) ) {
		warn(
			`No HTTPS certificate is registered for ${ env.SITE_DOMAIN }. Run \`npm run domains:add\`.`
		);
	}

	// Bind-mount sources must exist, or Docker creates them owned by root.
	for ( const dir of [
		IMPORTS_DIR,
		BACKUPS_DIR,
		EXPORTS_DIR,
		PREMIUM_DIR,
	] ) {
		mkdirSync( dir, { recursive: true } );
	}
	await applyNginxIncludes( env );

	step( 'Starting containers' );
	await compose(
		[
			...( tools ? [ '--profile', 'tools' ] : [] ),
			'up',
			'-d',
			...( build ? [ '--build' ] : [] ),
			'--remove-orphans',
		],
		{ quiet: false }
	);

	step( 'Waiting for WordPress (the first run downloads and installs it)' );
	await waitForReady();

	await ensureAutoloaders( env );
	const { missingPremium } = await installFromManifest();

	printUrls( env, tools );
	return { missingPremium };
}

/**
 * @param {Record<string,string>} env
 * @param {boolean} tools
 */
export function printUrls( env, tools = false ) {
	const url = siteUrl( env );
	success( `Site running at ${ color.bold( url ) }` );
	info(
		`Admin:   ${ url }/wp-admin  (${ env.LOCAL_ADMIN_USER || 'admin' } / ${ env.LOCAL_ADMIN_PASSWORD || 'password' })`
	);
	info( `Mail:    https://mail.${ env.SITE_DOMAIN }` );
	if ( tools ) {
		info(
			`DB UI:   https://db.${ env.SITE_DOMAIN }  (server: db, user: ${ env.DB_USER })`
		);
	}
}

/**
 * Open a URL in the default browser (macOS), ignoring failures.
 *
 * @param {string} url
 */
export async function openUrl( url ) {
	await exec( 'open', [ url ], { quiet: true, allowFail: true } ).catch(
		() => {}
	);
}

/**
 * Activate the project's theme and plugin, ignoring ones that don't exist.
 *
 * @param {Record<string,string>} env
 */
export async function activateProjectPackages( env ) {
	for ( const pkg of getPackages( env ) ) {
		await wp( [ pkg.type, 'activate', pkg.slug ], {
			quiet: true,
			allowFail: true,
		} );
	}
}
