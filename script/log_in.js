/**
 * script/log_in.js
 * Handles login form submission and authentication API calls
 */

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const messageDiv = document.getElementById('message');

    if (!loginForm) return;

    loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        const identifier = document.getElementById('identifier').value;
        const password = document.getElementById('password').value;

        messageDiv.style.color = "var(--text-color, #ffffff)";
        messageDiv.innerText = "Authenticating...";

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, password })
            });

            const data = await response.json();

            if (response.ok) {
                // Save session state to localStorage
                localStorage.setItem('isLoggedIn', 'true');
                localStorage.setItem('userRole', data.role);
                localStorage.setItem('userData', JSON.stringify(data.user));

                // Route user based on their assigned database role
                if (data.role === 'admin') {
                    window.location.replace('/admin.html');
                } else {
                    window.location.replace('/dashboard.html');
                }
            } else {
                messageDiv.style.color = "#ff4d4d";
                messageDiv.innerText = data.error || 'Login failed. Please check your credentials.';
            }
        } catch (err) {
            messageDiv.style.color = "#ff4d4d";
            messageDiv.innerText = "Server error. Please try again later.";
        }
    });
});