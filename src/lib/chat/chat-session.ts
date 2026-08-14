import { LIMITS } from '$lib/config/brand';
import { randomBase64Url } from '$lib/protocol/ids';
import { isChatMessage, type ChatMessage } from '$lib/protocol/chat';

export class ChatSession {
	readonly #messages: ChatMessage[] = [];
	readonly #seenIds = new Set<string>();
	readonly #listeners = new Set<(messages: readonly ChatMessage[]) => void>();

	get messages(): readonly ChatMessage[] {
		return this.#messages;
	}

	create(peerId: string, displayName: string, text: string): ChatMessage {
		const normalized = text.trim();
		if (!normalized) throw new Error('Message cannot be empty.');
		if (normalized.length > LIMITS.maxChatLength) {
			throw new Error(
				`Messages are limited to ${LIMITS.maxChatLength.toLocaleString()} characters.`
			);
		}
		return {
			type: 'chat',
			messageId: randomBase64Url(16),
			senderPeerId: peerId,
			senderDisplayName: displayName,
			timestamp: Date.now(),
			text: normalized
		};
	}

	add(message: ChatMessage): boolean {
		if (!isChatMessage(message) || this.#seenIds.has(message.messageId)) return false;
		this.#seenIds.add(message.messageId);
		this.#messages.push(message);
		this.#emit();
		return true;
	}

	clear(): void {
		this.#messages.length = 0;
		this.#seenIds.clear();
		this.#emit();
	}

	subscribe(listener: (messages: readonly ChatMessage[]) => void): () => void {
		this.#listeners.add(listener);
		listener(this.#messages);
		return () => this.#listeners.delete(listener);
	}

	#emit(): void {
		for (const listener of this.#listeners) listener(this.#messages);
	}
}
