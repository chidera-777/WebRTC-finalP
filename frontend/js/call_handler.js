import { sendWebSocketMessage } from './websocket_client.js';
import {
    createOffer as createWebRTCOffer,
    handleOfferAndCreateAnswer as handleWebRTCOfferAndCreateAnswer,
    handleAnswer as handleWebRTCAnswer,
    handleCandidate as handleWebRTCCandidate,
    setLocalStream as setWebRTCLocalStream,
    closeConnection as closeWebRTCConnection,
    closeAllConnections as closeAllWebRTCConnections,
    getWebRTCConnection
} from './webrtc_handler.js';

let currentCallType = null;
let localStreamRef = null;

const currentCall = {
    type: null,
    peerId: null,
    groupId: null,
    groupName: null,
    recipients: [],
    isVideo: false,
    callState: 'idle',
    pendingOfferSdp: null,
    participants: {},
    activeParticipants: []
};

const callModal = document.getElementById('callModal');
const callModalTitle = document.getElementById('callModalTitle');
const callStatus = document.getElementById('call-status');
const localVideoModal = document.getElementById('localVideoModal');
const remoteStreamsContainer = document.getElementById('remoteStreamsContainer');
const localUserPlaceholder = document.getElementById('localUserPlaceholder');
const incomingCallActions = document.getElementById('incomingCallActions');
const activeCallActions = document.getElementById('activeCallActions');
const acceptCallButton = document.getElementById('acceptCallButton');
const rejectCallButton = document.getElementById('rejectCallButton');
const toggleMicrophoneButton = document.getElementById('toggleMicrophoneButton');
const toggleCameraButton = document.getElementById('toggleCameraButton');
const endCallButtonModal = document.getElementById('endCallButtonModal');

function addLocalStreamPlaceholder() {
    const localUserId = localStorage.getItem('userId');
    const localUsername = localStorage.getItem('username');

    if (!localStreamRef) {
        return;
    }

    addLocalUserDisplay(localUserId, localStreamRef, localUsername, currentCall.groupId, currentCall.isVideo);
}

function addLocalUserDisplay(userId, stream, username, groupId, isVideo) {
    const callType = groupId || 'peer';
    const elementId = `local-${userId}-${callType}`;
    const wrapperElementId = `wrapper-${elementId}`;

    let wrapper = document.getElementById(wrapperElementId);
    if (wrapper) {
        wrapper.innerHTML = '';
    } else {
        wrapper = document.createElement('div');
        wrapper.id = wrapperElementId;
        wrapper.classList.add('participant-wrapper', 'local-participant');

        const isOneOnOne = !groupId;
        wrapper.style.cssText = `
            position: relative;
            margin: 5px;
            border-radius: 8px;
            overflow: hidden;
            background: #333;
            min-width: ${isOneOnOne ? '200px' : '150px'};
            min-height: ${isOneOnOne ? '150px' : '100px'};
            ${isOneOnOne ? 'max-width: 300px; max-height: 220px;' : ''}
            border: 2px solid #3498db;
            ${isOneOnOne ? 'flex: 1;' : ''}
        `;

        if (remoteStreamsContainer) {
            remoteStreamsContainer.appendChild(wrapper);
        } else {
            return;
        }
    }
    const nameOverlay = document.createElement('div');
    nameOverlay.classList.add('participant-name-overlay');
    nameOverlay.textContent = `${username} (You)`;
    nameOverlay.style.cssText = `
        position: absolute;
        bottom: 5px;
        left: 5px;
        background: rgba(52,152,219,0.9);
        color: white;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: bold;
        z-index: 10;
    `;
    wrapper.appendChild(nameOverlay);

    let mediaElement;
    if (isVideo) {
        mediaElement = document.createElement('video');
        mediaElement.autoplay = true;
        mediaElement.playsinline = true;
        mediaElement.muted = true;
        mediaElement.classList.add('local-video');
        mediaElement.style.cssText = `
            width: 100%;
            height: 100%;
            object-fit: cover;
            background: #000;
            transform: scaleX(-1);
        `;
    } else {
        mediaElement = document.createElement('audio');
        mediaElement.autoplay = true;
        mediaElement.muted = true; // Always mute local audio
        mediaElement.classList.add('local-audio');

        const audioPlaceholder = document.createElement('div');
        const isOneOnOne = !groupId;
        audioPlaceholder.style.cssText = `
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: ${isOneOnOne ? '16px' : '14px'};
            text-align: center;
            min-height: ${isOneOnOne ? '150px' : '100px'};
        `;
        audioPlaceholder.innerHTML = `
            <div>
                <div style="font-size: ${isOneOnOne ? '48px' : '24px'}; margin-bottom: 10px;">🎤</div>
                <div style="font-weight: bold; margin-bottom: 5px;">${username} (You)</div>
                <div style="font-size: ${isOneOnOne ? '12px' : '10px'}; opacity: 0.8;">
                    Speaking • ${isOneOnOne ? '1-on-1 Call' : 'Group Call'}
                </div>
            </div>
        `;
        wrapper.appendChild(audioPlaceholder);
    }

    mediaElement.id = elementId;
    mediaElement.srcObject = stream;
    mediaElement.play().catch(e => console.warn(`▶️ Local autoplay prevented:`, e));
    wrapper.appendChild(mediaElement);
}

