// studenthomepage.js

let countdownInterval = null;
let currentProfileImage = null;

// ==========================================
// 1. INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const userId = userData.id || userData.user_id;

    if (!userId) {
        console.warn('No User ID found in localStorage.');
        updateDashboardState('pending');
        return;
    }

    await fetchStudentStatus(userId);
});

async function fetchStudentStatus(userId) {
    try {
        const response = await fetch(`/api/student/status?user_id=${encodeURIComponent(userId)}`);
        
        if (!response.ok) {
            throw new Error(`Server status: ${response.status}`);
        }

        const data = await response.json();

        // Save fresh user details in localStorage
        if (data.user) {
            localStorage.setItem('userData', JSON.stringify({
                ...JSON.parse(localStorage.getItem('userData') || '{}'),
                ...data.user
            }));
            populateAccountModal(data.user);
        }

        updateDashboardState(
            data.status || 'pending', 
            data.roomDetails || null, 
            data.reason || null
        );

    } catch (err) {
        console.error('Failed to load status:', err);
        updateDashboardState('pending');
    }
}

// ==========================================
// 2. DASHBOARD RENDERER
// ==========================================
function updateDashboardState(status, details = null, reason = null) {
    const mainContainer = document.getElementById('mainContainer');
    const deadlineBanner = document.getElementById('deadlineBanner');
    if (!mainContainer) return;

    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const normalizedStatus = String(status || '').toLowerCase().trim();

    // Reset container classes
    mainContainer.classList.remove('status-pending', 'status-success', 'status-fail');

    // Update Pills
    updateStatusPills(normalizedStatus);

    // Countdown handling for pending status
    if (normalizedStatus === 'pending') {
        mainContainer.classList.add('status-pending');
        if (deadlineBanner) deadlineBanner.style.display = 'flex';

        let deadlineStr = userData.registration_deadline;
        if (!deadlineStr && userData.created_at) {
            const createdDate = new Date(userData.created_at);
            const fallbackDeadline = new Date(createdDate.getTime() + (7 * 24 * 60 * 60 * 1000));
            deadlineStr = fallbackDeadline.toISOString();
        }
        if (deadlineStr) startRegistrationCountdown(deadlineStr);

    } else {
        if (countdownInterval) clearInterval(countdownInterval);
        if (deadlineBanner) deadlineBanner.style.display = 'none';

        if (['active', 'approved', 'success'].includes(normalizedStatus)) {
            mainContainer.classList.add('status-success');
            
            setElementText('displayBlock', details && details.block ? `Block: ${details.block}` : 'Block: No Data');
            setElementText('displayRoom', details && details.room_number ? `Room: ${details.room_number}` : 'Room: No Data');
            setElementText('displayPasscode', details && details.passcode ? details.passcode : 'No Data');

        } else if (['returned', 'rejected', 'fail'].includes(normalizedStatus)) {
            mainContainer.classList.add('status-fail');
            setElementText('failReason', `Reason: ${reason || 'No Data'}`);
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
// studenthomepage.js - Updated Section

function showExpiredModal() {
    const expiredModal = document.getElementById('expired-modal');
    if (expiredModal) {
        expiredModal.style.display = 'flex';
        // Prevent clicking backdrop/esc key from closing it by keeping it forced open
    }
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
            
            // Trigger the expired modal
            showExpiredModal();
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