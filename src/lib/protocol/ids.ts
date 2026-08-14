const BASE64_URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function randomBase64Url(byteLength: number): string {
	if (!Number.isInteger(byteLength) || byteLength < 1) {
		throw new RangeError('byteLength must be a positive integer');
	}
	const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
	let result = '';
	let buffer = 0;
	let bits = 0;
	for (const byte of bytes) {
		buffer = (buffer << 8) | byte;
		bits += 8;
		while (bits >= 6) {
			bits -= 6;
			result += BASE64_URL_ALPHABET[(buffer >> bits) & 63];
		}
	}
	if (bits > 0) result += BASE64_URL_ALPHABET[(buffer << (6 - bits)) & 63];
	return result;
}

export function createRoomCredentials(): { roomId: string; secret: string } {
	return { roomId: randomBase64Url(16), secret: randomBase64Url(32) };
}

export function createPeerId(): string {
	return randomBase64Url(16);
}

export function createSessionToken(): string {
	return randomBase64Url(32);
}

export async function sha256Hex(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function buildInviteUrl(baseUrl: string, roomId: string, secret: string): string {
	const url = new URL(`/room/${encodeURIComponent(roomId)}`, baseUrl);
	url.hash = secret;
	return url.toString();
}

export function parseInvite(
	value: string,
	baseUrl: string
): { roomId: string; secret: string } | null {
	try {
		const url = new URL(value, baseUrl);
		const match = url.pathname.match(/\/room\/([A-Za-z0-9_-]{22})\/?$/);
		const secret = url.hash.slice(1);
		if (!match || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
		return { roomId: match[1], secret };
	} catch {
		return null;
	}
}