export function updateCallState(newState) {
    currentCall.callState = newState;
    localVideoModal.style.display = 'none';
    if (localUserPlaceholder) localUserPlaceholder.style.display = 'none';
    if (remoteStreamsContainer) {
        const mediaElements = remoteStreamsContainer.querySelectorAll('video, audio');
        mediaElements.forEach(element => {
            if (element.srcObject) {
                element.srcObject.getTracks().forEach(track => track.stop());
                element.srcObject = null;
            }
            element.pause();
        });
        remoteStreamsContainer.innerHTML = '';
    }

    switch (newState) {
        case 'idle':
            callModal.style.display = 'none';
            incomingCallActions.style.display = 'none';
            activeCallActions.style.display = 'block';
            currentCall.peerId = null;
            currentCall.groupId = null;
            currentCall.groupName = null;
            currentCall.recipients = [];
            currentCall.participants = {};
            currentCall.activeParticipants = [];
            currentCall.isVideo = false;
            currentCallType = null;

            if (localStreamRef) {
                localStreamRef.getTracks().forEach(track => track.stop());
                localStreamRef = null;
            }
            if (localVideoModal) localVideoModal.srcObject = null;
            setWebRTCLocalStream(null);

            closeAllWebRTCConnections();
            break;

        case 'initiating':
            callModal.style.display = 'block';
            currentCallType = currentCall.isVideo ? 'video' : 'audio';
            toggleCameraButton.style.display = currentCall.isVideo ? 'inline-block' : 'none';

            let title = currentCall.isVideo ? 'Video Call' : 'Audio Call';
            
            if (currentCall.groupId) {
                title = `${currentCall.groupName} Group ${title}`;
            }
            callModalTitle.textContent = title;
            callStatus.textContent = 'Starting call...';
            incomingCallActions.style.display = 'none';
            activeCallActions.style.display = 'block';
            break;

        case 'ringing':
            callModal.style.display = 'block';
            currentCallType = currentCall.isVideo ? 'video' : 'audio';
            toggleCameraButton.style.display = currentCall.isVideo ? 'inline-block' : 'none';

            let incomingTitle = `Incoming ${currentCall.isVideo ? 'Video' : 'Audio'} Call`;
            if (currentCall.groupId) {
                incomingTitle = `Incoming Group ${currentCall.isVideo ? 'Video' : 'Audio'} Call (${currentCall.groupName})`;
            }
            callModalTitle.textContent = incomingTitle;
            callStatus.textContent = 'Incoming call...';
            incomingCallActions.style.display = 'block';
            activeCallActions.style.display = 'none';
            break;

        case 'active':
            callModal.style.display = 'block';
            currentCallType = currentCall.isVideo ? 'video' : 'audio';
            toggleCameraButton.style.display = currentCall.isVideo ? 'inline-block' : 'none';

            let activeTitle = `${currentCall.isVideo ? 'Video' : 'Audio'} Call`;
            if (currentCall.groupId) {
                activeTitle = `${currentCall.groupName} Group ${activeTitle}`;
            }
            addLocalStreamPlaceholder();

            callModalTitle.textContent = activeTitle;
            callStatus.textContent = 'Call in progress...';
            incomingCallActions.style.display = 'none';
            activeCallActions.style.display = 'block';
            break;
    }
}

