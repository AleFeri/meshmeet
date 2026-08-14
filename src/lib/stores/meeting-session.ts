import { LIMITS } from '$lib/config/brand';

const SESSION_VERSION = 1;
const KEY_PREFIX = 'meshmeet:meeting:';
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface MeetingSession {
	version: typeof SESSION_VERSION;
	roomId: string;
	peerId: string;
	sessionToken: string;
	displayName: string;
	muted: boolean;
}

type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function key(roomId: string): string {
	return `${KEY_PREFIX}${roomId}`;
}

function defaultStorage(): SessionStorage | null {
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

function isMeetingSession(value: unknown, roomId: string): value is MeetingSession {
	if (!value || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	return (
		record.version === SESSION_VERSION &&
		record.roomId === roomId &&
		typeof record.roomId === 'string' &&
		ID_PATTERN.test(record.roomId) &&
		typeof record.peerId === 'string' &&
		ID_PATTERN.test(record.peerId) &&
		typeof record.sessionToken === 'string' &&
		TOKEN_PATTERN.test(record.sessionToken) &&
		typeof record.displayName === 'string' &&
		record.displayName.trim() === record.displayName &&
		record.displayName.length >= 1 &&
		record.displayName.length <= LIMITS.maxDisplayNameLength &&
		typeof record.muted === 'boolean'
	);
}

export function readMeetingSession(
	roomId: string,
	storage: SessionStorage | null = defaultStorage()
): MeetingSession | null {
	if (!storage || !ID_PATTERN.test(roomId)) return null;
	try {
		const raw = storage.getItem(key(roomId));
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (isMeetingSession(parsed, roomId)) return parsed;
		storage.removeItem(key(roomId));
	} catch {
		// Storage can be unavailable in locked-down browser contexts.
	}
	return null;
}

export function writeMeetingSession(
	session: MeetingSession,
	storage: SessionStorage | null = defaultStorage()
): void {
	if (!storage || !isMeetingSession(session, session.roomId)) return;
	try {
		storage.setItem(key(session.roomId), JSON.stringify(session));
	} catch {
		// A meeting still works when session recovery storage is unavailable.
	}
}

export function clearMeetingSession(
	roomId: string,
	storage: SessionStorage | null = defaultStorage()
): void {
	if (!storage) return;
	try {
		storage.removeItem(key(roomId));
	} catch {
		// Nothing else is required when storage is unavailable.
	}
}
