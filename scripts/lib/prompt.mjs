import {
	confirm as inquirerConfirm,
	input as inquirerInput,
	select as inquirerSelect,
	password as inquirerPassword,
} from '@inquirer/prompts';

/**
 * Prompts fall back to their defaults when stdin isn't a TTY or `--yes` was passed,
 * so every command can run unattended (CI, scripted use).
 */
const nonInteractive = () =>
	! process.stdin.isTTY ||
	process.argv.includes( '--yes' ) ||
	process.argv.includes( '-y' );

export function isInteractive() {
	return ! nonInteractive();
}

/**
 * @param {string}  message
 * @param {boolean} defaultValue
 */
export async function confirm( message, defaultValue = true ) {
	if ( nonInteractive() ) {
		return defaultValue;
	}
	return inquirerConfirm( { message, default: defaultValue } );
}

/**
 * @param {string} message
 * @param {{default?: string, validate?: (v: string) => true|string}} options
 */
export async function input( message, options = {} ) {
	if ( nonInteractive() ) {
		if ( options.default === undefined ) {
			throw new Error(
				`"${ message }" needs an answer, but the command is running non-interactively.`
			);
		}
		return options.default;
	}
	return inquirerInput( { message, ...options } );
}

/**
 * @param {string} message
 * @param {{name: string, value: any, description?: string}[]} choices
 * @param {any} defaultValue
 */
export async function select(
	message,
	choices,
	defaultValue = choices[ 0 ]?.value
) {
	if ( nonInteractive() ) {
		return defaultValue;
	}
	return inquirerSelect( { message, choices, default: defaultValue } );
}

/**
 * @param {string} message
 */
export async function password( message ) {
	return inquirerPassword( { message, mask: '*' } );
}
