import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { readManifest, wp, wpJson } from './docker.mjs';
import { info, step, success, warn } from './log.mjs';
import { MANIFEST_PATH, PREMIUM_DIR } from './paths.mjs';

/**
 * Normalize a manifest entry.
 *
 * @param {string} slug
 * @param {string|{source?: string, version?: string}} spec
 * @return {{slug: string, version: string, source: 'wordpress.org'|'premium'}}
 */
export function normalizeEntry( slug, spec ) {
	if ( typeof spec === 'string' ) {
		return { slug, version: spec, source: 'wordpress.org' };
	}
	return {
		slug,
		version: spec?.version ?? '',
		source: spec?.source === 'premium' ? 'premium' : 'wordpress.org',
	};
}

/**
 * Find the zip for a premium plugin or theme: <slug>-<version>.zip, then <slug>.zip.
 *
 * @param {string}   slug
 * @param {string}   version
 * @param {string[]} files   Contents of premium-plugins/ (for testing).
 * @return {string|null} File name, or null when missing.
 */
export function findPremiumZip( slug, version, files = listPremiumZips() ) {
	const candidates = [ `${ slug }-${ version }.zip`, `${ slug }.zip` ];
	return candidates.find( ( name ) => files.includes( name ) ) ?? null;
}

function listPremiumZips() {
	return existsSync( PREMIUM_DIR )
		? readdirSync( PREMIUM_DIR ).filter( ( f ) => f.endsWith( '.zip' ) )
		: [];
}

/**
 * Write the manifest back, keeping key order stable.
 *
 * @param {object} manifest
 */
export function writeManifest( manifest ) {
	const sortKeys = ( obj = {} ) =>
		Object.fromEntries(
			Object.entries( obj ).sort( ( [ a ], [ b ] ) =>
				a.localeCompare( b )
			)
		);
	writeFileSync(
		MANIFEST_PATH,
		JSON.stringify(
			{
				...manifest,
				plugins: sortKeys( manifest.plugins ),
				themes: sortKeys( manifest.themes ),
			},
			null,
			2
		) + '\n'
	);
}

/**
 * Install everything in wp-dependencies.json that's missing or at the wrong version (R4.3).
 * Activation state is left alone; the database decides it.
 *
 * @param {{quiet?: boolean}} options
 * @return {Promise<{installed: string[], missingPremium: {slug: string, version: string, type: string}[]}>}
 */
export async function installFromManifest( { quiet = false } = {} ) {
	const manifest = readManifest();
	const result = { installed: [], missingPremium: [] };

	for ( const type of [ 'plugin', 'theme' ] ) {
		const entries = Object.entries( manifest[ `${ type }s` ] ?? {} ).map(
			( [ slug, spec ] ) => normalizeEntry( slug, spec )
		);
		if ( ! entries.length ) {
			continue;
		}

		const installed = new Map(
			( await wpJson( [ type, 'list', '--fields=name,version' ] ) ).map(
				( item ) => [ item.name, item.version ]
			)
		);

		for ( const entry of entries ) {
			const current = installed.get( entry.slug );
			if ( current && ( ! entry.version || current === entry.version ) ) {
				continue;
			}
			const label = `${ type } ${ entry.slug }${ entry.version ? `@${ entry.version }` : '' }`;

			if ( entry.source === 'premium' ) {
				const zip = findPremiumZip( entry.slug, entry.version );
				if ( ! zip ) {
					result.missingPremium.push( {
						slug: entry.slug,
						version: entry.version,
						type,
					} );
					continue;
				}
				step( `Installing ${ label } from premium-plugins/${ zip }` );
				await wp(
					[ type, 'install', `/premium-plugins/${ zip }`, '--force' ],
					{ quiet }
				);
			} else {
				step( `Installing ${ label } from wordpress.org` );
				await wp(
					[
						type,
						'install',
						entry.slug,
						...( entry.version
							? [ `--version=${ entry.version }` ]
							: [] ),
						'--force',
					],
					{ quiet }
				);
			}
			result.installed.push( label );
		}
	}

	if ( result.installed.length ) {
		success(
			`Installed ${ result.installed.length } item(s) from wp-dependencies.json`
		);
	}
	if ( result.missingPremium.length ) {
		warn( 'Premium zips missing from premium-plugins/ (R4.2):' );
		for ( const { slug, version, type } of result.missingPremium ) {
			info(
				`${ type } ${ slug }${ version ? ` ${ version }` : '' }: add premium-plugins/${ slug }${
					version ? `-${ version }` : ''
				}.zip`
			);
		}
	}
	return result;
}
