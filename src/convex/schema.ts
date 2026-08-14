import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const descriptionPayload = v.object({
	kind: v.literal('description'),
	description: v.object({
		type: v.union(v.literal('offer'), v.literal('answer')),
		sdp: v.string()
	})
});

const icePayload = v.object({
	kind: v.literal('ice'),
	candidates: v.array(
		v.object({
			candidate: v.string(),
			sdpMid: v.optional(v.string()),
			sdpMLineIndex: v.optional(v.number()),
			usernameFragment: v.optional(v.string())
		})
	)
});

const renegotiatePayload = v.object({
	kind: v.literal('renegotiate'),
	reason: v.union(v.literal('initial'), v.literal('screen-share'), v.literal('ice-restart'))
});

export default defineSchema({
	rooms: defineTable({
		roomId: v.string(),
		secretHash: v.string(),
		createdAt: v.number(),
		expiresAt: v.number(),
		maxParticipants: v.number(),
		hostPeerId: v.optional(v.string()),
		emptySince: v.optional(v.number())
	})
		.index('by_room_id', ['roomId'])
		.index('by_expires_at', ['expiresAt'])
		.index('by_empty_since', ['emptySince']),

	participants: defineTable({
		roomId: v.string(),
		peerId: v.string(),
		sessionTokenHash: v.string(),
		displayName: v.string(),
		joinedAt: v.number(),
		lastHeartbeatAt: v.number(),
		isScreenSharing: v.boolean()
	})
		.index('by_room', ['roomId'])
		.index('by_room_peer', ['roomId', 'peerId'])
		.index('by_heartbeat', ['lastHeartbeatAt']),

	signals: defineTable({
		roomId: v.string(),
		senderPeerId: v.string(),
		recipientPeerId: v.string(),
		signalType: v.union(
			v.literal('offer'),
			v.literal('answer'),
			v.literal('ice'),
			v.literal('renegotiate')
		),
		payload: v.union(descriptionPayload, icePayload, renegotiatePayload),
		createdAt: v.number(),
		expiresAt: v.number()
	})
		.index('by_room_recipient', ['roomId', 'recipientPeerId'])
		.index('by_expires_at', ['expiresAt'])
});
