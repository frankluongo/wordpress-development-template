// npm run db:import [file] [-- --sanitize] [-- --with-uploads] [-- --yes]
//
// Replaces the local database with a client's, from a .zip, .sql or .sql.gz (R5.1–R5.11):
// finds the dump (also inside nested folders), backs up the current database, imports,
// matches the table prefix, rewrites URLs, makes sure you can log in, deactivates plugins
// that misbehave locally, and proxies missing media from production.
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	readdirSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { extractZip, listZip } from './lib/archive.mjs';
import {
	applyEnvChanges,
	createBackup,
	importDatabase,
	pruneBackups,
	restoreBackup,
	timestamp,
} from './lib/backups.mjs';
import {
	assertDocker,
	assertRunning,
	compose,
	wp,
	wpJson,
} from './lib/docker.mjs';
import {
	findSqlFiles,
	IMPORT_PATTERN,
	inspectDump,
	searchReplacePairs,
	writeFilteredDump,
} from './lib/dump.mjs';
import { loadEnv, siteUrl } from './lib/env.mjs';
import { readVersions } from './lib/headers.mjs';
import { color, info, run, step, success, warn } from './lib/log.mjs';
import { DB_DIR, IMPORTS_DIR, ROOT, TMP_DIR } from './lib/paths.mjs';
import { confirm, input, isInteractive, select } from './lib/prompt.mjs';
import { activateProjectPackages } from './lib/site.mjs';
import { checkPlugins } from './plugins-check.mjs';

const formatSize = ( bytes ) => `${ ( bytes / 1024 / 1024 ).toFixed( 1 ) } MB`;

/**
 * Pick the import file: the given path, or the newest candidate after confirmation (R5.2).
 *
 * @param {string|undefined} given
 * @param {Record<string,string>} env
 */
async function resolveSource( given, env ) {
	if ( given ) {
		const file = resolve( given.replace( /^~(?=$|\/)/, homedir() ) );
		if ( ! existsSync( file ) ) {
			throw new Error( `File not found: ${ given }` );
		}
		if ( ! IMPORT_PATTERN.test( file ) ) {
			throw new Error(
				`Unsupported file type: ${ basename( file ) }. Use a .zip, .sql or .sql.gz.`
			);
		}
		return file;
	}

	const dirs = [ IMPORTS_DIR ];
	if ( env.IMPORT_SCAN_DOWNLOADS === 'true' ) {
		dirs.push( join( homedir(), 'Downloads' ) );
	}
	const candidates = dirs
		.filter( existsSync )
		.flatMap( ( dir ) =>
			readdirSync( dir )
				.filter(
					( name ) =>
						IMPORT_PATTERN.test( name ) && ! name.startsWith( '.' )
				)
				.map( ( name ) => join( dir, name ) )
		)
		.map( ( file ) => ( {
			file,
			mtime: statSync( file ).mtimeMs,
			size: statSync( file ).size,
		} ) )
		.sort( ( a, b ) => b.mtime - a.mtime )
		.slice( 0, 10 );

	if ( ! candidates.length ) {
		throw new Error(
			`No .zip, .sql or .sql.gz found in ${ dirs.map( ( d ) => d.replace( homedir(), '~' ) ).join( ' or ' ) }.\n` +
				'Pass a path: npm run db:import -- ~/Downloads/backup.zip'
		);
	}
	if ( ! isInteractive() && ! process.argv.includes( '--yes' ) ) {
		throw new Error(
			'Pass the file path (or --yes to use the newest file) when running non-interactively.'
		);
	}

	const describe = ( c ) =>
		`${ c.file.replace( homedir(), '~' ) }  ${ color.dim( `${ formatSize( c.size ) }, ${ new Date( c.mtime ).toLocaleString() }` ) }`;
	const file = await select(
		'Import which file? (newest first)',
		candidates.map( ( c ) => ( { name: describe( c ), value: c.file } ) )
	);
	return file;
}

/**
 * Extract the parts of a zip we need: SQL dumps, plugin/theme folders, and uploads if wanted.
 *
 * @param {string}  zipFile
 * @param {string}  workDir
 * @param {{withUploads?: boolean}} options
 */
