import {
	EMPTY_ROOM_GRACE_MS,
	isEmptyRoomExpired,
	PARTICIPANT_STALE_MS
} from '../lib/server/room-policy.js';
import { internalMutation } from './functions.js';

export const run = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const expiredSignals = await ctx.db
			.query('signals')
			.withIndex('by_expires_at', (query) => query.lt('expiresAt', now))
			.take(256);
		for (const signal of expiredSignals) await ctx.db.delete(signal._id);

		const staleParticipants = await ctx.db
			.query('participants')
			.withIndex('by_heartbeat', (query) => query.lt('lastHeartbeatAt', now - PARTICIPANT_STALE_MS))
			.take(128);
		const affectedRooms = new Set(staleParticipants.map((participant) => participant.roomId));
		for (const participant of staleParticipants) await ctx.db.delete(participant._id);

		for (const roomId of affectedRooms) {
			const remaining = await ctx.db
				.query('participants')
				.withIndex('by_room', (query) => query.eq('roomId', roomId))
				.first();
			if (!remaining) {
				const room = await ctx.db
					.query('rooms')
					.withIndex('by_room_id', (query) => query.eq('roomId', roomId))
					.unique();
				if (room && room.emptySince === undefined)
					await ctx.db.patch(room._id, { emptySince: now });
			}
		}

		const expiredRooms = await ctx.db
			.query('rooms')
			.withIndex('by_expires_at', (query) => query.lt('expiresAt', now))
			.take(64);
		const emptyRooms = await ctx.db
			.query('rooms')
			.withIndex('by_empty_since', (query) =>
				query.gte('emptySince', 0).lt('emptySince', now - EMPTY_ROOM_GRACE_MS)
			)
			.take(64);
		const roomsToDelete = new Map(
			[
				...expiredRooms,
				...emptyRooms.filter((room) => isEmptyRoomExpired(room.emptySince, now))
			].map((room) => [String(room._id), room])
		);
		for (const room of roomsToDelete.values()) {
			const participants = await ctx.db
				.query('participants')
				.withIndex('by_room', (query) => query.eq('roomId', room.roomId))
				.collect();
			for (const participant of participants) await ctx.db.delete(participant._id);
			await ctx.db.delete(room._id);
		}
	}
});