async function getLocalMedia(isVideoCall) {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: isVideoCall,
            audio: true
        });
        localStreamRef = stream;
        setWebRTCLocalStream(stream);
        if (isVideoCall && !currentCall.groupId) {
            localVideoModal.srcObject = stream;
        }
        return stream;
    } catch (error) {
        alert('Could not access your camera/microphone. Please check permissions and try again.');
        updateCallState('idle');
        return null;
    }
}

export async function initiateCall(callDetails, username, isVideoCall) {
    if (currentCall.callState !== 'idle') {
        alert('A call is already in progress. Please end it before starting a new one.');
        return;
    }

    const stream = await getLocalMedia(isVideoCall);
    if (!stream) return;

    currentCall.isVideo = isVideoCall;

    if (callDetails.targetUserId) { // 1-on-1 Call
        currentCall.peerId = callDetails.targetUserId;
        currentCall.participants[callDetails.targetUserId] = {
            username: callDetails.targetUsername,
            stream: null,
            elementId: null
        };

        try {
            const offer = await createWebRTCOffer(callDetails.targetUserId, callDetails.targetUsername, isVideoCall, null);
            sendWebSocketMessage({
                type: 'call_offer',
                to: callDetails.targetUserId,
                userId: localStorage.getItem('userId'),
                sender_username: localStorage.getItem('username'),
                sdp: offer,
                isVideo: isVideoCall
            });
        } catch (error) {
            updateCallState('idle');
        }
    } else if (callDetails.groupId && callDetails.recipients) { // Group Call
        currentCall.groupId = callDetails.groupId;
        currentCall.groupName = callDetails.groupName;
        const validRecipients = callDetails.recipients.filter(r => r && r.user_id !== undefined);

        if (validRecipients.length === 0) {
            updateCallState('idle');
            alert('Could not initiate group call: No valid recipients.');
            return;
        }

        const localUserId = localStorage.getItem('userId');
        currentCall.participants[localUserId] = {
            username: localStorage.getItem('username'),
            stream: localStreamRef,
            elementId: 'localVideoModal'
        };
        currentCall.activeParticipants = [localUserId];

        validRecipients.forEach(r => {
            const recipientUserIdStr = r.user_id.toString();
            if (recipientUserIdStr !== localUserId) {
                currentCall.participants[recipientUserIdStr] = {
                    username: r.user.username,
                    stream: null,
                    elementId: null
                };
            }
        });
        sendWebSocketMessage({
            type: 'group-call-start',
            groupId: currentCall.groupId,
            groupName: currentCall.groupName,
            userId: localUserId,
            sender_username: localStorage.getItem('username'),
            isVideo: currentCall.isVideo
        });
    }
    
    updateCallState('initiating');
}

export function handleGroupCallStart(data) {
    if (data.userId === localStorage.getItem('userId')) {
        return;
    }

    if (currentCall.callState !== 'idle') {
        sendWebSocketMessage({
            type: 'group-call-busy',
            to: data.userId,
            userId: localStorage.getItem('userId'),
            sender_username: localStorage.getItem('username'),
            groupId: data.groupId,
            reason: 'busy'
        });
        return;
    }

    currentCall.groupId = data.groupId;
    currentCall.groupName = data.groupName;
    console.log(data.groupName);
    currentCall.peerId = data.userId;
    currentCall.isVideo = data.isVideo;
    currentCall.pendingOfferSdp = null;
    currentCall.activeParticipants = [data.userId];

    if (!currentCall.participants[data.userId]) {
        currentCall.participants[data.userId] = {
            username: data.sender_username,
            stream: null,
            elementId: null
        };
    }

    const localUserId = localStorage.getItem('userId');
    if (!currentCall.participants[localUserId]) {
        currentCall.participants[localUserId] = {
            username: localStorage.getItem('username'),
            stream: null,
            elementId: 'localVideoModal'
        };
    }

    updateCallState('ringing');
}

