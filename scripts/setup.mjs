// npm run setup: first-time project setup (R7.1–R7.3, R7.7).
//
// On the template: asks for the project details, renames the starters, writes .env,
// issues HTTPS certificates, adds local domains, installs, builds and starts the site.
// On a project already created from the template (no .env yet, e.g. a collaborator's
// fresh clone): skips the renaming and does only the local steps.
//
// Non-interactive: npm run setup -- --name="Acme" --yes [--theme-only|--plugin-only]
//   [--slug=acme] [--domain=acme.test] [--namespace=Acme] [--production-url=https://acme.com]
//   [--php=8.3] [--wp=7.1.3] [--skip-domains] [--skip-start]
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { ensureCertificate } from './lib/certs.mjs';
import { assertDocker, exec, readManifest } from './lib/docker.mjs';
import {
	ENV_EXAMPLE_PATH,
	ENV_PATH,
	hasEnv,
	loadEnv,
	parseEnv,
	updateEnvText,
} from './lib/env.mjs';
import { addHosts } from './lib/hosts.mjs';
import { color, info, run, step, success, warn } from './lib/log.mjs';
import { MANIFEST_PATH, ROOT } from './lib/paths.mjs';
import { confirm, input, select } from './lib/prompt.mjs';
import {
	applyReplacements,
	hasStarterTokens,
	replacementsFor,
	password,
	salt,
	scaffoldStarter,
	STARTER_PLUGIN,
	STARTER_THEME,
	toPascal,
	toSlug,
} from './lib/scaffold.mjs';
import { openUrl, printUrls, startSite } from './lib/site.mjs';

const WP_CONTENT = join( ROOT, 'wp-content' );
const SALT_KEYS = [
	'AUTH_KEY',
	'SECURE_AUTH_KEY',
	'LOGGED_IN_KEY',
	'NONCE_KEY',
	'AUTH_SALT',
	'SECURE_AUTH_SALT',
	'LOGGED_IN_SALT',
	'NONCE_SALT',
];
const validSlug = ( value ) =>
	/^[a-z0-9]+(-[a-z0-9]+)*$/.test( value ) ||
	'Use lowercase letters, numbers and hyphens.';

function isPortFree( port ) {
	return new Promise( ( resolve ) => {
		const server = createServer();
		server.once( 'error', () => resolve( false ) );
		server.listen( port, '127.0.0.1', () =>
			server.close( () => resolve( true ) )
		);
	} );
}

/**
 * A dev server port unlikely to clash with other projects: derived from the slug, then the
 * next free one.
 *
 * @param {string} slug
 */
async function pickDevPort( slug ) {
	const hash = [ ...slug ].reduce(
		( sum, ch ) => ( sum * 31 + ch.charCodeAt( 0 ) ) % 1000,
		7
	);
	for ( let port = 8800 + ( hash % 900 ); port < 9800; port++ ) {
		if ( await isPortFree( port ) ) {
			return port;
		}
	}
	return 8887;
}

/**
 * Ask for (or read from flags) everything needed to rename the starters.
 *
 * @param {Record<string, any>} flags
 */
