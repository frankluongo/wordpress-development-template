import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from './docker.mjs';
import { info, step, success } from './log.mjs';
import { CERTS_DIR, installProxyFiles, writeDynamic } from './proxy.mjs';

export async function hasMkcert() {
	const { code } = await exec( 'mkcert', [ '-help' ], {
		quiet: true,
		allowFail: true,
	} ).catch( () => ( {
		code: 1,
	} ) );
	return code === 0;
}

/**
 * Issue a locally trusted certificate for <domain> and *.<domain> and register it with
 * the proxy (R3.1, R3.2). Wildcards directly under a TLD (*.test) are rejected by
 * browsers, so each project gets its own certificate.
 *
 * @param {string} domain
 * @param {{force?: boolean}} options
 */
export async function ensureCertificate( domain, { force = false } = {} ) {
	if ( ! ( await hasMkcert() ) ) {
		throw new Error(
			'mkcert is not installed. Install it with:\n\n    brew install mkcert nss\n\nthen run this again.'
		);
	}
	installProxyFiles();

	const certFile = join( CERTS_DIR, `${ domain }.pem` );
	const keyFile = join( CERTS_DIR, `${ domain }-key.pem` );

	const { stdout: caRoot } = await exec( 'mkcert', [ '-CAROOT' ], {
		capture: true,
	} );
	if ( ! existsSync( join( caRoot.trim(), 'rootCA.pem' ) ) ) {
		step( 'Installing the local certificate authority (once per machine)' );
		info(
			'mkcert adds a local CA to your macOS keychain and Firefox so browsers trust *.test certificates.'
		);
		info( 'macOS may ask for your password.' );
	}
	// Safe to repeat: it only prompts if the CA isn't trusted yet.
	await exec( 'mkcert', [ '-install' ] );

	if ( force || ! existsSync( certFile ) || ! existsSync( keyFile ) ) {
		step( `Issuing a certificate for ${ domain } and *.${ domain }` );
		await exec(
			'mkcert',
			[
				'-cert-file',
				certFile,
				'-key-file',
				keyFile,
				domain,
				`*.${ domain }`,
			],
			{
				quiet: true,
			}
		);
	}

	writeDynamic(
		domain,
		`# Written by \`npm run setup\`: TLS certificate for ${ domain }.
tls:
  certificates:
    - certFile: /certs/${ domain }.pem
      keyFile: /certs/${ domain }-key.pem
`
	);
	success( `Certificate ready for https://${ domain }` );
}
