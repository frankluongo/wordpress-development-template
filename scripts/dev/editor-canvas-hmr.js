/**
 * Dev-only helper, prepended to every script entry by webpack.config.js while `npm run dev` runs.
 *
 * mini-css-extract-plugin swaps updated <link> stylesheets in the current document only, but
 * the block editor renders content inside an iframe (name="editor-canvas"). After each hot
 * update, this refreshes the iframe's stylesheets that come from a build/ folder.
 */

const REFRESH_KEY = '__wpDevRefreshEditorCanvas';

if ( module.hot && typeof window !== 'undefined' ) {
	if ( ! window[ REFRESH_KEY ] ) {
		let timer;
		window[ REFRESH_KEY ] = () => {
			clearTimeout( timer );
			timer = setTimeout( () => {
				document
					.querySelectorAll( 'iframe[name="editor-canvas"]' )
					.forEach( ( iframe ) => {
						const doc = iframe.contentDocument;
						if ( ! doc ) {
							return;
						}
						doc.querySelectorAll(
							'link[rel="stylesheet"][href*="/build/"]'
						).forEach( ( link ) => {
							const url = new URL( link.href );
							url.searchParams.set( 'hmr', Date.now() );
							const next = link.cloneNode();
							next.href = url.toString();
							next.addEventListener( 'load', () =>
								link.remove()
							);
							next.addEventListener( 'error', () =>
								next.remove()
							);
							link.after( next );
						} );
					} );
			}, 50 );
		};
	}
	module.hot.addStatusHandler( ( status ) => {
		if ( status === 'idle' ) {
			window[ REFRESH_KEY ]();
		}
	} );
}
