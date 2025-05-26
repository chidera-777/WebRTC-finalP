import { sendWebSocketMessage } from './websocket_client.js';
import { createOffer, handleOfferAndCreateAnswer, handleAnswer, handleCandidate, closeConnection as closeWebRTCConnection, getLocalStream, setLocalStream, setRemoteStream, getPeerConnection } from './webrtc_handler.js';

let currentCallState = 'idle'; // idle, initiating, ringing, active
let currentCallType = null; // 'audio' or 'video'
let currentCallPartnerId = null;
let currentCallPartnerUsername = null;
let localStreamRef = null;

const callModal = document.getElementById('callModal');
const callModalTitle = document.getElementById('callModalTitle');
const callStatus = document.getElementById('call-status');
const localVideoModal = document.getElementById('localVideoModal');
const remoteVideoModal = document.getElementById('remoteVideoModal');
const localUserPlaceholder = document.getElementById('localUserPlaceholder');
const remoteUserPlaceholder = document.getElementById('remoteUserPlaceholder');
const incomingCallActions = document.getElementById('incomingCallActions');
const activeCallActions = document.getElementById('activeCallActions');
const acceptCallButton = document.getElementById('acceptCallButton');
const rejectCallButton = document.getElementById('rejectCallButton');
const toggleMicrophoneButton = document.getElementById('toggleMicrophoneButton');
const toggleCameraButton = document.getElementById('toggleCameraButton');
const endCallButtonModal = document.getElementById('endCallButtonModal');

function updateCallState(newState) {
    console.log(`Call state changing from ${currentCallState} to ${newState}`);
    currentCallState = newState;

    // Default visibility
    localVideoModal.style.display = 'none';
    remoteVideoModal.style.display = 'none';
    localUserPlaceholder.style.display = 'none';
    remoteUserPlaceholder.style.display = 'none';

    switch (newState) {
        case 'idle':
            callModal.style.display = 'none';
            incomingCallActions.style.display = 'none';
            activeCallActions.style.display = 'block'; 
            currentCallPartnerId = null;
            currentCallType = null;
            if (localStreamRef) {
                localStreamRef.getTracks().forEach(track => track.stop());
                localStreamRef = null;
            }
            if (localVideoModal) localVideoModal.srcObject = null;
            if (remoteVideoModal) remoteVideoModal.srcObject = null;
            setLocalStream(null);
            setRemoteStream(null);
            closeWebRTCConnection();
            break;
        case 'initiating':
        case 'ringing':
        case 'active':
            callModal.style.display = 'block';
            toggleCameraButton.style.display = currentCallType === 'video' ? 'inline-block' : 'none';

            if (currentCallType === 'video') {
                localVideoModal.style.display = 'block';
                remoteVideoModal.style.display = 'block';
            } else { // audio call
                localUserPlaceholder.style.display = 'block';
                remoteUserPlaceholder.style.display = 'block';
            }

            if (newState === 'initiating') {
                callModalTitle.textContent = currentCallType === 'video' ? 'Video Call' : 'Audio Call';
                callStatus.textContent = `Calling ${currentCallPartnerUsername}...`;
                incomingCallActions.style.display = 'none';
                activeCallActions.style.display = 'block';
            } else if (newState === 'ringing') {
                callModalTitle.textContent = `Incoming ${currentCallType} Call`;
                callStatus.textContent = `${currentCallPartnerUsername} is calling...`;
                incomingCallActions.style.display = 'block';
                activeCallActions.style.display = 'none';
            } else { // active
                callModalTitle.textContent = `${currentCallType === 'video' ? 'Video' : 'Audio'} Call with ${currentCallPartnerUsername}`;
                callStatus.textContent = 'Call in progress...';
                incomingCallActions.style.display = 'none';
                activeCallActions.style.display = 'block';
            }
            break;
    }
}

