export const ROOM_LIFETIME_MS = 12 * 60 * 60 * 1_000;
export const EMPTY_ROOM_GRACE_MS = 5 * 60 * 1_000;
export const PARTICIPANT_STALE_MS = 90 * 1_000;
export const SIGNAL_LIFETIME_MS = 2 * 60 * 1_000;
export const MAX_PARTICIPANTS = 4;

export interface PresenceRecord {
	peerId: string;
	lastHeartbeatAt: number;
}

export interface SignalMailboxRecord {
	id: string;
	roomId: string;
	recipientPeerId: string;
	expiresAt: number;
}

export function isValidSecretHash(secretHash: string): boolean {
	return /^[a-f0-9]{64}$/.test(secretHash);
}

export function secretsMatch(storedHash: string, suppliedHash: string): boolean {
	if (!isValidSecretHash(storedHash) || !isValidSecretHash(suppliedHash)) return false;
	let difference = 0;
	for (let index = 0; index < storedHash.length; index += 1) {
		difference |= storedHash.charCodeAt(index) ^ suppliedHash.charCodeAt(index);
	}
	return difference === 0;
}

export function activeParticipants<T extends PresenceRecord>(
	participants: readonly T[],
	now: number
): T[] {
	return participants.filter(
		(participant) => now - participant.lastHeartbeatAt <= PARTICIPANT_STALE_MS
	);
}

export function canJoinRoom(participants: readonly PresenceRecord[], now: number): boolean {
	return activeParticipants(participants, now).length < MAX_PARTICIPANTS;
}

export function signalsForRecipient<T extends SignalMailboxRecord>(
	signals: readonly T[],
	roomId: string,
	recipientPeerId: string,
	now: number
): T[] {
	return signals.filter(
		(signal) =>
			signal.roomId === roomId &&
			signal.recipientPeerId === recipientPeerId &&
			signal.expiresAt > now
	);
}

export function acknowledgeSignal<T extends SignalMailboxRecord>(
	signals: readonly T[],
	signalId: string,
	roomId: string,
	recipientPeerId: string
): T[] {
	return signals.filter(
		(signal) =>
			!(
				signal.id === signalId &&
				signal.roomId === roomId &&
				signal.recipientPeerId === recipientPeerId
			)
	);
}

export function cleanupExpired<T extends { expiresAt: number }>(
	records: readonly T[],
	now: number
): T[] {
	return records.filter((record) => record.expiresAt > now);
}

export function isEmptyRoomExpired(emptySince: number | undefined, now: number): boolean {
	return emptySince !== undefined && emptySince < now - EMPTY_ROOM_GRACE_MS;
}
