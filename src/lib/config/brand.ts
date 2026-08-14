export const BRAND = {
	name: 'MeshMeet',
	tagline: 'Private conversations, directly connected.',
	description:
		'Peer-to-peer voice, screen sharing, and messages that disappear when the room closes.'
} as const;

export const LIMITS = {
	maxParticipants: 4,
	maxDisplayNameLength: 48,
	maxChatLength: 2_000
} as const;
