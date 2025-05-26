const API_BASE_URL = 'https://localhost:8000';

const messagesDiv = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const searchResultsModal = document.getElementById('searchResultsModal');
const searchMessageModal = document.getElementById('searchMessageModal');
const chatListUl = document.getElementById('chatList');
const noChatsMessage = document.getElementById('noChatsMessage');
const activeChatPartnerName = document.getElementById('activeChatPartnerName');
const chatWelcomeScreen = document.getElementById('chat-welcome-screen');
const currentChatArea = document.querySelector('.current-chat-area');
const token = localStorage.getItem('accessToken');
const groupListUl = document.getElementById('groupList');
const noGroupsMessage = document.getElementById('noGroupsMessage');
const openCreateGroupModalButton = document.getElementById('openCreateGroupModalButton');
const createGroupModal = document.getElementById('createGroupModal');
const closeCreateGroupModalButton = document.getElementById('closeCreateGroupModalButton');
const createGroupForm = document.getElementById('createGroupForm');
const groupNameInput = document.getElementById('groupNameInput');
const groupSettingsPanel = document.querySelector('.groupSettingsPanel');
const groupSettingsName = document.getElementById('groupSettingsName');
const closeGroupSettingsButton = document.getElementById('closeGroupSettingsButton');
const updateGroupNameInput = document.getElementById('updateGroupNameInput');
const updateGroupNameButton = document.getElementById('updateGroupNameButton');
const groupMemberCount = document.getElementById('groupMemberCount');
const groupMemberListUl = document.getElementById('groupMemberList');
const addUserToGroupInput = document.getElementById('addUserToGroupInput');
const addUserToGroupButton = document.getElementById('addUserToGroupButton');
const addUserToGroupResults = document.getElementById('addUserToGroupResults');
const leaveGroupButton = document.getElementById('leaveGroupButton');
const deleteGroupButton = document.getElementById('deleteGroupButton');
const changeRoleModal = document.getElementById('changeRoleModal');
const closeChangeRoleModalButton = document.getElementById('closeChangeRoleModalButton');
const changeRoleUserNameSpan = document.getElementById('changeRoleUserName');
const newRoleSelect = document.getElementById('newRoleSelect');
const changeRoleUserIdInput = document.getElementById('changeRoleUserId');
const confirmChangeRoleButton = document.getElementById('confirmChangeRoleButton');

let currentUserRoleInGroup = 'member'; 
let currentActiveFriendId = null;
let currentActiveFriendUsername = null;
let currentActiveGroupId = null; 
let currentActiveGroupName = null; 
let currentChatType = null;

const logoutBtnOnChatPage = document.getElementById('logoutButton'); 
if (logoutBtnOnChatPage) {
    if (typeof showAuthForms === 'function') {
        logoutBtnOnChatPage.addEventListener('click', () => {
            showAuthForms(); 
        });
    } else {
        console.error('showAuthForms function for logout not found.');
    }
}

function showAuthForms() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('username');
    localStorage.removeItem('userId');

    if (typeof closeWebSocket === 'function') {
        closeWebSocket();
    }
    if (typeof closePeerConnection === 'function') {
        closePeerConnection();
    }
    if (window.location.pathname.includes('chat.html')) {
        window.location.href = 'index.html';
    }
}

