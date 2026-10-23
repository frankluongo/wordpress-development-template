/**
 * Builds the project theme and plugin with the official WordPress tooling (@wordpress/scripts).
 *
 * For each package (R1.3: either may be absent):
 *   - `blocks/`      every block.json is built to build/blocks/ with a blocks manifest.
 *   - `src/`, `assets/`  top-level *.js|ts files are entry points built to build/assets/.
 *
 * `npm run dev` serves everything from one dev server routed through the shared proxy at
 * https://hmr.<domain>, with CSS injection, React Fast Refresh, and full reloads for
 * PHP/template/theme.json/block.json changes (R6.1–R6.5).
 */
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { loadEnv } from './scripts/lib/env.mjs';
import { getPackages, ROOT } from './scripts/lib/paths.mjs';

const require = createRequire( import.meta.url );
const WP_SCRIPTS_CONFIG =
	require.resolve( '@wordpress/scripts/config/webpack.config' );
const CopyWebpackPlugin = require( 'copy-webpack-plugin' );
const CANVAS_HMR = join( ROOT, 'scripts/dev/editor-canvas-hmr.js' );
const ENTRY_EXTENSIONS = [ '.js', '.jsx', '.ts', '.tsx' ];

const env = loadEnv( { required: false } );
const isServe =
	process.argv.includes( 'serve' ) || process.argv.includes( '--hot' );
const devOrigin = `https://hmr.${ env.SITE_DOMAIN }`;
const poll = Number( env.WATCH_POLL ) || false;

// Script modules (Interactivity API `viewScriptModule`) need the module build.
process.env.WP_EXPERIMENTAL_MODULES = 'true';

/**
 * Load a fresh copy of the wp-scripts configs for one source directory. The default config
 * reads its source path from the environment while it's evaluated, so it's reloaded per source.
 *
 * @param {string}  sourceDir      Absolute source directory.
 * @param {boolean} blocksManifest Whether to generate blocks-manifest.php.
 * @param {boolean} resolveEntries Whether to detect entries (skipped when they're set explicitly).
 * @return {import('webpack').Configuration[]}
 */
function loadWpScriptsConfigs(
	sourceDir,
	blocksManifest,
	resolveEntries = true
) {
	process.env.WP_SOURCE_PATH = relative( ROOT, sourceDir );
	if ( blocksManifest ) {
		process.env.WP_BLOCKS_MANIFEST = 'true';
	} else {
		delete process.env.WP_BLOCKS_MANIFEST;
	}
	delete require.cache[ WP_SCRIPTS_CONFIG ];
	const configs = []
		.concat( require( WP_SCRIPTS_CONFIG ) )
		.map( ( config ) => ( {
			...config,
			// Entries are resolved lazily by default; resolve them now, while WP_SOURCE_PATH is set.
			entry:
				resolveEntries && typeof config.entry === 'function'
					? config.entry()
					: {},
		} ) );
	delete process.env.WP_SOURCE_PATH;
	delete process.env.WP_BLOCKS_MANIFEST;
	return configs;
}

/**
 * Top-level entry files in a directory, e.g. src/frontend.js → { frontend: '…/src/frontend.js' }.
 *
 * @param {string} dir
 */
function topLevelEntries( dir ) {
	if ( ! existsSync( dir ) ) {
		return {};
	}
	return Object.fromEntries(
		readdirSync( dir, { withFileTypes: true } )
			.filter(
				( file ) =>
					file.isFile() &&
					ENTRY_EXTENSIONS.includes( extname( file.name ) )
			)
			.map( ( file ) => [
				file.name.slice( 0, -extname( file.name ).length ),
				join( dir, file.name ),
			] )
	);
}

/**
 * Tailor one wp-scripts config to a package output directory.
 *
 * @param {import('webpack').Configuration} config
 * @param {object} options
 * @param {string} options.name
 * @param {object} options.entry
 * @param {string} options.outputDir Absolute output directory.
 * @param {Array}  options.plugins   Extra webpack plugins.
 */
