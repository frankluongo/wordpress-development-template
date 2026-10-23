// npm run plugins:check: compare the database's active plugins/themes with what's installed
// and declared in wp-dependencies.json, and offer to add missing ones (R4.4, R4.6).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compare, pluginSlug, STATUS } from './lib/compare.mjs';
import {
	assertDocker,
	assertRunning,
	readManifest,
	wp,
	wpJson,
} from './lib/docker.mjs';
import { loadEnv } from './lib/env.mjs';
import { color, info, run, step, success, table, warn } from './lib/log.mjs';
import { zipDirectory } from './lib/archive.mjs';
import { DB_DIR, PREMIUM_DIR } from './lib/paths.mjs';
import { installFromManifest, writeManifest } from './lib/plugins.mjs';
import { confirm, input } from './lib/prompt.mjs';

/**
 * Look a slug up on wordpress.org.
 *
 * @param {'plugin'|'theme'} type
 * @param {string}           slug
 * @return {Promise<{version: string}|null>}
 */
async function wordpressOrgInfo( type, slug ) {
	const url =
		type === 'plugin'
			? `https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=${ encodeURIComponent( slug ) }&request[fields][sections]=0`
			: `https://api.wordpress.org/themes/info/1.2/?action=theme_information&request[slug]=${ encodeURIComponent( slug ) }`;
	try {
		const response = await fetch( url, {
			signal: AbortSignal.timeout( 10000 ),
		} );
		if ( ! response.ok ) {
			return null;
		}
		const data = await response.json();
		return data?.version && ! data.error ? { version: data.version } : null;
	} catch {
		return null;
	}
}

function readLastImport() {
	const file = join( DB_DIR, 'last-import.json' );
	return existsSync( file ) ? JSON.parse( readFileSync( file, 'utf8' ) ) : {};
}

const paint = ( status ) =>
	( {
		[ STATUS.OK ]: color.green,
		[ STATUS.PROJECT ]: color.dim,
		[ STATUS.MISSING ]: color.red,
		[ STATUS.MISMATCH ]: color.yellow,
		[ STATUS.UNLISTED ]: color.yellow,
	} )[ status ] ?? String;

/**
 * @param {Record<string,string>} env
 * @param {{importDirs?: {plugin?: string, theme?: string}}} options importDirs: wp-content/plugins
 *        and themes extracted from a full-site import zip, used to copy premium items (R4.6).
 */
export async function checkPlugins(
	env = loadEnv(),
	{ importDirs = {} } = {}
) {
	const manifest = readManifest();
	manifest.plugins ??= {};
	manifest.themes ??= {};
	const lastImport = readLastImport();
	let manifestChanged = false;
	let problems = 0;

	const activePlugins = (
		( await wpJson( [ 'option', 'get', 'active_plugins' ] ) ) ?? []
	).map( pluginSlug );
	const { stdout: template } = await wp( [ 'option', 'get', 'template' ], {
		capture: true,
		allowFail: true,
	} );
	const { stdout: stylesheet } = await wp(
		[ 'option', 'get', 'stylesheet' ],
		{ capture: true, allowFail: true }
	);
	const activeThemes = [
		...new Set( [ template.trim(), stylesheet.trim() ].filter( Boolean ) ),
	];

	const sections = [
		{
			type: 'plugin',
			active: activePlugins,
			projectSlug: env.PLUGIN_SLUG,
			importVersions: lastImport.plugins ?? {},
		},
		{
			type: 'theme',
			active: activeThemes,
			projectSlug: env.THEME_SLUG,
			importVersions: lastImport.themes ?? {},
		},
	];

	for ( const section of sections ) {
		const installed = Object.fromEntries(
			(
				await wpJson( [
					section.type,
					'list',
					'--fields=name,version',
				] )
			).map( ( item ) => [ item.name, item.version ] )
		);
		const rows = compare( {
			active: section.active,
			installed,
			manifest: manifest[ `${ section.type }s` ],
			projectSlug: section.projectSlug,
			importVersions: section.importVersions,
		} );

		console.log( '' );
		table(
			[
				section.type === 'plugin' ? 'Plugin' : 'Theme',
				'Active',
				'Installed',
				'Expected',
				'Status',
			],
			rows.map( ( row ) => [
				row.slug,
				row.active ? 'yes' : '',
				row.installed || '-',
				row.expected || '-',
				paint( row.status )( row.status ),
			] )
		);

		for ( const row of rows ) {
			if ( row.status === STATUS.OK || row.status === STATUS.PROJECT ) {
				continue;
			}
			problems++;
			if ( row.source ) {
				// Declared but not installed or at the wrong version: plugins:install fixes it.
				continue;
			}

			const remote = await wordpressOrgInfo( section.type, row.slug );
			// Prefer the production version from an imported full-site zip, then what's installed.
			const knownVersion = row.expected || row.installed;

			if ( remote ) {
				const suggested = knownVersion || remote.version;
				const note = knownVersion
					? ''
					: ' (latest on wordpress.org; production may differ)';
				if (
					await confirm(
						`Add ${ section.type } ${ row.slug } @ ${ suggested }${ note } to wp-dependencies.json?`,
						false
					)
				) {
					const version = await input(
						`Version of ${ row.slug } on production`,
						{ default: suggested }
					);
					manifest[ `${ section.type }s` ][ row.slug ] = version;
					manifestChanged = true;
				}
			} else {
				warn(
					`${ row.slug } isn't on wordpress.org, so it's probably premium.`
				);
				if (
					await confirm(
						`Add ${ row.slug } as a premium ${ section.type }?`,
						false
					)
				) {
					const version = await input(
						`Version of ${ row.slug } on production`,
						{ default: knownVersion }
					);
					manifest[ `${ section.type }s` ][ row.slug ] = {
						source: 'premium',
						version,
					};
					manifestChanged = true;

					const zipName = `${ row.slug }-${ version }.zip`;
					const extracted =
						importDirs[ section.type ] &&
						join( importDirs[ section.type ], row.slug );
					if (
						extracted &&
						existsSync( extracted ) &&
						! existsSync( join( PREMIUM_DIR, zipName ) ) &&
						( await confirm(
							`The import zip includes ${ row.slug }. Save it as premium-plugins/${ zipName }?`,
							true
						) )
					) {
						await zipDirectory(
							extracted,
							join( PREMIUM_DIR, zipName ),
							row.slug
						);
						success( `Saved premium-plugins/${ zipName }` );
					} else {
						info( `Put its zip at premium-plugins/${ zipName }` );
					}
				}
			}
		}
	}

	console.log( '' );
	if ( manifestChanged ) {
		writeManifest( manifest );
		success( 'Updated wp-dependencies.json' );
		if ( await confirm( 'Install the additions now?', true ) ) {
			await installFromManifest();
		} else {
			info( 'Run `npm run plugins:install` when ready.' );
		}
	}
	if ( problems ) {
		warn(
			`${ problems } item(s) need attention. Declared items are fixed by \`npm run plugins:install\`.`
		);
	} else {
		success(
			'Active plugins and themes match what is installed and declared'
		);
	}
	return { problems };
}

if (
	process.argv[ 1 ] &&
	import.meta.url === pathToFileURL( process.argv[ 1 ] ).href
) {
	run( async () => {
		assertDocker();
		await assertRunning();
		step(
			'Comparing active plugins and themes with local installs and wp-dependencies.json'
		);
		await checkPlugins();
	} );
}
