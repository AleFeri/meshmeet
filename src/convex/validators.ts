import { v } from 'convex/values';

export const credentialsFields = {
	roomId: v.string(),
	secretHash: v.string(),
	peerId: v.string(),
	sessionTokenHash: v.string()
};

export const signalTypeValidator = v.union(
	v.literal('offer'),
	v.literal('answer'),
	v.literal('ice'),
	v.literal('renegotiate')
);

export const signalPayloadValidator = v.union(
	v.object({
		kind: v.literal('description'),
		description: v.object({
			type: v.union(v.literal('offer'), v.literal('answer')),
			sdp: v.string()
		})
	}),
	v.object({
		kind: v.literal('ice'),
		candidates: v.array(
			v.object({
				candidate: v.string(),
				sdpMid: v.optional(v.string()),
				sdpMLineIndex: v.optional(v.number()),
				usernameFragment: v.optional(v.string())
			})
		)
	}),
	v.object({
		kind: v.literal('renegotiate'),
		reason: v.union(v.literal('initial'), v.literal('screen-share'), v.literal('ice-restart'))
	})
);