export async function acceptCall() {
    if (currentCall.callState !== 'ringing' || !currentCall.peerId) {
        return;
    }

    if (!localStreamRef) {
        const stream = await getLocalMedia(currentCall.isVideo);
        if (!stream) {
            updateCallState('idle');
            return;
        }
    }

    const localUserId = localStorage.getItem('userId');

    if (currentCall.groupId) {
        if (!currentCall.participants[localUserId]) {
            currentCall.participants[localUserId] = {
                username: localStorage.getItem('username'),
                stream: localStreamRef,
                elementId: 'localVideoModal'
            };
        }

        if (!currentCall.activeParticipants.includes(localUserId)) {
            currentCall.activeParticipants.push(localUserId);
        }
        sendWebSocketMessage({
            type: 'group-call-join',
            groupId: currentCall.groupId,
            groupName: currentCall.groupName,
            userId: localUserId,
            sender_username: localStorage.getItem('username'),
            isVideo: currentCall.isVideo
        });

        updateCallState('active');
        for (const participantId of currentCall.activeParticipants) {
            if (participantId !== localUserId) {
                try {
                    const participantUsername = currentCall.participants[participantId]?.username || 'Unknown User';
                    const offer = await createWebRTCOffer(participantId, participantUsername, currentCall.isVideo, currentCall.groupId);

                    sendWebSocketMessage({
                        type: 'group-call-offer',
                        groupId: currentCall.groupId,
                        groupName: currentCall.groupName,
                        to: participantId,
                        userId: localUserId,
                        sender_username: localStorage.getItem('username'),
                        sdp: offer,
                        isVideo: currentCall.isVideo
                    });
                } catch (error) {
                    error
                }
            }
        }
    } else {
        if (!currentCall.pendingOfferSdp) {
            updateCallState('idle');
            return;
        }

        try {
            const answerSdp = await handleWebRTCOfferAndCreateAnswer(
                currentCall.peerId,
                currentCall.pendingOfferSdp,
                currentCall.participants[currentCall.peerId]?.username || 'Unknown User',
                currentCall.isVideo,
                null
            );

            sendWebSocketMessage({
                type: 'call_answer',
                to: currentCall.peerId,
                userId: localUserId,
                sender_username: localStorage.getItem('username'),
                sdp: answerSdp,
                isVideo: currentCall.isVideo
            });

            updateCallState('active');
        } catch (error) {
            updateCallState('idle');
        }
    }
}

export async function handleIncomingCallOffer(data) {
    if (!data.sdp || data.sdp.type !== 'offer') {
        return;
    }
    if (data.groupId && currentCall.groupId === data.groupId && currentCall.callState === 'active') {
        if (!currentCall.participants[data.userId]) {
            currentCall.participants[data.userId] = {
                username: data.sender_username,
                stream: null,
                elementId: null
            };
        }

        if (!currentCall.activeParticipants.includes(data.userId)) {
            currentCall.activeParticipants.push(data.userId);
        }

        try {
            const answerSdp = await handleWebRTCOfferAndCreateAnswer(data.userId, data.sdp, data.sender_username, data.isVideo, data.groupId);

            sendWebSocketMessage({
                type: 'group-call-answer',
                to: data.userId,
                userId: localStorage.getItem('userId'),
                sender_username: localStorage.getItem('username'),
                sdp: answerSdp,
                isVideo: data.isVideo,
                groupId: data.groupId
            });
        } catch (error) {
        }
        return;
    }
    if (currentCall.callState !== 'idle') {
        const busyType = data.groupId ? 'group-call-busy' : 'call_busy';
        sendWebSocketMessage({
            type: busyType,
            to: data.userId,
            userId: localStorage.getItem('userId'),
            sender_username: localStorage.getItem('username'),
            groupId: data.groupId
        });
        return;
    }
    currentCall.peerId = data.userId;
    currentCall.isVideo = data.isVideo;
    currentCall.pendingOfferSdp = data.sdp;

    if (!currentCall.participants[data.userId]) {
        currentCall.participants[data.userId] = {
            username: data.sender_username,
            stream: null,
            elementId: null
        };
    }

    if (data.groupId) {
        currentCall.groupId = data.groupId;
        currentCall.groupName = data.groupName;
        if (data.activeParticipants) {
            currentCall.activeParticipants = data.activeParticipants;
        }
    }

    updateCallState('ringing');
}

