import { sendWebSocketMessage } from './websocket_client.js';

let localStream;
const peerConnections = {};
const pendingCandidatesPerConnection = {};

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

function createPeerConnection(partnerId, username, isVideoCall, groupId = null) {
    console.log(`🔗 Creating peer connection for ${partnerId} (${username})`);
    
    if (peerConnections[partnerId]) {
        console.warn(`Peer connection for ${partnerId} already exists. Closing existing one.`);
        closeConnection(partnerId, groupId);
    }

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[partnerId] = pc;
    pendingCandidatesPerConnection[partnerId] = [];

    // ICE Candidate handler
    pc.onicecandidate = event => {
        if (event.candidate) {
            console.log(`🧊 ICE candidate generated for ${partnerId}`);
            sendWebSocketMessage({
                type: 'candidate',
                to: partnerId,
                userId: localStorage.getItem('userId'),
                sender_username: localStorage.getItem('username'),
                candidate: event.candidate,
                groupId: groupId
            });
        }
    };

    // Remote track handler
    pc.ontrack = event => {
        console.log(`🎵 Remote track received from ${partnerId}`);
        const stream = event.streams[0];
        
        stream.getTracks().forEach(track => {
            console.log(`Track: ${track.kind}, enabled: ${track.enabled}, state: ${track.readyState}`);
        });
        
        // Determine if this is a video call based on the stream tracks
        const hasVideoTrack = stream.getVideoTracks().length > 0;
        const actualIsVideo = isVideoCall || hasVideoTrack;
        
        console.log(`🔍 Stream analysis for ${partnerId}: hasVideoTrack=${hasVideoTrack}, originalIsVideo=${isVideoCall}, finalIsVideo=${actualIsVideo}`);
        
        // Call addRemoteStream directly from global scope
        setTimeout(() => {
            console.log(`🔄 Attempting to call addRemoteStream for ${partnerId}`);
            if (typeof window.addRemoteStream === 'function') {
                console.log(`✅ Using window.addRemoteStream for ${partnerId}`);
                window.addRemoteStream(partnerId, stream, username, groupId, actualIsVideo);
            } else {
                console.log(`🔄 Trying dynamic import for ${partnerId}`);
                // Fallback to dynamic import
                import('./call_handler.js').then(module => {
                    if (module.addRemoteStream) {
                        console.log(`✅ Using imported addRemoteStream for ${partnerId}`);
                        module.addRemoteStream(partnerId, stream, username, groupId, actualIsVideo);
                    } else {
                        console.error(`❌ addRemoteStream not found in module for ${partnerId}`);
                    }
                }).catch(err => {
                    console.error(`❌ Failed to import addRemoteStream for ${partnerId}:`, err);
                });
            }
        }, 100); // Small delay to ensure everything is ready
    };

    // Connection state monitoring
    pc.oniceconnectionstatechange = () => {
        console.log(`🔌 ICE connection state for ${partnerId}: ${pc.iceConnectionState}`);
    };

    pc.onconnectionstatechange = () => {
        console.log(`📡 Connection state for ${partnerId}: ${pc.connectionState}`);
    };

    // Add local stream tracks
    if (localStream) {
        console.log(`📤 Adding local stream tracks to peer connection for ${partnerId}`);
        localStream.getTracks().forEach(track => {
            console.log(`Adding ${track.kind} track to ${partnerId}`);
            pc.addTrack(track, localStream);
        });
    } else {
        console.warn(`⚠️ No local stream available when creating peer connection for ${partnerId}`);
    }

    return pc;
}

async function processPendingCandidates(partnerId) {
    const pc = peerConnections[partnerId];
    const candidates = pendingCandidatesPerConnection[partnerId];

    if (pc && pc.remoteDescription && candidates && candidates.length > 0) {
        console.log(`🔄 Processing ${candidates.length} queued ICE candidates for ${partnerId}`);
        for (const candidate of candidates) {
            try {
                if (pc.signalingState !== "closed") {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                    console.log(`✅ Queued ICE candidate added for ${partnerId}`);
                }
            } catch (e) {
                console.error(`❌ Error adding queued ICE candidate for ${partnerId}:`, e);
            }
        }
        pendingCandidatesPerConnection[partnerId] = []; 
    }
}