export async function searchUsers(searchTerm) {
    if (!searchResultsModal || !searchMessageModal) {
        console.error('Search modal elements not found');
        return;
    }
    searchMessageModal.textContent = 'Searching...';
    searchResultsModal.innerHTML = '';
    if (!searchTerm.trim()) {
        searchMessageModal.textContent = 'Please enter a username to search.';
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/contacts/search?query=${encodeURIComponent(searchTerm)}`, { 
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json' 
            }
        });
        if (!response.ok) {
            let errorDetail = `Error searching users: ${response.statusText}`;
            try {
                const errorData = await response.json();
                errorDetail = errorData.detail || JSON.stringify(errorData);
            } catch (e) {
                // Keep the original statusText error if JSON parsing fails
            }
            throw new Error(errorDetail);
        }
        const users = await response.json();

        if (users.length === 0) {
            searchMessageModal.textContent = 'No users found or already in contacts.';
            return;
        }

        searchMessageModal.textContent = '';
        users.forEach(user => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.innerHTML = `<span>${user.username}</span> <button class="add-friend-btn" data-user-id="${user.id}" data-username="${user.username}">Add</button>`;
            searchResultsModal.appendChild(item);
        });
    } catch (error) {
        console.error('Failed to search users:', error);
        // Ensure error.message is displayed, which now should have more details
        searchMessageModal.textContent = error.message || 'Failed to search users. Please try again.';
    }
}

export async function addFriend(friendUsername, friendId) { // Added friendId for the API
    if (!searchMessageModal) {
        console.error('Search message modal element not found');
        return;
    }
    searchMessageModal.textContent = `Adding ${friendUsername}...`;
    try {
        const response = await fetch(`${API_BASE_URL}/contacts/add`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            },
            body: JSON.stringify({ friend_id: friendId })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: `Error adding friend: ${response.statusText}` }));
            throw new Error(errorData.detail || `Error adding friend: ${response.statusText}`);
        }
        const result = await response.json();

        searchMessageModal.textContent = `${friendUsername} added successfully!`;
        loadFriends(); 
        if (searchResultsModal) searchResultsModal.innerHTML = ''; // Clear results after adding
    } catch (error) {
        console.error('Failed to add friend:', error);
        searchMessageModal.textContent = error.message || `Failed to add ${friendUsername}. Please try again.`;
    }
}

export async function loadFriends() {
    if (!chatListUl || !noChatsMessage || !token) {
        console.error('Required elements or token not found for loading friends.');
        if (chatListUl) chatListUl.innerHTML = '<li>Error: Could not initialize friend list.</li>';
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/contacts/`,
        {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                localStorage.clear();
                window.location.href = '/index.html';
                return;
            }
            
            let errorDetail = `Failed to load friends: ${response.statusText}`;
            try {
                const errorData = await response.json();
                errorDetail = errorData.detail || JSON.stringify(errorData);
            } catch (e) {
                // Keep original error if JSON parsing fails
            }
            throw new Error(errorDetail);
        }

        const friends = await response.json();
        chatListUl.innerHTML = '';

        if (friends.length === 0) {
            noChatsMessage.style.display = 'block';
        } else {
            noChatsMessage.style.display = 'none';
            friends.forEach(friend => { 
                const li = document.createElement('li');
                li.classList.add('chat-item');
                li.dataset.userId = friend.id;
                li.dataset.username = friend.username;
                li.innerHTML = `
                    <div class="chat-item-wrapper">
                        <img src="assets/img/default_img.jpg" alt="Profile" class="chat-item-profile-pic">
                        <div class="chat-item-info">
                            <span class="chat-item-username">${friend.username}</span>
                            <!-- Optional: last message preview -->
                        </div>
                        <button class="delete-contact-btn" data-friend-id="${friend.id}" title="Delete ${friend.username}">&times;</button>
                    </div>
                `;
                
                li.addEventListener('click', (event) => {
                    if (event.target.classList.contains('delete-contact-btn')) {
                        if (confirm(`Are you sure you want to remove ${friend.username} from your contacts?`)) {
                            deleteFriend(friend.id, friend.username);
                        }
                    } else {
                        selectChat(friend.id, friend.username);
                    }
                });
                chatListUl.appendChild(li);
            });
        }
    } catch (error) {
        console.error('Failed to load friends:', error);
        chatListUl.innerHTML = `<li>${error.message || 'Failed to load contacts.'}</li>`;
        noChatsMessage.style.display = 'none';
    }
}



export function getActiveChatPartnerId() {
    return currentActiveFriendId;
}

export function getActiveChatPartnerUsername(){
    return currentActiveFriendUsername;
}


function openCreateGroupModal() {
    if (createGroupModal) {
        createGroupModal.style.display = 'block';
    }
}

function closeCreateGroupModal() {
    if (createGroupModal) {
        createGroupModal.style.display = 'none';
        if (groupNameInput) groupNameInput.value = ''; // Clear input
    }
}

