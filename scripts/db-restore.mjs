// npm run db:restore [file]: restore the newest pre-import backup, or a given one (R5.4).
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { listBackups, restoreBackup } from './lib/backups.mjs';
import { parseArgs } from './lib/args.mjs';
import { assertDocker, assertRunning } from './lib/docker.mjs';
import { info, run } from './lib/log.mjs';
import { confirm } from './lib/prompt.mjs';

run( async () => {
	const { values, positionals } = parseArgs();
	assertDocker();
	await assertRunning();

	const file = positionals[ 0 ]
		? resolve( positionals[ 0 ] )
		: listBackups()[ 0 ];
	if ( ! file ) {
		throw new Error(
			'No backups found in .db/backups. Backups are made automatically before each import.'
		);
	}
	if ( ! existsSync( file ) ) {
		throw new Error( `Backup not found: ${ file }` );
	}

	const others = listBackups().length - 1;
	if ( ! positionals[ 0 ] && others > 0 ) {
		info(
			`${ others } older backup(s) in .db/backups; pass a path to restore a specific one.`
		);
	}
	if (
		! values.yes &&
		! ( await confirm(
			`Replace the local database with ${ basename( file ) }?`,
			true
		) )
	) {
		throw new Error( 'Restore cancelled.' );
	}
	await restoreBackup( file );
} );
