export interface MicrophoneState {
	stream: MediaStream | null;
	devices: MediaDeviceInfo[];
	selectedDeviceId: string;
	level: number;
	error: string | null;
}

export class MicrophoneController {
	#stream: MediaStream | null = null;
	#audioContext: AudioContext | null = null;
	#animationFrame: number | null = null;
	#listener: (state: MicrophoneState) => void;
	#state: MicrophoneState = {
		stream: null,
		devices: [],
		selectedDeviceId: '',
		level: 0,
		error: null
	};

	constructor(listener: (state: MicrophoneState) => void) {
		this.#listener = listener;
		this.#emit();
	}

	get stream(): MediaStream | null {
		return this.#stream;
	}

	async request(deviceId?: string): Promise<MediaStream> {
		this.#stopStream();
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					deviceId: deviceId ? { exact: deviceId } : undefined,
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true
				},
				video: false
			});
			this.#stream = stream;
			const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
				(candidate) => candidate.kind === 'audioinput'
			);
			const selectedDeviceId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? deviceId ?? '';
			this.#state = { stream, devices, selectedDeviceId, level: 0, error: null };
			this.#startMeter(stream);
			this.#emit();
			return stream;
		} catch (error) {
			const message = this.#permissionError(error);
			this.#state = { ...this.#state, stream: null, level: 0, error: message };
			this.#emit();
			throw new Error(message, { cause: error });
		}
	}

	async selectDevice(deviceId: string): Promise<MediaStream> {
		return this.request(deviceId);
	}

	setEnabled(enabled: boolean): void {
		for (const track of this.#stream?.getAudioTracks() ?? []) track.enabled = enabled;
	}

	stop(): void {
		this.#stopStream();
		void this.#audioContext?.close();
		this.#audioContext = null;
		this.#state = { ...this.#state, stream: null, level: 0 };
		this.#emit();
	}

	#startMeter(stream: MediaStream): void {
		void this.#audioContext?.close();
		this.#audioContext = new AudioContext();
		const source = this.#audioContext.createMediaStreamSource(stream);
		const analyser = this.#audioContext.createAnalyser();
		analyser.fftSize = 256;
		source.connect(analyser);
		const values = new Uint8Array(analyser.frequencyBinCount);
		const update = () => {
			analyser.getByteTimeDomainData(values);
			let sum = 0;
			for (const value of values) {
				const normalized = (value - 128) / 128;
				sum += normalized * normalized;
			}
			this.#state = { ...this.#state, level: Math.min(1, Math.sqrt(sum / values.length) * 4) };
			this.#emit();
			this.#animationFrame = requestAnimationFrame(update);
		};
		update();
	}

	#stopStream(): void {
		if (this.#animationFrame !== null) cancelAnimationFrame(this.#animationFrame);
		this.#animationFrame = null;
		for (const track of this.#stream?.getTracks() ?? []) track.stop();
		this.#stream = null;
	}

	#permissionError(error: unknown): string {
		if (
			error instanceof DOMException &&
			(error.name === 'NotAllowedError' || error.name === 'SecurityError')
		) {
			return 'Microphone access was blocked. Allow microphone permission in your browser, then try again.';
		}
		if (error instanceof DOMException && error.name === 'NotFoundError') {
			return 'No microphone was found. Connect one and try again.';
		}
		if (error instanceof DOMException && error.name === 'NotReadableError') {
			return 'Your microphone is busy in another application.';
		}
		return 'The microphone could not be started. Check your browser and device settings.';
	}

	#emit(): void {
		this.#listener(this.#state);
	}
}
