<script lang="ts">
	import { env } from '$env/dynamic/public';
	import { setupConvex } from 'convex-svelte';
	import '../app.css';

	let { children } = $props();
	if (env.PUBLIC_CONVEX_URL) setupConvex(env.PUBLIC_CONVEX_URL);
</script>

<svelte:head>
	<title>MeshMeet — private conversations, directly connected</title>
	<meta
		name="description"
		content="Open-source, browser-based P2P voice, screen sharing, and ephemeral chat."
	/>
	<meta name="theme-color" content="#09110f" />
</svelte:head>

{@render children()}
