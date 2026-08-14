import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';

const rooms = new Map();
const server = new WebSocketServer({ host: '127.0.0.1', port: 4174 });

function send(socket, value) {
	if (socket.readyState === 1) socket.send(JSON.stringify(value));
}

function participants(room) {
	return [...room.members.values()].map((member) => member.participant);
}

function broadcastParticipants(room) {
	const message = { type: 'participants', participants: participants(room) };
	for (const member of room.members.values()) send(member.socket, message);
}

function remove(socket) {
	const identity = socket.identity;
	if (!identity) return;
	const room = rooms.get(identity.roomKey);
	if (!room) return;
	if (room.members.get(identity.peerId)?.socket !== socket) {
		socket.identity = null;
		return;
	}
	room.members.delete(identity.peerId);
	broadcastParticipants(room);
	socket.identity = null;
}

server.on('connection', (socket) => {
	socket.on('message', (raw) => {
		if (raw.length > 100_000) return socket.close(1009, 'Message too large');
		let message;
		try {
			message = JSON.parse(raw.toString());
		} catch {
			return;
		}
		if (message.type === 'join') {
			const roomKey = `${message.roomId}:${message.secretHash}`;
			let room = rooms.get(roomKey);
			if (!room) {
				if (!message.createIfMissing) {
					send(socket, { type: 'error', code: 'ROOM_ACCESS', message: 'Room not found.' });
					return;
				}
				room = { members: new Map() };
				rooms.set(roomKey, room);
			}
			const existing = room.members.get(message.peerId);
			if (room.members.size >= 4 && !existing) {
				send(socket, { type: 'error', code: 'ROOM_FULL', message: 'Room is full.' });
				return;
			}
			const now = Date.now();
			const participant = {
				peerId: message.peerId,
				displayName: String(message.displayName).slice(0, 48),
				joinedAt: now,
				lastHeartbeatAt: now,
				isScreenSharing: false
			};
			socket.identity = { roomKey, peerId: message.peerId };
			room.members.set(message.peerId, { socket, participant });
			existing?.socket.close();
			send(socket, { type: 'joined', participants: participants(room) });
			broadcastParticipants(room);
			return;
		}
		const identity = socket.identity;
		const room = identity ? rooms.get(identity.roomKey) : null;
		const member = room?.members.get(identity?.peerId);
		if (!room || !member) return;
		if (message.type === 'leave') return remove(socket);
		if (message.type === 'heartbeat') {
			member.participant.lastHeartbeatAt = Date.now();
			return;
		}
		if (message.type === 'sharing') {
			member.participant.isScreenSharing = Boolean(message.isSharing);
			member.participant.lastHeartbeatAt = Date.now();
			broadcastParticipants(room);
			return;
		}
		if (message.type === 'signal') {
			const recipient = room.members.get(message.signal?.toPeerId);
			if (!recipient) return;
			send(recipient.socket, {
				type: 'signal',
				signal: {
					id: randomBytes(16).toString('base64url'),
					fromPeerId: identity.peerId,
					type: message.signal.type,
					payload: message.signal.payload,
					createdAt: Date.now()
				}
			});
		}
	});
	socket.on('close', () => remove(socket));
});

process.on('SIGTERM', () => server.close());
