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
    if (peerConnections[partnerId]) {
        closeConnection(partnerId, groupId);
    }

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[partnerId] = pc;
    pendingCandidatesPerConnection[partnerId] = [];
    pc.onicecandidate = event => {
        if (event.candidate) {
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
    pc.ontrack = event => {
        const stream = event.streams[0];
        
        if (!stream) {
            return;
        }
        
        // Enhanced stream validation
        const videoTracks = stream.getVideoTracks();
        const audioTracks = stream.getAudioTracks();
        const hasVideoTrack = videoTracks.length > 0;
        const actualIsVideo = isVideoCall && hasVideoTrack;
        
        setTimeout(() => {
            if (typeof window.addRemoteStreamSafe === 'function') {
                window.addRemoteStreamSafe(partnerId, stream, username, groupId, actualIsVideo);
            } else if (typeof window.addRemoteStream === 'function') {
                window.addRemoteStream(partnerId, stream, username, groupId, actualIsVideo);
            } else {
                import('./call_handler.js').then(module => {
                    if (module.addRemoteStream) {
                        module.addRemoteStream(partnerId, stream, username, groupId, actualIsVideo);
                    }
                }).catch(
                    console.error
                );
            }
        }, 100);
    };
    pc.oniceconnectionstatechange = () => {
    };

    pc.onconnectionstatechange = () => {
    };
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    } else {
    }

    return pc;
}

async function processPendingCandidates(partnerId) {
    const pc = peerConnections[partnerId];
    const candidates = pendingCandidatesPerConnection[partnerId];

    if (pc && pc.remoteDescription && candidates && candidates.length > 0) {
        for (const candidate of candidates) {
            try {
                if (pc.signalingState !== "closed") {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                }
            } catch (e) {
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
    pc.getSenders().forEach(sender => {
        pc.removeTrack(sender);
    });
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    if (pc.signalingState !== 'stable') {
        return null;
    }

    try {
        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: isVideoCall,
            iceRestart: false
        });

        let modifiedSdp = offer.sdp;
        modifiedSdp = modifiedSdp.replace(/a=setup:actpass/g, 'a=setup:actpass');

        const modifiedOffer = {
            type: offer.type,
            sdp: modifiedSdp
        };

        await pc.setLocalDescription(modifiedOffer);
        return modifiedOffer;
    } catch (error) {
        throw error;
    }
}


export async function handleOfferAndCreateAnswer(partnerId, offer, username, isVideoCall, groupId = null) {
    if (!offer || typeof offer !== 'object' || !offer.type || !offer.sdp) {
        throw new Error('Invalid offer received');
    }

    if (offer.type !== 'offer') {
        throw new Error(`Expected offer type but got ${offer.type}`);
    }

    let pc = peerConnections[partnerId];
    if (!pc || pc.signalingState === 'closed' || pc.signalingState === 'failed') {
        pc = createPeerConnection(partnerId, username, isVideoCall, groupId);
    }

    if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') {
        closeConnection(partnerId, groupId);
        pc = createPeerConnection(partnerId, username, isVideoCall, groupId);
    }

    if (!localStream) {
        throw new Error('Local stream is required to create an answer');
    }
    pc.getSenders().forEach(sender => {
        pc.removeTrack(sender);
    });
    localStream.getTracks().forEach(track => {
        try {
            pc.addTrack(track, localStream);
        } catch (e) {
        }
    });

    try {
        let modifiedSdp = offer.sdp;
        if (modifiedSdp.includes('a=setup:actpass')) {
            modifiedSdp = modifiedSdp.replace(/a=setup:actpass/g, 'a=setup:actpass');
        }

        const modifiedOffer = {
            type: offer.type,
            sdp: modifiedSdp
        };

        await pc.setRemoteDescription(new RTCSessionDescription(modifiedOffer));
        await processPendingCandidates(partnerId);

        const answer = await pc.createAnswer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: isVideoCall
        });
        let answerSdp = answer.sdp;
        answerSdp = answerSdp.replace(/a=setup:active/g, 'a=setup:passive');
        answerSdp = answerSdp.replace(/a=setup:actpass/g, 'a=setup:passive');

        const modifiedAnswer = {
            type: answer.type,
            sdp: answerSdp
        };

        await pc.setLocalDescription(modifiedAnswer);
        return modifiedAnswer;
    } catch (error) {
        throw error;
    }
}

export async function handleAnswer(partnerId, answer, groupId = null) {
    if (!answer || typeof answer !== 'object' || !answer.type || !answer.sdp) {
        return;
    }

    if (answer.type !== 'answer') {
        return;
    }

    const pc = peerConnections[partnerId];
    if (!pc) {
        return;
    }

    if (pc.signalingState !== 'have-local-offer') {
        return;
    }

    try {
        const dtlsSetup = answer.sdp.match(/a=setup:\w+/g) || [];
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await processPendingCandidates(partnerId);
    } catch (error) {
        if (error.message.includes('SSL role') || error.message.includes('DTLS')) {
        }
    }
}

export async function handleCandidate(partnerId, candidate, groupId = null) {
    const pc = peerConnections[partnerId];

    if (!pc) {
        if (!pendingCandidatesPerConnection[partnerId]) {
            pendingCandidatesPerConnection[partnerId] = [];
        }
        pendingCandidatesPerConnection[partnerId].push(candidate);
        return;
    }

    if (!pc.remoteDescription) {
        if (!pendingCandidatesPerConnection[partnerId]) {
            pendingCandidatesPerConnection[partnerId] = [];
        }
        pendingCandidatesPerConnection[partnerId].push(candidate);
        return;
    }

    try {
        if (pc.signalingState === "closed") {
            return;
        }
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
    }
}

export function setLocalStream(stream) {
    localStream = stream;

    if (localStream) {
        localStream.getTracks().forEach(track => {
        });
        Object.entries(peerConnections).forEach(([partnerId, pc]) => {
            if (pc && pc.signalingState !== 'closed') {
                localStream.getTracks().forEach(track => {
                    const sender = pc.getSenders().find(s => s.track && s.track.kind === track.kind);
                    if (sender) {
                        sender.replaceTrack(track).catch(e => console.error(`❌ Error replacing track for ${partnerId}:`, e));
                    } else {
                        try {
                            pc.addTrack(track, localStream);
                        } catch (e) {
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

export function getWebRTCConnection(partnerId, groupId = null) {
    return peerConnections[partnerId];
}

export function closeConnection(partnerId, groupId = null) {
    const pc = peerConnections[partnerId];
    if (pc) {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.oniceconnectionstatechange = null;
        pc.onconnectionstatechange = null;
        pc.getReceivers().forEach(receiver => {
            if (receiver.track) {
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

    }
}

export function closeAllConnections(groupId = null) {
    const connectionsToClose = Object.keys(peerConnections);
    connectionsToClose.forEach(partnerId => {
        closeConnection(partnerId, groupId);
    });
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
        });
        localStream = null;
    }
    Object.keys(pendingCandidatesPerConnection).forEach(partnerId => {
        delete pendingCandidatesPerConnection[partnerId];
    });
}