export async function initiateCall(partnerId, partnerUsername, callType) {
    if (currentCallState !== 'idle') {
        console.warn('Cannot initiate call, already in a call or call in progress.');
        return;
    }
    currentCallPartnerUsername = partnerUsername
    currentCallPartnerId = partnerId;
    currentCallType = callType;
    updateCallState('initiating');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: callType === 'video', 
            audio: true 
        });
        localStreamRef = stream;
        setLocalStream(stream); 
        if (callType === 'video' && localVideoModal) {
            localVideoModal.srcObject = stream;
        } else if (callType === 'audio' && localUserPlaceholder) {
            // Placeholder is already made visible by updateCallState
        }

        const offer = await createOffer(partnerId, callType === 'video'); // createOffer in webrtc_handler needs to be updated for callType
        sendWebSocketMessage({
            type: 'call_offer',
            to: partnerId,
            sender_id: localStorage.getItem('userId'),
            sender_username: localStorage.getItem('username'),
            offer: offer,
            call_type: callType
        });
        console.log('Call offer sent to', partnerId);
    } catch (error) {
        console.error('Error initiating call:', error);
        callStatus.textContent = 'Failed to start call.';
        updateCallState('idle');
    }
}

export async function handleIncomingCallOffer(data) {
    if (currentCallState !== 'idle') {
        console.warn('Cannot receive call, already in a call or call in progress. Sending busy signal.');
        console.log(localStorage.getItem("username"))
        sendWebSocketMessage({
            type: 'call_busy', // Or 'call_rejected' with a reason
            to: data.sender_id,
            sender_id: localStorage.getItem('userId'),
            sender_username: localStorage.getItem('username')
        });
        return;
    }
    currentCallPartnerId = data.sender_id;
    currentCallType = data.call_type;
    currentCallPartnerUsername = data.sender_username;
    console.log(data)
    updateCallState('ringing');
    // Store offer temporarily or pass directly
    window.currentOfferData = data; // Simple way to store, consider a more robust state management
}

async function acceptCall() {
    if (currentCallState !== 'ringing' || !window.currentOfferData) {
        console.error('Cannot accept call, not in ringing state or no offer data.');
        return;
    }
    const offerData = window.currentOfferData;
    // currentCallType is already set in handleIncomingCallOffer, which calls updateCallState('ringing')
    updateCallState('active'); 

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: offerData.call_type === 'video', 
            audio: true 
        });
        localStreamRef = stream;
        setLocalStream(stream); 
        if (offerData.call_type === 'video' && localVideoModal) {
            localVideoModal.srcObject = stream;
        } else if (offerData.call_type === 'audio' && localUserPlaceholder) {
            // Placeholder is already made visible by updateCallState
        }

        const answer = await handleOfferAndCreateAnswer(offerData.sender_id, offerData.offer, offerData.call_type === 'video');
        sendWebSocketMessage({
            type: 'call_answer',
            to: offerData.sender_id,
            sender_id: localStorage.getItem('userId'),
            sender_username: localStorage.getItem('username'),
            answer: answer,
            call_type: offerData.call_type
        });
        console.log('Call answer sent to', offerData.sender_id);
        window.currentOfferData = null; // Clear stored offer
    } catch (error) {
        console.error('Error accepting call:', error);
        callStatus.textContent = 'Failed to accept call.';
        updateCallState('idle');
        // Optionally send a reject message
        sendWebSocketMessage({
            type: 'call_rejected',
            to: offerData.sender_id,
            sender_id: localStorage.getItem('userId'),
            reason: 'Failed to establish connection'
        });
    }
}

function rejectCall() {
    if (currentCallState !== 'ringing' || !window.currentOfferData) {
        console.warn('No incoming call to reject or not in ringing state.');
        if (currentCallState !== 'idle') updateCallState('idle'); // Reset if stuck
        return;
    }
    const offerData = window.currentOfferData;
    console.log('Call rejected by user.');
    sendWebSocketMessage({
        type: 'call_rejected',
        to: offerData.sender_id,
        sender_id: localStorage.getItem('userId'),
        sender_username: localStorage.getItem('username')
    });
    updateCallState('idle');
    window.currentOfferData = null; // Clear stored offer
}

export async function handleCallAnswer(data) {
    if (currentCallState !== 'initiating') {
        console.warn('Received answer but not in initiating state.');
        return;
    }
    console.log('Call answer received from', data.sender_id);
    await handleAnswer(data.sender_id, data.answer);
    updateCallState('active');
}