async function handleCreateGroup(event) {
    event.preventDefault();
    if (!groupNameInput || !token) {
        console.error('Group name input or token not found.');
        showNotification('Could not create group. Missing required information.', 'error');
        return;
    }
    const groupName = groupNameInput.value.trim();
    if (!groupName) {
        showNotification('Please enter a group name.', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/groups/`, { 
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            },
            body: JSON.stringify({ name: groupName })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'Failed to create group.' }));
            throw new Error(errorData.detail || `Error: ${response.statusText}`);
        }

        const newGroup = await response.json();
        showNotification(`Group "${newGroup.name}" created successfully!`, 'success');
        closeCreateGroupModal();
        loadGroups();
    } catch (error) {
        console.error('Failed to create group:', error);
        showNotification(`Failed to create group: ${error.message}`, "error");
    }
}

export async function loadGroups() {
    if (!groupListUl || !noGroupsMessage || !token) {
        console.error('Required elements or token not found for loading groups.');
        if (groupListUl) groupListUl.innerHTML = '<li>Error: Could not initialize group list.</li>';
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/groups/`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                showAuthForms(); 
                return;
            }
            const errorData = await response.json().catch(() => ({ detail: 'Failed to load groups.' }));
            throw new Error(errorData.detail || `Error: ${response.statusText}`);
        }
        const groups = await response.json();
        groupListUl.innerHTML = '';

        if (groups.length === 0) {
            // if (noGroupsMessage) noGroupsMessage.style.display = 'block';
        } else {
            // if (noGroupsMessage) noGroupsMessage.style.display = 'none';
            groups.forEach(group => {
                const li = document.createElement('li');
                li.classList.add('chat-item');
                li.dataset.groupId = group.id;
                li.dataset.groupName = group.name;
                li.innerHTML = `
                    <div class="chat-item-wrapper">
                        <img src="assets/img/group-icon.jpg" alt="Group" class="chat-item-profile-pic"> <!-- Placeholder group icon -->
                        <div class="chat-item-info">
                            <span class="chat-item-username">${group.name}</span>
                        </div>
                        <!-- Add delete/leave group button later if needed -->
                    </div>
                `;
                li.addEventListener('click', () => selectChat(group.id, group.name, 'group'));
                groupListUl.appendChild(li);
            });
        }
    } catch (error) {
        console.error('Failed to load groups:', error);
        if (groupListUl) groupListUl.innerHTML = `<li>${error.message || 'Failed to load groups.'}</li>`;
        if (noGroupsMessage) noGroupsMessage.style.display = 'none';
    }
}


export async function selectChat(id, name, type = 'private') {
    currentChatType = type;
    if (chatWelcomeScreen) chatWelcomeScreen.style.display = 'none';
    if (currentChatArea) currentChatArea.classList.remove('hidden');
    if (groupSettingsPanel) groupSettingsPanel.classList.add('hidden');
    if (activeChatPartnerName) activeChatPartnerName.textContent = name;
    if (messagesDiv) messagesDiv.innerHTML = '';

    document.querySelectorAll('#chatList li, #groupList li').forEach(item => {
        item.classList.remove('active-chat');
    });
    const selector = type === 'private' ? `#chatList li[data-user-id="${id}"]` : `#groupList li[data-group-id="${id}"]`;
    const selectedLi = document.querySelector(selector);
    if (selectedLi) {
        selectedLi.classList.add('active-chat');
    }

    if (type === 'private') {
        currentActiveFriendId = id;
        currentActiveFriendUsername = name;
        currentActiveGroupId = null;
        currentActiveGroupName = null;
        await fetchMessageHistory(id);
        document.getElementById('audioCallButton').style.display = 'inline-block';
        document.getElementById('videoCallButton').style.display = 'inline-block';
    } else if (type === 'group') {
        currentActiveGroupId = id;
        currentActiveGroupName = name;
        currentActiveFriendId = null;
        currentActiveFriendUsername = null;
        await fetchGroupMessageHistory(id);
        document.getElementById('audioCallButton').style.display = 'none';
        document.getElementById('videoCallButton').style.display = 'none';

        activeChatPartnerName.style.cursor = 'pointer';
        activeChatPartnerName.removeEventListener('click', openGroupSettingsPanel);
        activeChatPartnerName.addEventListener('click', openGroupSettingsPanel);
    } else {
        console.error('Unknown chat type:', type);
        activeChatPartnerName.textContent = 'Select a chat';
        if (currentChatArea) currentChatArea.classList.add('hidden');
        if (chatWelcomeScreen) chatWelcomeScreen.style.display = 'block';
        return;
    }
    if (chatInput) chatInput.focus();
}


