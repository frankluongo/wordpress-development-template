import { __ } from '@wordpress/i18n';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import { PanelBody, TextControl } from '@wordpress/components';

/**
 * Editor view of the block.
 *
 * @param {Object}                       props
 * @param {Object}                       props.attributes
 * @param {(attributes: Object) => void} props.setAttributes
 */
export default function Edit( { attributes, setAttributes } ) {
	const { label, message } = attributes;

	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Settings', 'starter-plugin' ) }>
					<TextControl
						__next40pxDefaultSize
						label={ __( 'Button label', 'starter-plugin' ) }
						value={ label }
						onChange={ ( value ) =>
							setAttributes( { label: value } )
						}
					/>
					<TextControl
						__next40pxDefaultSize
						label={ __( 'Message', 'starter-plugin' ) }
						value={ message }
						onChange={ ( value ) =>
							setAttributes( { message: value } )
						}
					/>
				</PanelBody>
			</InspectorControls>
			<div { ...useBlockProps() }>
				<button
					type="button"
					className="wp-block-starter-plugin-example__button"
				>
					{ label }
				</button>
				<p className="wp-block-starter-plugin-example__message">
					{ message }
				</p>
			</div>
		</>
	);
}