export async function handleCallAnswer(data) {
    if (!data.sdp || data.sdp.type !== 'answer') {
        return;
    }

    try {
        const connection = getWebRTCConnection(data.userId, data.groupId);
        if (!connection) {
            return;
        }
        if (connection.signalingState === 'have-remote-offer') {
            if (!currentCall.pendingAnswers) {
                currentCall.pendingAnswers = {};
            }
            currentCall.pendingAnswers[data.userId] = {
                sdp: data.sdp,
                username: data.sender_username,
                groupId: data.groupId
            };
            return;
        }
        if (connection.signalingState === 'stable') {
            try {
                const offer = await createWebRTCOffer(
                    data.userId,
                    data.sender_username,
                    currentCall.isVideo,
                    data.groupId
                );
                sendWebSocketMessage({
                    type: data.groupId ? 'group-call-offer' : 'call_offer',
                    to: data.userId,
                    userId: localStorage.getItem('userId'),
                    sender_username: localStorage.getItem('username'),
                    sdp: offer,
                    isVideo: currentCall.isVideo,
                    groupId: data.groupId,
                    groupName: data.groupName
                });
                return;
            } catch (error) {
                return;
            }
        }

        await handleWebRTCAnswer(data.userId, data.sdp, data.groupId);
        if (currentCall.groupId && !currentCall.participants[data.userId]) {
            currentCall.participants[data.userId] = {
                username: data.sender_username,
                stream: null,
                elementId: null
            };
        }

        if (currentCall.groupId && !currentCall.activeParticipants.includes(data.userId)) {
            currentCall.activeParticipants.push(data.userId);
        }

        if (currentCall.callState !== 'active') {
            updateCallState('active');
        }
        if (currentCall.pendingAnswers && currentCall.pendingAnswers[data.userId]) {
            const pendingAnswer = currentCall.pendingAnswers[data.userId];
            delete currentCall.pendingAnswers[data.userId];
            handleCallAnswer({
                userId: data.userId,
                sender_username: pendingAnswer.username,
                sdp: pendingAnswer.sdp,
                groupId: pendingAnswer.groupId
            });
        }
    } catch (error) {
        if (currentCall.groupId && currentCall.callState === 'active') {
            try {
                const offer = await createWebRTCOffer(data.userId, data.sender_username, currentCall.isVideo, currentCall.groupId);
                sendWebSocketMessage({
                    type: 'group-call-offer',
                    groupId: currentCall.groupId,
                    groupName: currentCall.groupName,
                    to: data.userId,
                    userId: localStorage.getItem('userId'),
                    sender_username: localStorage.getItem('username'),
                    sdp: offer,
                    isVideo: currentCall.isVideo
                });
            } catch (renegotiateError) {
            }
        }
    }
}

