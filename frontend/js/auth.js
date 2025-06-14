const API_BASE_URL = 'https://192.168.43.122:8000';

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const showRegisterLink = document.getElementById('showRegister');
const showLoginLink = document.getElementById('showLogin');
const loginFormContainer = document.getElementById('login-form-container');
const registerFormContainer = document.getElementById('register-form-container');
const authFormsDiv = document.getElementById('auth-forms');
const loggedInUserSpan = document.getElementById('loggedInUser');
const logoutButton = document.getElementById('logoutButton');

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
                showLoginLink.click();
            } else {
                showNotification(data.detail || 'Registration failed.', "error")
            }
        } catch (error) {
            showNotification("An error occurred. Please try again later.", "error")
        }
    });
}
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;
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
                localStorage.setItem('accessToken', data.access_token);
                localStorage.setItem('username', username);
                localStorage.setItem('userId', data.user_id);
                showNotification("Login Successful", "success");
                window.location.href = 'chat.html'; 
            } else {
                showNotification(data.detail||'Login failed', "error");
            }
        } catch (error) {
            showNotification('An error occurred. Please try again.', 'error');
        }
    });
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);
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


window.addEventListener('load', () => {
    const token = localStorage.getItem('accessToken');
    const username = localStorage.getItem('username');
    if (token && username && !window.location.pathname.includes('chat.html')) {
        window.location.href = 'chat.html';
    } 
    else if (!token && window.location.pathname.includes('chat.html')) {
        window.location.href = 'index.html';
    } 
    else if (!token && !window.location.pathname.includes('chat.html')) {
        if (authFormsDiv) authFormsDiv.style.display = 'block';
    }
});