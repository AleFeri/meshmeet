import { describe, expect, it, vi } from 'vitest';
import { getScreenShareProfile } from '$lib/media/screen-share';
import { configureScreenSender } from './screen-encoding';

describe('screen sender encoding', () => {
	it('keeps 1080p resolution and gives the screen track a high bitrate', async () => {
		const parameters = {
			encodings: [{}],
			codecs: [],
			headerExtensions: [],
			rtcp: {},
			transactionId: 'transaction'
		} as RTCRtpSendParameters;
		const sender = {
			track: { kind: 'video', getSettings: () => ({ height: 2160 }) },
			getParameters: vi.fn(() => parameters),
			setParameters: vi.fn(async () => undefined)
		} as unknown as RTCRtpSender;

		await expect(configureScreenSender(sender, getScreenShareProfile('1080p'))).resolves.toBe(true);
		expect(parameters.degradationPreference).toBe('maintain-resolution');
		expect(parameters.encodings[0]).toMatchObject({
			scaleResolutionDownBy: 2,
			maxBitrate: 8_000_000,
			maxFramerate: 30,
			priority: 'high'
		});
		expect(sender.setParameters).toHaveBeenCalledWith(parameters);
	});

	it('fails softly when a browser rejects sender parameters', async () => {
		const sender = {
			track: { kind: 'video', getSettings: () => ({ height: 1080 }) },
			getParameters: () => ({ encodings: [] }),
			setParameters: vi.fn(async () => Promise.reject(new DOMException('Unsupported')))
		} as unknown as RTCRtpSender;

		await expect(configureScreenSender(sender, getScreenShareProfile('1080p'))).resolves.toBe(
			false
		);
	});
});
