import { anyApi } from 'convex/server';
import { ConvexError } from 'convex/values';
import { credentialsFields } from './validators.js';
import { action } from './functions.js';

interface CloudflareIceResponse {
	iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
}

function isCloudflareResponse(value: unknown): value is CloudflareIceResponse {
	if (!value || typeof value !== 'object' || !('iceServers' in value)) return false;
	const iceServers = (value as CloudflareIceResponse).iceServers;
	return (
		Array.isArray(iceServers) &&
		iceServers.length <= 8 &&
		iceServers.every(
			(server) =>
				typeof server === 'object' &&
				server !== null &&
				(typeof server.urls === 'string' ||
					(Array.isArray(server.urls) && server.urls.every((url) => typeof url === 'string'))) &&
				(server.username === undefined || typeof server.username === 'string') &&
				(server.credential === undefined || typeof server.credential === 'string')
		)
	);
}

export const getIceServers = action({
	args: credentialsFields,
	handler: async (ctx, args) => {
		const authorized = await ctx.runQuery(anyApi.rooms.authorizeTurn, args);
		if (!authorized) throw new ConvexError('PARTICIPANT_ACCESS');

		const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
		const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
		if (!keyId || !apiToken) {
			return {
				configured: false,
				iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }]
			};
		}

		const response = await fetch(
			`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiToken}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ ttl: 43_200 })
			}
		);
		if (!response.ok) throw new ConvexError(`TURN_PROVIDER_ERROR_${response.status}`);
		const body: unknown = await response.json();
		if (!isCloudflareResponse(body) || !body.iceServers) {
			throw new ConvexError('TURN_PROVIDER_INVALID_RESPONSE');
		}
		return {
			configured: true,
			iceServers: body.iceServers.map((server) => ({
				...server,
				urls: Array.isArray(server.urls)
					? server.urls.filter((url) => !url.includes(':53'))
					: server.urls
			}))
		};
	}
});
