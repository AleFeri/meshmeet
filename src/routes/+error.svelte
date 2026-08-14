<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { BRAND } from '$lib/config/brand';

	const notFound = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{notFound ? 'Page not found' : 'Something went wrong'} · {BRAND.name}</title>
</svelte:head>

<main class="error-page">
	<a class="wordmark" href={resolve('/')} aria-label={`${BRAND.name} home`}>{BRAND.name}</a>

	<section>
		<p class="status">{page.status}</p>
		<h1>{notFound ? 'Page not found' : 'Something went wrong'}</h1>
		<p>{notFound ? 'This link does not point to a MeshMeet room.' : 'Please try again.'}</p>
		<a class="home-link" href={resolve('/')}>Back home</a>
	</section>
</main>

<style>
	.error-page {
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
		margin-bottom: 3.5rem;
		color: var(--text);
		text-decoration: none;
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	section {
		display: grid;
		gap: 0.75rem;
	}
	.status {
		margin: 0;
		color: var(--muted);
		font-size: 0.75rem;
	}
	h1 {
		margin: 0;
		font-size: clamp(1.75rem, 8vw, 2.4rem);
		letter-spacing: -0.045em;
	}
	section > p:last-of-type {
		margin: 0;
		color: var(--muted);
		line-height: 1.55;
	}
	.home-link {
		width: fit-content;
		margin-top: 0.75rem;
		color: var(--text);
		text-underline-offset: 0.25rem;
	}
</style>