export async function fetchGroupMessageHistory(groupId) {
    if (!groupId || !token) {
        console.error('Group ID or token not found for fetching history.');
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/groups/${groupId}/messages`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'Failed to fetch group message history.' }));
            throw new Error(errorData.detail);
        }
        const messages = await response.json();
        if (messagesDiv) messagesDiv.innerHTML = '';
        messages.forEach(msg => displayMessage(msg, true, 'group'));
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } catch (error) {
        console.error('Error fetching group message history:', error);
        if (messagesDiv) messagesDiv.innerHTML = `<p class="error-message">Error loading messages: ${error.message}</p>`;
    }
}

export async function deleteFriend(friendId, friendUsername) {
    console.log(`Attempting to delete friend: ${friendUsername} (ID: ${friendId})`);
    try {
        
        const response = await fetch(`${API_BASE_URL}/contacts/${friendId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json' 
            }
        });

        if (!response.ok) {
            let errorDetail = `Error deleting friend: ${response.statusText}`;
            if (response.status !== 204) { // 204 No Content might not have a body
                try {
                    const errorData = await response.json();
                    errorDetail = errorData.detail || JSON.stringify(errorData);
                } catch (e) {
                    // Keep original statusText error if JSON parsing fails
                }
            }
            throw new Error(errorDetail);
        }
        showNotification(`${friendUsername} has been removed from your contacts.`, "success");
        loadFriends(); // Refresh the friend list

    } catch (error) {
        console.error('Failed to delete friend:', error);
        showNotification(`Failed to remove ${friendUsername}. Error: ${error.message}`, "error");
    }
}


export function displayMessage(message, isHistory = false, chatType = 'private') {
    if (!messagesDiv) return;

    const currentUserId = parseInt(localStorage.getItem('userId'));
    const isSelf = message.sender_id === currentUserId;

    let relevantToCurrentChat = false;
    if (chatType === 'private' && currentActiveFriendId) {
        relevantToCurrentChat = isHistory ||
                                (message.sender_id === currentActiveFriendId && message.receiver_id === currentUserId) ||
                                (message.sender_id === currentUserId && message.receiver_id === currentActiveFriendId);
    } else if (chatType === 'group' && currentActiveGroupId) {
        // For group messages, check if message.group_id matches currentActiveGroupId
        // This assumes your backend includes group_id in the message payload for group messages
        relevantToCurrentChat = isHistory || (message.group_id === currentActiveGroupId);
    }

    if (!relevantToCurrentChat && !isHistory) { // Allow history to always display for the selected chat
        console.log("Received message for a different chat or group:", message);
        // TODO: Add notification badge to the respective chat/group list item
        return;
    }

    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message');
    messageElement.classList.toggle('self', isSelf);
    messageElement.classList.toggle('other', !isSelf);

    let senderDisplayName = '';
    if (chatType === 'group' && !isSelf && (message.sender_username)) {
        senderDisplayName = `<strong class="message-sender">${message.sender_username}</strong> `;
    }

    messageElement.innerHTML = `
        ${senderDisplayName}
        <p class="message-content">${message.content}</p>
        <span class="message-timestamp">${new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</span>
    `;

    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

export async function fetchMessageHistory(friendId) {
    if (!friendId) return;
    if (!token) {
        console.error("No access token found.");
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/messages/${friendId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Failed to fetch message history:', errorData.detail);
            return;
        }

        const messages = await response.json();
        messagesDiv.innerHTML = '';

        messages.forEach(msg => displayMessage(msg, true, 'private'));
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

    } catch (error) {
        console.error('Error fetching message history:', error);
    }
}

export async function sendMessage() {
    const content = chatInput.value.trim();
    if (!content) {
        console.log("Cannot send empty message.");
        return;
    }
    if (!token) {
        console.error("No access token found for sending message.");
        return;
    }

    let messagePayload; 
    let endpoint;

    if (currentChatType === 'private' && currentActiveFriendId) {
        messagePayload = {
            receiver_id: currentActiveFriendId,
            content: content,
        };
        endpoint = `${API_BASE_URL}/messages/`;
    } else if (currentChatType === 'group' && currentActiveGroupId) {
        messagePayload = {
            content: content,
        };
        endpoint = `${API_BASE_URL}/groups/${currentActiveGroupId}/messages`;
    } else {
        console.log("No active chat (private or group) selected.");
        return;
    }

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(messagePayload),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'Failed to send message.' }));
            console.error('Failed to send message:', errorData.detail);
            return;
        }

        const sentMessage = await response.json();
        displayMessage(sentMessage, false, currentChatType);
        
        chatInput.value = '';
    } catch (error) {
        console.error('Error sending message:', error);
    }
}

