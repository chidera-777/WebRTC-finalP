import { sendWebSocketMessage } from './websocket_client.js';
import {
    createOffer as createWebRTCOffer,
    handleOfferAndCreateAnswer as handleWebRTCOfferAndCreateAnswer,
    handleAnswer as handleWebRTCAnswer,
    handleCandidate as handleWebRTCCandidate,
    setLocalStream as setWebRTCLocalStream,
    getLocalStream as getWebRTCLocalStream,
    closeConnection as closeWebRTCConnection,
    closeAllConnections as closeAllWebRTCConnections
} from './webrtc_handler.js';

let currentCallState = 'idle';
let currentCallType = null;
let localStreamRef = null;

const currentCall = {
    type: null,
    peerId: null,
    groupId: null,
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

// Function to add local stream as a participant placeholder
function addLocalStreamPlaceholder() {
    const localUserId = localStorage.getItem('userId');
    const localUsername = localStorage.getItem('username');
    
    console.log(`🎯 Adding local stream placeholder for: ${localUsername} (${localUserId})`);
    
    if (!localStreamRef) {
        console.warn('No local stream available for placeholder');
        return;
    }
    
    addLocalUserDisplay(localUserId, localStreamRef, localUsername, currentCall.groupId, currentCall.isVideo);
}

function addLocalUserDisplay(userId, stream, username, groupId, isVideo) {
    console.log(`🎥 Adding LOCAL display for ${username || userId} (isVideo: ${isVideo})`);
    
    const localUserId = localStorage.getItem('userId');
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
            console.error('❌ remoteStreamsContainer not found');
            return;
        }
    }

    // Create name overlay
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
        mediaElement.muted = true; // Always mute local video
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

    console.log(`✅ Local user display created for ${username}`);
}

function updateCallState(newState) {
    console.log(`Call state changing from ${currentCall.callState} to ${newState}`);
    currentCall.callState = newState;

    // Clear display
    localVideoModal.style.display = 'none';
    if(localUserPlaceholder) localUserPlaceholder.style.display = 'none';
    if(remoteStreamsContainer) {
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
                title = `Group ${title}`;
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
                incomingTitle = `Incoming Group ${currentCall.isVideo ? 'Video' : 'Audio'} Call`;
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
                activeTitle = `Group ${activeTitle}`;
            }
            
            // Always add local placeholder for active calls (both 1-on-1 and group)
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
    updateCallState('initiating');

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
            console.log('✅ 1-on-1 call offer sent to', callDetails.targetUsername);
        } catch (error) {
            console.error('❌ Error initiating 1-on-1 call:', error);
            updateCallState('idle');
        }
    } else if (callDetails.groupId && callDetails.recipients) { // Group Call
        currentCall.groupId = callDetails.groupId;
        const validRecipients = callDetails.recipients.filter(r => r && r.user_id !== undefined);
        
        if (validRecipients.length === 0) {
            console.error('No valid recipients found');
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
        
        console.log(`🚀 Starting group call for ${validRecipients.length} recipients`);
        
        // Send group call start notification
        sendWebSocketMessage({
            type: 'group-call-start',
            groupId: currentCall.groupId,
            userId: localUserId,
            sender_username: localStorage.getItem('username'),
            isVideo: currentCall.isVideo
        });
    }
}

