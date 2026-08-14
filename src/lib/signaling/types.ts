import type { IncomingSignal, OutgoingSignal } from '$lib/protocol/signaling';

export type Unsubscribe = () => void;

export interface Participant {
	peerId: string;
	displayName: string;
	joinedAt: number;
	lastHeartbeatAt: number;
	isScreenSharing: boolean;
}

export interface JoinRoomInput {
	roomId: string;
	secretHash: string;
	peerId: string;
	sessionTokenHash: string;
	displayName: string;
	createIfMissing: boolean;
}

export interface SignalingAdapter {
	joinRoom(input: JoinRoomInput): Promise<void>;
	leaveRoom(): Promise<void>;
	heartbeat(): Promise<void>;
	setScreenSharing(isSharing: boolean): Promise<void>;
	sendSignal(signal: OutgoingSignal): Promise<void>;
	subscribeToParticipants(callback: (participants: Participant[]) => void): Unsubscribe;
	subscribeToSignals(callback: (signal: IncomingSignal) => void | Promise<void>): Unsubscribe;
}

export class RoomFullError extends Error {
	constructor() {
		super('This room is full. MeshMeet rooms support up to four participants.');
		this.name = 'RoomFullError';
	}
}

export class RoomAccessError extends Error {
	constructor(message = 'The room link is invalid or the room has expired.') {
		super(message);
		this.name = 'RoomAccessError';
	}
}
