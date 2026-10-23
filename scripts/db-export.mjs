// npm run db:export: export the local database to .db/exports/<project>-<timestamp>.sql.gz (R5.12).
import { mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { timestamp, exportDatabase } from './lib/backups.mjs';
import { assertDocker, assertRunning } from './lib/docker.mjs';
import { loadEnv } from './lib/env.mjs';
import { run, step, success } from './lib/log.mjs';
import { EXPORTS_DIR, ROOT } from './lib/paths.mjs';

run( async () => {
	const env = loadEnv();
	assertDocker();
	await assertRunning();

	mkdirSync( EXPORTS_DIR, { recursive: true } );
	const file = join(
		EXPORTS_DIR,
		`${ env.COMPOSE_PROJECT_NAME }-${ timestamp() }.sql.gz`
	);
	step( 'Exporting the database' );
	await exportDatabase( file );
	success( `Exported to ${ relative( ROOT, file ) }` );
} );
