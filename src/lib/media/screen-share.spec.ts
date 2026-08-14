import { describe, expect, it, vi } from 'vitest';
import { ScreenShareController } from './screen-share';

describe('screen track lifecycle', () => {
	it('publishes the selected stream and removes/stops every track on end', async () => {
		const listeners = new Map<string, () => void>();
		const videoTrack = {
			contentHint: '',
			applyConstraints: vi.fn(async () => undefined),
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
			updateScreenShareQuality: vi.fn(async () => undefined),
			stopScreenShare: vi.fn(async () => undefined)
		};
		const getDisplayMedia = vi.fn(async () => stream);
		const onStopped = vi.fn();
		const controller = new ScreenShareController(target, onStopped, getDisplayMedia);

		await expect(controller.start()).resolves.toBe(stream);
		expect(getDisplayMedia).toHaveBeenCalledWith({
			audio: true,
			video: {
				width: { ideal: 1920 },
				height: { ideal: 1080 },
				frameRate: { ideal: 30 }
			}
		});
		expect(videoTrack.contentHint).toBe('detail');
		expect(videoTrack.applyConstraints).toHaveBeenCalledWith({
			width: { ideal: 1920 },
			height: { ideal: 1080 },
			frameRate: { ideal: 30 }
		});
		expect(target.startScreenShare).toHaveBeenCalledWith(
			stream,
			expect.objectContaining({ quality: '1080p', maxBitrate: 8_000_000 })
		);

		await controller.setQuality('2160p');
		expect(target.updateScreenShareQuality).toHaveBeenCalledWith(
			expect.objectContaining({ quality: '2160p', height: 2160, maxBitrate: 20_000_000 })
		);
		listeners.get('ended')?.();
		await vi.waitFor(() => expect(onStopped).toHaveBeenCalledOnce());
		expect(target.stopScreenShare).toHaveBeenCalledWith(false);
		expect(videoTrack.stop).toHaveBeenCalledOnce();
		expect(audioTrack.stop).toHaveBeenCalledOnce();
	});
});
