import { base64UrlEncode, base64UrlDecode, hmacSign, hmacVerify } from './crypto-utils.js';

function encodeJson(obj) {
	return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

function decodeJson(str) {
	return JSON.parse(new TextDecoder().decode(base64UrlDecode(str)));
}

export async function signJwt(payload, secret, expSeconds) {
	const header = { alg: 'HS256', typ: 'JWT' };
	const now = Math.floor(Date.now() / 1000);
	const body = { ...payload, iat: now, exp: now + expSeconds };
	const signingInput = `${encodeJson(header)}.${encodeJson(body)}`;
	const sig = await hmacSign(secret, signingInput);
	return `${signingInput}.${base64UrlEncode(sig)}`;
}

export async function verifyJwt(token, secret) {
	if (typeof token !== 'string') return null;
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const [headerB64, payloadB64, sigB64] = parts;
	const signingInput = `${headerB64}.${payloadB64}`;

	let sigBytes;
	try {
		sigBytes = base64UrlDecode(sigB64);
	} catch {
		return null;
	}

	const valid = await hmacVerify(secret, signingInput, sigBytes);
	if (!valid) return null;

	let payload;
	try {
		payload = decodeJson(payloadB64);
	} catch {
		return null;
	}

	const now = Math.floor(Date.now() / 1000);
	if (typeof payload.exp !== 'number' || payload.exp < now) return null;
	return payload;
}