async function askProjectDetails( flags ) {
	const name =
		flags.name ??
		( await input( 'Project name', { default: 'My Project' } ) );
	const slug =
		flags.slug ??
		( await input( 'Project slug', {
			default: toSlug( name ),
			validate: validSlug,
		} ) );
	const domain =
		flags.domain ??
		( await input( 'Local domain', { default: `${ slug }.test` } ) );

	let build = 'both';
	if ( flags[ 'theme-only' ] ) {
		build = 'theme';
	} else if ( flags[ 'plugin-only' ] ) {
		build = 'plugin';
	} else {
		build = await select( 'What are you building?', [
			{ name: 'Theme and plugin', value: 'both' },
			{ name: 'Theme only', value: 'theme' },
			{ name: 'Plugin only', value: 'plugin' },
		] );
	}

	const namespace =
		flags.namespace ??
		( await input( 'PHP namespace root', {
			default: toPascal( name ),
			validate: ( v ) =>
				/^[A-Z][A-Za-z0-9]*(\\[A-Z][A-Za-z0-9]*)*$/.test( v ) ||
				'Use PascalCase, e.g. Acme',
		} ) );

	const theme =
		build === 'plugin'
			? null
			: {
					slug:
						flags[ 'theme-slug' ] ??
						( await input( 'Theme slug (folder and text domain)', {
							default: `${ slug }-theme`,
							validate: validSlug,
						} ) ),
					name: `${ name } Theme`,
					namespace: `${ namespace }\\Theme`,
				};
	const plugin =
		build === 'theme'
			? null
			: {
					slug:
						flags[ 'plugin-slug' ] ??
						( await input( 'Plugin slug (folder and text domain)', {
							default: `${ slug }-plugin`,
							validate: validSlug,
						} ) ),
					name: `${ name } Plugin`,
					namespace: `${ namespace }\\Plugin`,
				};

	const productionUrl =
		flags[ 'production-url' ] ??
		( await input( 'Production URL (optional)', { default: '' } ) );
	const phpVersion =
		flags.php ??
		( await input( 'PHP version (match production)', { default: '8.3' } ) );
	const dbImage = await select(
		'Database (match production)',
		[
			{ name: 'MariaDB', value: 'mariadb' },
			{ name: 'MySQL', value: 'mysql' },
		],
		'mariadb'
	);
	const dbVersion = await input(
		`${ dbImage === 'mysql' ? 'MySQL' : 'MariaDB' } version`,
		{
			default: dbImage === 'mysql' ? '8.4' : '10.11',
		}
	);
	const wpVersion =
		flags.wp ??
		( await input( 'WordPress version (match production)', {
			default: readManifest().core || 'latest',
		} ) );

	return {
		name,
		slug,
		domain,
		theme,
		plugin,
		productionUrl,
		phpVersion,
		dbImage,
		dbVersion,
		wpVersion,
	};
}

/**
 * Rename starters and write project-wide (shareable) values into .env.example.
 *
 * @param {Awaited<ReturnType<typeof askProjectDetails>>} answers
 */
function scaffold( answers ) {
	step( 'Renaming the starters' );
	for ( const [ type, starter, target ] of [
		[ 'theme', STARTER_THEME, answers.theme ],
		[ 'plugin', STARTER_PLUGIN, answers.plugin ],
	] ) {
		if ( target ) {
			scaffoldStarter( WP_CONTENT, type, target );
			info(
				`${ type }: wp-content/${ type }s/${ target.slug } (${ target.namespace })`
			);
		} else {
			rmSync( join( WP_CONTENT, `${ type }s`, starter ), {
				recursive: true,
				force: true,
			} );
			info( `${ type }: removed (not used)` );
		}
	}

	// Text domains and prefixes in the coding standards ruleset.
	const phpcs = join( ROOT, 'phpcs.xml.dist' );
	let ruleset = readFileSync( phpcs, 'utf8' );
	for ( const [ type, target ] of [
		[ 'theme', answers.theme ],
		[ 'plugin', answers.plugin ],
	] ) {
		if ( target ) {
			ruleset = applyReplacements(
				ruleset,
				replacementsFor( type, target )
			);
		}
	}
	writeFileSync( phpcs, ruleset );

	// Shared project settings go in .env.example so collaborators get them; secrets stay in .env.
	const example = readFileSync( ENV_EXAMPLE_PATH, 'utf8' );
	writeFileSync(
		ENV_EXAMPLE_PATH,
		updateEnvText( example, {
			COMPOSE_PROJECT_NAME: answers.slug,
			SITE_DOMAIN: answers.domain,
			SITE_TITLE: answers.name,
			THEME_SLUG: answers.theme?.slug ?? '',
			PLUGIN_SLUG: answers.plugin?.slug ?? '',
			PHP_VERSION: answers.phpVersion,
			DB_IMAGE: answers.dbImage,
			DB_VERSION: answers.dbVersion,
			LOCAL_ADMIN_EMAIL: `admin@${ answers.domain }`,
			PRODUCTION_URL: answers.productionUrl,
		} )
	);

	const manifest = JSON.parse( readFileSync( MANIFEST_PATH, 'utf8' ) );
	manifest.core = answers.wpVersion;
	writeFileSync( MANIFEST_PATH, JSON.stringify( manifest, null, 2 ) + '\n' );

	// Workspace names changed; drop the lockfile entries for the old ones.
	const lockPath = join( ROOT, 'package-lock.json' );
	try {
		const lock = JSON.parse( readFileSync( lockPath, 'utf8' ) );
		for ( const key of Object.keys( lock.packages ?? {} ) ) {
			if (
				key.includes( STARTER_THEME ) ||
				key.includes( STARTER_PLUGIN )
			) {
				delete lock.packages[ key ];
			}
		}
		writeFileSync( lockPath, JSON.stringify( lock, null, '\t' ) + '\n' );
	} catch {
		// No lockfile yet.
	}
}

