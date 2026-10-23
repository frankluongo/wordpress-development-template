import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnv, updateEnvText } from '../../scripts/lib/env.mjs';

test( 'parseEnv reads plain, quoted and commented values', () => {
	const env = parseEnv(
		[
			'# comment',
			'A=1',
			'B="two words"',
			"C='single'",
			'D=value # trailing comment',
			'export E=exported',
			'EMPTY=',
		].join( '\n' )
	);
	assert.deepEqual( env, {
		A: '1',
		B: 'two words',
		C: 'single',
		D: 'value',
		E: 'exported',
		EMPTY: '',
	} );
} );

test( 'updateEnvText keeps comments and order, appends unknown keys', () => {
	const text = '# Header\nA=1\n\n# About B\nB=2\n';
	const next = updateEnvText( text, { B: 'new value', C: '3' } );
	assert.equal( next, '# Header\nA=1\n\n# About B\nB="new value"\nC=3\n' );
} );
