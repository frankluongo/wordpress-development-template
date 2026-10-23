/**
 * SSH connection details for a named remote environment, from .env (R5.13):
 * REMOTE_<ENV>_SSH, REMOTE_<ENV>_PATH, REMOTE_<ENV>_URL.
 *
 * @param {Record<string,string>} env
 * @param {string}                name e.g. "production"
 */
export function remoteConfig( env, name ) {
	if ( ! name ) {
		throw new Error(
			'Name the environment, e.g. `npm run db:pull -- production`.'
		);
	}
	const key = name.toUpperCase().replace( /[^A-Z0-9]/g, '_' );
	const config = {
		ssh: env[ `REMOTE_${ key }_SSH` ],
		path: env[ `REMOTE_${ key }_PATH` ],
		url: env[ `REMOTE_${ key }_URL` ],
	};
	if ( ! config.ssh || ! config.path ) {
		throw new Error(
			`Set REMOTE_${ key }_SSH and REMOTE_${ key }_PATH in .env (see .env.example).`
		);
	}
	return config;
}

/**
 * Quote a value for a POSIX shell.
 *
 * @param {string} value
 */
export const shellQuote = ( value ) =>
	`'${ String( value ).replace( /'/g, `'\\''` ) }'`;

/**
 * Read DB_* constants from wp-config.php text.
 *
 * @param {string} text
 * @return {Record<string,string>}
 */
export function parseWpConfigDb( text ) {
	const values = {};
	const pattern =
		/define\(\s*['"](DB_NAME|DB_USER|DB_PASSWORD|DB_HOST)['"]\s*,\s*(['"])((?:\\.|(?!\2).)*)\2\s*\)/g;
	for ( const [ , name, , value ] of text.matchAll( pattern ) ) {
		values[ name ] = value.replace( /\\(.)/g, '$1' );
	}
	return values;
}
