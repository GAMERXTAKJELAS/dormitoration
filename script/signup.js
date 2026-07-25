document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('registerForm');
    const messageDiv = document.getElementById('message');

    if (!registerForm) return;

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('username')?.value.trim();
        const phone = document.getElementById('phone')?.value.trim();
        const password = document.getElementById('password')?.value;

        if (messageDiv) {
            messageDiv.style.color = "#ffffff";
            messageDiv.innerText = "Creating account and logging in...";
        }

        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    username, 
                    phone, 
                    password, 
                    role: 'student' 
                })
            });

            const data = await response.json();

            if (response.ok) {
                // Set session state in localStorage for session guard compliance
                localStorage.setItem('isLoggedIn', 'true');
                localStorage.setItem('userRole', data.user.role || 'student');
                localStorage.setItem('userData', JSON.stringify(data.user));

                if (messageDiv) {
                    messageDiv.style.color = "#4CAF50";
                    messageDiv.innerText = "Welcome! Redirecting to student dashboard...";
                }
                
                // Direct redirect to student dashboard
                setTimeout(() => {
                    window.location.replace('/student/studenthomepage.html');
                }, 800);

            } else {
                if (messageDiv) {
                    messageDiv.style.color = "#ff4d4d";
                    messageDiv.innerText = data.details || data.error || 'Registration failed.';
                }
            }
        } catch (err) {
            if (messageDiv) {
                messageDiv.style.color = "#ff4d4d";
                messageDiv.innerText = "Server error. Could not complete registration.";
            }
            console.error("Registration Error:", err);
        }
    });
});