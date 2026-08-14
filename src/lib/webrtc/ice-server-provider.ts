export interface IceServerCredentials {
	roomId: string;
	secretHash: string;
	peerId: string;
	sessionTokenHash: string;
}

export interface IceServerProvider {
	getIceServers(credentials: IceServerCredentials): Promise<RTCIceServer[]>;
}

export class StunOnlyIceServerProvider implements IceServerProvider {
	async getIceServers(): Promise<RTCIceServer[]> {
		console.warn(
			'[MeshMeet] TURN is unavailable. Continuing with STUN only; some restrictive networks will not connect.'
		);
		return [{ urls: 'stun:stun.cloudflare.com:3478' }];
	}
}
