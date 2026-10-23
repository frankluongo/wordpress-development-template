const useColor = process.stdout.isTTY && ! process.env.NO_COLOR;

const paint = ( code ) => ( text ) =>
	useColor ? `\x1b[${ code }m${ text }\x1b[0m` : String( text );

export const color = {
	bold: paint( 1 ),
	dim: paint( 2 ),
	red: paint( 31 ),
	green: paint( 32 ),
	yellow: paint( 33 ),
	blue: paint( 34 ),
	cyan: paint( 36 ),
};

export function step( message ) {
	console.log( `${ color.blue( '›' ) } ${ message }` );
}

export function info( message ) {
	console.log( `  ${ message }` );
}

export function success( message ) {
	console.log( `${ color.green( '✔' ) } ${ message }` );
}

export function warn( message ) {
	console.warn( `${ color.yellow( '!' ) } ${ message }` );
}

export function error( message ) {
	console.error( `${ color.red( '✖' ) } ${ message }` );
}

/**
 * Print an error and exit non-zero.
 *
 * @param {string} message
 * @param {number} code
 * @return {never}
 */
export function fail( message, code = 1 ) {
	error( message );
	process.exit( code );
}

/**
 * Print rows as an aligned table.
 *
 * @param {string[]}   headers
 * @param {string[][]} rows
 */
export function table( headers, rows ) {
	const widths = headers.map( ( header, i ) =>
		Math.max(
			header.length,
			...rows.map( ( row ) => String( row[ i ] ?? '' ).length )
		)
	);
	const line = ( cells ) =>
		cells
			.map( ( cell, i ) => String( cell ?? '' ).padEnd( widths[ i ] ) )
			.join( '  ' );
	console.log( color.bold( line( headers ) ) );
	console.log(
		color.dim( widths.map( ( w ) => '-'.repeat( w ) ).join( '  ' ) )
	);
	rows.forEach( ( row ) => console.log( line( row ) ) );
}

/**
 * Run an async main function and turn thrown errors into a clean exit.
 *
 * @param {() => Promise<void>} main
 */
export function run( main ) {
	main().catch( ( err ) => {
		if ( err?.name === 'ExitPromptError' ) {
			fail( 'Cancelled.' );
		}
		fail( err?.message ?? String( err ) );
	} );
}
