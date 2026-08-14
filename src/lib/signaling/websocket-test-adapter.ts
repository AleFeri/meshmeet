import type { IncomingSignal, OutgoingSignal } from '$lib/protocol/signaling';
import { isIncomingSignal } from '$lib/protocol/signaling';
import {
	RoomAccessError,
	RoomFullError,
	type JoinRoomInput,
	type Participant,
	type SignalingAdapter,
	type Unsubscribe
} from './types';

type ServerMessage =
	| { type: 'joined'; participants: Participant[] }
	| { type: 'participants'; participants: Participant[] }
	| { type: 'signal'; signal: IncomingSignal }
	| { type: 'error'; code: string; message: string };

export class WebSocketTestSignalingAdapter implements SignalingAdapter {
	#url: string;
	#socket: WebSocket | null = null;
	#participants: Participant[] = [];
	#participantListeners = new Set<(participants: Participant[]) => void>();
	#signalListeners = new Set<(signal: IncomingSignal) => void | Promise<void>>();
	#queuedSignals: IncomingSignal[] = [];

	constructor(url: string) {
		this.#url = url;
	}

	async joinRoom(input: JoinRoomInput): Promise<void> {
		const socket = new WebSocket(this.#url);
		this.#socket = socket;
		await new Promise<void>((resolve, reject) => {
			const timer = window.setTimeout(() => reject(new Error('Test signaling timed out.')), 5_000);
			socket.onopen = () => socket.send(JSON.stringify({ type: 'join', ...input }));
			socket.onmessage = (event) => {
				const message = this.#parse(event.data);
				if (!message) return;
				if (message.type === 'joined') {
					window.clearTimeout(timer);
					this.#participants = message.participants;
					this.#emitParticipants();
					resolve();
					return;
				}
				if (message.type === 'error') {
					window.clearTimeout(timer);
					reject(
						message.code === 'ROOM_FULL'
							? new RoomFullError()
							: new RoomAccessError(message.message)
					);
					return;
				}
				this.#handle(message);
			};
			socket.onerror = () => {
				window.clearTimeout(timer);
				reject(new Error('Test signaling connection failed.'));
			};
		});
		this.#socket.onmessage = (event) => {
			const message = this.#parse(event.data);
			if (message) this.#handle(message);
		};
	}

	async leaveRoom(): Promise<void> {
		this.#send({ type: 'leave' });
		this.#socket?.close();
		this.#socket = null;
		this.#participants = [];
		this.#queuedSignals = [];
	}

	async heartbeat(): Promise<void> {
		this.#send({ type: 'heartbeat' });
	}

	async setScreenSharing(isSharing: boolean): Promise<void> {
		this.#send({ type: 'sharing', isSharing });
	}

	async sendSignal(signal: OutgoingSignal): Promise<void> {
		this.#send({ type: 'signal', signal });
	}

	subscribeToParticipants(callback: (participants: Participant[]) => void): Unsubscribe {
		this.#participantListeners.add(callback);
		callback(this.#participants);
		return () => this.#participantListeners.delete(callback);
	}

	subscribeToSignals(callback: (signal: IncomingSignal) => void | Promise<void>): Unsubscribe {
		this.#signalListeners.add(callback);
		for (const signal of this.#queuedSignals.splice(0)) void callback(signal);
		return () => this.#signalListeners.delete(callback);
	}

	#send(value: object): void {
		if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(value));
	}

	#parse(data: unknown): ServerMessage | null {
		if (typeof data !== 'string' || data.length > 100_000) return null;
		try {
			const value: unknown = JSON.parse(data);
			if (!value || typeof value !== 'object' || !('type' in value)) return null;
			return value as ServerMessage;
		} catch {
			return null;
		}
	}

	#handle(message: ServerMessage): void {
		if (message.type === 'participants') {
			this.#participants = message.participants;
			this.#emitParticipants();
		} else if (message.type === 'signal' && isIncomingSignal(message.signal)) {
			if (this.#signalListeners.size === 0) this.#queuedSignals.push(message.signal);
			else for (const listener of this.#signalListeners) void listener(message.signal);
		}
	}

	#emitParticipants(): void {
		for (const listener of this.#participantListeners) listener(this.#participants);
	}
}
