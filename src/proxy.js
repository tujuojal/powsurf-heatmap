const NLS_BASE = 'https://avoin-karttakuva.maanmittauslaitos.fi';
const STRAVA_BASE = 'https://heatmap-external-b.strava.com/tiles/all/hot';

async function cachedProxy(publicUrl, upstreamUrl) {
	const cache = caches.default;
	const cacheKey = new Request(publicUrl);
	let response = await cache.match(cacheKey);
	if (!response) {
		const r = await fetch(upstreamUrl);
		response = new Response(r.body, { status: r.status, headers: r.headers });
		response.headers.set('Access-Control-Allow-Origin', '*');
		response.headers.set('Cache-Control', 'public, max-age=86400');
		if (r.ok) await cache.put(cacheKey, response.clone());
	}
	return response;
}

export function handleNls(request, env, url) {
	const upstream = new URL(NLS_BASE + url.pathname.slice(4));
	upstream.search = url.search;
	upstream.searchParams.set('api-key', env.NLS_API_KEY);
	return cachedProxy(url.toString(), upstream.toString());
}

export function handleStravaTile(request, url, match) {
	const upstreamUrl = STRAVA_BASE + '/' + match[1] + '/' + match[2] + '/' + match[3] + '.png';
	return cachedProxy(url.toString(), upstreamUrl);
}

export const STRAVA_TILE_RE = /^\/(\d+)\/(\d+)\/(\d+)\.png$/;
