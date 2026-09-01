export function base64UrlEncode(bytes) {
	let str = '';
	for (const b of bytes) str += String.fromCharCode(b);
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(str) {
	str = str.replace(/-/g, '+').replace(/_/g, '/');
	while (str.length % 4) str += '=';
	const bin = atob(str);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

async function importHmacKey(secret) {
	return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
		'verify',
	]);
}

export async function hmacSign(secret, data) {
	const key = await importHmacKey(secret);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
	return new Uint8Array(sig);
}

export async function hmacVerify(secret, data, sigBytes) {
	const key = await importHmacKey(secret);
	return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
}
