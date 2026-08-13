// studenthomepage.js

let countdownInterval = null;
let currentProfileImage = null;

// ==========================================
// 1. INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Get stored user data (handles both 'id' or 'user_id' keys)
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const userId = userData.id || userData.user_id;

    if (!userId) {
        console.warn('No valid User ID found in localStorage.');
        // Show pending view without triggering instant expiration modal
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

        // Save fresh account status & info back into localStorage
        if (data.user) {
            const currentStored = JSON.parse(localStorage.getItem('userData') || '{}');
            localStorage.setItem('userData', JSON.stringify({
                ...currentStored,
                ...data.user,
                status: data.status // Ensure status is synced
            }));
            
            if (typeof populateAccountModal === 'function') {
                populateAccountModal(data.user);
            }
        }

        // Pass official status from server
        updateDashboardState(
            data.status || 'pending', 
            data.roomDetails || null, 
            data.reason || null,
            true // allow countdown trigger only if genuinely pending
        );

    } catch (err) {
        console.error('Failed to fetch status from server:', err);
        // Fallback safely without locking out user with fake expiration
        updateDashboardState('pending', null, null, false);
    }
}

// ==========================================
// 2. DASHBOARD RENDERER
// ==========================================
function updateDashboardState(status, details = null, reason = null, allowExpirationCheck = true) {
    const mainContainer = document.getElementById('mainContainer');
    const deadlineBanner = document.getElementById('deadlineBanner');
    if (!mainContainer) return;

    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const normalizedStatus = String(status || '').toLowerCase().trim();

    // Reset view classes
    mainContainer.classList.remove('status-pending', 'status-success', 'status-fail');

    // Update Status Indicator Pills
    updateStatusPills(normalizedStatus);

    // --- CASE A: ACTIVE / APPROVED / SUCCESS ---
    if (['active', 'approved', 'success'].includes(normalizedStatus)) {
        // 1. Clear any running countdowns and hide banner
        if (countdownInterval) clearInterval(countdownInterval);
        if (deadlineBanner) deadlineBanner.style.display = 'none';

        // 2. Hide Expired Modal if it was accidentally shown
        const expiredModal = document.getElementById('expired-modal');
        if (expiredModal) expiredModal.style.display = 'none';

        mainContainer.classList.add('status-success');
        
        setElementText('displayBlock', details && details.block ? `Block: ${details.block}` : 'Block: No Data');
        setElementText('displayRoom', details && details.room_number ? `Room: ${details.room_number}` : 'Room: No Data');
        setElementText('displayPasscode', details && details.passcode ? details.passcode : 'No Data');

    // --- CASE B: RETURNED / REJECTED ---
    } else if (['returned', 'rejected', 'fail'].includes(normalizedStatus)) {
        if (countdownInterval) clearInterval(countdownInterval);
        if (deadlineBanner) deadlineBanner.style.display = 'none';

        mainContainer.classList.add('status-fail');
        setElementText('failReason', `Reason: ${reason || 'No Data'}`);

    // --- CASE C: PENDING (Only state where countdown applies) ---
    } else {
        mainContainer.classList.add('status-pending');

        if (allowExpirationCheck) {
            if (deadlineBanner) deadlineBanner.style.display = 'flex';

            let deadlineStr = userData.registration_deadline;
            if (!deadlineStr && userData.created_at) {
                const createdDate = new Date(userData.created_at);
                const fallbackDeadline = new Date(createdDate.getTime() + (7 * 24 * 60 * 60 * 1000));
                deadlineStr = fallbackDeadline.toISOString();
            }
            if (deadlineStr) startRegistrationCountdown(deadlineStr);
        } else {
            if (deadlineBanner) deadlineBanner.style.display = 'none';
        }
    }

    mainContainer.style.visibility = 'visible';
    mainContainer.style.opacity = '1';
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

function startRegistrationCountdown(deadlineIsoString) {
    if (countdownInterval) clearInterval(countdownInterval);

    const targetTime = new Date(deadlineIsoString).getTime();
    const timerElement = document.getElementById('registrationCountdown');

    function updateTimer() {
        const now = new Date().getTime();
        const difference = targetTime - now;

        if (difference <= 0) {
            if (countdownInterval) clearInterval(countdownInterval);
            if (timerElement) timerElement.innerText = "00d 00h 00m 00s (Expired)";
            
            // Only show modal if the account is actually still pending
            const userData = JSON.parse(localStorage.getItem('userData') || '{}');
            if (userData.status === 'pending' || !userData.status) {
                showExpiredModal();
            }
            return;
        }

        const days = Math.floor(difference / (1000 * 60 * 60 * 24));
        const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((difference % (1000 * 60)) / 1000);

        if (timerElement) {
            timerElement.innerText = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        }
    }

    updateTimer();
    countdownInterval = setInterval(updateTimer, 1000);
}



// ==========================================
// 3. ACCOUNT MODAL HANDLERS
// ==========================================
function openAccountModal() {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    populateAccountModal(userData);
    document.getElementById('account-modal').style.display = 'flex';
}

function closeAccountModal() {
    document.getElementById('account-modal').style.display = 'none';
    disableAccountEditMode();
}

function populateAccountModal(user) {
    document.getElementById('accUsername').value = user.username || '';
    document.getElementById('accEmail').value = user.email || '';
    document.getElementById('accPhone').value = user.phone || '';

    const avatarSrc = user.profile_picture || '/image/default_avatar.png';
    
    // Update both modal avatar and nav header avatar
    const modalAvatar = document.getElementById('profileAvatar');
    const headerAvatar = document.getElementById('navHeaderAvatar');

    if (modalAvatar) modalAvatar.src = avatarSrc;
    if (headerAvatar) headerAvatar.src = avatarSrc;
}

function toggleAccountEditMode() {
    const inputs = document.querySelectorAll('#accountForm .form-input');
    const editBtn = document.getElementById('editToggleBtn');
    const saveBtn = document.getElementById('saveAccountBtn');

    inputs.forEach(input => input.disabled = false);
    editBtn.style.display = 'none';
    saveBtn.style.display = 'inline-flex';
}

function disableAccountEditMode() {
    const inputs = document.querySelectorAll('#accountForm .form-input');
    const editBtn = document.getElementById('editToggleBtn');
    const saveBtn = document.getElementById('saveAccountBtn');

    inputs.forEach(input => input.disabled = true);
    editBtn.style.display = 'inline-flex';
    saveBtn.style.display = 'none';
}

function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        currentProfileImage = e.target.result;
        
        // Update previews immediately
        const modalAvatar = document.getElementById('profileAvatar');
        const headerAvatar = document.getElementById('navHeaderAvatar');
        if (modalAvatar) modalAvatar.src = currentProfileImage;
        if (headerAvatar) headerAvatar.src = currentProfileImage;
    };
    reader.readAsDataURL(file);
}

async function handleAccountSave(event) {
    event.preventDefault();

    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const userId = userData.id || userData.user_id;

    const updatedData = {
        user_id: userId,
        username: document.getElementById('accUsername').value,
        email: document.getElementById('accEmail').value,
        phone: document.getElementById('accPhone').value,
        profile_picture: currentProfileImage || userData.profile_picture || null
    };

    try {
        const response = await fetch('/api/student/update-profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
        });

        if (!response.ok) throw new Error('Failed to update profile');

        // Update local storage
        localStorage.setItem('userData', JSON.stringify({ ...userData, ...updatedData }));
        disableAccountEditMode();
        alert('Profile updated successfully!');
    } catch (err) {
        console.error('Error saving account profile:', err);
        alert('Failed to save changes. Please try again.');
    }
}

function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}