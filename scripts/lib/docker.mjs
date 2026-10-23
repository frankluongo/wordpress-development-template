import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { loadEnv } from './env.mjs';
import { MANIFEST_PATH, ROOT } from './paths.mjs';

/**
 * Run a command. Streams output by default; `capture` returns stdout instead.
 *
 * @param {string}   cmd
 * @param {string[]} args
 * @param {{capture?: boolean, allowFail?: boolean, input?: string, cwd?: string, env?: object, quiet?: boolean}} options
 * @return {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function exec( cmd, args, options = {} ) {
	const {
		capture = false,
		allowFail = false,
		input,
		cwd = ROOT,
		env,
		quiet = false,
	} = options;
	const output = capture || quiet ? 'pipe' : 'inherit';
	let stdin = output === 'pipe' ? 'ignore' : 'inherit';
	if ( input !== undefined ) {
		stdin = 'pipe';
	}
	return new Promise( ( resolvePromise, reject ) => {
		const child = spawn( cmd, args, {
			cwd,
			env: { ...process.env, ...env },
			stdio: [ stdin, output, output ],
		} );
		let stdout = '';
		let stderr = '';
		child.stdout?.on( 'data', ( chunk ) => ( stdout += chunk ) );
		child.stderr?.on( 'data', ( chunk ) => ( stderr += chunk ) );
		if ( input !== undefined ) {
			child.stdin.end( input );
		}
		child.on( 'error', ( err ) => {
			if ( err.code === 'ENOENT' ) {
				reject(
					new Error(
						`\`${ cmd }\` was not found. Is it installed and on your PATH?`
					)
				);
			} else {
				reject( err );
			}
		} );
		child.on( 'close', ( code ) => {
			if ( code !== 0 && ! allowFail ) {
				const detail = ( stderr || stdout )
					.trim()
					.split( '\n' )
					.slice( -5 )
					.join( '\n' );
				reject(
					new Error(
						`\`${ cmd } ${ args.join( ' ' ) }\` exited with code ${ code }${
							detail ? `\n${ detail }` : ''
						}`
					)
				);
				return;
			}
			resolvePromise( { code, stdout, stderr } );
		} );
	} );
}

/**
 * Read the dependency manifest (wp-dependencies.json).
 *
 * @return {{core?: string, plugins?: Record<string, string|{source: string, version: string}>, themes?: Record<string, string|{source: string, version: string}>}}
 */
export function readManifest() {
	if ( ! existsSync( MANIFEST_PATH ) ) {
		return { plugins: {}, themes: {} };
	}
	return JSON.parse( readFileSync( MANIFEST_PATH, 'utf8' ) );
}

/**
 * Extra environment passed to every `docker compose` call.
 */
function composeEnv() {
	const env = loadEnv();
	return {
		WP_VERSION: env.WP_VERSION || readManifest().core || 'latest',
	};
}

/**
 * Run `docker compose` for this project.
 *
 * @param {string[]} args
 * @param {Parameters<typeof exec>[2]} options
 */
export function compose( args, options = {} ) {
	return exec(
		'docker',
		[ 'compose', '--project-directory', ROOT, ...args ],
		{
			...options,
			env: { ...composeEnv(), ...options.env },
		}
	);
}

/**
 * Run WP-CLI inside the php container as the web server user.
 *
 * @param {string[]} args
 * @param {Parameters<typeof exec>[2]} options
 */
export function wp( args, options = {} ) {
	return compose(
		[ 'exec', '-T', '-u', 'www-data', 'php', 'wp', ...args ],
		options
	);
}

/**
 * Run WP-CLI and parse JSON output.
 *
 * @param {string[]} args
 */
export async function wpJson( args ) {
	const { stdout } = await wp( [ ...args, '--format=json' ], {
		capture: true,
	} );
	return JSON.parse( stdout.trim() || 'null' );
}

/**
 * Whether a compose service is running.
 *
 * @param {string} service
 */
export async function isRunning( service ) {
	const { stdout } = await compose(
		[ 'ps', '--status', 'running', '--services' ],
		{
			capture: true,
			allowFail: true,
		}
	);
	return stdout
		.split( '\n' )
		.map( ( s ) => s.trim() )
		.includes( service );
}

/**
 * Fail early with a clear message if the Docker daemon isn't reachable.
 */
export function assertDocker() {
	const result = spawnSync( 'docker', [ 'info' ], { stdio: 'ignore' } );
	if ( result.error?.code === 'ENOENT' ) {
		throw new Error(
			'Docker is not installed. Install Docker Desktop: https://www.docker.com/products/docker-desktop/'
		);
	}
	if ( result.status !== 0 ) {
		throw new Error(
			'Docker is not running. Start Docker Desktop and try again.'
		);
	}
}

/**
 * Make sure the php container is running.
 */
export async function assertRunning() {
	if ( ! ( await isRunning( 'php' ) ) ) {
		throw new Error(
			'The site is not running. Start it with `npm run up`.'
		);
	}
}
