<script lang="ts">
	let { stream, peerId, onblocked } = $props<{
		stream: MediaStream;
		peerId: string;
		onblocked: (peerId: string) => void;
	}>();
	let element = $state<HTMLAudioElement>();

	$effect(() => {
		if (!element) return;
		element.srcObject = stream;
		void element.play().catch(() => onblocked(peerId));
		return () => {
			if (element) element.srcObject = null;
		};
	});
</script>

<audio bind:this={element} autoplay playsinline data-peer-audio={peerId}></audio>
