let socket;
let currentUserId;
const WS_BASE_URL = 'wss://192.168.43.122:8000';
import { displayMessage } from "./chat_handler.js";
import { 
    handleIncomingCallOffer, 
    handleCallAnswer, 
    handleCallRejected,
    handleCallEnded,
    handleCallBusy,
    handleICECandidate,
    handleGroupCallJoin,
    handleGroupCallLeave,
    handleGroupCallEnded,
    handleGroupCallBusy,
    handleGroupCallStart
} from './call_handler.js';

export function initWebSocket(userId) {
    currentUserId = userId;
    if (!userId) {
        return;
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
return;
    }
    socket = new WebSocket(`${WS_BASE_URL}/ws/${userId}`);

    socket.onopen = () => {
const username = localStorage.getItem('username');
        socket.send(JSON.stringify({ 
            type: 'join', 
            userId: userId, 
            username: username
        }));
    };

    socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        const senderId = message.user_id;

        switch (message.type) {
            case 'chat_message':
                if (typeof displayMessage === 'function') {
                     displayMessage(message);
                } else {
}
                break;
            case 'group_message':
                if (typeof displayMessage === 'function') {
                     displayMessage(message, false, 'group');
                } else {
}
                break;
            case 'user_joined':
break;
            case 'user_left':
break;
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
            case 'group-call-start':
                handleGroupCallStart(message);
                break;
            case 'group-call-offer': 
                handleIncomingCallOffer(message);
                break;
            case 'group-call-answer':
                handleCallAnswer(message);
                break;
            case 'group-ice-candidate':
                handleICECandidate(message);
                break;
            case 'group-call-join':
                handleGroupCallJoin(message);
                break;
            case 'group-call-user-joined':
                handleGroupCallJoin(message);
                break;
            case 'group-call-leave':
                handleGroupCallLeave(message);
                break;
            case 'group-call-ended':
                handleGroupCallEnded(message);
                break;
            case 'group-call-busy':
                handleGroupCallBusy(message);
                break;
            case 'error':
alert(`Server error: ${message.detail}`);
                break;

            default:
}
    };

    socket.onclose = (event) => {
};

    socket.onerror = (error) => {
};
}

export function sendWebSocketMessage(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        if (!message.from_user_id && currentUserId) {
            message.from_user_id = currentUserId;
        }
        if (!message.sender_username) {
            const username = localStorage.getItem('username');
            if (username) message.sender_username = username;
        }
        socket.send(JSON.stringify(message));
    } else {
}
}

export function closeWebSocket() {
    if (socket) {
        socket.close();
    }
}