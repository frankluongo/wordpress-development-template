import { normalizeEntry } from './plugins.mjs';

export const STATUS = {
	OK: 'ok',
	PROJECT: 'project',
	MISSING: 'missing',
	MISMATCH: 'version mismatch',
	UNLISTED: 'not in manifest',
};

/**
 * Compare what the database expects with what's installed and declared (R4.4).
 *
 * @param {object}                 input
 * @param {string[]}               input.active          Slugs active in the database.
 * @param {Record<string,string>}  input.installed       Installed slug → version.
 * @param {Record<string,any>}     input.manifest        Manifest section (plugins or themes).
 * @param {string}                 [input.projectSlug]   The project's own theme/plugin.
 * @param {Record<string,string>}  [input.importVersions] Versions read from an imported full-site zip.
 * @return {{slug: string, active: boolean, installed: string, expected: string, source: string, status: string}[]}
 */
export function compare( {
	active,
	installed,
	manifest,
	projectSlug = '',
	importVersions = {},
} ) {
	const slugs = [
		...new Set( [ ...active, ...Object.keys( manifest ) ] ),
	].sort();

	return slugs.map( ( slug ) => {
		const declared =
			manifest[ slug ] !== undefined
				? normalizeEntry( slug, manifest[ slug ] )
				: null;
		const installedVersion = installed[ slug ] ?? '';
		const row = {
			slug,
			active: active.includes( slug ),
			installed: installedVersion,
			expected: declared?.version || importVersions[ slug ] || '',
			source: declared?.source ?? '',
			status: STATUS.OK,
		};

		if ( slug === projectSlug ) {
			row.status = STATUS.PROJECT;
			row.expected = '';
		} else if ( ! installedVersion ) {
			row.status = STATUS.MISSING;
		} else if ( ! declared ) {
			row.status = STATUS.UNLISTED;
		} else if (
			declared.version &&
			declared.version !== installedVersion
		) {
			row.status = STATUS.MISMATCH;
		}
		return row;
	} );
}

/**
 * Plugin slug from an active_plugins entry ("akismet/akismet.php" → "akismet", "hello.php" → "hello").
 *
 * @param {string} entry
 */
export function pluginSlug( entry ) {
	return entry.includes( '/' )
		? entry.split( '/' )[ 0 ]
		: entry.replace( /\.php$/, '' );
}