function finalize( config, { name, entry, outputDir, plugins = [] } ) {
	const publicPath =
		'/' + relative( ROOT, outputDir ).split( sep ).join( '/' ) + '/';
	const isScriptConfig = ! config.output?.module;

	return {
		...config,
		name,
		// Dev-only helper so CSS updates also reach the block editor's canvas iframe.
		entry:
			isServe && isScriptConfig
				? Object.fromEntries(
						Object.entries( entry ).map( ( [ key, value ] ) => [
							key,
							[ CANVAS_HMR, ...[].concat( value ) ],
						] )
					)
				: entry,
		output: {
			...config.output,
			path: outputDir,
			// While serving, chunks and hot updates come from the dev server, at the same path
			// the files have under wp-content, so each package gets its own URL space.
			...( isServe && { publicPath: devOrigin + publicPath } ),
		},
		plugins: [ ...config.plugins, ...plugins ],
		// wp-scripts splits a shared runtime.js under --hot, which nothing would enqueue.
		// Self-contained entries behave the same in dev and production.
		optimization: { ...config.optimization, runtimeChunk: false },
		devServer: undefined,
		watchOptions: {
			...config.watchOptions,
			...( poll && { poll } ),
			ignored: /node_modules/,
		},
	};
}

/**
 * Files that trigger a full page reload while `npm run dev` runs (R6.4).
 *
 * @param {string} file
 */
function isReloadFile( file ) {
	return (
		/\.(php|html)$/.test( file ) ||
		/(^|[/\\])(theme|block)\.json$/.test( file ) ||
		/[/\\]styles[/\\].*\.json$/.test( file )
	);
}

const configs = [];
const packageDirs = [];

for ( const pkg of getPackages( env ) ) {
	packageDirs.push( pkg.dir );

	const blocksDir = join( pkg.dir, 'blocks' );
	if ( existsSync( blocksDir ) ) {
		for ( const config of loadWpScriptsConfigs( blocksDir, true ) ) {
			if ( Object.keys( config.entry ).length ) {
				configs.push(
					finalize( config, {
						name: `${ pkg.slug }:blocks${ config.output?.module ? ':modules' : '' }`,
						entry: config.entry,
						outputDir: join( pkg.dir, 'build/blocks' ),
						// wp-scripts tracks render.php files in a static shared by every config, so
						// in a multi-config build it can miss them. Everything in blocks/ is block code.
						plugins: config.output?.module
							? []
							: [
									new CopyWebpackPlugin( {
										patterns: [
											{
												from: '**/*.php',
												context: blocksDir,
												noErrorOnMissing: true,
											},
										],
									} ),
								],
					} )
				);
			}
		}
	}

	const entryDirs = [ 'src', 'assets' ]
		.map( ( dir ) => join( pkg.dir, dir ) )
		.filter( ( dir ) => Object.keys( topLevelEntries( dir ) ).length );
	const entry = Object.assign( {}, ...entryDirs.map( topLevelEntries ) );
	if ( entryDirs.length ) {
		// The script build only; asset entries are classic scripts.
		const [ scriptConfig ] = loadWpScriptsConfigs(
			entryDirs[ 0 ],
			false,
			false
		);
		configs.push(
			finalize( scriptConfig, {
				name: `${ pkg.slug }:assets`,
				entry,
				outputDir: join( pkg.dir, 'build/assets' ),
			} )
		);
	}
}

if ( ! configs.length ) {
	throw new Error(
		'No theme or plugin entry points found. Check THEME_SLUG and PLUGIN_SLUG in .env.'
	);
}

// One dev server for every config (webpack-cli starts a server per config that has one).
if ( isServe ) {
	configs[ 0 ].devServer = {
		host: '127.0.0.1',
		port: Number( env.DEV_SERVER_PORT ) || 8887,
		allowedHosts: 'all',
		hot: true,
		liveReload: true,
		static: false,
		headers: {
			// The editor canvas iframe and wp-admin load assets cross-origin.
			'Access-Control-Allow-Origin': '*',
		},
		devMiddleware: {
			// PHP reads *.asset.php and blocks-manifest.php from disk; hot updates stay in memory.
			writeToDisk: ( file ) => ! /\.hot-update\./.test( file ),
		},
		client: {
			webSocketURL: `wss://hmr.${ env.SITE_DOMAIN }/ws`,
			overlay: { errors: true, warnings: false, runtimeErrors: false },
		},
		watchFiles: {
			paths: packageDirs,
			options: {
				usePolling: Boolean( poll ),
				interval: poll || undefined,
				ignored: ( file, stats ) => {
					if (
						/[/\\](node_modules|vendor|build|\.git)([/\\]|$)/.test(
							file
						)
					) {
						return true;
					}
					// Directories (no stats yet, or a directory) are traversed; files must match.
					const isFile = stats
						? stats.isFile()
						: Boolean( extname( file ) );
					return isFile && ! isReloadFile( file );
				},
			},
		},
	};
}

export default configs;
