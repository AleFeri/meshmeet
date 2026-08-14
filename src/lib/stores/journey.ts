import { writable } from 'svelte/store';

export const pendingDisplayName = writable('');
export const pendingCreatedRoomId = writable<string | null>(null);
