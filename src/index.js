import { handleNls, handleStravaTile, STRAVA_TILE_RE } from './proxy.js';
import { handleAuthStart, handleAuthCallback, handleMe, requireAuth, AuthError } from './auth.js';
import { handleOptions, json } from './cors.js';
import {
	HttpError,
	handleListTrips,
	handleGetTrip,
	handleCreateTrip,
	handleUpdateTrip,
	handleDeleteTrip,
	handleGetShared,
	handleExportTrip,
	handleExportShared,
} from './trips.js';

const TRIP_ID_RE = /^\/api\/trips\/([^/]+)$/;
const TRIP_EXPORT_RE = /^\/api\/trips\/([^/]+)\/export$/;
const SHARE_TOKEN_RE = /^\/api\/share\/([^/]+)$/;
const SHARE_EXPORT_RE = /^\/api\/share\/([^/]+)\/export$/;

async function handleApi(request, env, url) {
	if (request.method === 'OPTIONS') return handleOptions(request);

	// Full-page browser redirects — no CORS needed, not wrapped in try/catch
	// below since they never throw AuthError/HttpError (see auth.js).
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

		let m;

		if (url.pathname === '/api/trips') {
			if (request.method === 'GET') return await handleListTrips(request, env, await requireAuth(request, env));
			if (request.method === 'POST') return await handleCreateTrip(request, env, await requireAuth(request, env));
		}

		if ((m = url.pathname.match(TRIP_EXPORT_RE))) {
			if (request.method === 'GET') {
				const format = url.searchParams.get('format');
				return await handleExportTrip(request, env, await requireAuth(request, env), m[1], format);
			}
		}

		if ((m = url.pathname.match(TRIP_ID_RE))) {
			const auth = await requireAuth(request, env);
			if (request.method === 'GET') return await handleGetTrip(request, env, auth, m[1]);
			if (request.method === 'PATCH') return await handleUpdateTrip(request, env, auth, m[1]);
			if (request.method === 'DELETE') return await handleDeleteTrip(request, env, auth, m[1]);
		}

		if ((m = url.pathname.match(SHARE_EXPORT_RE))) {
			if (request.method === 'GET') {
				const format = url.searchParams.get('format');
				return await handleExportShared(request, env, m[1], format);
			}
		}

		if ((m = url.pathname.match(SHARE_TOKEN_RE))) {
			if (request.method === 'GET') return await handleGetShared(request, env, m[1]);
		}

		return json({ error: 'not_found' }, 404, request);
	} catch (err) {
		if (err instanceof AuthError) return json({ error: err.message }, 401, request);
		if (err instanceof HttpError) return json({ error: err.message }, err.status, request);
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
