// npm run lint [-- --php] [-- --fix]
// PHP_CodeSniffer (in the php container), ESLint, Stylelint, and the version sync check (R9.1, R9.2).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from './lib/args.mjs';
import { compose, exec, isRunning } from './lib/docker.mjs';
import { loadEnv } from './lib/env.mjs';
import { error, run, step, success } from './lib/log.mjs';
import { getPackages, ROOT } from './lib/paths.mjs';

/**
 * JS sources to lint: each package's source folders that exist, plus the tooling.
 *
 * @param {Record<string,string>} env
 */
function jsPaths( env ) {
	const sources = getPackages( env ).flatMap( ( pkg ) =>
		[ 'src', 'assets', 'blocks' ]
			.map( ( dir ) => join( pkg.dir, dir ) )
			.filter( existsSync )
	);
	return [
		...sources,
		join( ROOT, 'scripts' ),
		join( ROOT, 'tests' ),
		join( ROOT, 'webpack.config.js' ),
	].filter( existsSync );
}

const STYLE_GLOB =
	'wp-content/{themes,plugins}/*/{src,assets,blocks}/**/*.{css,scss}';

/**
 * Run a PHP tool in the php container (or a one-off container if the site isn't running).
 *
 * @param {string[]} args
 */
async function inPhp( args ) {
	const running = await isRunning( 'php' );
	const base = running
		? [ 'exec', '-T', '-w', '/project', 'php' ]
		: [ 'run', '--rm', '--no-deps', '-T', '-w', '/project', 'php' ];
	return compose( [ ...base, ...args ], { allowFail: true } );
}

run( async () => {
	const { values } = parseArgs( {
		php: { type: 'boolean' },
		fix: { type: 'boolean' },
	} );
	const env = loadEnv( { required: false } );
	const failures = [];

	step( values.fix ? 'Fixing PHP (phpcbf)' : 'Linting PHP (phpcs)' );
	if ( ! existsSync( join( ROOT, 'vendor/bin/phpcs' ) ) ) {
		await inPhp( [ 'composer', 'install', '--no-interaction', '--quiet' ] );
	}
	const php = await inPhp( [
		values.fix ? 'vendor/bin/phpcbf' : 'vendor/bin/phpcs',
		'--runtime-set',
		'testVersion',
		`${ env.PHP_VERSION || '8.1' }-`,
	] );
	// phpcbf exits 1 when it fixed something, which isn't a failure.
	if ( php.code !== 0 && ! ( values.fix && php.code === 1 ) ) {
		failures.push( 'PHP' );
	}

	if ( ! values.php ) {
		step( 'Linting JavaScript (ESLint)' );
		const js = await exec(
			'npx',
			[
				'wp-scripts',
				'lint-js',
				'--no-error-on-unmatched-pattern',
				...( values.fix ? [ '--fix' ] : [] ),
				...jsPaths( env ),
			],
			{
				allowFail: true,
			}
		);
		if ( js.code !== 0 ) {
			failures.push( 'JavaScript' );
		}

		step( 'Linting styles (Stylelint)' );
		const css = await exec(
			'npx',
			[
				'wp-scripts',
				'lint-style',
				...( values.fix ? [ '--fix' ] : [] ),
				STYLE_GLOB,
			],
			{
				allowFail: true,
			}
		);
		if ( css.code !== 0 ) {
			failures.push( 'styles' );
		}

		step( 'Checking version sync' );
		const versions = await exec( 'node', [ 'scripts/check-versions.mjs' ], {
			allowFail: true,
		} );
		if ( versions.code !== 0 ) {
			failures.push( 'versions' );
		}
	}

	if ( failures.length ) {
		error( `Lint failed: ${ failures.join( ', ' ) }` );
		process.exit( 1 );
	}
	success(
		values.fix
			? 'Fixed what could be fixed automatically'
			: 'All checks passed'
	);
} );