export function handleGroupCallStart(data) {
    if (data.userId === localStorage.getItem('userId')) {
        return; // Ignore own start notification
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

    console.log(`📞 Incoming group call from ${data.sender_username}`);
    
    currentCall.groupId = data.groupId;
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
    
    console.log(`✅ Accepting call from ${currentCall.peerId}`);
    
    if (!localStreamRef) {
        const stream = await getLocalMedia(currentCall.isVideo);
        if (!stream) {
            updateCallState('idle'); 
            return;
        }
    }

    const localUserId = localStorage.getItem('userId');

    if (currentCall.groupId) {
        // Group call acceptance
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

        // Send join notification
        sendWebSocketMessage({
            type: 'group-call-join',
            groupId: currentCall.groupId,
            userId: localUserId,
            sender_username: localStorage.getItem('username'),
            isVideo: currentCall.isVideo
        });

        updateCallState('active');

        // Create offers to all active participants
        for (const participantId of currentCall.activeParticipants) {
            if (participantId !== localUserId) {
                console.log(`🔄 Creating offer for participant: ${participantId}`);
                try {
                    const participantUsername = currentCall.participants[participantId]?.username || 'Unknown User';
                    const offer = await createWebRTCOffer(participantId, participantUsername, currentCall.isVideo, currentCall.groupId);
                    
                    sendWebSocketMessage({
                        type: 'group-call-offer',
                        groupId: currentCall.groupId,
                        to: participantId,
                        userId: localUserId,
                        sender_username: localStorage.getItem('username'),
                        sdp: offer,
                        isVideo: currentCall.isVideo
                    });
                    console.log(`✅ Offer sent to ${participantId}`);
                } catch (error) {
                    console.error(`❌ Error creating offer for ${participantId}:`, error);
                }
            }
        }
    } else {
        // 1-on-1 call acceptance
        if (!currentCall.pendingOfferSdp) {
            console.error('No pending offer for 1-on-1 call');
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
            console.error('❌ Error accepting 1-on-1 call:', error);
            updateCallState('idle');
        }
    }
}

export async function handleIncomingCallOffer(data) {
    console.log(`📥 Received offer from ${data.sender_username} (${data.userId})`);
    console.log(`🔍 Offer details: isVideo=${data.isVideo}, groupId=${data.groupId}, hasSDPContent=${!!data.sdp?.sdp}`);
    
    if (!data.sdp || data.sdp.type !== 'offer') {
        console.error('❌ Invalid offer received');
        return;
    }

    // Handle offers when already in active group call
    if (data.groupId && currentCall.groupId === data.groupId && currentCall.callState === 'active') {
        console.log(`🔄 Processing offer from ${data.sender_username} in active group call (isVideo: ${data.isVideo})`);
        
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
            console.log(`🔄 Creating answer with isVideo: ${data.isVideo} for ${data.sender_username}`);
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
            console.log(`✅ Answer sent to ${data.sender_username} with isVideo: ${data.isVideo}`);
        } catch (error) {
            console.error(`❌ Error processing offer from ${data.userId}:`, error);
        }
        return;
    }

    // Handle new call offers
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

    // Set up new incoming call
    currentCall.peerId = data.userId;
    currentCall.isVideo = data.isVideo; // Make sure we preserve the isVideo value
    currentCall.pendingOfferSdp = data.sdp;
    
    console.log(`📞 Setting up incoming call: isVideo=${currentCall.isVideo}, groupId=${data.groupId}`);
    
    if (!currentCall.participants[data.userId]) {
        currentCall.participants[data.userId] = { 
            username: data.sender_username, 
            stream: null, 
            elementId: null 
        };
    }

    if (data.groupId) {
        currentCall.groupId = data.groupId;
        if (data.activeParticipants) {
            currentCall.activeParticipants = data.activeParticipants;
        }
    }
    
    updateCallState('ringing');
}

export async function handleCallAnswer(data) {
    console.log(`📞 Answer received from ${data.sender_username} (${data.userId})`);

    if (!data.sdp || data.sdp.type !== 'answer') {
        console.error('❌ Invalid answer received');
        return;
    }

    try {
        await handleWebRTCAnswer(data.userId, data.sdp, data.groupId);
        console.log(`✅ Answer processed for ${data.sender_username}`);
        
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
    } catch (error) {
        console.error(`❌ Error handling answer from ${data.userId}:`, error);
    }
}

export async function handleGroupCallJoin(data) {
    if (!currentCall.groupId || currentCall.groupId !== data.groupId || data.userId == localStorage.getItem('userId')) {
        return;
    }

    console.log(`👥 ${data.sender_username} joined group call`);
    
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

    // Send offer to new participant if we're active
    if (currentCall.callState === 'active') {
        console.log(`🔄 Sending offer to new participant ${data.sender_username}`);
        try {
            const offer = await createWebRTCOffer(data.userId, data.sender_username, currentCall.isVideo, currentCall.groupId);
            sendWebSocketMessage({
                type: 'group-call-offer',
                groupId: currentCall.groupId,
                to: data.userId,
                userId: localStorage.getItem('userId'),
                sender_username: localStorage.getItem('username'),
                sdp: offer,
                isVideo: currentCall.isVideo
            });
            console.log(`✅ Offer sent to ${data.sender_username}`);
        } catch (error) {
            console.error(`❌ Error creating offer for ${data.userId}:`, error);
        }
    } else if (currentCall.callState === 'initiating') {
        // Initiator transitions to active when first participant joins
        updateCallState('active');
        
        // Send offer to joiner
        try {
            const offer = await createWebRTCOffer(data.userId, data.sender_username, currentCall.isVideo, currentCall.groupId);
            sendWebSocketMessage({
                type: 'group-call-offer',
                groupId: currentCall.groupId,
                to: data.userId,
                userId: localStorage.getItem('userId'),
                sender_username: localStorage.getItem('username'),
                sdp: offer,
                isVideo: currentCall.isVideo
            });
            console.log(`✅ Initiator offer sent to ${data.sender_username}`);
        } catch (error) {
            console.error(`❌ Error creating initiator offer for ${data.userId}:`, error);
        }
    }
}

