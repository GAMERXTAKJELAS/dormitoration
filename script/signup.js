document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('registerForm') || document.querySelector('form');
    const messageDiv = document.getElementById('message');

    if (!registerForm) return;

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 1. Target form input fields
        const fullNameInput = registerForm.querySelector('input[placeholder*="full name"]') || document.getElementById('regFullName');
        const emailInput = registerForm.querySelector('input[type="email"]') || document.getElementById('regEmail');
        const phoneInput = registerForm.querySelector('input[placeholder*="0123456789"]') || document.getElementById('regPhone');
        const matriksInput = document.getElementById('regMatriks');
        const icInput = document.getElementById('regIC');
        const passwordInputs = registerForm.querySelectorAll('input[type="password"]');

        const fullName = fullNameInput ? fullNameInput.value.trim() : '';
        const email = emailInput ? emailInput.value.trim() : '';
        const phone = phoneInput ? phoneInput.value.trim() : '';
        const matriks = matriksInput ? matriksInput.value.trim() : '';
        const rawIC = icInput ? icInput.value.trim() : '';
        const password = passwordInputs[0] ? passwordInputs[0].value : '';
        const confirmPassword = passwordInputs[1] ? passwordInputs[1].value : '';

        // 2. Client-side password validation
        if (passwordInputs.length > 1 && password !== confirmPassword) {
            if (messageDiv) {
                messageDiv.style.color = "#ff4d4d";
                messageDiv.innerText = "Passwords do not match!";
            }
            return;
        }

        // 3. Extract IC details (DOB, Age, Gender, State)
        const icData = parseMalaysianIC(rawIC);
        if (rawIC && !icData.valid) {
            if (messageDiv) {
                messageDiv.style.color = "#ff4d4d";
                messageDiv.innerText = "Sila masukkan No. IC yang sah (12 digit).";
            }
            return;
        }

        if (messageDiv) {
            messageDiv.style.color = "#ffffff";
            messageDiv.innerText = "Creating account and logging in...";
        }

        // 4. Payload sending username as NULL
        const payload = { 
            username: null, 
            ic_number: icData.valid ? icData.cleanIC : null,
            matriks_number: matriks || null,
            full_name: fullName || null,
            email: email || null,
            phone: phone, 
            password: password, 
            tarikh_lahir: icData.valid ? icData.tarikhLahir : null,
            umur: icData.valid ? icData.umur : null,
            jantina: icData.valid ? icData.jantina : null,
            negeri: icData.valid ? icData.negeri : null,
            role: 'student' 
        };

        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (response.ok) {
                // Save complete user payload into localStorage for subsequent forms
                const userPayload = data.user || {
                    ...payload,
                    account_status: 'pending_details'
                };

                localStorage.setItem('isLoggedIn', 'true');
                localStorage.setItem('userRole', 'student');
                localStorage.setItem('userData', JSON.stringify(userPayload));

                if (messageDiv) {
                    messageDiv.style.color = "#4CAF50";
                    messageDiv.innerText = "Welcome! Redirecting to student home page...";
                }
                
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
            console.warn("Server unavailable. Saving session locally:", err);

            // Local fallback session storage
            const fallbackPayload = {
                ...payload,
                id: 'temp_' + Date.now(),
                account_status: 'pending_details'
            };

            localStorage.setItem('isLoggedIn', 'true');
            localStorage.setItem('userRole', 'student');
            localStorage.setItem('userData', JSON.stringify(fallbackPayload));

            if (messageDiv) {
                messageDiv.style.color = "#4CAF50";
                messageDiv.innerText = "Offline mode active. Redirecting...";
            }

            setTimeout(() => {
                window.location.replace('/student/studenthomepage.html');
            }, 800);
        }
    });
});

/* =========================================================
   MALAYSIAN IC EXTRACTOR
   ========================================================= */
function parseMalaysianIC(icString) {
    if (!icString) return { valid: false };

    const cleanIC = icString.replace(/\D/g, '');
    if (cleanIC.length !== 12) return { valid: false };

    const yearDigits = parseInt(cleanIC.substring(0, 2), 10);
    const monthDigits = parseInt(cleanIC.substring(2, 4), 10);
    const dayDigits = parseInt(cleanIC.substring(4, 6), 10);
    const stateCode = cleanIC.substring(6, 8);
    const lastDigit = parseInt(cleanIC.substring(11, 12), 10);

    if (monthDigits < 1 || monthDigits > 12 || dayDigits < 1 || dayDigits > 31) {
        return { valid: false };
    }

    const currentTwoDigitYear = new Date().getFullYear() % 100;
    const fullYear = (yearDigits <= currentTwoDigitYear) ? (2000 + yearDigits) : (1900 + yearDigits);

    const monthStr = String(monthDigits).padStart(2, '0');
    const dayStr = String(dayDigits).padStart(2, '0');
    const tarikhLahir = `${fullYear}-${monthStr}-${dayStr}`;

    const dob = new Date(fullYear, monthDigits - 1, dayDigits);
    const today = new Date();
    let umur = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
        umur--;
    }

    const jantina = (lastDigit % 2 !== 0) ? 'Lelaki' : 'Perempuan';
    const negeri = getMalaysianState(stateCode);

    return { valid: true, cleanIC, tarikhLahir, umur, jantina, negeri };
}

function getMalaysianState(code) {
    const stateMap = {
        '01': 'Johor', '21': 'Johor', '22': 'Johor', '23': 'Johor', '24': 'Johor',
        '02': 'Kedah', '25': 'Kedah', '26': 'Kedah', '27': 'Kedah',
        '03': 'Kelantan', '28': 'Kelantan', '29': 'Kelantan',
        '04': 'Melaka', '30': 'Melaka',
        '05': 'Negeri Sembilan', '31': 'Negeri Sembilan',
        '06': 'Pahang', '32': 'Pahang', '33': 'Pahang',
        '07': 'Pulau Pinang', '34': 'Pulau Pinang', '35': 'Pulau Pinang',
        '08': 'Perak', '36': 'Perak', '37': 'Perak', '38': 'Perak', '39': 'Perak',
        '09': 'Perlis', '40': 'Perlis',
        '10': 'Selangor', '41': 'Selangor', '42': 'Selangor', '43': 'Selangor', '44': 'Selangor',
        '11': 'Terengganu', '45': 'Terengganu', '46': 'Terengganu',
        '12': 'Sabah', '47': 'Sabah', '48': 'Sabah', '49': 'Sabah',
        '13': 'Sarawak', '50': 'Sarawak', '51': 'Sarawak', '52': 'Sarawak', '53': 'Sarawak',
        '14': 'Wilayah Persekutuan Kuala Lumpur', '54': 'Wilayah Persekutuan Kuala Lumpur', '55': 'Wilayah Persekutuan Kuala Lumpur',
        '15': 'Wilayah Persekutuan Labuan', '56': 'Wilayah Persekutuan Labuan',
        '16': 'Wilayah Persekutuan Putrajaya', '57': 'Wilayah Persekutuan Putrajaya'
    };
    return stateMap[code] || 'Lain-lain';
}