/**
 * Create .env from .env.example with secrets and machine-specific values.
 */
async function writeEnv() {
	copyFileSync( ENV_EXAMPLE_PATH, ENV_PATH );
	const env = parseEnv( readFileSync( ENV_PATH, 'utf8' ) );
	const updates = {
		LOCAL_ADMIN_PASSWORD: password(),
		DEV_SERVER_PORT: String(
			await pickDevPort( env.COMPOSE_PROJECT_NAME )
		),
		...Object.fromEntries(
			SALT_KEYS.map( ( key ) => [ `WP_${ key }`, salt() ] )
		),
	};
	writeFileSync(
		ENV_PATH,
		updateEnvText( readFileSync( ENV_PATH, 'utf8' ), updates )
	);
	success( 'Created .env' );
}

run( async () => {
	// R7.7: setup runs once.
	if ( hasEnv() ) {
		warn( 'This project is already set up (.env exists). Nothing to do.' );
		info(
			'Start it with `npm run up`, or delete .env to set up this machine again.'
		);
		return;
	}

	const { values: flags } = parseArgs( {
		name: { type: 'string' },
		slug: { type: 'string' },
		domain: { type: 'string' },
		namespace: { type: 'string' },
		'theme-slug': { type: 'string' },
		'plugin-slug': { type: 'string' },
		'theme-only': { type: 'boolean' },
		'plugin-only': { type: 'boolean' },
		'production-url': { type: 'string' },
		php: { type: 'string' },
		wp: { type: 'string' },
		'skip-domains': { type: 'boolean' },
		'skip-start': { type: 'boolean' },
	} );

	const isTemplate = hasStarterTokens( WP_CONTENT );
	if ( isTemplate ) {
		console.log(
			color.bold(
				'\nNew project from the WordPress development template\n'
			)
		);
		const answers = await askProjectDetails( flags );
		if (
			! flags.yes &&
			! ( await confirm(
				`Rename the starters and set up ${ answers.domain }?`,
				true
			) )
		) {
			throw new Error( 'Setup cancelled.' );
		}
		scaffold( answers );
	} else {
		console.log(
			color.bold( '\nSetting up this project on this machine\n' )
		);
	}

	await writeEnv();
	const env = loadEnv();

	if ( ! flags[ 'skip-domains' ] ) {
		step( 'HTTPS certificate and local domains' );
		await ensureCertificate( env.SITE_DOMAIN );
		await addHosts( env.SITE_DOMAIN );
	}

	step( 'Installing npm packages' );
	await exec( 'npm', [ 'install', '--no-audit', '--no-fund' ] );
	await exec( 'node', [ 'scripts/build.mjs' ] );

	if ( flags[ 'skip-start' ] ) {
		success( 'Setup complete. Start the site with `npm run up`.' );
		return;
	}

	assertDocker();
	await startSite( env );

	console.log( '' );
	success( color.bold( 'Your site is ready' ) );
	printUrls( env );
	info( `The admin password is also in .env (LOCAL_ADMIN_PASSWORD).` );
	console.log( '' );
	info( 'Next steps:' );
	info( '  npm run dev                        hot reloading while you work' );
	info( '  npm run db:import -- <backup.zip>  load a client database' );
	info( '  npm run release                    version and zip for upload' );
	await openUrl( `https://${ env.SITE_DOMAIN }` );
} );
