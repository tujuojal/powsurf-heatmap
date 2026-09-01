import { base64UrlEncode, base64UrlDecode, hmacSign, hmacVerify } from './crypto-utils.js';
import { signJwt, verifyJwt } from './jwt.js';
import { getOrCreateUser, getUserById } from './db.js';

const DEFAULT_RETURN_TO = 'https://tujuojal.github.io/';
const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export class AuthError extends Error {}

// Only ever allow redirecting back to the app itself (or a local dev server) —
// `returnTo` is attacker-influenceable (it's a query param), and the OAuth
// callback puts the session JWT in the fragment of that URL, so an
// unvalidated returnTo would be an open-redirect that leaks tokens.
function sanitizeReturnTo(raw) {
	if (!raw) return DEFAULT_RETURN_TO;
	try {
		const u = new URL(raw);
		if (u.origin === 'https://tujuojal.github.io') return u.toString();
		if (u.hostname === 'localhost') return u.toString();
	} catch {
		// fall through
	}
	return DEFAULT_RETURN_TO;
}

async function signState(payload, secret) {
	const json = JSON.stringify(payload);
	const encoded = base64UrlEncode(new TextEncoder().encode(json));
	const sig = await hmacSign(secret, encoded);
	return `${encoded}.${base64UrlEncode(sig)}`;
}

async function verifyState(state, secret) {
	if (typeof state !== 'string') return null;
	const parts = state.split('.');
	if (parts.length !== 2) return null;
	const [encoded, sigB64] = parts;

	let sigBytes;
	try {
		sigBytes = base64UrlDecode(sigB64);
	} catch {
		return null;
	}
	const valid = await hmacVerify(secret, encoded, sigBytes);
	if (!valid) return null;

	let payload;
	try {
		payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
	} catch {
		return null;
	}
	if (typeof payload.t !== 'number' || Date.now() - payload.t > STATE_MAX_AGE_MS) return null;
	return payload;
}

function callbackUrl(requestUrl) {
	return new URL('/api/auth/github/callback', requestUrl).toString();
}

function withAuthHash(returnTo, jwt) {
	const u = new URL(returnTo);
	u.hash = `auth=${encodeURIComponent(jwt)}`;
	return u.toString();
}

function withErrorHash(returnTo, reason) {
	const u = new URL(returnTo);
	u.hash = `authError=${encodeURIComponent(reason)}`;
	return u.toString();
}

export async function handleAuthStart(request, env) {
	const url = new URL(request.url);
	const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'));
	const state = await signState({ n: crypto.randomUUID(), r: returnTo, t: Date.now() }, env.OAUTH_STATE_SECRET);

	const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
	authorizeUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
	authorizeUrl.searchParams.set('redirect_uri', callbackUrl(url));
	authorizeUrl.searchParams.set('scope', 'read:user');
	authorizeUrl.searchParams.set('state', state);

	return Response.redirect(authorizeUrl.toString(), 302);
}

export async function handleAuthCallback(request, env) {
	const url = new URL(request.url);
	const code = url.searchParams.get('code');
	const stateParam = url.searchParams.get('state');
	const verified = stateParam ? await verifyState(stateParam, env.OAUTH_STATE_SECRET) : null;
	const returnTo = verified?.r ?? DEFAULT_RETURN_TO;

	if (!code || !verified) {
		return Response.redirect(withErrorHash(returnTo, 'invalid_state'), 302);
	}

	try {
		const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({
				client_id: env.GITHUB_CLIENT_ID,
				client_secret: env.GITHUB_CLIENT_SECRET,
				code,
				redirect_uri: callbackUrl(url),
			}),
		});
		const tokenData = await tokenRes.json();
		if (!tokenData.access_token) throw new Error('no_access_token');

		const userRes = await fetch('https://api.github.com/user', {
			headers: {
				Authorization: `Bearer ${tokenData.access_token}`,
				'User-Agent': 'powsurf-heatmap-worker',
				Accept: 'application/vnd.github+json',
			},
		});
		if (!userRes.ok) throw new Error('user_fetch_failed');
		const ghUser = await userRes.json();

		const user = await getOrCreateUser(env, 'github', String(ghUser.id), ghUser.login, ghUser.avatar_url ?? null);
		const jwt = await signJwt({ sub: user.id, provider: 'github' }, env.JWT_SECRET, SESSION_TTL_SECONDS);

		return Response.redirect(withAuthHash(returnTo, jwt), 302);
	} catch {
		return Response.redirect(withErrorHash(returnTo, 'auth_failed'), 302);
	}
}

export async function requireAuth(request, env) {
	const header = request.headers.get('Authorization') || '';
	const match = header.match(/^Bearer\s+(.+)$/i);
	if (!match) throw new AuthError('missing_token');
	const payload = await verifyJwt(match[1], env.JWT_SECRET);
	if (!payload) throw new AuthError('invalid_token');
	return payload; // { sub, provider, iat, exp }
}

export async function handleMe(request, env) {
	const payload = await requireAuth(request, env);
	const user = await getUserById(env, payload.sub);
	if (!user) throw new AuthError('user_not_found');
	return { id: user.id, username: user.username, avatarUrl: user.avatar_url, provider: user.provider };
}
