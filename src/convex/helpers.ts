import { ConvexError } from 'convex/values';
import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server';
import { PARTICIPANT_STALE_MS, secretsMatch } from '../lib/server/room-policy.js';
import type { DataModel } from './functions.js';

type ReadContext = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

export function validateIdentifier(value: string, name: string, expectedLength?: number): void {
	const pattern = expectedLength
		? new RegExp(`^[A-Za-z0-9_-]{${expectedLength}}$`)
		: /^[A-Za-z0-9_-]{16,64}$/;
	if (!pattern.test(value)) throw new ConvexError(`INVALID_${name.toUpperCase()}`);
}

export function validateHash(value: string, name: string): void {
	if (!/^[a-f0-9]{64}$/.test(value)) throw new ConvexError(`INVALID_${name.toUpperCase()}`);
}

export async function requireRoom(
	ctx: ReadContext,
	args: { roomId: string; secretHash: string },
	now = Date.now()
) {
	validateIdentifier(args.roomId, 'room_id', 22);
	validateHash(args.secretHash, 'secret_hash');
	const room = await ctx.db
		.query('rooms')
		.withIndex('by_room_id', (query) => query.eq('roomId', args.roomId))
		.unique();
	if (!room || !secretsMatch(room.secretHash, args.secretHash)) {
		throw new ConvexError('ROOM_ACCESS');
	}
	if (room.expiresAt <= now) throw new ConvexError('ROOM_EXPIRED');
	return room;
}

export async function requireParticipant(
	ctx: ReadContext,
	args: {
		roomId: string;
		secretHash: string;
		peerId: string;
		sessionTokenHash: string;
	},
	now = Date.now()
) {
	await requireRoom(ctx, args, now);
	validateIdentifier(args.peerId, 'peer_id');
	validateHash(args.sessionTokenHash, 'session_token_hash');
	const participant = await ctx.db
		.query('participants')
		.withIndex('by_room_peer', (query) => query.eq('roomId', args.roomId).eq('peerId', args.peerId))
		.unique();
	if (
		!participant ||
		!secretsMatch(participant.sessionTokenHash, args.sessionTokenHash) ||
		now - participant.lastHeartbeatAt > PARTICIPANT_STALE_MS
	) {
		throw new ConvexError('PARTICIPANT_ACCESS');
	}
	return participant;
}
