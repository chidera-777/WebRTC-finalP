const API_BASE_URL = 'https://localhost:8000';

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const showRegisterLink = document.getElementById('showRegister');
const showLoginLink = document.getElementById('showLogin');
const loginFormContainer = document.getElementById('login-form-container');
const registerFormContainer = document.getElementById('register-form-container');
const authFormsDiv = document.getElementById('auth-forms');
const loggedInUserSpan = document.getElementById('loggedInUser');
const logoutButton = document.getElementById('logoutButton');

// Toggle forms
showRegisterLink.addEventListener('click', (e) => {
    e.preventDefault();
    loginFormContainer.style.display = 'none';
    registerFormContainer.style.display = 'block';
});

showLoginLink.addEventListener('click', (e) => {
    e.preventDefault();
    registerFormContainer.style.display = 'none';
    loginFormContainer.style.display = 'block';
});

// Handle Registration
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('registerUsername').value;
        const password = document.getElementById('registerPassword').value;
        const email = document.getElementById('registerEmail').value;

        try {
            const response = await fetch(`${API_BASE_URL}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password, email: email || null }),
            });

            const data = await response.json();

            if (response.ok) {
                showNotification('Registration successful! Please login.', "success")
                registerForm.reset();
                showLoginLink.click(); // Switch to login form
            } else {
                showNotification(data.detail || 'Registration failed.', "error")
            }
        } catch (error) {
            console.error('Registration error:', error);
            showNotification("An error occurred. Please try again later.", "error")
        }
    });
}

// Handle Login
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;

        // FastAPI's OAuth2PasswordRequestForm expects form data, not JSON
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);

        try {
            const response = await fetch(`${API_BASE_URL}/auth/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData,
            });

            const data = await response.json();

            if (response.ok) {
                console.log(data);
                localStorage.setItem('accessToken', data.access_token);
                localStorage.setItem('username', username);
                localStorage.setItem('userId', data.user_id);
                showNotification("Login Successful", "success");
                window.location.href = 'chat.html'; 
            } else {
                showNotification(data.detail||'Login failed', "error");
            }
        } catch (error) {
            console.error('Login error:', error);
            showNotification('An error occurred. Please try again.', 'error');
        }
    });
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
        }, 3000); 
    }, 9000);
}

function showAuthForms() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('username');
    if (loginForm) loginForm.reset();
    if (registerForm) registerForm.reset();

    // Close WebSocket connection
    if (typeof closeWebSocket === 'function') {
        closeWebSocket();
    } else {
        console.error('closeWebSocket function not found.');
    }

    // Close any active WebRTC peer connection
    if (typeof closePeerConnection === 'function') {
        closePeerConnection();
    } else {
        console.error('closePeerConnection function not found. Make sure webrtc_handler.js is loaded.');
    }
    // Redirect to login page if not already there
    if (window.location.pathname.includes('chat.html')) {
        window.location.href = 'index.html';
    }
}


// Check if user is already logged in (e.g., on page load of index.html)
window.addEventListener('load', () => {
    const token = localStorage.getItem('accessToken');
    const username = localStorage.getItem('username');

    // If on index.html and already logged in, redirect to chat.html
    if (token && username && !window.location.pathname.includes('chat.html')) {
        console.log('User already logged in, redirecting to chat app.');
        window.location.href = 'chat.html';
    } 
    else if (!token && window.location.pathname.includes('chat.html')) {
        console.log('No active session on chat page, redirecting to login.');
        window.location.href = 'index.html';
    } 
    else if (!token && !window.location.pathname.includes('chat.html')) {
        console.log('No active session, showing auth forms on index.html.');
        if (authFormsDiv) authFormsDiv.style.display = 'block';
    }
});