async function openGroupSettingsPanel() {
    if (!currentActiveGroupId) return;
    console.log(`Opening group settings for group ID: ${currentActiveGroupId}`);
    if (currentChatArea) currentChatArea.classList.add('hidden');
    if (groupSettingsPanel) groupSettingsPanel.classList.remove('hidden');
    if (groupSettingsName) groupSettingsName.textContent = `${currentActiveGroupName} - Settings`;
    
    await loadGroupDetailsForSettings(currentActiveGroupId);
}

if (closeGroupSettingsButton) {
    closeGroupSettingsButton.addEventListener('click', () => {
        if (groupSettingsPanel) groupSettingsPanel.classList.add('hidden');
        if (currentChatArea) currentChatArea.classList.remove('hidden');
        if (currentActiveGroupId && currentActiveGroupName) {
            selectChat(currentActiveGroupId, currentActiveGroupName, 'group');
        }
    });
}

async function loadGroupDetailsForSettings(groupId) {
    try {
        // Fetch group details (includes members with roles)
        const response = await fetch(`${API_BASE_URL}/groups/${groupId}`, { // Assuming this endpoint returns GroupDetails with members
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error(`Failed to fetch group details: ${response.statusText}`);
        const groupDetails = await response.json();

        if (updateGroupNameInput) updateGroupNameInput.value = groupDetails.name;
        if (groupMemberCount) groupMemberCount.textContent = groupDetails.members.length;

        const currentUserId = parseInt(localStorage.getItem('userId'));
        currentUserRoleInGroup = 'member';

        if (groupMemberListUl) {
            groupMemberListUl.innerHTML = '';
            groupDetails.members.forEach(member => {
                if (member.user_id === currentUserId) {
                    currentUserRoleInGroup = member.role;
                }
                const li = document.createElement('li');
                const memberName = member.user ? member.user.username : `User ID: ${member.user_id}`;
                li.innerHTML = `
                    <span class="member-info">${memberName} (${member.role})</span>
                    <span class="member-actions">
                        ${currentUserRoleInGroup === 'admin' && member.user_id !== currentUserId ? 
                            `<button class="change-role-btn admin-only-group" data-user-id="${member.user_id}" data-username="${memberName}" data-current-role="${member.role}">Change Role</button> 
                             <button class="remove-member-btn admin-only-group" data-user-id="${member.user_id}" data-username="${memberName}">Remove</button>` : ''}
                        ${member.user_id === currentUserId && groupDetails.members.length > 1 && !(currentUserRoleInGroup === 'admin' && groupDetails.members.filter(m => m.role ==='admin').length === 1) ? 
                            '' : ''} 
                    </span>
                `;
                groupMemberListUl.appendChild(li);
            });
        }
        updateAdminOnlyElementsVisibility();
        document.querySelectorAll('.change-role-btn').forEach(button => {
            button.addEventListener('click', handleChangeRoleClick);
        });
        document.querySelectorAll('.remove-member-btn').forEach(button => {
            button.addEventListener('click', handleRemoveMemberClick);
        });

    } catch (error) {
        console.error('Error loading group details for settings:', error);
        if (groupMemberListUl) groupMemberListUl.innerHTML = '<li>Error loading members.</li>';
    }
}

function updateAdminOnlyElementsVisibility() {
    const isAdmin = currentUserRoleInGroup === 'admin';
    document.querySelectorAll('.admin-only-group').forEach(el => {
        if (isAdmin) {
            el.style.display = ''; // Or 'block', 'flex', etc., depending on original display type
        } else {
            el.style.display = 'none';
        }
    });
}

// Event handler for Update Group Name button
if (updateGroupNameButton) {
    updateGroupNameButton.addEventListener('click', async () => {
        const newName = updateGroupNameInput.value.trim();
        if (!newName || !currentActiveGroupId) return;
        if (currentUserRoleInGroup !== 'admin') {
            showNotification('Only admins can change the group name.', "error");
            return;
        }
        try {
            const response = await fetch(`${API_BASE_URL}/groups/${currentActiveGroupId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ name: newName })
            });
            if (!response.ok) throw new Error(`Failed to update group name: ${response.statusText}`);
            const updatedGroup = await response.json();
            currentActiveGroupName = updatedGroup.name;
            activeChatPartnerName.textContent = currentActiveGroupName;
            if (groupSettingsName) groupSettingsName.textContent = `${currentActiveGroupName} - Settings`;
            loadGroups(); 
            showNotification('Group name updated successfully!', 'success');
        } catch (error) {
            console.error('Error updating group name:', error);
            showNotification('Error updating group name.', 'error');
        }
    });
}

if (addUserToGroupButton) {
    addUserToGroupButton.addEventListener('click', async () => {
        const usernameToAdd = addUserToGroupInput.value.trim();
        if (!usernameToAdd || !currentActiveGroupId) return;
        if (currentUserRoleInGroup !== 'admin') {
            showNotification('Only admins can add members.', 'warning');
            return;
        }
        if (addUserToGroupResults) addUserToGroupResults.textContent = 'Searching and adding...';
        
        try {
            const searchResponse = await fetch(`${API_BASE_URL}/contacts/search?query=${encodeURIComponent(usernameToAdd)}`, { 
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
            });
            if (!searchResponse.ok) throw new Error('Failed to search for user.');
            const users = await searchResponse.json();
            if (users.length === 0) {
                if (addUserToGroupResults) addUserToGroupResults.textContent = `User '${usernameToAdd}' not found.`;
                return;
            }
            const userToAdd = users.find(u => u.username.toLowerCase() === usernameToAdd.toLowerCase());
            if (!userToAdd) {
                 if (addUserToGroupResults) addUserToGroupResults.textContent = `User '${usernameToAdd}' not found (exact match).`;
                return;
            }

            const response = await fetch(`${API_BASE_URL}/groups/${currentActiveGroupId}/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ user_id: userToAdd.id, role: 'member' }) // Default role 'member'
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Failed to add member.');
            }
            await response.json();
            if (addUserToGroupResults) addUserToGroupResults.textContent = `${usernameToAdd} added successfully.`;
            addUserToGroupInput.value = '';
            await loadGroupDetailsForSettings(currentActiveGroupId); // Refresh member list
        } catch (error) {
            console.error('Error adding member to group:', error);
            if (addUserToGroupResults) addUserToGroupResults.textContent = `Error: ${error.message}`;
        }
    });
}

