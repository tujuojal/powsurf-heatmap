import { handleNls, handleStravaTile, STRAVA_TILE_RE } from './proxy.js';

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (url.pathname.startsWith('/nls/')) {
			return handleNls(request, env, url);
		}

		const match = url.pathname.match(STRAVA_TILE_RE);
		if (match) {
			return handleStravaTile(request, url, match);
		}

		return new Response('Not found', { status: 404 });
	},
};
