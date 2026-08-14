<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { env } from '$env/dynamic/public';
	import { onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { getConvexClient } from 'convex-svelte';
	import type { ConvexClient } from 'convex/browser';
	import RemoteAudio from '$lib/components/RemoteAudio.svelte';
	import ScreenStage from '$lib/components/ScreenStage.svelte';
	import { BRAND, LIMITS } from '$lib/config/brand';
	import { MicrophoneController, type MicrophoneState } from '$lib/media/microphone';
	import { ScreenShareController } from '$lib/media/screen-share';
	import type { ChatMessage } from '$lib/protocol/chat';
	import { createPeerId, createSessionToken, sha256Hex } from '$lib/protocol/ids';
	import { createSignalingAdapter } from '$lib/signaling/create-adapter';
	import { createIceServerProvider } from '$lib/signaling/create-ice-server-provider';
	import { RoomFullError, type Participant, type SignalingAdapter } from '$lib/signaling/types';
	import { pendingCreatedRoomId, pendingDisplayName } from '$lib/stores/journey';
	import { MeshConnectionManager, type PeerConnectionStatus } from '$lib/webrtc/mesh-manager';

	type ViewState = 'prejoin' | 'joining' | 'meeting';
	interface RemoteStreamEntry {
		peerId: string;
		stream: MediaStream;
	}
	interface StatusEntry {
		status: PeerConnectionStatus;
		message?: string;
	}

	const roomId = page.params.roomId ?? '';
	const convexClient: ConvexClient | null = env.PUBLIC_CONVEX_URL ? getConvexClient() : null;
	let view = $state<ViewState>('prejoin');
	let secret = $state('');
	let displayName = $state(get(pendingDisplayName));
	let muted = $state(false);
	let microphone = $state<MicrophoneState>({
		stream: null,
		devices: [],
		selectedDeviceId: '',
		level: 0,
		error: null
	});
	let participants = $state<Participant[]>([]);
	let statuses = $state<Record<string, StatusEntry>>({});
	let remoteAudio = $state<RemoteStreamEntry[]>([]);
	let remoteScreens = $state<RemoteStreamEntry[]>([]);
	let localScreen = $state<MediaStream | null>(null);
	let chatMessages = $state<readonly ChatMessage[]>([]);
	let chatOpen = $state(false);
	let chatDraft = $state('');
	let error = $state('');
	let announcement = $state('');
	let audioBlocked = $state(false);
	let sharing = $state(false);
	let copied = $state(false);

	let microphoneController: MicrophoneController | null = null;
	let screenController: ScreenShareController | null = null;
	let signaling: SignalingAdapter | null = null;
	let manager: MeshConnectionManager | null = null;
	let heartbeatTimer: number | null = null;
	let subscriptions: Array<() => void> = [];

	let selfPeerId = $state('');
	const otherParticipants = $derived(
		participants.filter((participant) => participant.peerId !== selfPeerId)
	);
	const stagedScreen = $derived(
		localScreen
			? { stream: localScreen, sharerName: 'You' }
			: remoteScreens[0]
				? {
						stream: remoteScreens[0].stream,
						sharerName:
							participants.find((participant) => participant.peerId === remoteScreens[0].peerId)
								?.displayName ?? 'A participant'
					}
				: { stream: null, sharerName: null }
	);

	onMount(() => {
		secret = window.location.hash.slice(1);
		if (!/^[A-Za-z0-9_-]{43}$/.test(secret) || !/^[A-Za-z0-9_-]{22}$/.test(roomId)) {
			error = 'This invitation link is incomplete or invalid. Ask the host for a new link.';
		}
		microphoneController = new MicrophoneController((state) => {
			microphone = state;
		});
		window.addEventListener('beforeunload', bestEffortLeave);
	});

	onDestroy(() => {
		window.removeEventListener('beforeunload', bestEffortLeave);
		void cleanup();
	});

	function bestEffortLeave(): void {
		manager?.close();
		void signaling?.leaveRoom();
	}

	async function prepareMicrophone(deviceId?: string): Promise<void> {
		error = '';
		try {
			const stream = await microphoneController?.request(deviceId);
			if (stream) microphoneController?.setEnabled(!muted);
			announcement = 'Microphone is ready.';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Microphone access failed.';
		}
	}

	async function joinMeeting(): Promise<void> {
		const normalizedName = displayName.trim();
		if (!normalizedName || normalizedName.length > LIMITS.maxDisplayNameLength) {
			error = `Enter a display name up to ${LIMITS.maxDisplayNameLength} characters.`;
			return;
		}
		if (!secret || error.includes('invitation')) return;
		view = 'joining';
		error = '';
		try {
			const localStream = microphone.stream ?? (await microphoneController?.request());
			if (!localStream) throw new Error('Microphone access is required to join this voice room.');
			microphoneController?.setEnabled(!muted);
			selfPeerId = createPeerId();
			const sessionToken = createSessionToken();
			const [secretHash, sessionTokenHash] = await Promise.all([
				sha256Hex(secret),
				sha256Hex(sessionToken)
			]);
			const credentials = { roomId, secretHash, peerId: selfPeerId, sessionTokenHash };
			signaling = createSignalingAdapter(convexClient, env.PUBLIC_E2E_SIGNALING_URL);
			await signaling.joinRoom({
				...credentials,
				displayName: normalizedName,
				createIfMissing: get(pendingCreatedRoomId) === roomId
			});
			pendingCreatedRoomId.set(null);
			pendingDisplayName.set(normalizedName);
			const iceServers = await createIceServerProvider(convexClient).getIceServers(credentials);
			manager = new MeshConnectionManager({
				localPeerId: selfPeerId,
				displayName: normalizedName,
				localMicrophoneStream: localStream,
				iceServers,
				sendSignal: (signal) =>
					signaling?.sendSignal(signal) ?? Promise.reject(new Error('Signaling closed.')),
				events: {
					onConnectionStatus: (peerId, status, message) => {
						statuses[peerId] = { status, ...(message ? { message } : {}) };
						if (status === 'failed' && message) error = message;
					},
					onRemoteStream: updateRemoteStream,
					onChatMessages: (messages) => {
						chatMessages = [...messages];
					},
					onError: (message) => {
						error = message;
					}
				}
			});
			screenController = new ScreenShareController(manager, () => {
				localScreen = null;
				sharing = false;
				void signaling?.setScreenSharing(false);
				announcement = 'Screen sharing stopped.';
			});
			subscriptions = [
				signaling.subscribeToSignals((signal) => manager?.handleSignal(signal)),
				signaling.subscribeToParticipants((nextParticipants) => {
					participants = nextParticipants;
					manager?.setParticipants(nextParticipants);
				})
			];
			heartbeatTimer = window.setInterval(() => {
				void signaling?.heartbeat().catch(() => {
					error = 'Presence update failed. Check your connection.';
				});
			}, 30_000);
			view = 'meeting';
			announcement = `Joined ${BRAND.name}.`;
		} catch (cause) {
			if (cause instanceof RoomFullError) {
				error = cause.message;
			} else {
				error = cause instanceof Error ? cause.message : 'Could not join this room.';
			}
			await cleanup(false);
			view = 'prejoin';
		}
	}

	function updateRemoteStream(
		peerId: string,
		kind: 'audio' | 'screen',
		stream: MediaStream | null
	): void {
		const source = kind === 'audio' ? remoteAudio : remoteScreens;
		const next = source.filter((entry) => entry.peerId !== peerId);
		if (stream) next.push({ peerId, stream });
		if (kind === 'audio') remoteAudio = next;
		else remoteScreens = next;
	}

	function toggleMute(): void {
		muted = !muted;
		microphoneController?.setEnabled(!muted);
		manager?.setMicrophoneEnabled(!muted);
		announcement = muted ? 'Microphone muted.' : 'Microphone unmuted.';
	}

	async function toggleScreenShare(): Promise<void> {
		error = '';
		try {
			if (sharing) {
				await screenController?.stop();
				return;
			}
			const stream = await screenController?.start();
			if (!stream) return;
			localScreen = stream;
			sharing = true;
			await signaling?.setScreenSharing(true);
			announcement = 'Screen sharing started.';
		} catch (cause) {
			error =
				cause instanceof DOMException && cause.name === 'NotAllowedError'
					? 'Screen sharing was canceled or blocked by your browser.'
					: cause instanceof Error
						? cause.message
						: 'Screen sharing could not start.';
		}
	}

	function sendChat(): void {
		try {
			manager?.broadcastChat(chatDraft);
			chatDraft = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Message could not be sent.';
		}
	}

	async function copyInvite(): Promise<void> {
		const invitation = `${window.location.origin}${window.location.pathname}#${secret}`;
		try {
			await navigator.clipboard.writeText(invitation);
			copied = true;
			announcement = 'Invitation link copied.';
			window.setTimeout(() => {
				copied = false;
			}, 2_000);
		} catch {
			error = 'The browser could not copy the link. Copy it from the address bar instead.';
		}
	}

	async function enableAudio(): Promise<void> {
		const audioElements = document.querySelectorAll<HTMLAudioElement>('audio[data-peer-audio]');
		const results = await Promise.allSettled([...audioElements].map((element) => element.play()));
		audioBlocked = results.some((result) => result.status === 'rejected');
		if (!audioBlocked) announcement = 'Remote audio enabled.';
	}

	async function cleanup(stopMicrophone = true): Promise<void> {
		if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
		heartbeatTimer = null;
		for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
		manager?.close();
		manager = null;
		if (signaling) await signaling.leaveRoom();
		signaling = null;
		if (stopMicrophone) microphoneController?.stop();
		participants = [];
		remoteAudio = [];
		remoteScreens = [];
		chatMessages = [];
	}

	async function leaveMeeting(): Promise<void> {
		await cleanup();
		await goto(resolve('/'));
	}

	function participantStatus(peerId: string): string {
		const status = statuses[peerId]?.status;
		if (!status) return peerId === selfPeerId ? 'You' : 'Joining';
		return status === 'connected'
			? 'Connected'
			: status === 'recovering'
				? 'Reconnecting'
				: status === 'failed'
					? 'Connection failed'
					: status === 'closed'
						? 'Left'
						: 'Connecting';
	}
</script>

<svelte:head
	><title>{view === 'meeting' ? 'Meeting' : 'Join room'} · {BRAND.name}</title></svelte:head
>

<div class="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>

{#if view === 'prejoin' || view === 'joining'}
	<main class="prejoin-shell">
		<header>
			<a class="brand" href={resolve('/')}
				><span class="brand-mark" aria-hidden="true">M</span>{BRAND.name}</a
			>
			<span class="privacy-label"><span></span>P2P room</span>
		</header>
		<section class="prejoin-grid">
			<div class="preview-panel">
				<div
					class="audio-orbit"
					class:active={microphone.stream !== null && !muted}
					aria-hidden="true"
				>
					<div class="avatar">{displayName.trim().charAt(0).toUpperCase() || '?'}</div>
					<div class="level-ring" style={`--level: ${microphone.level}`}></div>
				</div>
				<h1>Check your sound</h1>
				<p>No camera. Just your voice until you choose to share a screen.</p>
				<div
					class="meter"
					aria-label="Live microphone level"
					role="meter"
					aria-valuenow={Math.round(microphone.level * 100)}
					aria-valuemin="0"
					aria-valuemax="100"
				>
					<span style={`width: ${Math.max(3, microphone.level * 100)}%`}></span>
				</div>
			</div>

			<div class="prejoin-card">
				<p class="eyebrow">Before you join</p>
				<h2>Settle in.</h2>
				<div class="field">
					<label for="room-display-name">Display name</label>
					<input
						id="room-display-name"
						data-testid="room-display-name"
						bind:value={displayName}
						maxlength={LIMITS.maxDisplayNameLength}
						autocomplete="name"
					/>
				</div>
				{#if microphone.stream}
					<div class="field">
						<label for="microphone-device">Microphone</label>
						<select
							id="microphone-device"
							data-testid="microphone-device"
							value={microphone.selectedDeviceId}
							onchange={(event) => void prepareMicrophone(event.currentTarget.value)}
						>
							{#each microphone.devices as device, index (device.deviceId)}
								<option value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>
							{/each}
						</select>
					</div>
				{:else}
					<button
						class="secondary permission-button"
						data-testid="prepare-microphone"
						onclick={() => void prepareMicrophone()}
						disabled={Boolean(error && error.includes('invitation'))}>Allow microphone</button
					>
				{/if}
				<label class="mute-check"
					><input
						type="checkbox"
						bind:checked={muted}
						onchange={() => microphoneController?.setEnabled(!muted)}
					/> Join with microphone muted</label
				>
				{#if microphone.error}<div class="error-box" role="alert">{microphone.error}</div>{/if}
				{#if error}<div class="error-box" data-testid="room-error" role="alert">{error}</div>{/if}
				<button
					class="primary join-meeting"
					data-testid="join-meeting"
					onclick={() => void joinMeeting()}
					disabled={view === 'joining' || Boolean(error && error.includes('invitation'))}
				>
					{view === 'joining' ? 'Joining securely…' : 'Join room'}
				</button>
				<p class="prejoin-note">
					Your room secret stays after the # in this browser URL and is never sent to the web host.
				</p>
			</div>
		</section>
	</main>
{:else}
	<div class="meeting-shell">
		<header class="meeting-header">
			<div class="meeting-brand">
				<span class="brand-mark" aria-hidden="true">M</span>
				<div><strong>{BRAND.name}</strong><span>Room · {roomId.slice(0, 6)}</span></div>
			</div>
			<div class="room-health">
				<span></span>{participants.length} / {LIMITS.maxParticipants} in room
			</div>
		</header>

		<main class="meeting-main" class:chat-visible={chatOpen}>
			<div class="stage-column">
				{#if audioBlocked}<button class="audio-banner" onclick={() => void enableAudio()}
						>Enable remote audio</button
					>{/if}
				{#if error}<div class="error-box meeting-error" role="alert">
						{error}<button
							aria-label="Dismiss message"
							onclick={() => {
								error = '';
							}}>×</button
						>
					</div>{/if}
				<ScreenStage stream={stagedScreen.stream} sharerName={stagedScreen.sharerName} />
				{#if otherParticipants.length === 0}
					<p class="waiting" data-testid="waiting-state">
						<span></span>Waiting for someone to join…
					</p>
				{/if}
			</div>

			<aside class="people-panel" aria-label="Participants">
				<div class="panel-title">
					<h2>People</h2>
					<span>{participants.length}</span>
				</div>
				<ul data-testid="participant-list">
					{#each participants as participant (participant.peerId)}
						<li data-testid="participant-item">
							<div class="participant-avatar">
								{participant.displayName.charAt(0).toUpperCase()}
							</div>
							<div class="participant-copy">
								<strong
									>{participant.displayName}{participant.peerId === selfPeerId
										? ' (you)'
										: ''}</strong
								><span class:connected={participantStatus(participant.peerId) === 'Connected'}
									>{participantStatus(participant.peerId)}</span
								>
							</div>
							{#if participant.isScreenSharing}<span class="sharing-badge">Sharing</span>{/if}
						</li>
					{/each}
				</ul>
			</aside>

			{#if chatOpen}
				<aside class="chat-panel" aria-label="Ephemeral chat">
					<div class="panel-title">
						<div>
							<h2>Room chat</h2>
							<small>Not saved</small>
						</div>
						<button
							aria-label="Close chat"
							onclick={() => {
								chatOpen = false;
							}}>×</button
						>
					</div>
					<div class="messages" data-testid="chat-messages" aria-live="polite">
						{#if chatMessages.length === 0}<div class="chat-empty">
								<strong>Start here, end here.</strong>
								<p>Messages only reach people connected now and vanish when you leave.</p>
							</div>{/if}
						{#each chatMessages as message (message.messageId)}
							<article class:own={message.senderPeerId === selfPeerId}>
								<div>
									<strong
										>{message.senderPeerId === selfPeerId
											? 'You'
											: message.senderDisplayName}</strong
									><time datetime={new Date(message.timestamp).toISOString()}
										>{new Date(message.timestamp).toLocaleTimeString([], {
											hour: '2-digit',
											minute: '2-digit'
										})}</time
									>
								</div>
								<p>{message.text}</p>
							</article>
						{/each}
					</div>
					<form
						class="chat-compose"
						onsubmit={(event) => {
							event.preventDefault();
							sendChat();
						}}
					>
						<label class="sr-only" for="chat-message">Message</label>
						<textarea
							id="chat-message"
							data-testid="chat-input"
							bind:value={chatDraft}
							maxlength={LIMITS.maxChatLength}
							rows="2"
							placeholder="Write a message…"></textarea>
						<div>
							<span>{chatDraft.length} / {LIMITS.maxChatLength}</span><button
								class="primary"
								data-testid="send-chat"
								type="submit"
								disabled={!chatDraft.trim()}>Send</button
							>
						</div>
					</form>
				</aside>
			{/if}
		</main>

		<footer class="meeting-controls" aria-label="Meeting controls">
			<div class="control-group">
				<button
					class="control"
					class:active-control={muted}
					data-testid="toggle-mute"
					aria-pressed={muted}
					onclick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button
				>
				<button
					class="control"
					class:active-control={sharing}
					data-testid="toggle-screen"
					aria-pressed={sharing}
					onclick={() => void toggleScreenShare()}
					>{sharing ? 'Stop sharing' : 'Share screen'}</button
				>
			</div>
			<div class="control-group secondary-controls">
				<button class="control" data-testid="copy-invite" onclick={() => void copyInvite()}
					>{copied ? 'Copied!' : 'Copy invite'}</button
				>
				<button
					class="control"
					class:active-control={chatOpen}
					data-testid="toggle-chat"
					aria-expanded={chatOpen}
					onclick={() => {
						chatOpen = !chatOpen;
					}}>Chat{chatMessages.length > 0 ? ` · ${chatMessages.length}` : ''}</button
				>
				<button class="danger-button" data-testid="leave-room" onclick={() => void leaveMeeting()}
					>Leave</button
				>
			</div>
		</footer>

		{#each remoteAudio as audio (audio.peerId)}
			<RemoteAudio
				stream={audio.stream}
				peerId={audio.peerId}
				onblocked={() => {
					audioBlocked = true;
				}}
			/>
		{/each}
	</div>
{/if}

<style>
	.prejoin-shell {
		min-height: 100vh;
		max-width: 1160px;
		margin: 0 auto;
		padding: 1.4rem 2rem 3rem;
	}
	.prejoin-shell header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.prejoin-shell header a {
		color: var(--text);
		text-decoration: none;
	}
	.privacy-label,
	.room-health {
		display: flex;
		gap: 0.55rem;
		align-items: center;
		color: var(--muted);
		font-size: 0.82rem;
	}
	.privacy-label span,
	.room-health span {
		width: 0.5rem;
		height: 0.5rem;
		background: var(--accent);
		border-radius: 50%;
	}
	.prejoin-grid {
		min-height: calc(100vh - 6rem);
		display: grid;
		grid-template-columns: 1.15fr minmax(330px, 0.7fr);
		gap: clamp(2rem, 7vw, 6rem);
		align-items: center;
		padding: 4rem 0;
	}
	.preview-panel {
		min-height: 520px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		border-radius: 1.5rem;
		background: linear-gradient(145deg, #11231e, #0d1714);
		border: 1px solid var(--border);
		text-align: center;
	}
	.preview-panel h1 {
		margin: 2rem 0 0.5rem;
		font-size: clamp(2rem, 4vw, 3.5rem);
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.05em;
	}
	.preview-panel p {
		max-width: 420px;
		margin: 0.5rem 1.5rem 1.8rem;
		color: var(--muted);
	}
	.audio-orbit {
		position: relative;
		display: grid;
		place-items: center;
		width: 9rem;
		height: 9rem;
		border: 1px solid rgba(105, 227, 170, 0.16);
		border-radius: 50%;
	}
	.audio-orbit::before {
		content: '';
		position: absolute;
		inset: -1.5rem;
		border: 1px solid rgba(105, 227, 170, 0.08);
		border-radius: 50%;
	}
	.avatar {
		display: grid;
		place-items: center;
		width: 6.3rem;
		height: 6.3rem;
		border-radius: 50%;
		background: #203a32;
		color: var(--accent);
		font-size: 2.3rem;
		font-weight: 700;
	}
	.level-ring {
		position: absolute;
		inset: -0.45rem;
		border: calc(2px + var(--level) * 8px) solid
			rgba(105, 227, 170, calc(0.2 + var(--level) * 0.65));
		border-radius: 50%;
		transition: border-width 80ms linear;
	}
	.meter {
		width: min(260px, 60%);
		height: 0.35rem;
		overflow: hidden;
		background: #21302b;
		border-radius: 1rem;
	}
	.meter span {
		display: block;
		height: 100%;
		background: var(--accent);
		border-radius: inherit;
		transition: width 70ms linear;
	}
	.prejoin-card {
		display: grid;
		gap: 1rem;
	}
	.prejoin-card h2 {
		margin: -0.6rem 0 1rem;
		font-size: clamp(2.3rem, 5vw, 4rem);
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.05em;
	}
	.permission-button,
	.join-meeting {
		width: 100%;
	}
	.mute-check {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		color: #c9d8d3;
		font-size: 0.9rem;
	}
	.mute-check input {
		accent-color: var(--accent);
		width: 1rem;
		height: 1rem;
	}
	.prejoin-note {
		color: #71877f;
		font-size: 0.78rem;
		line-height: 1.5;
	}

	.meeting-shell {
		min-height: 100vh;
		height: 100dvh;
		display: grid;
		grid-template-rows: auto 1fr auto;
		overflow: hidden;
		background: #08100e;
	}
	.meeting-header {
		height: 4.4rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.7rem 1rem;
		border-bottom: 1px solid var(--border);
	}
	.meeting-brand {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.meeting-brand > div {
		display: grid;
		gap: 0.08rem;
	}
	.meeting-brand strong {
		font-size: 0.95rem;
		font-weight: 700;
	}
	.meeting-brand span {
		color: var(--muted);
		font-size: 0.72rem;
	}
	.meeting-main {
		min-height: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 250px;
		gap: 0.8rem;
		padding: 0.8rem;
	}
	.meeting-main.chat-visible {
		grid-template-columns: minmax(0, 1fr) 230px 340px;
	}
	.stage-column {
		position: relative;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	:global(.stage) {
		position: relative;
		flex: 1;
		min-height: 300px;
		display: grid;
		place-items: center;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: #050907;
	}
	:global(.stage video) {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	:global(.stage-empty) {
		display: grid;
		justify-items: center;
		text-align: center;
		padding: 2rem;
	}
	:global(.stage-empty h2) {
		margin: 1.2rem 0 0.4rem;
		font-size: clamp(1.5rem, 3vw, 2.4rem);
		font-weight: 700;
		letter-spacing: -0.04em;
	}
	:global(.stage-empty p) {
		margin: 0;
		color: var(--muted);
	}
	:global(.stage-label) {
		position: absolute;
		top: 0.8rem;
		left: 0.8rem;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.45rem 0.65rem;
		border-radius: 0.6rem;
		background: rgba(5, 9, 7, 0.82);
		backdrop-filter: blur(10px);
		font-size: 0.78rem;
	}
	:global(.live-dot) {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--accent);
	}
	.waiting {
		position: absolute;
		left: 50%;
		bottom: 1.2rem;
		transform: translateX(-50%);
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		padding: 0.55rem 0.8rem;
		border-radius: 2rem;
		background: rgba(16, 28, 25, 0.88);
		color: #b7cac3;
		font-size: 0.82rem;
	}
	.waiting span {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--warning);
	}
	.people-panel,
	.chat-panel {
		min-height: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 1rem;
		overflow: hidden;
	}
	.people-panel {
		padding: 0.9rem;
	}
	.panel-title {
		min-height: 2.8rem;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	.panel-title h2 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 700;
	}
	.panel-title span {
		display: grid;
		place-items: center;
		min-width: 1.5rem;
		height: 1.5rem;
		border-radius: 0.45rem;
		background: var(--surface-3);
		color: var(--muted);
		font-size: 0.72rem;
	}
	.panel-title small {
		color: var(--accent);
		font-size: 0.68rem;
	}
	.panel-title button {
		background: transparent;
		color: var(--muted);
		font-size: 1.3rem;
	}
	.people-panel ul {
		display: grid;
		gap: 0.45rem;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}
	.people-panel li {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.65rem 0.55rem;
		border-radius: 0.7rem;
		background: rgba(255, 255, 255, 0.018);
	}
	.participant-avatar {
		display: grid;
		place-items: center;
		flex: 0 0 2.2rem;
		height: 2.2rem;
		border-radius: 50%;
		background: #244239;
		color: var(--accent);
		font-weight: 700;
	}
	.participant-copy {
		min-width: 0;
		display: grid;
		gap: 0.15rem;
	}
	.participant-copy strong {
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 0.82rem;
		white-space: nowrap;
	}
	.participant-copy span {
		color: var(--muted);
		font-size: 0.67rem;
	}
	.participant-copy span.connected {
		color: var(--accent);
	}
	.sharing-badge {
		margin-left: auto;
		padding: 0.25rem 0.38rem;
		border-radius: 0.35rem;
		background: rgba(105, 227, 170, 0.12);
		color: var(--accent);
		font-size: 0.62rem;
	}
	.chat-panel {
		display: grid;
		grid-template-rows: auto 1fr auto;
		padding: 0.9rem;
	}
	.messages {
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		padding: 0.7rem 0;
	}
	.chat-empty {
		margin: auto;
		padding: 1.2rem;
		text-align: center;
		color: var(--muted);
	}
	.chat-empty strong {
		color: var(--text);
	}
	.chat-empty p {
		margin: 0.5rem 0;
		font-size: 0.8rem;
		line-height: 1.45;
	}
	.messages article {
		align-self: flex-start;
		max-width: 92%;
	}
	.messages article.own {
		align-self: flex-end;
	}
	.messages article > div {
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
		margin: 0 0.35rem 0.25rem;
	}
	.messages article strong,
	.messages article time {
		color: var(--muted);
		font-size: 0.66rem;
	}
	.messages article p {
		margin: 0;
		padding: 0.55rem 0.7rem;
		border-radius: 0.7rem;
		background: var(--surface-3);
		font-size: 0.82rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.messages article.own p {
		background: #1b523e;
	}
	.chat-compose {
		display: grid;
		gap: 0.45rem;
	}
	.chat-compose textarea {
		resize: none;
		width: 100%;
		border: 1px solid var(--border);
		border-radius: 0.7rem;
		background: #0b1512;
		color: var(--text);
		padding: 0.65rem;
	}
	.chat-compose > div {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.chat-compose span {
		color: var(--muted);
		font-size: 0.65rem;
	}
	.chat-compose button {
		min-height: 2.2rem;
		padding: 0.4rem 0.8rem;
	}
	.meeting-controls {
		min-height: 5rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.7rem 1rem;
		border-top: 1px solid var(--border);
	}
	.control-group {
		display: flex;
		gap: 0.55rem;
	}
	.control.active-control {
		background: #315d4e;
		color: #eafff5;
		box-shadow: inset 0 0 0 1px rgba(105, 227, 170, 0.35);
	}
	.meeting-error,
	.audio-banner {
		position: absolute;
		top: 0.8rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 4;
		width: min(540px, calc(100% - 2rem));
	}
	.meeting-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.meeting-error button {
		background: transparent;
		color: inherit;
		font-size: 1.2rem;
	}
	.audio-banner {
		border-radius: 0.7rem;
		padding: 0.7rem;
		background: var(--warning);
		color: #261d09;
		font-weight: 700;
	}
	@media (max-width: 980px) {
		.meeting-main,
		.meeting-main.chat-visible {
			grid-template-columns: minmax(0, 1fr) 220px;
		}
		.chat-panel {
			position: fixed;
			z-index: 10;
			inset: 4.4rem 0 5rem auto;
			width: min(360px, 100%);
			border-radius: 0;
			box-shadow: var(--shadow);
		}
	}
	@media (max-width: 760px) {
		.prejoin-shell {
			padding: 1rem;
		}
		.prejoin-grid {
			grid-template-columns: 1fr;
			padding: 2.5rem 0;
		}
		.preview-panel {
			min-height: 330px;
		}
		.meeting-main,
		.meeting-main.chat-visible {
			grid-template-columns: 1fr;
			grid-template-rows: minmax(0, 1fr) auto;
		}
		.people-panel {
			max-height: 130px;
		}
		.people-panel ul {
			grid-auto-flow: column;
			grid-auto-columns: minmax(170px, 1fr);
			overflow-x: auto;
		}
		.meeting-controls {
			align-items: stretch;
			flex-direction: column;
		}
		.control-group {
			display: grid;
			grid-template-columns: repeat(2, 1fr);
		}
		.secondary-controls {
			grid-template-columns: repeat(3, 1fr);
		}
		.meeting-shell {
			grid-template-rows: auto 1fr auto;
		}
		.chat-panel {
			bottom: 8.7rem;
		}
	}
	@media (max-width: 480px) {
		.room-health {
			font-size: 0.72rem;
		}
		.meeting-main {
			padding: 0.45rem;
		}
		.meeting-controls {
			padding: 0.55rem;
		}
		.control,
		.danger-button {
			padding: 0.6rem 0.45rem;
			font-size: 0.75rem;
		}
		.people-panel {
			display: none;
		}
		.meeting-main,
		.meeting-main.chat-visible {
			grid-template-rows: 1fr;
		}
		.chat-panel {
			top: 4.4rem;
			bottom: 8.7rem;
			width: 100%;
		}
	}
</style>
