import { handleNls, handleStravaTile, STRAVA_TILE_RE } from './proxy.js';
import { handleAuthStart, handleAuthCallback, handleMe, AuthError } from './auth.js';
import { handleOptions, json } from './cors.js';

async function handleApi(request, env, url) {
	if (request.method === 'OPTIONS') return handleOptions(request);

	if (url.pathname === '/api/auth/github/start' && request.method === 'GET') {
		return handleAuthStart(request, env);
	}
	if (url.pathname === '/api/auth/github/callback' && request.method === 'GET') {
		return handleAuthCallback(request, env);
	}

	try {
		if (url.pathname === '/api/me' && request.method === 'GET') {
			return json(await handleMe(request, env), 200, request);
		}

		return json({ error: 'not_found' }, 404, request);
	} catch (err) {
		if (err instanceof AuthError) return json({ error: err.message }, 401, request);
		return json({ error: 'internal_error' }, 500, request);
	}
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (url.pathname.startsWith('/api/')) {
			return handleApi(request, env, url);
		}

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
