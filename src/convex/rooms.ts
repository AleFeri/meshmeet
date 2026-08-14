import { ConvexError, v } from 'convex/values';
import {
	MAX_PARTICIPANTS,
	PARTICIPANT_STALE_MS,
	ROOM_LIFETIME_MS,
	secretsMatch
} from '../lib/server/room-policy.js';
import { credentialsFields } from './validators.js';
import { requireParticipant, requireRoom, validateHash, validateIdentifier } from './helpers.js';
import { mutation, query } from './functions.js';

const publicParticipant = (participant: {
	peerId: string;
	displayName: string;
	joinedAt: number;
	lastHeartbeatAt: number;
	isScreenSharing: boolean;
}) => ({
	peerId: participant.peerId,
	displayName: participant.displayName,
	joinedAt: participant.joinedAt,
	lastHeartbeatAt: participant.lastHeartbeatAt,
	isScreenSharing: participant.isScreenSharing
});

function validateDisplayName(displayName: string): string {
	const normalized = displayName.trim();
	if (normalized.length < 1 || normalized.length > 48)
		throw new ConvexError('INVALID_DISPLAY_NAME');
	return normalized;
}

export const join = mutation({
	args: {
		...credentialsFields,
		displayName: v.string(),
		createIfMissing: v.boolean()
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		validateIdentifier(args.roomId, 'room_id', 22);
		validateIdentifier(args.peerId, 'peer_id');
		validateHash(args.secretHash, 'secret_hash');
		validateHash(args.sessionTokenHash, 'session_token_hash');
		const displayName = validateDisplayName(args.displayName);

		let room = await ctx.db
			.query('rooms')
			.withIndex('by_room_id', (query) => query.eq('roomId', args.roomId))
			.unique();

		if (!room) {
			if (!args.createIfMissing) throw new ConvexError('ROOM_ACCESS');
			const roomDocumentId = await ctx.db.insert('rooms', {
				roomId: args.roomId,
				secretHash: args.secretHash,
				createdAt: now,
				expiresAt: now + ROOM_LIFETIME_MS,
				maxParticipants: MAX_PARTICIPANTS,
				hostPeerId: args.peerId
			});
			room = await ctx.db.get(roomDocumentId);
		}
		if (!room || !secretsMatch(room.secretHash, args.secretHash)) {
			throw new ConvexError('ROOM_ACCESS');
		}
		if (room.expiresAt <= now) throw new ConvexError('ROOM_EXPIRED');

		const participants = await ctx.db
			.query('participants')
			.withIndex('by_room', (query) => query.eq('roomId', args.roomId))
			.collect();
		for (const participant of participants) {
			if (now - participant.lastHeartbeatAt > PARTICIPANT_STALE_MS) {
				await ctx.db.delete(participant._id);
			}
		}
		const active = participants.filter(
			(participant) => now - participant.lastHeartbeatAt <= PARTICIPANT_STALE_MS
		);
		const existing = active.find((participant) => participant.peerId === args.peerId);
		if (existing) {
			if (!secretsMatch(existing.sessionTokenHash, args.sessionTokenHash)) {
				throw new ConvexError('PARTICIPANT_ACCESS');
			}
			await ctx.db.patch(existing._id, { displayName, lastHeartbeatAt: now });
			return { participant: publicParticipant({ ...existing, displayName, lastHeartbeatAt: now }) };
		}
		if (active.length >= room.maxParticipants) throw new ConvexError('ROOM_FULL');

		const participant = {
			roomId: args.roomId,
			peerId: args.peerId,
			sessionTokenHash: args.sessionTokenHash,
			displayName,
			joinedAt: now,
			lastHeartbeatAt: now,
			isScreenSharing: false
		};
		await ctx.db.insert('participants', participant);
		if (room.emptySince !== undefined) await ctx.db.patch(room._id, { emptySince: undefined });
		return { participant: publicParticipant(participant) };
	}
});

export const leave = mutation({
	args: credentialsFields,
	handler: async (ctx, args) => {
		const participant = await requireParticipant(ctx, args);
		await ctx.db.delete(participant._id);
		const remaining = await ctx.db
			.query('participants')
			.withIndex('by_room', (query) => query.eq('roomId', args.roomId))
			.first();
		if (!remaining) {
			const room = await requireRoom(ctx, args);
			await ctx.db.patch(room._id, { emptySince: Date.now() });
		}
		return null;
	}
});

export const heartbeat = mutation({
	args: credentialsFields,
	handler: async (ctx, args) => {
		const participant = await requireParticipant(ctx, args);
		await ctx.db.patch(participant._id, { lastHeartbeatAt: Date.now() });
		return null;
	}
});

export const setScreenSharing = mutation({
	args: { ...credentialsFields, isScreenSharing: v.boolean() },
	handler: async (ctx, args) => {
		const participant = await requireParticipant(ctx, args);
		await ctx.db.patch(participant._id, {
			isScreenSharing: args.isScreenSharing,
			lastHeartbeatAt: Date.now()
		});
		return null;
	}
});

export const listParticipants = query({
	args: credentialsFields,
	handler: async (ctx, args) => {
		const now = Date.now();
		await requireParticipant(ctx, args, now);
		const participants = await ctx.db
			.query('participants')
			.withIndex('by_room', (query) => query.eq('roomId', args.roomId))
			.collect();
		return participants
			.filter((participant) => now - participant.lastHeartbeatAt <= PARTICIPANT_STALE_MS)
			.sort((a, b) => a.joinedAt - b.joinedAt || a.peerId.localeCompare(b.peerId))
			.map(publicParticipant);
	}
});

export const authorizeTurn = query({
	args: credentialsFields,
	handler: async (ctx, args) => {
		await requireParticipant(ctx, args);
		return true;
	}
});
