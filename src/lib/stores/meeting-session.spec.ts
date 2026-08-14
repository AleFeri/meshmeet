import { describe, expect, it } from 'vitest';
import {
	clearMeetingSession,
	readMeetingSession,
	type MeetingSession,
	writeMeetingSession
} from './meeting-session';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => values.delete(key)
	};
}

const session: MeetingSession = {
	version: 1,
	roomId: 'A'.repeat(22),
	peerId: 'B'.repeat(22),
	sessionToken: 'C'.repeat(43),
	displayName: 'Ada',
	muted: false
};

describe('meeting refresh session', () => {
	it('restores only participant credentials and preferences for the current room', () => {
		const storage = memoryStorage();
		writeMeetingSession(session, storage);

		expect(readMeetingSession(session.roomId, storage)).toEqual(session);
		expect(readMeetingSession('D'.repeat(22), storage)).toBeNull();
	});

	it('rejects malformed records and clears the record when leaving', () => {
		const storage = memoryStorage();
		storage.setItem(
			`meshmeet:meeting:${session.roomId}`,
			JSON.stringify({ ...session, peerId: 'no' })
		);
		expect(readMeetingSession(session.roomId, storage)).toBeNull();

		writeMeetingSession(session, storage);
		clearMeetingSession(session.roomId, storage);
		expect(readMeetingSession(session.roomId, storage)).toBeNull();
	});
});
