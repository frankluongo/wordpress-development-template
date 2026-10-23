import { parseArgs as nodeParseArgs } from 'node:util';

/**
 * Parse CLI flags. Unknown flags are rejected so typos fail loudly.
 *
 * @param {import('node:util').ParseArgsConfig['options']} options
 */
export function parseArgs( options = {} ) {
	return nodeParseArgs( {
		args: process.argv.slice( 2 ),
		options: {
			yes: { type: 'boolean', short: 'y' },
			...options,
		},
		allowPositionals: true,
	} );
}
