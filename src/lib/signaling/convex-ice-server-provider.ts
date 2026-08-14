import type { ConvexClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import type { Value } from 'convex/values';
import type { IceServerCredentials, IceServerProvider } from '$lib/webrtc/ice-server-provider';

const iceServersRef = makeFunctionReference<
	'action',
	IceServerCredentials & Record<string, Value>,
	{ configured: boolean; iceServers: RTCIceServer[] }
>('turn:getIceServers');

export class ConvexIceServerProvider implements IceServerProvider {
	constructor(private readonly client: ConvexClient) {}

	async getIceServers(credentials: IceServerCredentials): Promise<RTCIceServer[]> {
		try {
			const result = await this.client.action(
				iceServersRef,
				credentials as IceServerCredentials & Record<string, Value>
			);
			if (!result.configured) {
				console.warn(
					'[MeshMeet] Cloudflare TURN is not configured. Continuing with STUN only; some restrictive networks will not connect.'
				);
			}
			return result.iceServers.length > 0
				? result.iceServers
				: [{ urls: 'stun:stun.cloudflare.com:3478' }];
		} catch (error) {
			console.warn('[MeshMeet] TURN credential request failed; using STUN only.', error);
			return [{ urls: 'stun:stun.cloudflare.com:3478' }];
		}
	}
}
