// studenthomepage.js

let countdownInterval = null;

// ==========================================
// AVATAR HELPER
// ==========================================
function getDynamicAvatar(student) {
    if (!student) return '/image/default_Male.svg';

    if (student.profile_picture && 
        student.profile_picture.trim() !== '' && 
        !student.profile_picture.includes('ui-avatars.com')) {
        return student.profile_picture;
    }

    const gender = String(student.gender || '').toLowerCase().trim();

    if (['perempuan', 'female', 'p', 'f'].includes(gender)) {
        return '/image/default_Female.svg';
    }

    return '/image/default_Male.svg';
}

// ==========================================
// EXPIRED MODAL CONTROLLERS
// ==========================================
function showExpiredModal() {
    const expiredModal = document.getElementById('expired-modal');
    if (expiredModal) {
        expiredModal.style.display = 'flex';
        expiredModal.classList.add('active');
    }
}

// Fallback logout handler
if (typeof window.executeLogout !== 'function') {
    window.executeLogout = function() {
        localStorage.removeItem('userData');
        sessionStorage.clear();
        window.location.href = '/login.html'; // Adjust to your login page route
    };
}

// ==========================================
// 1. INITIALIZATION & STATUS FETCH
// ==========================================
window.addEventListener('load', async () => {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const userId = userData.id || userData.user_id;

    // Fast initial preview for navbar avatar
    const headerAvatar = document.getElementById('navHeaderAvatar');
    if (headerAvatar && userData) {
        headerAvatar.src = getDynamicAvatar(userData);
    }

    if (!userId) {
        updateDashboardState('pending', null, null, false); 
        return;
    }

    await fetchStudentStatus(userId);
});

async function fetchStudentStatus(userId) {
    try {
        const response = await fetch(`/api/student/status?user_id=${encodeURIComponent(userId)}`);
        
        if (!response.ok) {
            throw new Error(`Server returned status: ${response.status}`);
        }

        const data = await response.json();

        if (data.user) {
            const currentStored = JSON.parse(localStorage.getItem('userData') || '{}');
            const mergedUser = {
                ...currentStored,
                ...data.user,
                status: data.status
            };

            localStorage.setItem('userData', JSON.stringify(mergedUser));
            
            // Re-render header avatar once DB returns gender
            const headerAvatar = document.getElementById('navHeaderAvatar');
            if (headerAvatar) {
                headerAvatar.src = getDynamicAvatar(mergedUser);
            }

            // Sync values to account modal if open or ready
            populateAccountModal(mergedUser);
        }

        // Trigger UI status transition and timer calculation
        updateDashboardState(
            data.status || 'pending', 
            data.roomDetails || null, 
            data.reason || null,
            true,
            data.user
        );

    } catch (err) {
        console.error('Failed to fetch status from server:', err);
        const localData = JSON.parse(localStorage.getItem('userData') || '{}');
        updateDashboardState(localData.status || 'pending', null, null, false, localData);
    }
}

// ==========================================
// 2. DASHBOARD RENDERER & TIMER
// ==========================================
function updateDashboardState(status, details = null, reason = null, allowExpirationCheck = true, user = null) {
    const mainContainer = document.getElementById('mainContainer');
    const deadlineBanner = document.getElementById('deadlineBanner');
    if (!mainContainer) return;

    const normalizedStatus = String(status || '').toLowerCase().trim();

    requestAnimationFrame(() => {
        mainContainer.classList.remove('status-pending', 'status-success', 'status-fail');

        updateStatusPills(normalizedStatus);

        if (['active', 'approved', 'success'].includes(normalizedStatus)) {
            // STOP COUNTDOWN & HIDE BANNER FOR APPROVED STATUS
            if (countdownInterval) clearInterval(countdownInterval);
            if (deadlineBanner) deadlineBanner.style.display = 'none';

            mainContainer.classList.add('status-success');
            
            setElementText('displayBlock', details && details.block ? `Block: ${details.block}` : 'Block: No Data');
            setElementText('displayRoom', details && details.room_number ? `Room: ${details.room_number}` : 'Room: No Data');
            setElementText('displayPasscode', details && details.passcode ? details.passcode : 'No Data');

        } else if (['returned', 'rejected', 'fail'].includes(normalizedStatus)) {
            // STOP COUNTDOWN & HIDE BANNER FOR REJECTED STATUS
            if (countdownInterval) clearInterval(countdownInterval);
            if (deadlineBanner) deadlineBanner.style.display = 'none';

            mainContainer.classList.add('status-fail');
            setElementText('failReason', `Reason: ${reason || 'No Data'}`);

        } else {
            // PENDING STATE: Show banner and start timer/check expiration
            mainContainer.classList.add('status-pending');
            
            if (allowExpirationCheck && user) {
                if (deadlineBanner) deadlineBanner.style.display = 'block';
                startCountdownTimer(user);
            } else if (deadlineBanner) {
                deadlineBanner.style.display = 'none';
            }
        }

        mainContainer.style.visibility = 'visible';
        mainContainer.style.opacity = '1';
    });
}

