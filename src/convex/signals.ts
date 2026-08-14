import { anyApi } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { SIGNAL_LIFETIME_MS } from '../lib/server/room-policy.js';
import { isValidSignalPayload } from '../lib/protocol/signaling.js';
import { requireParticipant } from './helpers.js';
import { credentialsFields, signalPayloadValidator, signalTypeValidator } from './validators.js';
import { internalMutation, mutation, query } from './functions.js';

export const send = mutation({
	args: {
		...credentialsFields,
		recipientPeerId: v.string(),
		signalType: signalTypeValidator,
		payload: signalPayloadValidator
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		await requireParticipant(ctx, args, now);
		if (args.recipientPeerId === args.peerId) throw new ConvexError('INVALID_RECIPIENT');
		if (!isValidSignalPayload(args.signalType, args.payload)) {
			throw new ConvexError('INVALID_SIGNAL_PAYLOAD');
		}
		const recipient = await ctx.db
			.query('participants')
			.withIndex('by_room_peer', (query) =>
				query.eq('roomId', args.roomId).eq('peerId', args.recipientPeerId)
			)
			.unique();
		if (!recipient || now - recipient.lastHeartbeatAt > 90_000) {
			throw new ConvexError('INVALID_RECIPIENT');
		}
		const mailbox = await ctx.db
			.query('signals')
			.withIndex('by_room_recipient', (query) =>
				query.eq('roomId', args.roomId).eq('recipientPeerId', args.recipientPeerId)
			)
			.take(129);
		if (mailbox.length >= 128) throw new ConvexError('SIGNAL_MAILBOX_FULL');

		const expiresAt = now + SIGNAL_LIFETIME_MS;
		const signalId = await ctx.db.insert('signals', {
			roomId: args.roomId,
			senderPeerId: args.peerId,
			recipientPeerId: args.recipientPeerId,
			signalType: args.signalType,
			payload: args.payload,
			createdAt: now,
			expiresAt
		});
		await ctx.scheduler.runAt(expiresAt, anyApi.signals.expireSignal, { signalId });
		return null;
	}
});

export const inbox = query({
	args: credentialsFields,
	handler: async (ctx, args) => {
		const now = Date.now();
		await requireParticipant(ctx, args, now);
		const signals = await ctx.db
			.query('signals')
			.withIndex('by_room_recipient', (query) =>
				query.eq('roomId', args.roomId).eq('recipientPeerId', args.peerId)
			)
			.take(128);
		return signals
			.filter((signal) => signal.expiresAt > now)
			.map((signal) => ({
				_id: signal._id,
				senderPeerId: signal.senderPeerId,
				signalType: signal.signalType,
				payload: signal.payload,
				createdAt: signal.createdAt
			}));
	}
});

export const acknowledge = mutation({
	args: { ...credentialsFields, signalId: v.id('signals') },
	handler: async (ctx, args) => {
		await requireParticipant(ctx, args);
		const signal = await ctx.db.get(args.signalId);
		if (!signal || signal.roomId !== args.roomId || signal.recipientPeerId !== args.peerId) {
			throw new ConvexError('SIGNAL_ACCESS');
		}
		await ctx.db.delete(signal._id);
		return null;
	}
});

export const expireSignal = internalMutation({
	args: { signalId: v.id('signals') },
	handler: async (ctx, { signalId }) => {
		const signal = await ctx.db.get(signalId);
		if (signal && signal.expiresAt <= Date.now()) await ctx.db.delete(signalId);
	}
});
