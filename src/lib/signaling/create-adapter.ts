import type { ConvexClient } from 'convex/browser';
import { ConvexSignalingAdapter } from './convex-adapter';
import { LocalSignalingAdapter } from './local-adapter';
import type { SignalingAdapter } from './types';
import { WebSocketTestSignalingAdapter } from './websocket-test-adapter';

export function createSignalingAdapter(
	client: ConvexClient | null,
	testSignalingUrl?: string
): SignalingAdapter {
	if (client) return new ConvexSignalingAdapter(client);
	if (testSignalingUrl) return new WebSocketTestSignalingAdapter(testSignalingUrl);
	console.warn(
		'[MeshMeet] PUBLIC_CONVEX_URL is not configured. Using the same-origin BroadcastChannel signaling adapter for local development only.'
	);
	return new LocalSignalingAdapter();
}
