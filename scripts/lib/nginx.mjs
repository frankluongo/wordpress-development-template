import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { compose, isRunning } from './docker.mjs';
import { ROOT } from './paths.mjs';

const NGINX_DIR = join( ROOT, 'docker/nginx' );
const INCLUDES_DIR = join( NGINX_DIR, 'includes' );
const UPLOADS_FRAGMENT = join( INCLUDES_DIR, 'uploads-proxy.conf' );

/**
 * Render optional nginx fragments from .env. Returns true when anything changed.
 *
 * @param {Record<string,string>} env
 */
export function renderNginxIncludes( env ) {
	mkdirSync( INCLUDES_DIR, { recursive: true } );
	const before = existsSync( UPLOADS_FRAGMENT )
		? readFileSync( UPLOADS_FRAGMENT, 'utf8' )
		: null;

	const proxyUrl = ( env.UPLOADS_PROXY_URL || '' )
		.trim()
		.replace( /\/+$/, '' );
	if ( proxyUrl ) {
		if ( ! /^https?:\/\/[^\s;'"$]+$/.test( proxyUrl ) ) {
			throw new Error(
				`UPLOADS_PROXY_URL is not a valid URL: ${ proxyUrl }`
			);
		}
		const template = readFileSync(
			join( NGINX_DIR, 'uploads-proxy.conf.template' ),
			'utf8'
		);
		const rendered = template.replaceAll(
			'${UPLOADS_PROXY_URL}',
			proxyUrl
		);
		writeFileSync( UPLOADS_FRAGMENT, rendered );
		return rendered !== before;
	}

	rmSync( UPLOADS_FRAGMENT, { force: true } );
	return before !== null;
}

/**
 * Render fragments and reload nginx if it's running and something changed.
 *
 * @param {Record<string,string>} env
 */
export async function applyNginxIncludes( env ) {
	if ( renderNginxIncludes( env ) && ( await isRunning( 'nginx' ) ) ) {
		await compose( [ 'exec', '-T', 'nginx', 'nginx', '-s', 'reload' ], {
			quiet: true,
		} );
	}
}
