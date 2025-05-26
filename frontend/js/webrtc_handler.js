import { sendWebSocketMessage } from './websocket_client.js';
import { displayRemoteStream } from './call_handler.js';

let localStream;
let remoteStream;
let peerConnection;
let currentPartnerId = null;
let pendingCandidates = [];

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' } // Example STUN server
    ]
};

function createPeerConnection(partnerId) {
    currentPartnerId = partnerId;
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            sendWebSocketMessage({
                type: 'candidate', 
                to: currentPartnerId,
                candidate: event.candidate
            });
        }
    };

    peerConnection.ontrack = event => {
        console.log('Remote track received:', event.streams[0]);
        setRemoteStream(event.streams[0]);
        displayRemoteStream(event.streams[0]);
    };

    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    return peerConnection;
}

// Function to process pending candidates, call this after setRemoteDescription
async function processPendingCandidates() {
    if (peerConnection && peerConnection.remoteDescription && pendingCandidates.length > 0) {
        console.log(`Processing ${pendingCandidates.length} queued ICE candidates after remote description set.`);
        for (const candidate of pendingCandidates) {
            try {
                if (peerConnection.signalingState !== "closed") {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                    console.log('Queued ICE candidate added.');
                }
            } catch (e) {
                console.error("Error adding queued ICE candidate:", e);
            }
        }
        pendingCandidates = [];
    }
}

export async function createOffer(partnerId, isVideoCall) {
    if (!peerConnection || peerConnection.signalingState !== 'stable') {
        console.log('Creating new peer connection for offer.');
        createPeerConnection(partnerId);
    } else {
        currentPartnerId = partnerId;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => {
            const senders = peerConnection.getSenders().find(s => s.track === track);
            if (!senders) {
                peerConnection.addTrack(track, localStream);
            }
        });
    } else {
        console.error('Local stream not available when creating offer.');
        throw new Error('Local stream is required to create an offer.');
    }

    const offerOptions = {
        offerToReceiveAudio: true,
        offerToReceiveVideo: isVideoCall
    };

    try {
        const offer = await peerConnection.createOffer(offerOptions);
        await peerConnection.setLocalDescription(offer);
        console.log('Offer created:', offer);
        return offer;
    } catch (error) {
        console.error('Error creating offer:', error);
        throw error;
    }
}

export async function handleOfferAndCreateAnswer(partnerId, offer, isVideoCall) {
    if (!peerConnection) {
        console.log('Creating new peer connection for answer.');
        createPeerConnection(partnerId);
    } else {
        currentPartnerId = partnerId;
    }

    // Ensure local stream is added before setting remote description and creating answer
    if (localStream) {
        localStream.getTracks().forEach(track => {
            const senders = peerConnection.getSenders().find(s => s.track === track);
            if (!senders) {
                peerConnection.addTrack(track, localStream);
            }
        });
    } else {
        console.error('Local stream not available when creating answer.');
        throw new Error('Local stream is required to create an answer.');
    }

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        console.log('Remote description set from offer.');
        await processPendingCandidates(); // Process candidates after setting remote description
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        console.log('Answer created:', answer);
        return answer;
    } catch (error) {
        console.error('Error creating answer:', error);
        throw error;
    }
}

export async function handleAnswer(partnerId, answer) {
    if (!peerConnection) {
        console.error('PeerConnection not initialized for handling answer.');
        return;
    }
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('Remote description set for answer.');
        await processPendingCandidates(); // Process candidates after setting remote description
    } catch (error) {
        console.error('Error setting remote description for answer:', error);
    }
}

export async function handleCandidate(candidate) {
    if (!peerConnection) {
        console.log('PeerConnection not initialized. Queuing candidate.');
        pendingCandidates.push(candidate);
        return;
    }
    // Ensure remote description is set before adding candidate
    if (!peerConnection.remoteDescription) {
        console.log('Remote description not set. Queuing candidate.');
        pendingCandidates.push(candidate);
        return;
    }
    try {
        if (peerConnection.signalingState === "closed") {
            console.warn("Tried to add ICE candidate to a closed peer connection.");
            return;
        }
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('ICE candidate added.');
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
}

export function setLocalStream(stream) {
    localStream = stream;
    // If peerConnection exists and stream is new/updated, replace tracks
    if (peerConnection && localStream) {
        localStream.getTracks().forEach(track => {
            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === track.kind);
            if (sender) {
                sender.replaceTrack(track).catch(e => console.error('Error replacing track:', e));
            } else {
                // This case should ideally be handled when connection is first established
                // peerConnection.addTrack(track, localStream);
            }
        });
    }
}

export function getLocalStream() {
    return localStream;
}

export function setRemoteStream(stream) {
    remoteStream = stream;
    // The remote video element is updated by displayRemoteStream in call_handler.js via ontrack
}

export function getPeerConnection() {
    return peerConnection;
}

export function closeConnection() {
    if (peerConnection) {
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;

        // Stop all senders and receivers
        peerConnection.getSenders().forEach(sender => {
            if (sender.track) {
                sender.track.stop();
            }
        });
        peerConnection.getReceivers().forEach(receiver => {
            if (receiver.track) {
                receiver.track.stop();
            }
        });
        
        peerConnection.close();
        peerConnection = null;
        console.log('WebRTC PeerConnection closed.');
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
        remoteStream = null;
    }
    currentPartnerId = null;
    pendingCandidates = [];
}

console.log('WebRTC Handler Initialized');