function handleRemoveMemberClick(event) {
    const button = event.target;
    const userIdToRemove = button.dataset.userId;
    const usernameToRemove = button.dataset.username;

    if (!currentActiveGroupId || !userIdToRemove) return;
    if (currentUserRoleInGroup !== 'admin') {
        showNotification('Only admins can remove members.', 'warning');
        return;
    }
    if (!confirm(`Are you sure you want to remove ${usernameToRemove} from the group?`)) return;

    removeGroupMember(currentActiveGroupId, userIdToRemove, usernameToRemove);
}

async function removeGroupMember(groupId, userId, username) {
    try {
        const response = await fetch(`${API_BASE_URL}/groups/${groupId}/members/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Failed to remove member.');
        }
        showNotification(`${username} removed successfully.`, 'success');
        await loadGroupDetailsForSettings(groupId);
    } catch (error) {
        console.error('Error removing member:', error);
        showNotification(`Error: ${error.message}`, 'error');
    }
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    // Make it visible
    setTimeout(() => {
        notification.classList.add('visible');
    }, 10); 
    setTimeout(() => {
        notification.classList.remove('visible');
        setTimeout(() => {
            notification.remove();
        }, 500); 
    }, 3000);
}

function handleChangeRoleClick(event) {
    const button = event.target;
    const userId = button.dataset.userId;
    const username = button.dataset.username;
    const currentRole = button.dataset.currentRole;

    if (currentUserRoleInGroup !== 'admin') {
        showNotification('Only admins can change member roles.', 'warning');
        return;
    }
    if (changeRoleModal) {
        if (changeRoleUserNameSpan) changeRoleUserNameSpan.textContent = username;
        if (newRoleSelect) newRoleSelect.value = currentRole;
        if (changeRoleUserIdInput) changeRoleUserIdInput.value = userId;
        changeRoleModal.style.display = 'block';
    }
}


if (closeChangeRoleModalButton) {
    closeChangeRoleModalButton.addEventListener('click', () => {
        if (changeRoleModal) changeRoleModal.style.display = 'none';
    });
}
window.addEventListener('click', (event) => {
    if (event.target === changeRoleModal) {
        changeRoleModal.style.display = 'none';
    }
});


if (confirmChangeRoleButton) {
    confirmChangeRoleButton.addEventListener('click', async () => {
        const userIdToUpdate = changeRoleUserIdInput.value;
        const newRole = newRoleSelect.value;
        if (!currentActiveGroupId || !userIdToUpdate || !newRole) return;

        try {
            const response = await fetch(`${API_BASE_URL}/groups/${currentActiveGroupId}/members/${userIdToUpdate}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ role: newRole })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Failed to update role.');
            }
            await response.json();
            showNotification('Member role updated successfully.', 'success');
            if (changeRoleModal) changeRoleModal.style.display = 'none';
            await loadGroupDetailsForSettings(currentActiveGroupId);
        } catch (error) {
            console.error('Error updating member role:', error);
            showNotification(`Error: ${error.message}`, 'error');
        }
    });
}


