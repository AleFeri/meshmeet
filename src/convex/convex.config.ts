import { defineApp } from 'convex/server';
import { v } from 'convex/values';

export default defineApp({
	env: {
		CLOUDFLARE_TURN_KEY_ID: v.optional(v.string()),
		CLOUDFLARE_TURN_API_TOKEN: v.optional(v.string())
	}
});
