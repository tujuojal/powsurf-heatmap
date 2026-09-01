import { describe, it, expect } from 'vitest';
import { signState, verifyState } from '../src/auth';

describe('signState / verifyState (OAuth CSRF state param)', () => {
	it('round-trips a payload', async () => {
		const payload = { n: 'nonce-1', r: 'https://tujuojal.github.io/', t: Date.now() };
		const state = await signState(payload, 'state-secret');
		const verified = await verifyState(state, 'state-secret');
		expect(verified).toEqual(payload);
	});

	it('rejects a state signed with a different secret', async () => {
		const state = await signState({ n: '1', r: 'x', t: Date.now() }, 'secret-a');
		expect(await verifyState(state, 'secret-b')).toBeNull();
	});

	it('rejects a tampered state', async () => {
		const state = await signState({ n: '1', r: 'https://tujuojal.github.io/', t: Date.now() }, 'state-secret');
		const [encoded, sig] = state.split('.');
		const tampered = `${encoded}x.${sig}`;
		expect(await verifyState(tampered, 'state-secret')).toBeNull();
	});

	it('rejects a state older than the freshness window', async () => {
		const tenMinutesAndOneSecondAgo = Date.now() - (10 * 60 * 1000 + 1000);
		const state = await signState({ n: '1', r: 'x', t: tenMinutesAndOneSecondAgo }, 'state-secret');
		expect(await verifyState(state, 'state-secret')).toBeNull();
	});

	it('accepts a state right at the edge of the freshness window', async () => {
		const nineMinutesAgo = Date.now() - 9 * 60 * 1000;
		const state = await signState({ n: '1', r: 'x', t: nineMinutesAgo }, 'state-secret');
		expect(await verifyState(state, 'state-secret')).not.toBeNull();
	});

	it('rejects malformed state strings', async () => {
		expect(await verifyState('not-a-state', 'state-secret')).toBeNull();
		expect(await verifyState('', 'state-secret')).toBeNull();
		expect(await verifyState('a.b.c', 'state-secret')).toBeNull();
	});
});
