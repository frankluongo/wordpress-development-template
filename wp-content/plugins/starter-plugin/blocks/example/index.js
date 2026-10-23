/**
 * Registers the block in the editor. Its markup is rendered by render.php.
 */
import { registerBlockType } from '@wordpress/blocks';

import Edit from './edit';
import metadata from './block.json';
import './style.scss';
import './editor.scss';

registerBlockType( metadata.name, {
	edit: Edit,
} );
