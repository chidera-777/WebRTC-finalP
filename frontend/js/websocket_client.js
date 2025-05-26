let socket;
let currentUserId;
const WS_BASE_URL = 'wss://localhost:8000';
import { displayMessage } from "./chat_handler.js";
import { 
    handleIncomingCallOffer, 
    handleCallAnswer, 
    handleCallRejected, 
    handleCallEnded, 
    handleCallBusy,
    handleICECandidate 
} from './call_handler.js';

export function initWebSocket(userId) {
    currentUserId = userId
    if (!userId) {
        return;
    }
    currentUserId = userId;

    if (socket && socket.readyState === WebSocket.OPEN) {
        console.log('WebSocket already connected.');
        return;
    }
    socket = new WebSocket(`${WS_BASE_URL}/ws/${userId}`);

    socket.onopen = () => {
        console.log('WebSocket connection established for user ID:', userId);
        const username = localStorage.getItem('username');
        socket.send(JSON.stringify({ 
            type: 'join', 
            userId: userId, 
            username: username
        }));
    };

    socket.onmessage = (event) => {
        console.log('WebSocket message received:', event.data);
        const message = JSON.parse(event.data);
        console.log('Parsed WebSocket message:', message);

        const fromUserId = message.from_user_id || message.from;

        switch (message.type) {
            case 'chat_message':
                if (typeof displayMessage === 'function') {
                     displayMessage(message);
                } else {
                    console.error('displayMessage function not found to handle private_message.');
                }
                break;
            case 'group_message':
                if (typeof displayMessage === 'function') {
                     displayMessage(message, false, 'group');
                } else {
                    console.error('displayMessage function not found to handle group_message.');
                }
                break;
            case 'user_joined':
                console.log('User joined:', message.username, '(ID:', message.user_id, ')');
                break;
            case 'user_left':
                console.log('User left:', message.username, '(ID:', message.user_id, ')');

                if (typeof targetUserId !== 'undefined' && targetUserId === message.user_id) { 
                    if (typeof closePeerConnection === 'function') closePeerConnection();
                }
                break;
            // WebRTC Signaling Messages for Calls
            case 'call_offer':
                handleIncomingCallOffer(message);
                break;
            case 'call_answer':
                handleCallAnswer(message);
                break;
            case 'candidate': 
                handleICECandidate(message);
                break;
            case 'call_rejected':
                handleCallRejected(message);
                break;
            case 'call_busy':
                handleCallBusy(message);
                break;
            case 'call_ended':
                handleCallEnded(message);
                break;
            case 'error':
                console.error('Server error message:', message.detail);
                break;

            default:
                console.log('Received unhandled message type:', message.type, message);
        }
    };

    socket.onclose = (event) => {
        console.log('WebSocket connection closed:', event);
        // Optionally, try to reconnect or notify the user
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

export function sendWebSocketMessage(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        if (!message.from_user_id && currentUserId) {
            message.from_user_id = currentUserId;
        }
        socket.send(JSON.stringify(message));
    } else {
        console.error('WebSocket is not connected.');
    }
}

export function closeWebSocket() {
    if (socket) {
        socket.close();
    }
}