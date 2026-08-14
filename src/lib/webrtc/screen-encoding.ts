import type { ScreenShareProfile } from '$lib/media/screen-share';

export async function configureScreenSender(
	sender: RTCRtpSender,
	profile: ScreenShareProfile
): Promise<boolean> {
	const track = sender.track;
	if (!track || track.kind !== 'video') return false;
	const parameters = sender.getParameters();
	if (!parameters.encodings?.length) parameters.encodings = [{}];
	const encoding = parameters.encodings[0];
	const sourceHeight = track.getSettings().height ?? profile.height;
	encoding.scaleResolutionDownBy = Math.max(sourceHeight / profile.height, 1);
	encoding.maxBitrate = profile.maxBitrate;
	encoding.maxFramerate = profile.frameRate;
	encoding.priority = 'high';
	parameters.degradationPreference = 'maintain-resolution';
	try {
		await sender.setParameters(parameters);
		return true;
	} catch {
		// Retry with the widely implemented encoding controls when a browser rejects
		// priority or degradationPreference.
		const fallback = sender.getParameters();
		if (!fallback.encodings?.length) fallback.encodings = [{}];
		fallback.encodings[0].scaleResolutionDownBy = Math.max(sourceHeight / profile.height, 1);
		fallback.encodings[0].maxBitrate = profile.maxBitrate;
		fallback.encodings[0].maxFramerate = profile.frameRate;
		try {
			await sender.setParameters(fallback);
			return true;
		} catch {
			// Capture constraints still provide the requested ceiling.
			return false;
		}
	}
}
