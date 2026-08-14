import { LIMITS } from '$lib/config/brand';
import type { IncomingSignal, OutgoingSignal } from '$lib/protocol/signaling';
import { randomBase64Url } from '$lib/protocol/ids';
import {
	RoomAccessError,
	RoomFullError,
	type JoinRoomInput,
	type Participant,
	type SignalingAdapter,
	type Unsubscribe
} from './types';

type LocalMessage =
	| { type: 'discover'; requestId: string; fromPeerId: string }
	| { type: 'snapshot'; requestId: string; toPeerId: string; participants: Participant[] }
	| { type: 'joined'; participant: Participant }
	| { type: 'heartbeat'; participant: Participant }
	| { type: 'left'; peerId: string }
	| { type: 'signal'; recipientPeerId: string; signal: IncomingSignal };

const DISCOVERY_WINDOW_MS = 220;

export class LocalSignalingAdapter implements SignalingAdapter {
	#channel: BroadcastChannel | null = null;
	#identity: JoinRoomInput | null = null;
	#participants = new Map<string, Participant>();
	#participantListeners = new Set<(participants: Participant[]) => void>();
	#signalListeners = new Set<(signal: IncomingSignal) => void | Promise<void>>();
	#messageHandler = (event: MessageEvent<unknown>) => this.#handleMessage(event.data);

	async joinRoom(input: JoinRoomInput): Promise<void> {
		if (this.#identity) throw new Error('Already joined.');
		if (input.createIfMissing === false && !/^[a-f0-9]{64}$/.test(input.secretHash)) {
			throw new RoomAccessError();
		}
		this.#identity = input;
		this.#channel = new BroadcastChannel(`meshmeet:${input.roomId}:${input.secretHash}`);
		this.#channel.addEventListener('message', this.#messageHandler);
		const requestId = randomBase64Url(12);
		this.#channel.postMessage({
			type: 'discover',
			requestId,
			fromPeerId: input.peerId
		} satisfies LocalMessage);
		await new Promise((resolve) => window.setTimeout(resolve, DISCOVERY_WINDOW_MS));
		if (this.#participants.size >= LIMITS.maxParticipants) {
			this.#closeChannel();
			throw new RoomFullError();
		}
		const participant = this.#selfParticipant();
		this.#participants.set(input.peerId, participant);
		this.#channel.postMessage({ type: 'joined', participant } satisfies LocalMessage);
		this.#emitParticipants();
	}

	async leaveRoom(): Promise<void> {
		if (this.#channel && this.#identity) {
			this.#channel.postMessage({
				type: 'left',
				peerId: this.#identity.peerId
			} satisfies LocalMessage);
		}
		this.#closeChannel();
		this.#participants.clear();
		this.#identity = null;
		this.#emitParticipants();
	}

	async heartbeat(): Promise<void> {
		if (!this.#channel || !this.#identity) return;
		const participant = this.#selfParticipant();
		this.#participants.set(participant.peerId, participant);
		this.#channel.postMessage({ type: 'heartbeat', participant } satisfies LocalMessage);
	}

	async setScreenSharing(isSharing: boolean): Promise<void> {
		if (!this.#identity) return;
		const existing = this.#participants.get(this.#identity.peerId) ?? this.#selfParticipant();
		const participant = { ...existing, isScreenSharing: isSharing, lastHeartbeatAt: Date.now() };
		this.#participants.set(participant.peerId, participant);
		this.#channel?.postMessage({ type: 'heartbeat', participant } satisfies LocalMessage);
		this.#emitParticipants();
	}

	async sendSignal(outgoing: OutgoingSignal): Promise<void> {
		if (!this.#channel || !this.#identity) throw new Error('Not joined.');
		const signal: IncomingSignal = {
			id: randomBase64Url(16),
			fromPeerId: this.#identity.peerId,
			type: outgoing.type,
			payload: outgoing.payload,
			createdAt: Date.now()
		};
		this.#channel.postMessage({
			type: 'signal',
			recipientPeerId: outgoing.toPeerId,
			signal
		} satisfies LocalMessage);
	}

	subscribeToParticipants(callback: (participants: Participant[]) => void): Unsubscribe {
		this.#participantListeners.add(callback);
		callback(this.#sortedParticipants());
		return () => this.#participantListeners.delete(callback);
	}

	subscribeToSignals(callback: (signal: IncomingSignal) => void | Promise<void>): Unsubscribe {
		this.#signalListeners.add(callback);
		return () => this.#signalListeners.delete(callback);
	}

	#handleMessage(value: unknown): void {
		if (!value || typeof value !== 'object' || !('type' in value) || !this.#identity) return;
		const message = value as LocalMessage;
		if (message.type === 'discover') {
			this.#channel?.postMessage({
				type: 'snapshot',
				requestId: message.requestId,
				toPeerId: message.fromPeerId,
				participants: this.#sortedParticipants()
			} satisfies LocalMessage);
			return;
		}
		if (message.type === 'snapshot') {
			if (message.toPeerId !== this.#identity.peerId) return;
			for (const participant of message.participants) {
				this.#participants.set(participant.peerId, participant);
			}
			return;
		}
		if (message.type === 'joined' || message.type === 'heartbeat') {
			this.#participants.set(message.participant.peerId, message.participant);
			this.#emitParticipants();
			return;
		}
		if (message.type === 'left') {
			this.#participants.delete(message.peerId);
			this.#emitParticipants();
			return;
		}
		if (message.type === 'signal' && message.recipientPeerId === this.#identity.peerId) {
			for (const listener of this.#signalListeners) void listener(message.signal);
		}
	}

	#selfParticipant(): Participant {
		if (!this.#identity) throw new Error('Not joined.');
		const existing = this.#participants.get(this.#identity.peerId);
		const now = Date.now();
		return {
			peerId: this.#identity.peerId,
			displayName: this.#identity.displayName,
			joinedAt: existing?.joinedAt ?? now,
			lastHeartbeatAt: now,
			isScreenSharing: existing?.isScreenSharing ?? false
		};
	}

	#sortedParticipants(): Participant[] {
		return [...this.#participants.values()].sort(
			(a, b) => a.joinedAt - b.joinedAt || a.peerId.localeCompare(b.peerId)
		);
	}

	#emitParticipants(): void {
		const participants = this.#sortedParticipants();
		for (const listener of this.#participantListeners) listener(participants);
	}

	#closeChannel(): void {
		this.#channel?.removeEventListener('message', this.#messageHandler);
		this.#channel?.close();
		this.#channel = null;
	}
}
