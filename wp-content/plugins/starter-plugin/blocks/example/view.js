/**
 * Front-end behaviour, loaded as a script module (Interactivity API).
 */
import { store, getContext } from '@wordpress/interactivity';

store( 'starter-plugin/example', {
	actions: {
		toggle() {
			const context = getContext();
			context.isOpen = ! context.isOpen;
		},
	},
} );
