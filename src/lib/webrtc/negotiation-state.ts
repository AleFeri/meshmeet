export interface PerfectNegotiationState {
	makingOffer: boolean;
	ignoreOffer: boolean;
	isSettingRemoteAnswerPending: boolean;
}

export function initialNegotiationState(): PerfectNegotiationState {
	return { makingOffer: false, ignoreOffer: false, isSettingRemoteAnswerPending: false };
}

export function shouldAcceptDescription(
	state: PerfectNegotiationState,
	signalingState: RTCSignalingState,
	descriptionType: RTCSdpType,
	polite: boolean
): { accept: boolean; offerCollision: boolean } {
	const readyForOffer =
		!state.makingOffer && (signalingState === 'stable' || state.isSettingRemoteAnswerPending);
	const offerCollision = descriptionType === 'offer' && !readyForOffer;
	return { accept: polite || !offerCollision, offerCollision };
}
