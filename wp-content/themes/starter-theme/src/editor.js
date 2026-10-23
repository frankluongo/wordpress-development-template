/**
 * Block editor entry point: block styles, variations, and editor-only tweaks.
 */
import { registerBlockStyle } from '@wordpress/blocks';
import domReady from '@wordpress/dom-ready';

import './editor.scss';

domReady( () => {
	registerBlockStyle( 'core/group', {
		name: 'card',
		label: 'Card',
	} );
} );