export async function createOffer(partnerId, username, isVideoCall, groupId = null) {
    let pc = peerConnections[partnerId];
    if (!pc || pc.signalingState === 'closed' || pc.signalingState === 'failed') {
        pc = createPeerConnection(partnerId, username, isVideoCall, groupId);
    }

    if (!localStream) {
        throw new Error('Local stream is required to create an offer');
    }

    // Add tracks only if not already added
    localStream.getTracks().forEach(track => {
        const existingSender = pc.getSenders().find(sender => sender.track === track);
        if (!existingSender) {
            pc.addTrack(track, localStream);
        }
    });

    // Prevent SDP m-line order mismatch
    if (pc.signalingState !== 'stable') {
        console.warn(`⚠️ Skipping offer creation for ${partnerId} — signalingState: ${pc.signalingState}`);
        return null;
    }

    try {
        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: isVideoCall
        });
        await pc.setLocalDescription(offer);
        return offer;
    } catch (error) {
        console.error(`❌ Error creating offer for ${partnerId}:`, error);
        throw error;
    }
}


export async function handleOfferAndCreateAnswer(partnerId, offer, username, isVideoCall, groupId = null) {
    // Validate offer
    if (!offer || typeof offer !== 'object' || !offer.type || !offer.sdp) {
        throw new Error('Invalid offer received');
    }
    
    if (offer.type !== 'offer') {
        throw new Error(`Expected offer type but got ${offer.type}`);
    }

    let pc = peerConnections[partnerId];
    if (!pc || pc.signalingState === 'closed' || pc.signalingState === 'failed') {
        console.log(`Creating new peer connection for answer to ${partnerId}`);
        pc = createPeerConnection(partnerId, username, isVideoCall, groupId);
    }

    if (!localStream) {
        throw new Error('Local stream is required to create an answer');
    }

    // Ensure all local tracks are added
    localStream.getTracks().forEach(track => {
        const senders = pc.getSenders();
        const existingSender = senders.find(s => s.track === track);
        if (!existingSender) {
            try {
                console.log(`📤 Adding ${track.kind} track for answer to ${partnerId}`);
                pc.addTrack(track, localStream);
            } catch (e) {
                console.error(`❌ Error adding track for answer to ${partnerId}:`, e);
            }
        }
    });

    try {
        console.log(`📥 Setting remote description from offer for ${partnerId}`);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        console.log(`✅ Remote description set for ${partnerId}`);
        
        await processPendingCandidates(partnerId);
        
        console.log(`🔄 Creating answer for ${partnerId}`);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`✅ Answer created for ${partnerId}`);
        return answer;
    } catch (error) {
        console.error(`❌ Error creating answer for ${partnerId}:`, error);
        throw error;
    }
}

export async function handleAnswer(partnerId, answer, groupId = null) {
    // Validate answer
    if (!answer || typeof answer !== 'object' || !answer.type || !answer.sdp) {
        console.error(`❌ Invalid answer from ${partnerId}:`, answer);
        return;
    }
    
    if (answer.type !== 'answer') {
        console.error(`❌ Expected answer type but got ${answer.type} from ${partnerId}`);
        return;
    }

    const pc = peerConnections[partnerId];
    if (!pc) {
        console.error(`❌ No peer connection found for ${partnerId}`);
        return;
    }
    
    if (pc.signalingState === 'closed') {
        console.warn(`⚠️ Cannot set remote answer for ${partnerId}, connection is closed`);
        return;
    }
    
    try {
        console.log(`📥 Setting remote description from answer for ${partnerId}`);
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log(`✅ Remote description set for answer from ${partnerId}`);
        await processPendingCandidates(partnerId);
    } catch (error) {
        console.error(`❌ Error setting remote description for answer from ${partnerId}:`, error);
    }
}

