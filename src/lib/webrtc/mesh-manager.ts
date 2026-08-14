import { ChatSession } from '$lib/chat/chat-session';
import type { ChatMessage } from '$lib/protocol/chat';
import { parseChatMessage } from '$lib/protocol/chat';
import type { ScreenShareProfile } from '$lib/media/screen-share';
import type {
	IceCandidatePayload,
	IncomingSignal,
	OutgoingSignal,
	SignalType
} from '$lib/protocol/signaling';
import { isIncomingSignal } from '$lib/protocol/signaling';
import type { Participant } from '$lib/signaling/types';
import { initialNegotiationState, shouldAcceptDescription } from './negotiation-state';
import { configureScreenSender } from './screen-encoding';

export type PeerConnectionStatus =
	'new' | 'connecting' | 'connected' | 'recovering' | 'failed' | 'closed';

export interface MeshManagerEvents {
	onConnectionStatus(peerId: string, status: PeerConnectionStatus, message?: string): void;
	onRemoteStream(peerId: string, kind: 'audio' | 'screen', stream: MediaStream | null): void;
	onChatMessages(messages: readonly ChatMessage[]): void;
	onError(message: string): void;
}

export interface MeshManagerOptions {
	localPeerId: string;
	displayName: string;
	localMicrophoneStream: MediaStream;
	iceServers: RTCIceServer[];
	sendSignal: (signal: OutgoingSignal) => Promise<void>;
	events: MeshManagerEvents;
	peerConnectionFactory?: (configuration: RTCConfiguration) => RTCPeerConnection;
}

interface PeerState {
	connection: RTCPeerConnection;
	polite: boolean;
	negotiation: ReturnType<typeof initialNegotiationState>;
	dataChannel: RTCDataChannel | null;
	pendingChatPayloads: string[];
	localIceCandidates: RTCIceCandidateInit[];
	remoteIceCandidates: RTCIceCandidateInit[];
	iceBatchTimer: number | null;
	recoveryTimer: number | null;
	failureTimer: number | null;
	connectionTimer: number | null;
	screenSenders: RTCRtpSender[];
	remoteAudioStream: MediaStream;
}

const CHAT_CHANNEL_LABEL = 'meshmeet-chat-v1';
const ICE_BATCH_MS = 150;
const MAX_PENDING_CHAT_MESSAGES = 50;

export class MeshConnectionManager {
	readonly #options: MeshManagerOptions;
	readonly #peers = new Map<string, PeerState>();
	readonly #chat = new ChatSession();
	#screenStream: MediaStream | null = null;
	#screenProfile: ScreenShareProfile | null = null;
	#closed = false;
	#unsubscribeChat: () => void;

