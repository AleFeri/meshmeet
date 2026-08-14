import { LIMITS } from '$lib/config/brand';

export interface ChatMessage {
	type: 'chat';
	messageId: string;
	senderPeerId: string;
	senderDisplayName: string;
	timestamp: number;
	text: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export function isChatMessage(value: unknown): value is ChatMessage {
	if (!isRecord(value)) return false;
	return (
		value.type === 'chat' &&
		typeof value.messageId === 'string' &&
		/^[A-Za-z0-9_-]{16,64}$/.test(value.messageId) &&
		typeof value.senderPeerId === 'string' &&
		/^[A-Za-z0-9_-]{16,64}$/.test(value.senderPeerId) &&
		typeof value.senderDisplayName === 'string' &&
		value.senderDisplayName.trim().length > 0 &&
		value.senderDisplayName.length <= LIMITS.maxDisplayNameLength &&
		typeof value.timestamp === 'number' &&
		Number.isFinite(value.timestamp) &&
		value.timestamp > 0 &&
		typeof value.text === 'string' &&
		value.text.trim().length > 0 &&
		value.text.length <= LIMITS.maxChatLength
	);
}

export function parseChatMessage(raw: string): ChatMessage | null {
	if (raw.length > 8_192) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isChatMessage(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
