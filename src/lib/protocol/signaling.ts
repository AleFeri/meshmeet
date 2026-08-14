export type SignalType = 'offer' | 'answer' | 'ice' | 'renegotiate';

export interface DescriptionPayload {
	kind: 'description';
	description: { type: 'offer' | 'answer'; sdp: string };
}

export interface IceCandidatePayload {
	kind: 'ice';
	candidates: Array<{
		candidate: string;
		sdpMid?: string;
		sdpMLineIndex?: number;
		usernameFragment?: string;
	}>;
}

export interface RenegotiatePayload {
	kind: 'renegotiate';
	reason: 'initial' | 'screen-share' | 'ice-restart';
}

export type SignalPayload = DescriptionPayload | IceCandidatePayload | RenegotiatePayload;

export interface OutgoingSignal {
	toPeerId: string;
	type: SignalType;
	payload: SignalPayload;
}

export interface IncomingSignal {
	id: string;
	fromPeerId: string;
	type: SignalType;
	payload: SignalPayload;
	createdAt: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isBoundedString = (value: unknown, max: number): value is string =>
	typeof value === 'string' && value.length > 0 && value.length <= max;

export function isValidSignalPayload(type: SignalType, payload: unknown): payload is SignalPayload {
	if (!isRecord(payload) || (payload.kind !== type && type !== 'offer' && type !== 'answer'))
		return false;
	if (type === 'offer' || type === 'answer') {
		if (payload.kind !== 'description' || !isRecord(payload.description)) return false;
		return payload.description.type === type && isBoundedString(payload.description.sdp, 65_536);
	}
	if (type === 'renegotiate') {
		return (
			payload.kind === 'renegotiate' &&
			(payload.reason === 'initial' ||
				payload.reason === 'screen-share' ||
				payload.reason === 'ice-restart')
		);
	}
	if (payload.kind !== 'ice' || !Array.isArray(payload.candidates)) return false;
	return (
		payload.candidates.length > 0 &&
		payload.candidates.length <= 20 &&
		payload.candidates.every(
			(candidate) =>
				isRecord(candidate) &&
				isBoundedString(candidate.candidate, 4_096) &&
				(candidate.sdpMid === undefined ||
					(typeof candidate.sdpMid === 'string' && candidate.sdpMid.length <= 256)) &&
				(candidate.sdpMLineIndex === undefined ||
					(Number.isInteger(candidate.sdpMLineIndex) && Number(candidate.sdpMLineIndex) >= 0)) &&
				(candidate.usernameFragment === undefined ||
					(typeof candidate.usernameFragment === 'string' &&
						candidate.usernameFragment.length <= 256))
		)
	);
}

export function isIncomingSignal(value: unknown): value is IncomingSignal {
	if (!isRecord(value)) return false;
	if (
		!isBoundedString(value.id, 128) ||
		!isBoundedString(value.fromPeerId, 64) ||
		!['offer', 'answer', 'ice', 'renegotiate'].includes(String(value.type)) ||
		typeof value.createdAt !== 'number' ||
		!Number.isFinite(value.createdAt)
	) {
		return false;
	}
	return isValidSignalPayload(value.type as SignalType, value.payload);
}