async function extractImportZip( zipFile, workDir, { withUploads } ) {
	step( `Reading ${ basename( zipFile ) }` );
	const names = await listZip( zipFile );
	const sqlNames = names.filter(
		( name ) =>
			/(\.sql|\.sql\.gz|-db\.gz)$/i.test( name ) &&
			! name.includes( '__MACOSX' )
	);
	if ( ! sqlNames.length ) {
		throw new Error(
			`${ basename( zipFile ) } contains no .sql or .sql.gz file.`
		);
	}
	const hasUploads = names.some( ( name ) =>
		/(^|\/)wp-content\/uploads\/.+[^/]$/.test( name )
	);
	const hasCode = names.some( ( name ) =>
		/(^|\/)wp-content\/(plugins|themes)\/.+[^/]$/.test( name )
	);

	let extractUploads = false;
	if ( hasUploads ) {
		extractUploads =
			withUploads ||
			( await confirm(
				'The zip contains wp-content/uploads. Copy media into the local site? (No: missing media loads from production instead)',
				false
			) );
	}

	step( 'Extracting' );
	await extractZip( zipFile, workDir, ( name ) => {
		if ( name.includes( '__MACOSX' ) ) {
			return false;
		}
		return (
			sqlNames.includes( name ) ||
			( hasCode &&
				/(^|\/)wp-content\/(plugins|themes)\//.test( name ) ) ||
			( extractUploads && /(^|\/)wp-content\/uploads\//.test( name ) )
		);
	} );

	// Locate wp-content inside the extracted tree (often nested, e.g. public_html/wp-content).
	const wpContent = [ ...names ]
		.map( ( name ) => name.match( /^(.*?wp-content)\// )?.[ 1 ] )
		.find( Boolean );

	return {
		sqlFiles: findSqlFiles( workDir ),
		wpContentDir: wpContent ? join( workDir, wpContent ) : null,
		extractUploads,
	};
}

/**
 * Ensure the local admin from .env can log in (R5.6).
 *
 * @param {Record<string,string>} env
 */
async function ensureAdmin( env ) {
	const user = env.LOCAL_ADMIN_USER || 'admin';
	const pass = env.LOCAL_ADMIN_PASSWORD || 'password';
	const email = env.LOCAL_ADMIN_EMAIL || `admin@${ env.SITE_DOMAIN }`;

	const { code } = await wp( [ 'user', 'get', user, '--field=ID' ], {
		quiet: true,
		allowFail: true,
	} );
	if ( code === 0 ) {
		await wp(
			[
				'user',
				'update',
				user,
				`--user_pass=${ pass }`,
				'--role=administrator',
				'--skip-email',
			],
			{ quiet: true }
		);
		await wp(
			[
				'user',
				'update',
				user,
				`--user_email=${ email }`,
				'--skip-email',
			],
			{ quiet: true, allowFail: true }
		);
	} else {
		const created = await wp(
			[
				'user',
				'create',
				user,
				email,
				'--role=administrator',
				`--user_pass=${ pass }`,
			],
			{
				quiet: true,
				allowFail: true,
			}
		);
		if ( created.code !== 0 ) {
			// The email may already belong to a client user.
			await wp(
				[
					'user',
					'create',
					user,
					`${ user }+${ Date.now() }@${ env.SITE_DOMAIN }`,
					'--role=administrator',
					`--user_pass=${ pass }`,
				],
				{ quiet: true }
			);
		}
	}
	success( `Local admin ready: ${ user } / ${ pass }` );
}

/**
 * Scrub personal data (R5.9).
 *
 * @param {Record<string,string>} env
 * @param {string}                prefix
 * @param {string}                workDir
 */
async function sanitize( env, prefix, workDir ) {
	step( 'Sanitizing personal data' );
	const sql = readFileSync( join( ROOT, 'scripts/sql/sanitize.sql' ), 'utf8' )
		.replaceAll( '{{prefix}}', prefix )
		.replaceAll(
			'{{admin_user}}',
			( env.LOCAL_ADMIN_USER || 'admin' ).replace( /'/g, "''" )
		)
		.replaceAll(
			'{{admin_email}}',
			( env.LOCAL_ADMIN_EMAIL || `admin@${ env.SITE_DOMAIN }` ).replace(
				/'/g,
				"''"
			)
		);

	const { stdout } = await wp(
		[ 'db', 'tables', '--all-tables-with-prefix', '--format=csv' ],
		{ capture: true }
	);
	const tables = stdout.trim().split( ',' );
	const wooTables = [
		'wc_orders',
		'wc_orders_meta',
		'wc_order_addresses',
		'wc_order_operational_data',
		'wc_order_stats',
		'wc_order_product_lookup',
		'wc_order_tax_lookup',
		'wc_order_coupon_lookup',
		'wc_customer_lookup',
		'woocommerce_order_items',
		'woocommerce_order_itemmeta',
		'woocommerce_sessions',
		'wc_download_log',
	]
		.map( ( name ) => prefix + name )
		.filter( ( name ) => tables.includes( name ) );
	const truncates = wooTables
		.map( ( name ) => `TRUNCATE TABLE \`${ name }\`;` )
		.join( '\n' );

	const file = join( workDir, 'sanitize.sql' );
	writeFileSync( file, `${ sql }\n${ truncates }\n` );
	await compose(
		[
			'exec',
			'-T',
			'-u',
			'www-data',
			'php',
			'bash',
			'-c',
			'wp db query < "$1"',
			'bash',
			`/db/tmp/${ basename( workDir ) }/sanitize.sql`,
		],
		{
			quiet: true,
		}
	);
	success(
		`Sanitized users, comments and orders${ wooTables.length ? ` (${ wooTables.length } WooCommerce tables emptied)` : '' }`
	);
}

run( async () => {
	const { values, positionals } = parseArgs( {
		sanitize: { type: 'boolean' },
		'with-uploads': { type: 'boolean' },
	} );
	const env = loadEnv();
	assertDocker();
	await assertRunning();

	const source = await resolveSource( positionals[ 0 ], env );
	if (
		! values.yes &&
		! ( await confirm(
			`Replace the local database with ${ basename( source ) }?`,
			true
		) )
	) {
		throw new Error( 'Import cancelled.' );
	}

	const workDir = join( TMP_DIR, timestamp() );
	mkdirSync( workDir, { recursive: true } );
	let backup = null;
	let imported = false;

	try {
		// 1–2. Locate the dump.
		let dumpFile;
		let wpContentDir = null;
		let uploadsExtracted = false;
		if ( /\.zip$/i.test( source ) ) {
			const extracted = await extractImportZip( source, workDir, {
				withUploads: values[ 'with-uploads' ],
			} );
			wpContentDir = extracted.wpContentDir;
			uploadsExtracted = extracted.extractUploads;
			dumpFile = extracted.sqlFiles[ 0 ];
			if ( extracted.sqlFiles.length > 1 ) {
				dumpFile = await select(
					'The zip contains more than one SQL file. Which is the WordPress database?',
					extracted.sqlFiles.map( ( file ) => ( {
						name: `${ file.slice( workDir.length + 1 ) }  ${ color.dim( formatSize( statSync( file ).size ) ) }`,
						value: file,
					} ) )
				);
			}
		} else {
			// The container only sees .db/, so copy files from elsewhere into the work dir.
			dumpFile = source.startsWith( DB_DIR )
				? source
				: join( workDir, basename( source ) );
			if ( dumpFile !== source ) {
				copyFileSync( source, dumpFile );
			}
		}

		// 3. Inspect: prefix, production URL, statements that need filtering.
		step( `Inspecting ${ basename( dumpFile ) }` );
		const dump = await inspectDump( dumpFile );
		if ( ! dump.prefixes.length ) {
			throw new Error(
				`${ basename( dumpFile ) } doesn't look like a WordPress database (no options/posts tables found).`
			);
		}
		const prefix =
			dump.prefixes.length === 1
				? dump.prefixes[ 0 ]
				: await select(
						'The dump contains more than one WordPress site. Which table prefix?',
						dump.prefixes.map( ( p ) => ( { name: p, value: p } ) )
					);
		const detectedUrl =
			dump.urls[ prefix ]?.home || dump.urls[ prefix ]?.siteurl;
		const productionUrl = (
			detectedUrl ||
			env.PRODUCTION_URL ||
			( await input( 'Production URL (e.g. https://example.com)' ) )
		).replace( /\/+$/, '' );
		info(
			`Table prefix: ${ prefix }   Production URL: ${ productionUrl }`
		);

		if ( dump.needsFilter ) {
			step(
				'Removing statements that would fail locally (USE, DEFINER, GTID, MySQL 8 collations)'
			);
			const filtered = join( workDir, 'filtered.sql.gz' );
			await writeFilteredDump(
				dumpFile,
				filtered,
				( env.DB_IMAGE || 'mariadb' ) === 'mariadb'
			);
			dumpFile = filtered;
		}

		// 4. Back up, then 5. import. A failure restores the backup (R5.11).
		backup = await createBackup( 'pre-import' );
		step( 'Importing (large databases take a while)' );
		await importDatabase( dumpFile );
		imported = true;

		// 6. Match the table prefix (R5.5).
		await applyEnvChanges( { TABLE_PREFIX: prefix } );

		// 7. Rewrite URLs (R5.3).
		const localUrl = siteUrl( env );
		const pairs = searchReplacePairs( productionUrl, localUrl ).filter(
			( [ from ] ) => dump.contents( from )
		);
		step( `Rewriting ${ productionUrl } → ${ localUrl }` );
		for ( const [ from, to ] of pairs ) {
			const { stdout } = await wp(
				[
					'search-replace',
					from,
					to,
					'--all-tables-with-prefix',
					'--precise',
					'--skip-columns=guid',
					'--format=count',
				],
				{ capture: true }
			);
			info(
				`${ from } → ${ to }  ${ color.dim( `${ stdout.trim() } replacements` ) }`
			);
		}
		await wp( [ 'option', 'update', 'home', localUrl ], { quiet: true } );
		await wp( [ 'option', 'update', 'siteurl', localUrl ], {
			quiet: true,
		} );

		// 8. Make the site usable locally.
		await ensureAdmin( env );
		await activateProjectPackages( env );
		const toDeactivate = ( env.LOCAL_DEACTIVATE_PLUGINS || '' )
			.split( ',' )
			.map( ( s ) => s.trim() )
			.filter( Boolean );
		if ( toDeactivate.length ) {
			const active =
				( await wpJson( [
					'plugin',
					'list',
					'--status=active',
					'--field=name',
				] ) ) ?? [];
			const hits = toDeactivate.filter( ( slug ) =>
				active.includes( slug )
			);
			if ( hits.length ) {
				await wp( [ 'plugin', 'deactivate', ...hits ], {
					quiet: true,
					allowFail: true,
				} );
				info( `Deactivated for local use: ${ hits.join( ', ' ) }` );
			}
		}

		// Uploads (R5.8): copy them if extracted; proxy anything missing from production either way.
		if (
			uploadsExtracted &&
			wpContentDir &&
			existsSync( join( wpContentDir, 'uploads' ) )
		) {
			step( 'Copying media into the site' );
			const from = `/db/tmp/${ basename( workDir ) }${ join( wpContentDir, 'uploads' ).slice( workDir.length ) }/`;
			await compose(
				[
					'exec',
					'-T',
					'php',
					'bash',
					'-c',
					'rsync -a "$1" /var/www/html/wp-content/uploads/ && chown -R www-data:www-data /var/www/html/wp-content/uploads',
					'bash',
					from,
				],
				{ quiet: true }
			);
		}
		await applyEnvChanges( { UPLOADS_PROXY_URL: productionUrl } );

		if ( values.sanitize ) {
			await sanitize( env, prefix, workDir );
		}

		await wp( [ 'cache', 'flush' ], { quiet: true, allowFail: true } );
		await wp( [ 'rewrite', 'flush' ], { quiet: true, allowFail: true } );

		// Record versions from a full-site zip so plugins:check can suggest them (R4.6).
		const lastImport = {
			source: basename( source ),
			importedAt: new Date().toISOString(),
			productionUrl,
			prefix,
			plugins: wpContentDir
				? readVersions( join( wpContentDir, 'plugins' ), 'plugin' )
				: {},
			themes: wpContentDir
				? readVersions( join( wpContentDir, 'themes' ), 'theme' )
				: {},
		};
		writeFileSync(
			join( DB_DIR, 'last-import.json' ),
			JSON.stringify( lastImport, null, 2 ) + '\n'
		);

		step( 'Checking plugins and themes against production' );
		const { problems } = await checkPlugins( loadEnv(), {
			importDirs: wpContentDir
				? {
						plugin: join( wpContentDir, 'plugins' ),
						theme: join( wpContentDir, 'themes' ),
					}
				: {},
		} );

		// 9. Summary.
		console.log( '' );
		success( `Imported ${ basename( source ) }` );
		info( `${ productionUrl } → ${ localUrl }` );
		info( `Table prefix: ${ prefix }` );
		info(
			uploadsExtracted
				? `Media copied locally; anything missing loads from ${ productionUrl }`
				: `Media loads from ${ productionUrl } (nothing downloaded)`
		);
		if ( problems ) {
			info(
				`Plugins/themes needing attention: ${ problems } (see above)`
			);
		}
		info(
			`Log in: ${ localUrl }/wp-admin  (${ env.LOCAL_ADMIN_USER || 'admin' } / ${ env.LOCAL_ADMIN_PASSWORD || 'password' })`
		);
		info( `Undo: npm run db:restore` );
	} catch ( err ) {
		if ( backup && imported === false ) {
			warn( 'Import failed. Restoring the previous database.' );
			await restoreBackup( backup ).catch( ( restoreErr ) =>
				warn( `Restore failed too: ${ restoreErr.message }` )
			);
		} else if ( backup ) {
			warn(
				`Import finished but a later step failed. \`npm run db:restore\` returns to the previous database.`
			);
		}
		throw err;
	} finally {
		rmSync( workDir, { recursive: true, force: true } );
		pruneBackups( Number( env.DB_BACKUPS_KEEP ) || 10 );
		if ( existsSync( TMP_DIR ) && ! readdirSync( TMP_DIR ).length ) {
			rmSync( TMP_DIR, { recursive: true, force: true } );
		}
	}
} );
