<script lang="ts">
	let { stream, sharerName } = $props<{ stream: MediaStream | null; sharerName: string | null }>();
	let element = $state<HTMLVideoElement>();

	$effect(() => {
		if (!element) return;
		element.srcObject = stream;
		if (stream) void element.play().catch(() => undefined);
		return () => {
			if (element) element.srcObject = null;
		};
	});
</script>

<section class="stage" aria-label="Shared screen">
	{#if stream}
		<div class="stage-label"><span class="live-dot"></span>{sharerName} is sharing</div>
		<video bind:this={element} autoplay playsinline muted={sharerName === 'You'}></video>
	{:else}
		<div class="stage-empty">
			<div class="stage-mark" aria-hidden="true">M</div>
			<h2>Ready when you are</h2>
			<p>Share a screen to put it on the stage for everyone.</p>
		</div>
	{/if}
</section>
