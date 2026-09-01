const PROD_ORIGIN = 'https://tujuojal.github.io';
const DEV_ORIGIN_RE = /^http:\/\/localhost(:\d+)?$/;

function resolveOrigin(request) {
	const origin = request.headers.get('Origin');
	if (!origin) return null;
	if (origin === PROD_ORIGIN) return origin;
	if (DEV_ORIGIN_RE.test(origin)) return origin;
	return null;
}

export function corsHeaders(request) {
	const origin = resolveOrigin(request);
	const headers = new Headers();
	if (origin) headers.set('Access-Control-Allow-Origin', origin);
	headers.set('Vary', 'Origin');
	headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
	headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
	return headers;
}

export function withCors(response, request) {
	const headers = new Headers(response.headers);
	for (const [k, v] of corsHeaders(request).entries()) headers.set(k, v);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function handleOptions(request) {
	return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function json(data, status, request) {
	const res = new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
	return withCors(res, request);
}
