import { describe, expect, it } from 'vitest';
import { ChatSession } from './chat-session';

describe('ChatSession', () => {
	it('deduplicates messages by message ID and clears all memory', () => {
		const chat = new ChatSession();
		const message = {
			type: 'chat',
			messageId: 'message_123456789',
			senderPeerId: 'peer_123456789012',
			senderDisplayName: 'Grace',
			timestamp: Date.now(),
			text: 'Hello'
		} as const;
		expect(chat.add(message)).toBe(true);
		expect(chat.add(message)).toBe(false);
		expect(chat.messages).toHaveLength(1);
		chat.clear();
		expect(chat.messages).toHaveLength(0);
		expect(chat.add(message)).toBe(true);
	});

	it('rejects oversized outgoing text', () => {
		const chat = new ChatSession();
		expect(() => chat.create('peer_123456789012', 'Grace', 'x'.repeat(2_001))).toThrow(
			/2,000 characters/
		);
	});
});
