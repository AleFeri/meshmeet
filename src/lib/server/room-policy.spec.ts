import { describe, expect, it } from 'vitest';
import {
	MAX_PARTICIPANTS,
	PARTICIPANT_STALE_MS,
	SIGNAL_LIFETIME_MS,
	acknowledgeSignal,
	activeParticipants,
	canJoinRoom,
	cleanupExpired,
	isEmptyRoomExpired,
	secretsMatch,
	signalsForRecipient
} from './room-policy';

describe('room authorization and presence policy', () => {
	it('compares only well-formed SHA-256 hashes', () => {
		const hash = 'a'.repeat(64);
		expect(secretsMatch(hash, hash)).toBe(true);
		expect(secretsMatch(hash, `${'a'.repeat(63)}b`)).toBe(false);
		expect(secretsMatch('not-a-hash', 'not-a-hash')).toBe(false);
	});

	it('enforces four active participants while ignoring stale records', () => {
		const now = 100_000;
		const active = Array.from({ length: MAX_PARTICIPANTS }, (_, index) => ({
			peerId: `peer-${index}`,
			lastHeartbeatAt: now - index * 1_000
		}));
		expect(canJoinRoom(active, now)).toBe(false);
		expect(
			canJoinRoom(
				[
					...active.slice(0, 3),
					{ peerId: 'stale', lastHeartbeatAt: now - PARTICIPANT_STALE_MS - 1 }
				],
				now
			)
		).toBe(true);
		expect(activeParticipants(active, now)).toHaveLength(4);
	});
});

describe('temporary signal mailbox policy', () => {
	const now = 500_000;
	const signals = [
		{ id: 'mine', roomId: 'room-a', recipientPeerId: 'peer-a', expiresAt: now + 1_000 },
		{ id: 'other-peer', roomId: 'room-a', recipientPeerId: 'peer-b', expiresAt: now + 1_000 },
		{ id: 'other-room', roomId: 'room-b', recipientPeerId: 'peer-a', expiresAt: now + 1_000 },
		{ id: 'expired', roomId: 'room-a', recipientPeerId: 'peer-a', expiresAt: now - 1 }
	];

	it('isolates signals by both room and recipient', () => {
		expect(
			signalsForRecipient(signals, 'room-a', 'peer-a', now).map((signal) => signal.id)
		).toEqual(['mine']);
	});

	it('acknowledges only the addressed recipient signal', () => {
		expect(acknowledgeSignal(signals, 'mine', 'room-a', 'peer-b')).toHaveLength(4);
		expect(
			acknowledgeSignal(signals, 'mine', 'room-a', 'peer-a').map((signal) => signal.id)
		).not.toContain('mine');
	});

	it('removes expired records and uses a two-minute lifetime', () => {
		expect(SIGNAL_LIFETIME_MS).toBe(120_000);
		expect(cleanupExpired(signals, now).map((signal) => signal.id)).not.toContain('expired');
	});

	it('only expires rooms with an explicit old empty timestamp', () => {
		const now = 1_000_000;
		expect(isEmptyRoomExpired(undefined, now)).toBe(false);
		expect(isEmptyRoomExpired(now - 1_000, now)).toBe(false);
		expect(isEmptyRoomExpired(now - 5 * 60 * 1_000 - 1, now)).toBe(true);
	});
});