export async function handleGroupCallJoin(data) {
    if (!currentCall.groupId || currentCall.groupId !== data.groupId || data.userId == localStorage.getItem('userId')) {
        return;
    }

    if (!currentCall.participants[data.userId]) {
        currentCall.participants[data.userId] = {
            username: data.sender_username,
            stream: null,
            elementId: null
        };
    }

    if (!currentCall.activeParticipants.includes(data.userId)) {
        currentCall.activeParticipants.push(data.userId);
    }
    if (currentCall.callState === 'active') {
        try {
            const connection = getWebRTCConnection(data.userId, data.groupId);
            if (connection && connection.signalingState !== 'stable') {
                return;
            }

            const offer = await createWebRTCOffer(data.userId, data.sender_username, currentCall.isVideo, currentCall.groupId);
            sendWebSocketMessage({
                type: 'group-call-offer',
                groupId: currentCall.groupId,
                groupName: currentCall.groupName,
                to: data.userId,
                userId: localStorage.getItem('userId'),
                sender_username: localStorage.getItem('username'),
                sdp: offer,
                isVideo: currentCall.isVideo
            });
        } catch (error) {
        }
    } else if (currentCall.callState === 'initiating') {
        updateCallState('active');
        try {
            const offer = await createWebRTCOffer(data.userId, data.sender_username, currentCall.isVideo, currentCall.groupId);
            sendWebSocketMessage({
                type: 'group-call-offer',
                groupId: currentCall.groupId,
                groupName: currentCall.groupName,
                to: data.userId,
                userId: localStorage.getItem('userId'),
                sender_username: localStorage.getItem('username'),
                sdp: offer,
                isVideo: currentCall.isVideo
            });
        } catch (error) {
        }
    }
}

export async function joinOngoingGroupCall(groupId, groupName, callInfo) {
    try {
        const confirmJoin = confirm(`Join the ongoing call in "${groupName}"?`);
        if (!confirmJoin) return;

        const isVideoCall = callInfo.isVideo || false;
        
        const stream = await getLocalMedia(isVideoCall)

        if (!stream)  return;
    
        const localUserId = localStorage.getItem('userId');
        const localUsername = localStorage.getItem('username');

        currentCall.groupId = groupId;
        currentCall.groupName = groupName;
        currentCall.isVideo = isVideoCall;
        currentCall.callState = 'active';
        
        if (!currentCall.participants[localUserId]) {
            currentCall.participants[localUserId] = {
                username: localUsername,
                stream: stream,
                elementId: 'localVideoModal'
            };
            currentCall.activeParticipants.push(localUserId);    
        }
        
        updateCallState('active');

        sendWebSocketMessage({
            type: 'group-call-join',
            groupId: groupId,
            userId: localUserId,
            sender_username: localUsername,
            isVideo: isVideoCall
        });
        
    } catch (error) {
        error
    }
}

export function handleICECandidate(data) {
    if (!data.userId || !data.candidate) {
        return;
    }
    if (data.groupId && currentCall.groupId === data.groupId) {
        if (!currentCall.activeParticipants.includes(data.userId)) {
            currentCall.activeParticipants.push(data.userId);
            if (!currentCall.participants[data.userId]) {
                currentCall.participants[data.userId] = {
                    username: data.sender_username || `User ${data.userId}`,
                    stream: null,
                    elementId: null
                };
            }
        }
        handleWebRTCCandidate(data.userId, data.candidate, data.groupId);
        return;
    }
    if (!data.groupId && data.to === localStorage.getItem('userId')) {
        handleWebRTCCandidate(data.userId, data.candidate, null);
    }
}

