export interface ScreenShareTarget {
	startScreenShare(stream: MediaStream, profile: ScreenShareProfile): Promise<void>;
	updateScreenShareQuality(profile: ScreenShareProfile): Promise<void>;
	stopScreenShare(stopTracks?: boolean): Promise<void>;
}

export type ScreenShareQuality = '720p' | '1080p' | '1440p' | '2160p';

export interface ScreenShareProfile {
	quality: ScreenShareQuality;
	label: string;
	width: number;
	height: number;
	frameRate: number;
	maxBitrate: number;
}

export const SCREEN_SHARE_PROFILES: readonly ScreenShareProfile[] = [
	{
		quality: '720p',
		label: '720p',
		width: 1280,
		height: 720,
		frameRate: 30,
		maxBitrate: 4_000_000
	},
	{
		quality: '1080p',
		label: '1080p',
		width: 1920,
		height: 1080,
		frameRate: 30,
		maxBitrate: 8_000_000
	},
	{
		quality: '1440p',
		label: '1440p',
		width: 2560,
		height: 1440,
		frameRate: 30,
		maxBitrate: 12_000_000
	},
	{
		quality: '2160p',
		label: '4K',
		width: 3840,
		height: 2160,
		frameRate: 30,
		maxBitrate: 20_000_000
	}
] as const;

export const DEFAULT_SCREEN_SHARE_QUALITY: ScreenShareQuality = '1080p';

export function isScreenShareQuality(value: string): value is ScreenShareQuality {
	return SCREEN_SHARE_PROFILES.some((profile) => profile.quality === value);
}

export function getScreenShareProfile(quality: ScreenShareQuality): ScreenShareProfile {
	return (
		SCREEN_SHARE_PROFILES.find((profile) => profile.quality === quality) ?? SCREEN_SHARE_PROFILES[1]
	);
}

function captureConstraints(profile: ScreenShareProfile): MediaTrackConstraints {
	return {
		width: { ideal: profile.width },
		height: { ideal: profile.height },
		frameRate: { ideal: profile.frameRate }
	};
}

export class ScreenShareController {
	#stream: MediaStream | null = null;
	#target: ScreenShareTarget;
	#getDisplayMedia: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
	#onStopped: () => void;
	#quality: ScreenShareQuality = DEFAULT_SCREEN_SHARE_QUALITY;

	constructor(
		target: ScreenShareTarget,
		onStopped: () => void,
		getDisplayMedia = (constraints?: DisplayMediaStreamOptions) =>
			navigator.mediaDevices.getDisplayMedia(constraints)
	) {
		this.#target = target;
		this.#onStopped = onStopped;
		this.#getDisplayMedia = getDisplayMedia;
	}

	async start(quality: ScreenShareQuality = DEFAULT_SCREEN_SHARE_QUALITY): Promise<MediaStream> {
		const profile = getScreenShareProfile(quality);
		const constraints = captureConstraints(profile);
		const stream = await this.#getDisplayMedia({ video: constraints, audio: true });
		const videoTrack = stream.getVideoTracks()[0];
		if (!videoTrack) {
			for (const track of stream.getTracks()) track.stop();
			throw new Error('No screen track was selected.');
		}
		videoTrack.contentHint = 'detail';
		await videoTrack.applyConstraints(constraints).catch(() => undefined);
		videoTrack.addEventListener('ended', () => void this.stop());
		this.#quality = quality;
		this.#stream = stream;
		await this.#target.startScreenShare(stream, profile);
		return stream;
	}

	async setQuality(quality: ScreenShareQuality): Promise<void> {
		this.#quality = quality;
		if (!this.#stream) return;
		const profile = getScreenShareProfile(quality);
		const videoTrack = this.#stream.getVideoTracks()[0];
		if (videoTrack)
			await videoTrack.applyConstraints(captureConstraints(profile)).catch(() => undefined);
		await this.#target.updateScreenShareQuality(profile);
	}

	get quality(): ScreenShareQuality {
		return this.#quality;
	}

	async stop(): Promise<void> {
		if (!this.#stream) return;
		const stream = this.#stream;
		this.#stream = null;
		await this.#target.stopScreenShare(false);
		for (const track of stream.getTracks()) track.stop();
		this.#onStopped();
	}
}