export async function handleCandidate(partnerId, candidate, groupId = null) {
    const pc = peerConnections[partnerId];
    
    if (!pc) {
        console.log(`🧊 No peer connection for ${partnerId}, queuing candidate`);
        if (!pendingCandidatesPerConnection[partnerId]) {
            pendingCandidatesPerConnection[partnerId] = [];
        }
        pendingCandidatesPerConnection[partnerId].push(candidate);
        return;
    }

    if (!pc.remoteDescription) {
        console.log(`🧊 No remote description for ${partnerId}, queuing candidate`);
        if (!pendingCandidatesPerConnection[partnerId]) {
            pendingCandidatesPerConnection[partnerId] = [];
        }
        pendingCandidatesPerConnection[partnerId].push(candidate);
        return;
    }
    
    try {
        if (pc.signalingState === "closed") {
            console.warn(`⚠️ Tried to add ICE candidate to closed connection for ${partnerId}`);
            return;
        }
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log(`✅ ICE candidate added for ${partnerId}`);
    } catch (error) {
        console.error(`❌ Error adding ICE candidate for ${partnerId}:`, error);
    }
}

export function setLocalStream(stream) {
    console.log('📤 Setting local stream:', stream ? 'Available' : 'Null');
    localStream = stream;
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log(`Local track: ${track.kind}, enabled: ${track.enabled}, state: ${track.readyState}`);
        });

        // Update existing peer connections with new stream
        Object.entries(peerConnections).forEach(([partnerId, pc]) => {
            if (pc && pc.signalingState !== 'closed') {
                console.log(`🔄 Updating peer connection ${partnerId} with new local stream`);
                localStream.getTracks().forEach(track => {
                    const sender = pc.getSenders().find(s => s.track && s.track.kind === track.kind);
                    if (sender) {
                        console.log(`🔄 Replacing ${track.kind} track for ${partnerId}`);
                        sender.replaceTrack(track).catch(e => console.error(`❌ Error replacing track for ${partnerId}:`, e));
                    } else {
                        console.log(`📤 Adding ${track.kind} track to existing connection ${partnerId}`);
                        try {
                            pc.addTrack(track, localStream);
                        } catch (e) {
                            console.error(`❌ Error adding track to existing connection ${partnerId}:`, e);
                        }
                    }
                });
            }
        });
    }
}

export function getLocalStream() {
    return localStream;
}

export function getPeerConnection(partnerId) {
    return peerConnections[partnerId];
}

export function closeConnection(partnerId, groupId = null) {
    const pc = peerConnections[partnerId];
    if (pc) {
        console.log(`🔌 Closing WebRTC connection for ${partnerId}`);
        
        // Clear event handlers
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.oniceconnectionstatechange = null;
        pc.onconnectionstatechange = null;

        // Stop receivers (remote tracks)
        pc.getReceivers().forEach(receiver => {
            if (receiver.track) {
                console.log(`🛑 Stopping receiver track for ${partnerId}: ${receiver.track.kind}`);
                receiver.track.stop();
            }
        });
        
        if (pc.signalingState !== 'closed') {
            pc.close();
        }
        
        delete peerConnections[partnerId];
        if (pendingCandidatesPerConnection[partnerId]) {
            delete pendingCandidatesPerConnection[partnerId];
        }
        
        console.log(`✅ WebRTC connection closed for ${partnerId}`);
    }
}

export function closeAllConnections(groupId = null) {
    console.log('🔌 Closing all WebRTC connections' + (groupId ? ` for group ${groupId}` : ''));
    
    const connectionsToClose = Object.keys(peerConnections);
    connectionsToClose.forEach(partnerId => {
        closeConnection(partnerId, groupId);
    });

    // Only stop local stream if ending all calls
    if (localStream) {
        console.log('🛑 Stopping local stream tracks');
        localStream.getTracks().forEach(track => {
            console.log(`🛑 Stopping local ${track.kind} track`);
            track.stop();
        });
        localStream = null;
    }
    Object.keys(pendingCandidatesPerConnection).forEach(partnerId => {
        delete pendingCandidatesPerConnection[partnerId];
    });
}

console.log('✅ WebRTC Handler initialized with streamlined connection management');