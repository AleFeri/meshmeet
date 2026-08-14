export interface ScreenShareTarget {
	startScreenShare(stream: MediaStream): Promise<void>;
	stopScreenShare(stopTracks?: boolean): Promise<void>;
}

export class ScreenShareController {
	#stream: MediaStream | null = null;
	#target: ScreenShareTarget;
	#getDisplayMedia: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
	#onStopped: () => void;

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

	async start(): Promise<MediaStream> {
		const stream = await this.#getDisplayMedia({ video: true, audio: true });
		const videoTrack = stream.getVideoTracks()[0];
		if (!videoTrack) {
			for (const track of stream.getTracks()) track.stop();
			throw new Error('No screen track was selected.');
		}
		videoTrack.contentHint = 'detail';
		videoTrack.addEventListener('ended', () => void this.stop());
		this.#stream = stream;
		await this.#target.startScreenShare(stream);
		return stream;
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