function startCountdownTimer(user) {
    if (countdownInterval) clearInterval(countdownInterval);

    let targetTime = null;

    // 1. Check calculated registration deadline from backend
    if (user && user.registration_deadline) {
        targetTime = new Date(user.registration_deadline.replace(' ', 'T')).getTime();
    }
    
    // 2. Fallback: Default to created_at + 24 hours
    if ((!targetTime || isNaN(targetTime)) && user && user.created_at) {
        const createdMs = new Date(user.created_at.replace(' ', 'T')).getTime();
        if (!isNaN(createdMs)) {
            targetTime = createdMs + (24 * 60 * 60 * 1000);
        }
    }

    // 3. Ultimate Fallback: 24 hours from right now
    if (!targetTime || isNaN(targetTime)) {
        targetTime = Date.now() + (24 * 60 * 60 * 1000);
    }

    function updateTimer() {
        const now = Date.now();
        const diff = targetTime - now;

        const countdownElement = document.getElementById('accountCountdown') 
            || document.querySelector('#deadlineBanner span') 
            || document.querySelector('#deadlineBanner');

        // IF EXPIRED
        if (diff <= 0) {
            if (countdownInterval) clearInterval(countdownInterval);
            
            if (countdownElement) {
                const timerSpan = document.getElementById('timerDisplay');
                if (timerSpan) {
                    timerSpan.innerText = "Expired";
                } else {
                    countdownElement.innerText = "Account Termination Countdown: Expired";
                }
            }

            // Trigger the modal display immediately
            showExpiredModal();
            return;
        }

        // IF NOT EXPIRED YET:
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        let formattedTime = '';
        if (days > 0) {
            formattedTime = `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
        } else {
            formattedTime = `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
        }

        const formattedText = `Account Termination Countdown: ${formattedTime}`;

        if (countdownElement) {
            const timerSpan = document.getElementById('timerDisplay');
            if (timerSpan) {
                timerSpan.innerText = formattedTime;
            } else {
                countdownElement.innerText = formattedText;
            }
        }
    }

    // Run check immediately on load
    updateTimer();
    
    // Continue interval if not expired
    if (targetTime - Date.now() > 0) {
        countdownInterval = setInterval(updateTimer, 1000);
    }
}

function updateStatusPills(status) {
    const pills = document.querySelectorAll('.status-indicator');
    pills.forEach(pill => {
        pill.classList.remove('active');
        const pillStatus = (pill.getAttribute('data-status') || '').toLowerCase().trim();

        if (status === 'pending' && pillStatus === 'pending') pill.classList.add('active');
        if (['approved', 'active', 'success'].includes(status) && pillStatus === 'approved') pill.classList.add('active');
        if (['returned', 'rejected', 'fail'].includes(status) && pillStatus === 'returned') pill.classList.add('active');
    });
}

function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

// ==========================================
// 3. ACCOUNT PROFILE MODAL CONTROLLERS
// ==========================================

function populateAccountModal(user) {
    if (!user) return;

    const usernameInput = document.getElementById('accUsername');
    const emailInput = document.getElementById('accEmail');
    const phoneInput = document.getElementById('accPhone');
    const profileAvatar = document.getElementById('profileAvatar');

    if (usernameInput) usernameInput.value = user.username || '';
    if (emailInput) emailInput.value = user.email || '';
    if (phoneInput) phoneInput.value = user.phone || '';

    if (profileAvatar) {
        profileAvatar.src = getDynamicAvatar(user);
    }
}

function openAccountModal() {
    const modal = document.getElementById('account-modal');
    if (!modal) return;

    const storedUser = JSON.parse(localStorage.getItem('userData') || '{}');
    populateAccountModal(storedUser);

    setEditState(false);

    modal.style.display = 'flex';
    modal.classList.add('active');
}

function closeAccountModal() {
    const modal = document.getElementById('account-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
}

function toggleAccountEditMode() {
    const usernameInput = document.getElementById('accUsername');
    const isCurrentlyDisabled = usernameInput ? usernameInput.disabled : true;
    
    setEditState(isCurrentlyDisabled);
}

function setEditState(enableEdit) {
    const fieldIds = ['accUsername', 'accEmail', 'accPhone'];
    fieldIds.forEach(id => {
        const input = document.getElementById(id);
        if (input) input.disabled = !enableEdit;
    });

    const editBtn = document.getElementById('editToggleBtn');
    const saveBtn = document.getElementById('saveAccountBtn');

    if (editBtn && saveBtn) {
        if (enableEdit) {
            editBtn.style.display = 'none';
            saveBtn.style.display = 'inline-flex';
        } else {
            editBtn.style.display = 'inline-flex';
            saveBtn.style.display = 'none';
        }
    }
}

async function handleAccountSave(e) {
    e.preventDefault();

    const storedUser = JSON.parse(localStorage.getItem('userData') || '{}');
    const userId = storedUser.id || storedUser.user_id;

    if (!userId) {
        alert('User session expired. Please log in again.');
        return;
    }

    const updatedUsername = document.getElementById('accUsername').value.trim();
    const updatedEmail = document.getElementById('accEmail').value.trim();
    const updatedPhone = document.getElementById('accPhone').value.trim();

    const payload = {
        user_id: userId,
        username: updatedUsername,
        email: updatedEmail,
        phone: updatedPhone
    };

    try {
        const response = await fetch('/api/student/update-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to update account.');
        }

        const mergedUser = { 
            ...storedUser, 
            username: updatedUsername, 
            email: updatedEmail, 
            phone: updatedPhone 
        };
        localStorage.setItem('userData', JSON.stringify(mergedUser));

        alert('Account details updated successfully!');
        
        setEditState(false);
        await fetchStudentStatus(userId);

    } catch (err) {
        console.error('Error updating account:', err);
        alert(`Error: ${err.message}`);
    }
}

function handleAvatarUpload(e) {
    alert('Avatar upload feature will be available once R2 bucket storage is connected.');
}

// ==========================================
// 4. EVENT LISTENERS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const navAvatar = document.getElementById('navHeaderAvatar');
    const accountNavBtn = document.getElementById('accountNavBtn');

    if (navAvatar) {
        navAvatar.addEventListener('click', (e) => {
            e.preventDefault();
            openAccountModal();
        });
    }

    if (accountNavBtn) {
        accountNavBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openAccountModal();
        });
    }
});