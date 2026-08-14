import type { ConvexClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import type { Value } from 'convex/values';
import type {
	IncomingSignal,
	OutgoingSignal,
	SignalPayload,
	SignalType
} from '$lib/protocol/signaling';
import { isIncomingSignal } from '$lib/protocol/signaling';
import {
	RoomAccessError,
	RoomFullError,
	type JoinRoomInput,
	type Participant,
	type SignalingAdapter,
	type Unsubscribe
} from './types';

interface ConvexSignal {
	_id: string;
	senderPeerId: string;
	signalType: SignalType;
	payload: SignalPayload;
	createdAt: number;
}

interface Credentials {
	roomId: string;
	secretHash: string;
	peerId: string;
	sessionTokenHash: string;
}

type ConvexArgs<T> = T & Record<string, Value>;

const joinRef = makeFunctionReference<
	'mutation',
	ConvexArgs<JoinRoomInput>,
	{ participant: Participant }
>('rooms:join');
const leaveRef = makeFunctionReference<'mutation', ConvexArgs<Credentials>, null>('rooms:leave');
const heartbeatRef = makeFunctionReference<'mutation', ConvexArgs<Credentials>, null>(
	'rooms:heartbeat'
);
const setSharingRef = makeFunctionReference<
	'mutation',
	ConvexArgs<Credentials & { isScreenSharing: boolean }>,
	null
>('rooms:setScreenSharing');
const participantsRef = makeFunctionReference<'query', ConvexArgs<Credentials>, Participant[]>(
	'rooms:listParticipants'
);
const sendSignalRef = makeFunctionReference<
	'mutation',
	ConvexArgs<
		Credentials & { recipientPeerId: string; signalType: SignalType; payload: SignalPayload }
	>,
	null
>('signals:send');
const inboxRef = makeFunctionReference<'query', ConvexArgs<Credentials>, ConvexSignal[]>(
	'signals:inbox'
);
const acknowledgeRef = makeFunctionReference<
	'mutation',
	ConvexArgs<Credentials & { signalId: string }>,
	null
>('signals:acknowledge');

function translateError(error: unknown): Error {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes('ROOM_FULL')) return new RoomFullError();
	if (message.includes('ROOM_ACCESS') || message.includes('ROOM_EXPIRED'))
		return new RoomAccessError();
	return error instanceof Error ? error : new Error(message);
}

export class ConvexSignalingAdapter implements SignalingAdapter {
	readonly #client: ConvexClient;
	#credentials: Credentials | null = null;
	#processedSignals = new Set<string>();

	constructor(client: ConvexClient) {
		this.#client = client;
	}

	async joinRoom(input: JoinRoomInput): Promise<void> {
		try {
			await this.#client.mutation(joinRef, input as ConvexArgs<JoinRoomInput>);
			this.#credentials = {
				roomId: input.roomId,
				secretHash: input.secretHash,
				peerId: input.peerId,
				sessionTokenHash: input.sessionTokenHash
			};
		} catch (error) {
			throw translateError(error);
		}
	}

	async leaveRoom(): Promise<void> {
		const credentials = this.#credentials;
		this.#credentials = null;
		this.#processedSignals.clear();
		if (!credentials) return;
		try {
			await this.#client.mutation(leaveRef, credentials as ConvexArgs<Credentials>);
		} catch {
			// Leaving is deliberately best effort; stale presence is cleaned server-side.
		}
	}

	async heartbeat(): Promise<void> {
		if (!this.#credentials) return;
		await this.#client.mutation(heartbeatRef, this.#credentials as ConvexArgs<Credentials>);
	}

	async setScreenSharing(isScreenSharing: boolean): Promise<void> {
		if (!this.#credentials) return;
		await this.#client.mutation(setSharingRef, {
			...this.#credentials,
			isScreenSharing
		} as ConvexArgs<Credentials & { isScreenSharing: boolean }>);
	}

	async sendSignal(signal: OutgoingSignal): Promise<void> {
		if (!this.#credentials) throw new Error('Not joined.');
		await this.#client.mutation(sendSignalRef, {
			...this.#credentials,
			recipientPeerId: signal.toPeerId,
			signalType: signal.type,
			payload: signal.payload
		} as ConvexArgs<
			Credentials & { recipientPeerId: string; signalType: SignalType; payload: SignalPayload }
		>);
	}

	subscribeToParticipants(callback: (participants: Participant[]) => void): Unsubscribe {
		if (!this.#credentials) throw new Error('Not joined.');
		return this.#client.onUpdate(
			participantsRef,
			this.#credentials as ConvexArgs<Credentials>,
			(participants) => callback(participants),
			(error) => console.error('Participant subscription failed.', translateError(error))
		);
	}

	subscribeToSignals(callback: (signal: IncomingSignal) => void | Promise<void>): Unsubscribe {
		if (!this.#credentials) throw new Error('Not joined.');
		const credentials = this.#credentials;
		return this.#client.onUpdate(
			inboxRef,
			credentials as ConvexArgs<Credentials>,
			(signals) => {
				for (const record of signals) {
					if (this.#processedSignals.has(record._id)) continue;
					const signal: IncomingSignal = {
						id: record._id,
						fromPeerId: record.senderPeerId,
						type: record.signalType,
						payload: record.payload,
						createdAt: record.createdAt
					};
					if (!isIncomingSignal(signal)) continue;
					this.#processedSignals.add(record._id);
					void Promise.resolve(callback(signal))
						.then(() =>
							this.#client.mutation(acknowledgeRef, {
								...credentials,
								signalId: record._id
							} as ConvexArgs<Credentials & { signalId: string }>)
						)
						.catch((error: unknown) => {
							this.#processedSignals.delete(record._id);
							console.error('Signal processing failed.', error);
						});
				}
			},
			(error) => console.error('Signal subscription failed.', translateError(error))
		);
	}
}
