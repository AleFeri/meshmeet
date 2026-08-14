import type { ConvexClient } from 'convex/browser';
import { StunOnlyIceServerProvider, type IceServerProvider } from '$lib/webrtc/ice-server-provider';
import { ConvexIceServerProvider } from './convex-ice-server-provider';

export function createIceServerProvider(client: ConvexClient | null): IceServerProvider {
	return client ? new ConvexIceServerProvider(client) : new StunOnlyIceServerProvider();
}