export function handleICECandidate(data) {
    if (!data.userId || !data.candidate) {
        console.warn('Invalid ICE candidate received');
        return;
    }
    
    // For group calls, accept candidates from group participants
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
        console.log(`🧊 ICE candidate from ${data.userId}`);
        handleWebRTCCandidate(data.userId, data.candidate, data.groupId);
        return;
    }
    
    // For 1-on-1 calls, check 'to' field
    if (!data.groupId && data.to === localStorage.getItem('userId')) {
        console.log(`🧊 ICE candidate from ${data.userId} (1-on-1)`);
        handleWebRTCCandidate(data.userId, data.candidate, null);
    }
}

export function addRemoteStream(userId, stream, username, groupId, isVideo) {
    console.log(`🎥 Adding stream for ${username || userId} (isVideo: ${isVideo})`);
    
    // Debug stream tracks
    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();
    console.log(`📊 Stream analysis for ${username}:`);
    console.log(`   - Video tracks: ${videoTracks.length}`, videoTracks.map(t => ({enabled: t.enabled, readyState: t.readyState})));
    console.log(`   - Audio tracks: ${audioTracks.length}`, audioTracks.map(t => ({enabled: t.enabled, readyState: t.readyState})));
    console.log(`   - Actual isVideo determination: hasVideo=${videoTracks.length > 0}, originalIsVideo=${isVideo}`);

    const localUserId = localStorage.getItem('userId');
    const isLocalUser = userId === localUserId;

    if (isLocalUser) {
        console.log(`🚫 Skipping addRemoteStream for local user ${username}`);
        return;
    }

    if (!currentCall.participants[userId]) {
        currentCall.participants[userId] = {
            username: username || `User ${userId}`,
            stream: null,
            elementId: null,
            wrapperElementId: null
        };
    }

    if (currentCall.participants[userId].stream && !isLocalUser) {
        console.log(`Stream already exists for ${userId}`);
        return;
    }

    // For 1-on-1 calls, use 'peer' as groupId for consistent element IDs
    const callType = groupId || 'peer';
    const elementId = `${isLocalUser ? 'local' : 'remote'}-${userId}-${callType}`;
    const wrapperElementId = `wrapper-${elementId}`;

    let wrapper = document.getElementById(wrapperElementId);
    if (wrapper) {
        wrapper.innerHTML = '';
    } else {
        wrapper = document.createElement('div');
        wrapper.id = wrapperElementId;
        wrapper.classList.add('participant-wrapper');
        if (isLocalUser) wrapper.classList.add('local-participant');
        
        // Adjust wrapper size for 1-on-1 calls (larger) vs group calls (smaller grid)
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
            border: 2px solid ${isLocalUser ? '#3498db' : '#34495e'};
            ${isOneOnOne ? 'flex: 1;' : ''}
        `;

        if (remoteStreamsContainer) {
            remoteStreamsContainer.appendChild(wrapper);
        } else {
            console.error('❌ remoteStreamsContainer not found');
            return;
        }
    }

    // Create name overlay
    const nameOverlay = document.createElement('div');
    nameOverlay.classList.add('participant-name-overlay');
    nameOverlay.textContent = isLocalUser ? `${username} (You)` : username;
    nameOverlay.style.cssText = `
        position: absolute;
        bottom: 5px;
        left: 5px;
        background: ${isLocalUser ? 'rgba(52,152,219,0.9)' : 'rgba(0,0,0,0.7)'};
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
        mediaElement.muted = isLocalUser;
        mediaElement.classList.add(isLocalUser ? 'local-video' : 'remote-video');
        mediaElement.style.cssText = `
            width: 100%;
            height: 100%;
            object-fit: cover;
            background: #000;
            ${isLocalUser ? 'transform: scaleX(-1);' : ''}
        `;
        
        // Add event listeners for debugging video issues
        mediaElement.addEventListener('loadedmetadata', () => {
            console.log(`📺 Video metadata loaded for ${username}: ${mediaElement.videoWidth}x${mediaElement.videoHeight}`);
        });
        
        mediaElement.addEventListener('canplay', () => {
            console.log(`📺 Video can play for ${username}`);
        });
        
        mediaElement.addEventListener('error', (e) => {
            console.error(`📺 Video error for ${username}:`, e);
        });
        
    } else {
        mediaElement = document.createElement('audio');
        mediaElement.autoplay = true;
        mediaElement.muted = isLocalUser;
        mediaElement.classList.add(isLocalUser ? 'local-audio' : 'remote-audio');
        
        // Add event listeners for debugging audio issues
        mediaElement.addEventListener('loadedmetadata', () => {
            console.log(`🔊 Audio metadata loaded for ${username}`);
        });
        
        mediaElement.addEventListener('canplay', () => {
            console.log(`🔊 Audio can play for ${username}`);
        });
        
        mediaElement.addEventListener('error', (e) => {
            console.error(`🔊 Audio error for ${username}:`, e);
        });
        
        // Audio visual placeholder - different gradients for 1-on-1 vs group
        const audioPlaceholder = document.createElement('div');
        const isOneOnOne = !groupId;
        audioPlaceholder.style.cssText = `
            width: 100%;
            height: 100%;
            background: ${isLocalUser 
                ? (isOneOnOne ? 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)' : 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)')
                : (isOneOnOne ? 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)')
            };
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
                <div style="font-size: ${isOneOnOne ? '48px' : '24px'}; margin-bottom: 10px;">${isLocalUser ? '🎤' : '🎵'}</div>
                <div style="font-weight: bold; margin-bottom: 5px;">${isLocalUser ? `${username} (You)` : username}</div>
                <div style="font-size: ${isOneOnOne ? '12px' : '10px'}; opacity: 0.8;">
                    ${isLocalUser ? 'Speaking' : 'Audio'}
                    ${isOneOnOne ? ' • 1-on-1 Call' : ' • Group Call'}
                </div>
            </div>
        `;
        wrapper.appendChild(audioPlaceholder);
    }
    
    mediaElement.id = elementId;
    mediaElement.srcObject = stream;
    
    // Force video/audio to start playing
    mediaElement.play().catch(e => {
        console.warn(`▶️ Autoplay prevented for ${username}:`, e);
        // Try to play again after user interaction
        if (!isLocalUser) {
            document.addEventListener('click', () => {
                mediaElement.play().catch(console.error);
            }, { once: true });
        }
    });
    
    wrapper.appendChild(mediaElement);

    // Update participant record
    currentCall.participants[userId].stream = stream;
    currentCall.participants[userId].elementId = elementId;
    currentCall.participants[userId].wrapperElementId = wrapperElementId;

    // Add to active participants list
    if (!currentCall.activeParticipants.includes(userId)) {
        currentCall.activeParticipants.push(userId);
    }

    console.log(`✅ Stream UI created for ${username || userId} (${isLocalUser ? 'local' : 'remote'})`);
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

// Simplified handlers for other events
export function handleCallRejected(data) {
    console.log(`❌ Call rejected by ${data.sender_username}`);
    if (callStatus) callStatus.textContent = `Call rejected by ${data.sender_username}.`;
    setTimeout(() => updateCallState('idle'), 3000);
}

export function handleCallBusy(data) {
    console.log(`📞 ${data.sender_username} is busy`);
    if (callStatus) callStatus.textContent = `${data.sender_username} is busy.`;
    setTimeout(() => updateCallState('idle'), 3000);
}

export function handleGroupCallLeave(data) {
    if (!currentCall.groupId || currentCall.groupId !== data.groupId || data.userId == localStorage.getItem('userId')) {
        return;
    }

    console.log(`👋 ${data.sender_username} left group call`);
    
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
        console.log(`📞 Group call ended`);
        if (callStatus) callStatus.textContent = 'Group call ended.';
        closeAllWebRTCConnections(currentCall.groupId);
        updateCallState('idle');
    }
}

export function handleCallEnded(data) {
    if (!data.groupId && currentCall.peerId == data.userId) {
        console.log(`📞 Call ended by ${data.sender_username}`);
        if (callStatus) callStatus.textContent = `Call ended.`;
        updateCallState('idle');
    }
}

export function handleGroupCallBusy(data) {
    console.log(`📞 ${data.sender_username} is busy for group call`);
}

// Event Listeners
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

// Initialize call state
updateCallState('idle');

console.log('✅ Call handler initialized with streamlined group call support');