if (leaveGroupButton) {
    leaveGroupButton.addEventListener('click', async () => {
        if (!currentActiveGroupId) return;
        if (!confirm('Are you sure you want to leave this group?')) return;

        const currentUserId = localStorage.getItem('userId');
        try {
            if (currentUserRoleInGroup === 'admin') {
                const groupDetailsResponse = await fetch(`${API_BASE_URL}/groups/${currentActiveGroupId}`, { 
                     headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!groupDetailsResponse.ok) throw new Error('Could not verify admin status before leaving.');
                const groupDetails = await groupDetailsResponse.json();
                const admins = groupDetails.members.filter(m => m.role === 'admin');
                if (admins.length === 1 && admins[0].user_id == currentUserId) {
                    showNotification('You are the only admin. Please make someone else an admin before leaving, or delete the group.', 'info');
                    return;
                }
            }

            const response = await fetch(`${API_BASE_URL}/groups/${currentActiveGroupId}/members/${currentUserId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Failed to leave group.');
            }
            showNotification('You have left the group.', 'info');
            // Reset view
            currentActiveGroupId = null;
            currentActiveGroupName = null;
            currentChatType = null;
            if (groupSettingsPanel) groupSettingsPanel.classList.add('hidden');
            if (currentChatArea) currentChatArea.classList.add('hidden');
            if (chatWelcomeScreen) chatWelcomeScreen.style.display = 'block';
            activeChatPartnerName.textContent = 'Select a chat';
            loadGroups();
        } catch (error) {
            console.error('Error leaving group:', error);
            showNotification(`Error: ${error.message}`, 'error');
        }
    });
}


if (deleteGroupButton) {
    deleteGroupButton.addEventListener('click', async () => {
        if (!currentActiveGroupId) return;
        if (currentUserRoleInGroup !== 'admin') {
            showNotification('Only admins can delete the group.', 'warning');
            return;
        }
        if (!confirm('Are you sure you want to PERMANENTLY DELETE this group? This action cannot be undone.')) return;

        try {
            const response = await fetch(`${API_BASE_URL}/groups/${currentActiveGroupId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Failed to delete group.');
            }
            showNotification('Group deleted successfully.', 'success');
            currentActiveGroupId = null;
            currentActiveGroupName = null;
            currentChatType = null;
            if (groupSettingsPanel) groupSettingsPanel.classList.add('hidden');
            if (currentChatArea) currentChatArea.classList.add('hidden');
            if (chatWelcomeScreen) chatWelcomeScreen.style.display = 'block';
            activeChatPartnerName.textContent = 'Select a chat';
            loadGroups(); // Refresh group list
        } catch (error) {
            console.error('Error deleting group:', error);
            showNotification(`Error: ${error.message}`, 'error');
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (openCreateGroupModalButton) {
        openCreateGroupModalButton.addEventListener('click', openCreateGroupModal);
    }
    if (closeCreateGroupModalButton) {
        closeCreateGroupModalButton.addEventListener('click', closeCreateGroupModal);
    }
    if (createGroupForm) {
        createGroupForm.addEventListener('submit', handleCreateGroup);
    }
    if (groupSettingsPanel) {
        groupSettingsPanel.classList.add('hidden');
    }

    loadFriends();
    loadGroups();
});