export function handleCallRejected(data) {
    console.log(`Call rejected by ${data.sender_username}. Reason: ${data.reason || 'User declined'}`);
    callStatus.textContent = `Call rejected by ${data.sender_username}.`;
    setTimeout(() => {
        updateCallState('idle');
    }, 3000);
}

export function handleCallBusy(data) {
    console.log(`${data.sender_username} is busy.`);
    callStatus.textContent = `${data.sender_username} is currently busy.`;
    setTimeout(() => {
        updateCallState('idle');
    }, 3000);
}

export function handleICECandidate(data) {
    if (currentCallState !== 'initiating' && currentCallState !== 'active' && currentCallState !== 'ringing') {
        // Allow candidate processing if we are in ringing state because the peer might send candidates before we accept
        console.warn('Received ICE candidate but not in an active call state:', currentCallState);
        // return; // Commented out to allow candidates during ringing state
    }
    console.log('Received ICE candidate from', data.sender_id);
    handleCandidate(data.candidate); // handleCandidate in webrtc_handler
}

function endCall() {
    if (currentCallState === 'idle') {
        console.warn('No active call to end.');
        return;
    }
    console.log('Ending call with', currentCallPartnerId);
    sendWebSocketMessage({
        type: 'call_ended',
        to: currentCallPartnerId,
        sender_id: localStorage.getItem('userId')
    });
    updateCallState('idle');
}

export function handleCallEnded(data) {
    console.log(`Call ended by ${data.sender_id}`);
    callStatus.textContent = 'Call ended.';
    setTimeout(() => {
        updateCallState('idle');
    }, 2000);
}

// Event Listeners for modal buttons
if (acceptCallButton) acceptCallButton.addEventListener('click', acceptCall);
if (rejectCallButton) rejectCallButton.addEventListener('click', rejectCall);
if (endCallButtonModal) endCallButtonModal.addEventListener('click', endCall);

if (toggleMicrophoneButton) {
    toggleMicrophoneButton.addEventListener('click', () => {
        if (!localStreamRef) return;
        const audioTrack = localStreamRef.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            toggleMicrophoneButton.textContent = audioTrack.enabled ? 'Mute Mic' : 'Unmute Mic';
            toggleMicrophoneButton.classList.toggle('muted', !audioTrack.enabled);
        }
    });
}

if (toggleCameraButton) {
    toggleCameraButton.addEventListener('click', () => {
        if (!localStreamRef || currentCallType !== 'video') return;
        const videoTrack = localStreamRef.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            toggleCameraButton.textContent = videoTrack.enabled ? 'Show Cam' : 'Hide Cam'; // Corrected text for Show Cam
            toggleCameraButton.classList.toggle('hidden-cam', !videoTrack.enabled);
            if (videoTrack.enabled) {
                localVideoModal.style.display = 'block';
                localUserPlaceholder.style.display = 'none';
            } else {
                localVideoModal.style.display = 'none';
                localUserPlaceholder.style.display = 'block';
            }
        }
    });
}

export function displayRemoteStream(stream) {
    if (!remoteVideoModal) {
        console.error('remoteVideoModal element not found');
        return;
    }

    remoteVideoModal.srcObject = stream;
    if (currentCallType === 'video') {
        console.log('Displaying remote video stream.');
        remoteVideoModal.style.display = 'block';
        if (remoteUserPlaceholder) remoteUserPlaceholder.style.display = 'none';
    } else if (currentCallType === 'audio') {
        console.log('Remote stream is audio-only. Hiding video element, showing placeholder.');
        remoteVideoModal.style.display = 'none'; // Hide video element itself
        if (remoteUserPlaceholder) remoteUserPlaceholder.style.display = 'block';
    } else {
        console.warn('displayRemoteStream called with unknown currentCallType:', currentCallType);
        // Fallback: attempt to show video, hide placeholder
        remoteVideoModal.style.display = 'block';
        if (remoteUserPlaceholder) remoteUserPlaceholder.style.display = 'none';
    }
}

// Initialize call state
updateCallState('idle');

console.log('Call handler initialized.');