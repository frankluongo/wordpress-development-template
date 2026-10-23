import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { exec } from './docker.mjs';
import { step, success, warn } from './log.mjs';
import { ROOT } from './paths.mjs';

export const PROXY_NAME = 'wp-dev-proxy';
export const PROXY_DIR = join( homedir(), '.config', PROXY_NAME );
export const CERTS_DIR = join( PROXY_DIR, 'certs' );
export const DYNAMIC_DIR = join( PROXY_DIR, 'dynamic' );

const TEMPLATE_DIR = join( ROOT, 'proxy' );
const PROXY_FILES = [ 'compose.yaml', 'traefik.yml', 'version' ];

function readVersion( dir ) {
	const file = join( dir, 'version' );
	return existsSync( file )
		? Number( readFileSync( file, 'utf8' ).trim() ) || 0
		: 0;
}

/**
 * Copy the proxy definition to ~/.config/wp-dev-proxy when missing or older.
 *
 * @return {boolean} Whether files were updated.
 */
export function installProxyFiles() {
	mkdirSync( CERTS_DIR, { recursive: true } );
	mkdirSync( DYNAMIC_DIR, { recursive: true } );
	if ( readVersion( PROXY_DIR ) >= readVersion( TEMPLATE_DIR ) ) {
		return false;
	}
	for ( const file of PROXY_FILES ) {
		copyFileSync( join( TEMPLATE_DIR, file ), join( PROXY_DIR, file ) );
	}
	return true;
}

function proxyCompose( args, options = {} ) {
	return exec(
		'docker',
		[
			'compose',
			'--project-directory',
			PROXY_DIR,
			'-p',
			PROXY_NAME,
			...args,
		],
		options
	);
}

export async function isProxyRunning() {
	const { stdout } = await exec(
		'docker',
		[
			'ps',
			'--filter',
			`name=^${ PROXY_NAME }$`,
			'--filter',
			'status=running',
			'--format',
			'{{.Names}}',
		],
		{ capture: true, allowFail: true }
	);
	return stdout.trim() === PROXY_NAME;
}

async function ensureNetwork() {
	const { code } = await exec(
		'docker',
		[ 'network', 'inspect', PROXY_NAME ],
		{
			quiet: true,
			allowFail: true,
		}
	);
	if ( code !== 0 ) {
		await exec( 'docker', [ 'network', 'create', PROXY_NAME ], {
			quiet: true,
		} );
	}
}

/**
 * Name whatever is already listening on 80/443, so a port conflict is easy to fix.
 */
async function describePortConflicts() {
	const { stdout } = await exec(
		'lsof',
		[ '-nP', '-iTCP:80', '-iTCP:443', '-sTCP:LISTEN' ],
		{
			capture: true,
			allowFail: true,
		}
	);
	const lines = stdout.trim().split( '\n' ).slice( 1 ).filter( Boolean );
	const names = [
		...new Set( lines.map( ( line ) => line.split( /\s+/ )[ 0 ] ) ),
	];
	return names.filter(
		( name ) => ! /^com\.docke|^docker|^vpnkit/i.test( name )
	);
}

/**
 * Start the shared proxy. A no-op when it's already running and up to date.
 */
export async function proxyUp() {
	const updated = installProxyFiles();
	await ensureNetwork();
	if ( ( await isProxyRunning() ) && ! updated ) {
		return;
	}
	if ( ! ( await isProxyRunning() ) ) {
		const conflicts = await describePortConflicts();
		if ( conflicts.length ) {
			throw new Error(
				`Ports 80/443 are already in use by: ${ conflicts.join( ', ' ) }.\n` +
					'Stop that program (e.g. MAMP, Valet, Local, another web server) and run this again.'
			);
		}
	}
	step(
		updated
			? 'Starting the shared HTTPS proxy (updated definition)'
			: 'Starting the shared HTTPS proxy'
	);
	await proxyCompose( [ 'up', '-d', '--remove-orphans' ], { quiet: true } );
	success( `Shared proxy running (${ PROXY_DIR })` );
}

export async function proxyDown() {
	const { stdout } = await exec(
		'docker',
		[
			'network',
			'inspect',
			PROXY_NAME,
			'--format',
			'{{range .Containers}}{{.Name}} {{end}}',
		],
		{ capture: true, allowFail: true }
	);
	const others = stdout
		.trim()
		.split( /\s+/ )
		.filter( ( name ) => name && name !== PROXY_NAME );
	if ( others.length ) {
		warn(
			`These containers still use the proxy and will be unreachable: ${ others.join( ', ' ) }`
		);
	}
	await proxyCompose( [ 'down' ], { quiet: true, allowFail: true } );
	success( 'Shared proxy stopped' );
}

export async function proxyStatus() {
	return {
		running: await isProxyRunning(),
		dir: PROXY_DIR,
	};
}

/**
 * Write a Traefik dynamic config file. Traefik picks it up without a restart.
 *
 * @param {string} name
 * @param {string} yaml
 */
export function writeDynamic( name, yaml ) {
	mkdirSync( DYNAMIC_DIR, { recursive: true } );
	writeFileSync( join( DYNAMIC_DIR, `${ name }.yml` ), yaml );
}

/**
 * @param {string} name
 */
export function removeDynamic( name ) {
	rmSync( join( DYNAMIC_DIR, `${ name }.yml` ), { force: true } );
}

/**
 * Route hmr.<domain> to the asset dev server on the host (R3.6).
 *
 * @param {string} domain
 * @param {number|string} port
 */
export function writeHmrRoute( domain, port ) {
	const id = domain.replace( /[^a-z0-9]/gi, '-' );
	writeDynamic(
		`${ domain }-hmr`,
		`# Written by \`npm run dev\`; removed when it stops.
http:
  routers:
    ${ id }-hmr:
      rule: "Host(\`hmr.${ domain }\`)"
      entryPoints: [websecure]
      service: ${ id }-hmr
      tls: {}
  services:
    ${ id }-hmr:
      loadBalancer:
        servers:
          - url: "http://host.docker.internal:${ port }"
`
	);
}

/**
 * @param {string} domain
 */
export function removeHmrRoute( domain ) {
	removeDynamic( `${ domain }-hmr` );
}