	constructor(options: MeshManagerOptions) {
		this.#options = options;
		this.#unsubscribeChat = this.#chat.subscribe((messages) =>
			this.#options.events.onChatMessages(messages)
		);
	}

	setParticipants(participants: readonly Participant[]): void {
		if (this.#closed) return;
		const remoteIds = new Set(
			participants
				.map((participant) => participant.peerId)
				.filter((peerId) => peerId !== this.#options.localPeerId)
		);
		for (const peerId of remoteIds) this.#ensurePeer(peerId);
		for (const peerId of this.#peers.keys()) {
			if (!remoteIds.has(peerId)) this.#removePeer(peerId);
		}
	}

	async handleSignal(value: IncomingSignal): Promise<void> {
		if (
			this.#closed ||
			!isIncomingSignal(value) ||
			value.fromPeerId === this.#options.localPeerId
		) {
			return;
		}
		const state = this.#ensurePeer(value.fromPeerId);
		try {
			if (value.type === 'offer' || value.type === 'answer') {
				if (value.payload.kind !== 'description') return;
				await this.#handleDescription(value.fromPeerId, state, value.payload.description);
				return;
			}
			if (value.type === 'ice') {
				if (value.payload.kind !== 'ice') return;
				await this.#handleRemoteIce(state, value.payload);
				return;
			}
			if (value.type === 'renegotiate' && value.payload.kind === 'renegotiate') {
				if (value.payload.reason === 'ice-restart') state.connection.restartIce();
				else await this.#negotiate(value.fromPeerId, state);
			}
		} catch (error) {
			this.#options.events.onError(
				`Could not negotiate a direct connection with a participant: ${this.#message(error)}`
			);
		}
	}

	setMicrophoneEnabled(enabled: boolean): void {
		for (const track of this.#options.localMicrophoneStream.getAudioTracks())
			track.enabled = enabled;
	}

	async startScreenShare(stream: MediaStream, profile: ScreenShareProfile): Promise<void> {
		if (this.#closed) throw new Error('Meeting has ended.');
		await this.stopScreenShare(false);
		this.#screenStream = stream;
		this.#screenProfile = profile;
		const additions: Promise<void>[] = [];
		for (const [peerId, state] of this.#peers) {
			additions.push(this.#addScreenTracks(peerId, state));
		}
		await Promise.all(additions);
	}

	async updateScreenShareQuality(profile: ScreenShareProfile): Promise<void> {
		this.#screenProfile = profile;
		const updates: Promise<boolean>[] = [];
		for (const state of this.#peers.values()) {
			for (const sender of state.screenSenders) {
				if (sender.track?.kind === 'video') updates.push(configureScreenSender(sender, profile));
			}
		}
		await Promise.all(updates);
	}

	async stopScreenShare(stopTracks = true): Promise<void> {
		const stream = this.#screenStream;
		this.#screenStream = null;
		this.#screenProfile = null;
		for (const state of this.#peers.values()) {
			for (const sender of state.screenSenders) {
				try {
					state.connection.removeTrack(sender);
				} catch {
					// A closing connection may already have removed the sender.
				}
			}
			state.screenSenders = [];
		}
		if (stopTracks) for (const track of stream?.getTracks() ?? []) track.stop();
	}

	broadcastChat(text: string): ChatMessage {
		const message = this.#chat.create(this.#options.localPeerId, this.#options.displayName, text);
		this.#chat.add(message);
		const serialized = JSON.stringify(message);
		for (const state of this.#peers.values()) {
			if (state.dataChannel?.readyState === 'open') {
				state.dataChannel.send(serialized);
			} else if (state.pendingChatPayloads.length < MAX_PENDING_CHAT_MESSAGES) {
				// A peer connection can become connected just before its negotiated data
				// channel opens. Keep only this peer's current-session messages in memory
				// and discard them with the peer state if the connection never opens.
				state.pendingChatPayloads.push(serialized);
			}
		}
		return message;
	}

	updateIceServers(iceServers: RTCIceServer[]): void {
		for (const state of this.#peers.values()) {
			state.connection.setConfiguration({ ...state.connection.getConfiguration(), iceServers });
		}
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		void this.stopScreenShare(true);
		for (const peerId of [...this.#peers.keys()]) this.#removePeer(peerId);
		for (const track of this.#options.localMicrophoneStream.getTracks()) track.stop();
		this.#chat.clear();
		this.#unsubscribeChat();
	}

	#ensurePeer(peerId: string): PeerState {
		const existing = this.#peers.get(peerId);
		if (existing) return existing;
		const connection = this.#options.peerConnectionFactory
			? this.#options.peerConnectionFactory({ iceServers: this.#options.iceServers })
			: new RTCPeerConnection({ iceServers: this.#options.iceServers });
		const state: PeerState = {
			connection,
			polite: this.#options.localPeerId.localeCompare(peerId) > 0,
			negotiation: initialNegotiationState(),
			dataChannel: null,
			pendingChatPayloads: [],
			localIceCandidates: [],
			remoteIceCandidates: [],
			iceBatchTimer: null,
			recoveryTimer: null,
			failureTimer: null,
			connectionTimer: null,
			screenSenders: [],
			remoteAudioStream: new MediaStream()
		};
		this.#peers.set(peerId, state);

		connection.onnegotiationneeded = () => void this.#negotiate(peerId, state);
		connection.onicecandidate = (event) => this.#queueLocalIce(peerId, state, event.candidate);
		connection.onconnectionstatechange = () => this.#handleConnectionState(peerId, state);
		connection.oniceconnectionstatechange = () => this.#handleIceState(peerId, state);
		connection.ontrack = (event) => this.#handleTrack(peerId, state, event);
		connection.ondatachannel = (event) => this.#configureDataChannel(peerId, state, event.channel);

		for (const track of this.#options.localMicrophoneStream.getAudioTracks().slice(0, 1)) {
			connection.addTrack(track, this.#options.localMicrophoneStream);
		}
		if (this.#screenStream) {
			void this.#addScreenTracks(peerId, state).catch((error: unknown) =>
				this.#options.events.onError(`Could not configure screen sharing: ${this.#message(error)}`)
			);
		}
		if (this.#options.localPeerId.localeCompare(peerId) < 0) {
			this.#configureDataChannel(
				peerId,
				state,
				connection.createDataChannel(CHAT_CHANNEL_LABEL, { ordered: true })
			);
		} else {
			// A peer keeping the same participant identity after a refresh needs the
			// smaller peer to replace its old session immediately instead of waiting
			// for ICE failure detection.
			void this.#send(peerId, 'renegotiate', {
				kind: 'renegotiate',
				reason: 'initial'
			});
		}
		this.#options.events.onConnectionStatus(peerId, 'connecting');
		state.connectionTimer = window.setTimeout(() => {
			if (state.connection.connectionState !== 'connected') {
				this.#options.events.onConnectionStatus(
					peerId,
					'failed',
					'Direct connection timed out. Configure TURN or try another network.'
				);
			}
		}, 20_000);
		return state;
	}

	async #negotiate(peerId: string, state: PeerState): Promise<void> {
		if (
			this.#closed ||
			state.connection.signalingState === 'closed' ||
			state.negotiation.makingOffer
		)
			return;
		// Let the lexicographically smaller peer make the first offer. Both peers still
		// use perfect negotiation for every later renegotiation, but avoiding needless
		// initial glare also prevents browsers from discarding their first ICE gathering.
		if (
			!state.connection.remoteDescription &&
			this.#options.localPeerId.localeCompare(peerId) > 0
		) {
			return;
		}
		try {
			state.negotiation.makingOffer = true;
			await state.connection.setLocalDescription();
			const description = state.connection.localDescription;
			if (!description || (description.type !== 'offer' && description.type !== 'answer')) return;
			await this.#send(peerId, description.type, {
				kind: 'description',
				description: { type: description.type, sdp: description.sdp ?? '' }
			});
		} catch (error) {
			this.#options.events.onError(`Negotiation failed: ${this.#message(error)}`);
		} finally {
			state.negotiation.makingOffer = false;
		}
	}

	async #handleDescription(
		peerId: string,
		state: PeerState,
		description: { type: 'offer' | 'answer'; sdp: string }
	): Promise<void> {
		const decision = shouldAcceptDescription(
			state.negotiation,
			state.connection.signalingState,
			description.type,
			state.polite
		);
		state.negotiation.ignoreOffer = !decision.accept;
		if (!decision.accept) return;

		state.negotiation.isSettingRemoteAnswerPending = description.type === 'answer';
		await state.connection.setRemoteDescription(description);
		state.negotiation.isSettingRemoteAnswerPending = false;
		for (const candidate of state.remoteIceCandidates.splice(0)) {
			await state.connection.addIceCandidate(candidate);
		}
		if (description.type === 'offer') {
			await state.connection.setLocalDescription();
			const local = state.connection.localDescription;
			if (local?.type === 'answer') {
				await this.#send(peerId, 'answer', {
					kind: 'description',
					description: { type: 'answer', sdp: local.sdp ?? '' }
				});
			}
		}
	}

	async #handleRemoteIce(state: PeerState, payload: IceCandidatePayload): Promise<void> {
		for (const candidate of payload.candidates) {
			if (!state.connection.remoteDescription) {
				state.remoteIceCandidates.push(candidate);
				continue;
			}
			try {
				await state.connection.addIceCandidate(candidate);
			} catch (error) {
				if (!state.negotiation.ignoreOffer) throw error;
			}
		}
	}

	#queueLocalIce(peerId: string, state: PeerState, candidate: RTCIceCandidate | null): void {
		if (candidate) state.localIceCandidates.push(candidate.toJSON());
		if (state.localIceCandidates.length >= 20 || candidate === null) {
			this.#flushLocalIce(peerId, state);
			return;
		}
		if (state.iceBatchTimer === null) {
			state.iceBatchTimer = window.setTimeout(
				() => this.#flushLocalIce(peerId, state),
				ICE_BATCH_MS
			);
		}
	}

	#flushLocalIce(peerId: string, state: PeerState): void {
		if (state.iceBatchTimer !== null) window.clearTimeout(state.iceBatchTimer);
		state.iceBatchTimer = null;
		const candidates = state.localIceCandidates.splice(0, 20).map((candidate) => ({
			candidate: candidate.candidate ?? '',
			...(candidate.sdpMid !== null && candidate.sdpMid !== undefined
				? { sdpMid: candidate.sdpMid }
				: {}),
			...(candidate.sdpMLineIndex !== null && candidate.sdpMLineIndex !== undefined
				? { sdpMLineIndex: candidate.sdpMLineIndex }
				: {}),
			...(candidate.usernameFragment !== null && candidate.usernameFragment !== undefined
				? { usernameFragment: candidate.usernameFragment }
				: {})
		}));
		if (candidates.length > 0) void this.#send(peerId, 'ice', { kind: 'ice', candidates });
		if (state.localIceCandidates.length > 0) {
			state.iceBatchTimer = window.setTimeout(
				() => this.#flushLocalIce(peerId, state),
				ICE_BATCH_MS
			);
		}
	}

	#configureDataChannel(peerId: string, state: PeerState, channel: RTCDataChannel): void {
		if (channel.label !== CHAT_CHANNEL_LABEL) {
			channel.close();
			return;
		}
		if (state.dataChannel && state.dataChannel !== channel) state.dataChannel.close();
		state.dataChannel = channel;
		channel.binaryType = 'arraybuffer';
		const flushPending = () => {
			if (state.dataChannel !== channel) return;
			while (channel.readyState === 'open' && state.pendingChatPayloads.length > 0) {
				const payload = state.pendingChatPayloads.shift();
				if (payload) channel.send(payload);
			}
		};
		channel.onopen = flushPending;
		if (channel.readyState === 'open') flushPending();
		channel.onmessage = (event) => {
			if (typeof event.data !== 'string') return;
			const message = parseChatMessage(event.data);
			if (!message || message.senderPeerId !== peerId) return;
			this.#chat.add(message);
		};
		channel.onerror = () =>
			this.#options.events.onError(
				'The private chat channel to one participant encountered an error.'
			);
		channel.onclose = () => {
			if (state.dataChannel === channel) state.dataChannel = null;
		};
	}

	#handleTrack(peerId: string, state: PeerState, event: RTCTrackEvent): void {
		if (event.track.kind === 'audio') {
			if (!state.remoteAudioStream.getTracks().some((track) => track.id === event.track.id)) {
				state.remoteAudioStream.addTrack(event.track);
			}
			this.#options.events.onRemoteStream(peerId, 'audio', state.remoteAudioStream);
			event.track.addEventListener('ended', () => {
				state.remoteAudioStream.removeTrack(event.track);
				this.#options.events.onRemoteStream(
					peerId,
					'audio',
					state.remoteAudioStream.getTracks().length > 0 ? state.remoteAudioStream : null
				);
			});
			return;
		}
		const stream = event.streams[0] ?? new MediaStream([event.track]);
		this.#options.events.onRemoteStream(peerId, 'screen', stream);
		event.track.addEventListener('ended', () =>
			this.#options.events.onRemoteStream(peerId, 'screen', null)
		);
	}

	async #addScreenTracks(_peerId: string, state: PeerState): Promise<void> {
		if (!this.#screenStream) return;
		const configurations: Promise<boolean>[] = [];
		for (const track of this.#screenStream.getTracks()) {
			if (track.kind === 'video' || track.kind === 'audio') {
				const sender = state.connection.addTrack(track, this.#screenStream);
				state.screenSenders.push(sender);
				if (track.kind === 'video' && this.#screenProfile) {
					configurations.push(configureScreenSender(sender, this.#screenProfile));
				}
			}
		}
		await Promise.all(configurations);
	}

	#handleConnectionState(peerId: string, state: PeerState): void {
		const status = state.connection.connectionState;
		if (status === 'connected') {
			this.#clearTimers(state);
			this.#options.events.onConnectionStatus(peerId, 'connected');
		} else if (status === 'connecting' || status === 'new') {
			this.#options.events.onConnectionStatus(peerId, 'connecting');
		} else if (status === 'failed') {
			this.#attemptRecovery(peerId, state);
		} else if (status === 'closed') {
			this.#options.events.onConnectionStatus(peerId, 'closed');
		}
	}

	#handleIceState(peerId: string, state: PeerState): void {
		if (state.connection.iceConnectionState === 'disconnected') {
			this.#options.events.onConnectionStatus(peerId, 'recovering', 'Connection interrupted…');
			if (state.recoveryTimer === null) {
				state.recoveryTimer = window.setTimeout(() => this.#attemptRecovery(peerId, state), 5_000);
			}
		}
	}

	#attemptRecovery(peerId: string, state: PeerState): void {
		if (state.connection.signalingState === 'closed') return;
		this.#options.events.onConnectionStatus(peerId, 'recovering', 'Trying to reconnect…');
		state.connection.restartIce();
		void this.#send(peerId, 'renegotiate', { kind: 'renegotiate', reason: 'ice-restart' });
		if (state.failureTimer === null) {
			state.failureTimer = window.setTimeout(() => {
				if (state.connection.connectionState !== 'connected') {
					this.#options.events.onConnectionStatus(
						peerId,
						'failed',
						'P2P connection failed. TURN may be required on this network.'
					);
				}
			}, 10_000);
		}
	}

	#clearTimers(state: PeerState): void {
		for (const timer of [state.recoveryTimer, state.failureTimer, state.connectionTimer]) {
			if (timer !== null) window.clearTimeout(timer);
		}
		state.recoveryTimer = null;
		state.failureTimer = null;
		state.connectionTimer = null;
	}

	#removePeer(peerId: string): void {
		const state = this.#peers.get(peerId);
		if (!state) return;
		this.#clearTimers(state);
		if (state.iceBatchTimer !== null) window.clearTimeout(state.iceBatchTimer);
		state.dataChannel?.close();
		state.connection.close();
		this.#peers.delete(peerId);
		this.#options.events.onRemoteStream(peerId, 'audio', null);
		this.#options.events.onRemoteStream(peerId, 'screen', null);
		this.#options.events.onConnectionStatus(peerId, 'closed');
	}

	async #send(peerId: string, type: SignalType, payload: OutgoingSignal['payload']): Promise<void> {
		await this.#options.sendSignal({ toPeerId: peerId, type, payload });
	}

	#message(error: unknown): string {
		return error instanceof Error ? error.message : 'Unknown browser error';
	}
}
