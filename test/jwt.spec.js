import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt } from '../src/jwt';

describe('signJwt / verifyJwt', () => {
	it('round-trips a payload', async () => {
		const token = await signJwt({ sub: 42, provider: 'github' }, 'test-secret', 3600);
		const payload = await verifyJwt(token, 'test-secret');
		expect(payload).toMatchObject({ sub: 42, provider: 'github' });
		expect(typeof payload.iat).toBe('number');
		expect(typeof payload.exp).toBe('number');
	});

	it('rejects a token signed with a different secret', async () => {
		const token = await signJwt({ sub: 1 }, 'secret-a', 3600);
		expect(await verifyJwt(token, 'secret-b')).toBeNull();
	});

	it('rejects a tampered payload', async () => {
		const token = await signJwt({ sub: 1 }, 'test-secret', 3600);
		const [header, payload, sig] = token.split('.');
		const tampered = `${header}.${payload}x.${sig}`;
		expect(await verifyJwt(tampered, 'test-secret')).toBeNull();
	});

	it('rejects an already-expired token', async () => {
		// Negative TTL puts `exp` in the past at signing time, so this needs
		// no clock mocking (which the Workers test runtime may not support).
		const token = await signJwt({ sub: 1 }, 'test-secret', -1);
		expect(await verifyJwt(token, 'test-secret')).toBeNull();
	});

	it('rejects malformed tokens', async () => {
		expect(await verifyJwt('not-a-jwt', 'test-secret')).toBeNull();
		expect(await verifyJwt('', 'test-secret')).toBeNull();
		expect(await verifyJwt(undefined, 'test-secret')).toBeNull();
	});
});
