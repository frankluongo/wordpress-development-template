import { readFileSync } from 'node:fs';
import { exec } from './docker.mjs';
import { info, step, success } from './log.mjs';

const HOSTS_FILE = '/etc/hosts';

/**
 * Hostnames each project needs.
 *
 * @param {string} domain
 */
export function hostnamesFor( domain ) {
	return [ domain, `hmr.${ domain }`, `mail.${ domain }`, `db.${ domain }` ];
}

const markers = ( domain ) => [
	`# wp-dev:${ domain } start`,
	`# wp-dev:${ domain } end`,
];

/**
 * Remove this project's marker block from hosts file text.
 *
 * @param {string} text
 * @param {string} domain
 */
export function stripBlock( text, domain ) {
	const [ start, end ] = markers( domain );
	const lines = text.split( '\n' );
	const out = [];
	let inside = false;
	for ( const line of lines ) {
		if ( line.trim() === start ) {
			inside = true;
			continue;
		}
		if ( inside && line.trim() === end ) {
			inside = false;
			continue;
		}
		if ( ! inside ) {
			out.push( line );
		}
	}
	return out.join( '\n' );
}

/**
 * Add (or replace) this project's marker block in hosts file text.
 *
 * @param {string} text
 * @param {string} domain
 */
export function withBlock( text, domain ) {
	const [ start, end ] = markers( domain );
	const base = stripBlock( text, domain ).replace( /\n*$/, '\n' );
	const entries = hostnamesFor( domain ).map(
		( name ) => `127.0.0.1 ${ name }`
	);
	return `${ base }${ start }\n${ entries.join( '\n' ) }\n${ end }\n`;
}

async function writeHosts( text ) {
	await exec( 'sudo', [ 'tee', HOSTS_FILE ], { input: text, quiet: true } );
	// Flush the macOS DNS cache so the change applies immediately.
	await exec( 'sudo', [ 'dscacheutil', '-flushcache' ], {
		quiet: true,
		allowFail: true,
	} );
	await exec( 'sudo', [ 'killall', '-HUP', 'mDNSResponder' ], {
		quiet: true,
		allowFail: true,
	} );
}

/**
 * Point the project's hostnames at 127.0.0.1 in /etc/hosts (R3.3).
 *
 * @param {string} domain
 */
export async function addHosts( domain ) {
	const current = readFileSync( HOSTS_FILE, 'utf8' );
	const next = withBlock( current, domain );
	if ( next === current ) {
		success( `/etc/hosts already has ${ domain }` );
		return;
	}
	step( `Adding ${ hostnamesFor( domain ).join( ', ' ) } to /etc/hosts` );
	info(
		'Editing /etc/hosts needs administrator rights, so sudo may ask for your password.'
	);
	await writeHosts( next );
	success( '/etc/hosts updated' );
}

/**
 * @param {string} domain
 */
export async function removeHosts( domain ) {
	const current = readFileSync( HOSTS_FILE, 'utf8' );
	const next = stripBlock( current, domain );
	if ( next === current ) {
		success( `/etc/hosts has no entries for ${ domain }` );
		return;
	}
	step(
		`Removing ${ domain } from /etc/hosts (sudo may ask for your password)`
	);
	await writeHosts( next );
	success( '/etc/hosts updated' );
}
