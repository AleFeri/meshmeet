<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { BRAND, LIMITS } from '$lib/config/brand';
	import { buildInviteUrl, createRoomCredentials, parseInvite } from '$lib/protocol/ids';
	import { pendingCreatedRoomId, pendingDisplayName } from '$lib/stores/journey';

	let displayName = $state('');
	let invite = $state('');
	let error = $state('');

	function validateName(): string | null {
		const normalized = displayName.trim();
		if (!normalized) return 'Enter a display name first.';
		if (normalized.length > LIMITS.maxDisplayNameLength) {
			return `Display names are limited to ${LIMITS.maxDisplayNameLength} characters.`;
		}
		return null;
	}

	async function createRoom(): Promise<void> {
		error = validateName() ?? '';
		if (error) return;
		const credentials = createRoomCredentials();
		pendingDisplayName.set(displayName.trim());
		pendingCreatedRoomId.set(credentials.roomId);
		const url = buildInviteUrl(window.location.origin, credentials.roomId, credentials.secret);
		const target = `${resolve('/room/[roomId]', { roomId: credentials.roomId })}${window.location.search}${new URL(url).hash}`;
		// The path portion is produced by resolve(); the dynamic fragment is appended afterward.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		await goto(target);
	}

	async function joinRoom(): Promise<void> {
		error = validateName() ?? '';
		if (error) return;
		const parsed = parseInvite(invite.trim(), window.location.origin);
		if (!parsed) {
			error = 'Paste a complete invitation link, including the part after #.';
			return;
		}
		pendingDisplayName.set(displayName.trim());
		pendingCreatedRoomId.set(null);
		const target = `${resolve('/room/[roomId]', { roomId: parsed.roomId })}${window.location.search}#${parsed.secret}`;
		// The path portion is produced by resolve(); the dynamic fragment is appended afterward.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		await goto(target);
	}
</script>

<svelte:head>
	<title>{BRAND.name} — {BRAND.tagline}</title>
</svelte:head>

<main class="landing">
	<a class="wordmark" href={resolve('/')} aria-label={`${BRAND.name} home`}>{BRAND.name}</a>

	<section class="room-form" aria-label="Create or join a room">
		<div class="field">
			<label for="display-name">Name</label>
			<input
				id="display-name"
				data-testid="display-name"
				bind:value={displayName}
				maxlength={LIMITS.maxDisplayNameLength}
				autocomplete="name"
				placeholder="Your name"
			/>
		</div>

		<button class="primary" data-testid="create-room" onclick={createRoom}>New room</button>

		<div class="divider" aria-hidden="true">or</div>

		<form
			onsubmit={(event) => {
				event.preventDefault();
				void joinRoom();
			}}
		>
			<div class="field">
				<label for="invite-link">Invite link</label>
				<input
					id="invite-link"
					data-testid="invite-link"
					bind:value={invite}
					inputmode="url"
					placeholder="Paste a link"
				/>
			</div>
			<button class="secondary" data-testid="join-invite" type="submit">Join room</button>
		</form>

		{#if error}<div class="error-box" role="alert">{error}</div>{/if}
	</section>

	<footer>P2P · Chat is not saved</footer>
</main>

<style>
	.landing {
		width: min(100% - 2rem, 360px);
		min-height: 100vh;
		margin: 0 auto;
		padding: 2rem 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}
	.wordmark {
		align-self: flex-start;
		margin-bottom: 2rem;
		color: var(--text);
		text-decoration: none;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.room-form {
		display: grid;
		gap: 0.75rem;
	}
	.room-form > button,
	form button {
		width: 100%;
		border-radius: 0.5rem;
	}
	.room-form > .primary {
		background: var(--text);
		color: var(--bg);
	}
	.room-form > .primary:hover:not(:disabled) {
		background: #ffffff;
		transform: none;
	}
	.room-form .secondary {
		background: transparent;
	}
	.room-form input {
		border-radius: 0.5rem;
	}
	form {
		display: grid;
		gap: 0.75rem;
	}
	.divider {
		padding: 0.25rem 0;
		color: var(--muted);
		font-size: 0.75rem;
		text-align: center;
	}
	footer {
		margin-top: 1.5rem;
		color: #71877f;
		font-size: 0.72rem;
	}
</style>
