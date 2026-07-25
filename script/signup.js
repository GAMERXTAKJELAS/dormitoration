document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('registerForm') || document.querySelector('form');
    const messageDiv = document.getElementById('message');

    if (!registerForm) return;

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 1. Target inputs by placeholder/type to match your UI form fields reliably
        const fullNameInput = registerForm.querySelector('input[placeholder*="full name"]');
        const emailInput = registerForm.querySelector('input[type="email"]') || registerForm.querySelector('input[placeholder*="gmail"]');
        const phoneInput = registerForm.querySelector('input[placeholder*="0123456789"]');
        const passwordInputs = registerForm.querySelectorAll('input[type="password"]');

        const fullName = fullNameInput ? fullNameInput.value.trim() : '';
        const email = emailInput ? emailInput.value.trim() : '';
        const phone = phoneInput ? phoneInput.value.trim() : '';
        const password = passwordInputs[0] ? passwordInputs[0].value : '';
        const confirmPassword = passwordInputs[1] ? passwordInputs[1].value : '';

        // 2. Client-side password matching check
        if (password && confirmPassword && password !== confirmPassword) {
            if (messageDiv) {
                messageDiv.style.color = "#ff4d4d";
                messageDiv.innerText = "Passwords do not match!";
            }
            return;
        }

        // 3. Fallback username generation if no dedicated username field exists
        const generatedUsername = email ? email.split('@')[0] : (fullName ? fullName.toLowerCase().replace(/\s+/g, '_') : `user_${phone}`);

        if (messageDiv) {
            messageDiv.style.color = "#ffffff";
            messageDiv.innerText = "Creating account and logging in...";
        }

        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    username: generatedUsername,
                    full_name: fullName,
                    email: email,
                    phone: phone, 
                    password: password, 
                    role: 'student' 
                })
            });

            const data = await response.json();

            if (response.ok) {
                // Save complete session state into localStorage
                const userPayload = data.user || {
                    username: generatedUsername,
                    full_name: fullName,
                    email: email,
                    phone: phone,
                    role: 'student',
                    account_status: 'pending_details'
                };

                localStorage.setItem('isLoggedIn', 'true');
                localStorage.setItem('userRole', 'student');
                localStorage.setItem('userData', JSON.stringify(userPayload));

                if (messageDiv) {
                    messageDiv.style.color = "#4CAF50";
                    messageDiv.innerText = "Welcome! Redirecting to student home page...";
                }
                
                // Redirect immediately to the student homepage
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