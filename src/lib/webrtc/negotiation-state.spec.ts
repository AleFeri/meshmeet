import { describe, expect, it } from 'vitest';
import { initialNegotiationState, shouldAcceptDescription } from './negotiation-state';

describe('perfect negotiation decisions', () => {
	it('accepts an offer in stable state', () => {
		const decision = shouldAcceptDescription(initialNegotiationState(), 'stable', 'offer', false);
		expect(decision).toEqual({ accept: true, offerCollision: false });
	});

	it('lets a polite peer accept glare and makes an impolite peer ignore it', () => {
		const makingOffer = { ...initialNegotiationState(), makingOffer: true };
		expect(shouldAcceptDescription(makingOffer, 'have-local-offer', 'offer', true)).toEqual({
			accept: true,
			offerCollision: true
		});
		expect(shouldAcceptDescription(makingOffer, 'have-local-offer', 'offer', false)).toEqual({
			accept: false,
			offerCollision: true
		});
	});

	it('accepts an answer while an answer is being set', () => {
		const state = { ...initialNegotiationState(), isSettingRemoteAnswerPending: true };
		expect(shouldAcceptDescription(state, 'have-local-offer', 'answer', false).accept).toBe(true);
	});
});
