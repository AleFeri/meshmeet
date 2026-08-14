import { describe, expect, it } from 'vitest';
import { isChatMessage, parseChatMessage } from './chat';
import { isIncomingSignal, isValidSignalPayload } from './signaling';

describe('signaling message validation', () => {
	it('accepts a bounded offer with a matching discriminant', () => {
		expect(
			isIncomingSignal({
				id: 'signal_123456789',
				fromPeerId: 'peer_123456789012',
				type: 'offer',
				payload: {
					kind: 'description',
					description: { type: 'offer', sdp: 'v=0\r\n' }
				},
				createdAt: Date.now()
			})
		).toBe(true);
	});

	it('rejects mismatched signal types and oversized ICE batches', () => {
		expect(
			isValidSignalPayload('answer', {
				kind: 'description',
				description: { type: 'offer', sdp: 'v=0' }
			})
		).toBe(false);
		expect(
			isValidSignalPayload('ice', {
				kind: 'ice',
				candidates: Array.from({ length: 21 }, () => ({ candidate: 'candidate:1' }))
			})
		).toBe(false);
	});
});

describe('data-channel message validation', () => {
	const validMessage = {
		type: 'chat',
		messageId: 'message_123456789',
		senderPeerId: 'peer_123456789012',
		senderDisplayName: 'Ada',
		timestamp: 1_700_000_000_000,
		text: '<b>render this as text</b>'
	} as const;

	it('accepts valid message data and parses JSON defensively', () => {
		expect(isChatMessage(validMessage)).toBe(true);
		expect(parseChatMessage(JSON.stringify(validMessage))).toEqual(validMessage);
	});

	it('rejects invalid JSON and messages over 2,000 characters', () => {
		expect(parseChatMessage('{')).toBeNull();
		expect(isChatMessage({ ...validMessage, text: 'a'.repeat(2_001) })).toBe(false);
	});
});