export function addRemoteStream(userId, stream, username, groupId, isVideo) {
    const localUserId = localStorage.getItem('userId');
    const isLocalUser = userId === localUserId;

    if (isLocalUser) {
        return;
    }

    if (currentCall.participants[userId] && currentCall.participants[userId].stream) {
        const existingStream = currentCall.participants[userId].stream;
        const existingTracks = existingStream.getTracks();
        const allTracksActive = existingTracks.every(track => track.readyState === 'live');
        
        if (allTracksActive && existingTracks.length > 0) {
            return;
        } else {
            const existingWrapper = document.getElementById(currentCall.participants[userId].wrapperElementId);
            if (existingWrapper) {
                existingWrapper.remove();
            }
        }
    }

    if (!currentCall.participants[userId]) {
        currentCall.participants[userId] = {
            username: username || `User ${userId}`,
            stream: null,
            elementId: null,
            wrapperElementId: null
        };
    }

    const callType = groupId || 'peer';
    const elementId = `remote-${userId}-${callType}`;
    const wrapperElementId = `wrapper-${elementId}`;

    const existingWrapper = document.getElementById(wrapperElementId);
    if (existingWrapper) {
        existingWrapper.remove();
    }

    const wrapper = document.createElement('div');
    wrapper.id = wrapperElementId;
    wrapper.classList.add('participant-wrapper');
    
    const isOneOnOne = !groupId;
    if (isVideo) {
        wrapper.style.cssText = `
            position: relative;
            margin: 5px;
            border-radius: 8px;
            overflow: hidden;
            background: #333;
            min-width: ${isOneOnOne ? '200px' : '150px'};
            min-height: ${isOneOnOne ? '150px' : '100px'};
            ${isOneOnOne ? 'max-width: 300px; max-height: 220px;' : ''}
            border: 2px solid #34495e;
            ${isOneOnOne ? 'flex: 1;' : ''}
            aspect-ratio: 4/3;
        `;
        
        remoteStreamsContainer.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(${isOneOnOne ? '200px' : '150px'}, 1fr));
            gap: 10px;
            padding: 10px;
            max-height: 70vh;
            overflow-y: auto;
            align-items: center;
            justify-items: center;
        `;
    } else {
        wrapper.style.cssText = `
            position: relative;
            margin: 5px;
            border-radius: 8px;
            overflow: hidden;
            background: #333;
            min-width: ${isOneOnOne ? '200px' : '150px'};
            min-height: ${isOneOnOne ? '150px' : '100px'};
            ${isOneOnOne ? 'max-width: 300px; max-height: 220px;' : ''}
            border: 2px solid #34495e;
            ${isOneOnOne ? 'flex: 1;' : ''}
        `;
        
        remoteStreamsContainer.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            padding: 10px;
            max-height: 70vh;
            overflow-y: auto;
            align-items: center;
            justify-content: center;
        `;
    }

    remoteStreamsContainer.appendChild(wrapper);

    const nameOverlay = document.createElement('div');
    nameOverlay.classList.add('participant-name-overlay');
    nameOverlay.textContent = username;
    nameOverlay.style.cssText = `
        position: absolute;
        bottom: 5px;
        left: 5px;
        background: rgba(0,0,0,0.7);
        color: white;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: bold;
        z-index: 10;
    `;
    wrapper.appendChild(nameOverlay);

    let mediaElement;
    if (isVideo) {
        mediaElement = document.createElement('video');
        mediaElement.autoplay = true;
        mediaElement.playsinline = true;
        mediaElement.muted = false; // Don't mute remote video
        mediaElement.classList.add('remote-video');
        mediaElement.style.cssText = `
            width: 100%;
            height: 100%;
            object-fit: cover;
            background: #000;
        `;
        
    } else {
        mediaElement = document.createElement('audio');
        mediaElement.autoplay = true;
        mediaElement.muted = false; // Don't mute remote audio
        mediaElement.classList.add('remote-audio');
        
        const audioPlaceholder = document.createElement('div');
        const isOneOnOne = !groupId;
        audioPlaceholder.style.cssText = `
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: ${isOneOnOne ? '16px' : '14px'};
            text-align: center;
            min-height: ${isOneOnOne ? '150px' : '100px'};
        `;
        audioPlaceholder.innerHTML = `
            <div>
                <div style="font-size: ${isOneOnOne ? '48px' : '24px'}; margin-bottom: 10px;">🎵</div>
                <div style="font-weight: bold; margin-bottom: 5px;">${username}</div>
                <div style="font-size: ${isOneOnOne ? '12px' : '10px'}; opacity: 0.8;">
                    Audio ${isOneOnOne ? ' • 1-on-1 Call' : ' • Group Call'}
                </div>
            </div>
        `;
        wrapper.appendChild(audioPlaceholder);
    }
    
    mediaElement.id = elementId;
    mediaElement.srcObject = stream;
    
    // Force video/audio to start playing
    const playPromise = mediaElement.play();
    if (playPromise !== undefined) {
        playPromise.then(() => {
        }).catch(e => {
            const playButton = document.createElement('button');
            playButton.textContent = '▶️ Play';
            playButton.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 20;
                padding: 10px;
                background: rgba(52, 152, 219, 0.9);
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
            `;
            playButton.onclick = () => {
                mediaElement.play().then(() => {
                    playButton.remove();
                }).catch(console.error);
            };
            wrapper.appendChild(playButton);
        });
    }
    
    wrapper.appendChild(mediaElement);
    currentCall.participants[userId].stream = stream;
    currentCall.participants[userId].elementId = elementId;
    currentCall.participants[userId].wrapperElementId = wrapperElementId;

    if (!currentCall.activeParticipants.includes(userId)) {
        currentCall.activeParticipants.push(userId);
    }
}

export function rejectCall() {
    if (currentCall.callState !== 'ringing') return;

    const messageType = currentCall.groupId ? 'group-call-busy' : 'call_rejected';
    sendWebSocketMessage({
        type: messageType,
        to: currentCall.peerId,
        userId: localStorage.getItem('userId'),
        sender_username: localStorage.getItem('username'),
        groupId: currentCall.groupId,
        reason: 'rejected'
    });

    updateCallState('idle');
}

export function endCall() {
    if (currentCall.callState === 'idle') return;

    const localUserId = localStorage.getItem('userId');

    if (currentCall.groupId) {
        sendWebSocketMessage({
            type: 'group-call-leave',
            groupId: currentCall.groupId,
            userId: localUserId,
            sender_username: localStorage.getItem('username')
        });
    } else if (currentCall.peerId) {
        sendWebSocketMessage({
            type: 'call_ended',
            to: currentCall.peerId,
            userId: localUserId,
            sender_username: localStorage.getItem('username')
        });
    }

    if (localStreamRef) {
        localStreamRef.getTracks().forEach(track => track.stop());
        localStreamRef = null;
    }
    setWebRTCLocalStream(null);
    updateCallState('idle');
}
export function handleCallRejected(data) {
    if (callStatus) callStatus.textContent = `Call rejected by ${data.sender_username}.`;
    setTimeout(() => updateCallState('idle'), 3000);
}

export function handleCallBusy(data) {
    if (callStatus) callStatus.textContent = `${data.sender_username} is busy.`;
    setTimeout(() => updateCallState('idle'), 3000);
}

export function handleGroupCallLeave(data) {
    if (!currentCall.groupId || currentCall.groupId !== data.groupId || data.userId == localStorage.getItem('userId')) {
        return;
    }

    const wrapper = document.getElementById(`wrapper-remote-${data.userId}-${data.groupId}`);
    if (wrapper) wrapper.remove();

    if (currentCall.participants[data.userId]) {
        delete currentCall.participants[data.userId];
    }

    currentCall.activeParticipants = currentCall.activeParticipants.filter(id => id !== data.userId);
    closeWebRTCConnection(data.userId, data.groupId);
}

export function handleGroupCallEnded(data) {
    if (currentCall.groupId && currentCall.groupId == data.groupId) {
        if (callStatus) callStatus.textContent = 'Group call ended.';
        closeAllWebRTCConnections(currentCall.groupId);
        updateCallState('idle');
    }
}

export function handleCallEnded(data) {
    if (!data.groupId && currentCall.peerId == data.userId) {
        if (callStatus) callStatus.textContent = `Call ended.`;
        updateCallState('idle');
    }
}

export function handleGroupCallBusy(data) {
    console.log(`📞 ${data.sender_username} is busy for group call`);
}

export function handleOngoingGroupCalls(calls) {
    if (calls && calls.length > 0) {
        if (typeof window.showOngoingCallsNotification === 'function') {
            window.showOngoingCallsNotification(calls);
        }
    }
}

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
            toggleCameraButton.textContent = videoTrack.enabled ? 'Hide Cam' : 'Show Cam';
            toggleCameraButton.classList.toggle('hidden-cam', !videoTrack.enabled);
        }
    });
}
updateCallState('idle');

window.addRemoteStream = addRemoteStream;
const addRemoteStreamDebounced = {};
window.addRemoteStreamSafe = function (userId, stream, username, groupId, isVideo) {
    if (addRemoteStreamDebounced[userId]) {
        clearTimeout(addRemoteStreamDebounced[userId]);
    }
    addRemoteStreamDebounced[userId] = setTimeout(() => {
        addRemoteStream(userId, stream, username, groupId, isVideo);
        delete addRemoteStreamDebounced[userId];
    }, 50);
};