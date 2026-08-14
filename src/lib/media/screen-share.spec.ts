import { describe, expect, it, vi } from 'vitest';
import { ScreenShareController } from './screen-share';

describe('screen track lifecycle', () => {
	it('publishes the selected stream and removes/stops every track on end', async () => {
		const listeners = new Map<string, () => void>();
		const videoTrack = {
			contentHint: '',
			addEventListener: vi.fn((name: string, listener: () => void) =>
				listeners.set(name, listener)
			),
			stop: vi.fn()
		};
		const audioTrack = { stop: vi.fn() };
		const stream = {
			getVideoTracks: () => [videoTrack],
			getTracks: () => [videoTrack, audioTrack]
		} as unknown as MediaStream;
		const target = {
			startScreenShare: vi.fn(async () => undefined),
			stopScreenShare: vi.fn(async () => undefined)
		};
		const onStopped = vi.fn();
		const controller = new ScreenShareController(
			target,
			onStopped,
			vi.fn(async () => stream)
		);

		await expect(controller.start()).resolves.toBe(stream);
		expect(videoTrack.contentHint).toBe('detail');
		expect(target.startScreenShare).toHaveBeenCalledWith(stream);
		listeners.get('ended')?.();
		await vi.waitFor(() => expect(onStopped).toHaveBeenCalledOnce());
		expect(target.stopScreenShare).toHaveBeenCalledWith(false);
		expect(videoTrack.stop).toHaveBeenCalledOnce();
		expect(audioTrack.stop).toHaveBeenCalledOnce();
	});
});
