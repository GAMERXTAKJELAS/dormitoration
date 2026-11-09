// studenthomepage.js

let countdownInterval = null;
let customAlertCallback = null;

// ==========================================
// CUSTOM ALERT MODAL HELPERS
// ==========================================
function showCustomAlert(message, type = 'success', onClose = null) {
    const modal = document.getElementById('custom-alert-modal');
    const iconContainer = document.getElementById('customAlertIcon');
    const messageElement = document.getElementById('customAlertMessage');
    const titleElement = document.getElementById('customAlertTitle');

    if (!modal) {
        alert(message);
        if (typeof onClose === 'function') onClose();
        return;
    }

    customAlertCallback = onClose;
    if (messageElement) messageElement.textContent = message;

    const config = {
        success: { title: 'Success', icon: 'bx-check-circle' },
        error: { title: 'Error', icon: 'bx-error-circle' },
        info: { title: 'Notification', icon: 'bx-info-circle' }
    }[type] || { title: 'Notification', icon: 'bx-info-circle' };
    const badgeType = ['success', 'error', 'info'].includes(type) ? type : 'info';

    if (titleElement) titleElement.textContent = config.title;
    if (iconContainer) {
        iconContainer.className = `alert-icon-badge ${badgeType}`;
        iconContainer.innerHTML = `<i class='bx ${config.icon}'></i>`;
    }

    modal.style.display = 'flex';
    modal.classList.add('active');
}

function closeCustomAlert() {
    const modal = document.getElementById('custom-alert-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }

    if (typeof customAlertCallback === 'function') {
        const callback = customAlertCallback;
        customAlertCallback = null;
        callback();
    }
}

// ==========================================
// AVATAR HELPER & R2 UPLOAD
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

async function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showCustomAlert('Please select a valid image file (PNG, JPG, WEBP).', 'error');
        return;
    }

    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const userId = userData.id || userData.user_id;

    if (!userId) {
        showCustomAlert('User session not found.', 'error');
        return;
    }

    try {
        // Compress image to 300x300 JPEG base64 before uploading to R2
        const base64Data = await resizeImageToBase64(file, 300, 300, 0.85);

        const response = await fetch('/api/student/upload-avatar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, profile_picture: base64Data })
        });

        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || 'Failed to upload profile picture.');
        }

        // Cache URL with cache-busting timestamp for immediate UI refresh
        const freshAvatarUrl = `${result.avatar_url}&t=${Date.now()}`;
        const updatedUser = { ...userData, profile_picture: freshAvatarUrl };
        localStorage.setItem('userData', JSON.stringify(updatedUser));

        const profileAvatar = document.getElementById('profileAvatar');
        const navHeaderAvatar = document.getElementById('navHeaderAvatar');

        if (profileAvatar) profileAvatar.src = freshAvatarUrl;
        if (navHeaderAvatar) navHeaderAvatar.src = freshAvatarUrl;

        showCustomAlert('Profile picture uploaded to R2 successfully!', 'success');
    } catch (err) {
        console.error('Avatar upload error:', err);
        showCustomAlert(`Error uploading avatar: ${err.message}`, 'error');
    } finally {
        e.target.value = '';
    }
}

function resizeImageToBase64(file, maxWidth, maxHeight, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}

// ==========================================
// MODAL CONTROLLERS
// ==========================================
function showExpiredModal() {
    const expiredModal = document.getElementById('expired-modal');
    if (expiredModal) {
        expiredModal.style.display = 'flex';
        expiredModal.classList.add('active');
    }
}

function openDeleteAccountModal() {
    const modal = document.getElementById('delete-account-modal');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
    }
}

function closeDeleteAccountModal() {
    const modal = document.getElementById('delete-account-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
}

async function executeDeleteAccount() {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const userId = userData.id || userData.user_id;

    if (!userId) {
        showCustomAlert('User session not found.', 'error');
        return;
    }

    try {
        const response = await fetch('/api/student/delete-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to delete account.');
        }

        closeDeleteAccountModal();

        showCustomAlert('Account deleted successfully.', 'success', () => {
            localStorage.removeItem('userData');
            sessionStorage.clear();
            window.location.href = '/log_in.html';
        });

    } catch (err) {
        console.error('Account deletion error:', err);
        showCustomAlert(`Error deleting account: ${err.message}`, 'error');
    }
}

if (typeof window.executeLogout !== 'function') {
    window.executeLogout = function() {
        localStorage.removeItem('userData');
        sessionStorage.clear();
        window.location.href = '/log_in.html';
    };
}

function updateNavAccountLabel(user) {
    const label = document.getElementById('navAccountLabel');
    if (!label) return;
    const username = user && user.username;
    label.textContent = (username && username !== 'N/A') ? username : 'Account';
}

// ==========================================
// 1. INITIALIZATION & STATUS FETCH
// ==========================================
window.addEventListener('load', async () => {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const userId = userData.id || userData.user_id;

    const headerAvatar = document.getElementById('navHeaderAvatar');
    if (headerAvatar && userData) {
        headerAvatar.src = getDynamicAvatar(userData);
    }
    updateNavAccountLabel(userData);

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
            
            const headerAvatar = document.getElementById('navHeaderAvatar');
            if (headerAvatar) {
                headerAvatar.src = getDynamicAvatar(mergedUser);
            }
            updateNavAccountLabel(mergedUser);

            populateAccountModal(mergedUser);
        }

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
// SMART ACCESS QR CODE
// ==========================================
let qrInstance = null;

async function renderAccessQR() {
    const qrBox = document.getElementById('qrBox');
    if (!qrBox) return;

    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const userId = userData.id || userData.user_id;
    if (!userId) return;

    try {
        const response = await fetch(`/api/student/qr-code?user_id=${encodeURIComponent(userId)}`);
        const data = await response.json();

        if (!data.code) {
            if (data.expired) {
                qrBox.innerHTML = `<i class='bx bx-error-circle'></i><p>Access code expired — contact admin to reissue</p>`;
            } else {
                qrBox.innerHTML = `<i class='bx bx-qr-scan'></i><p>QR not yet issued</p>`;
            }
            return;
        }

        if (typeof QRCodeStyling === 'undefined') {
            console.error('QR styling library failed to load.');
            return;
        }

        const dotStyles = ['rounded', 'dots', 'classy', 'classy-rounded', 'extra-rounded', 'square'];
        const cornerStyles = ['dot', 'square', 'extra-rounded'];
        const colorPairs = [
            ['#2f80ed', '#ffffff'], ['#27ae60', '#ffffff'], ['#eb5757', '#ffffff'],
            ['#9b51e0', '#ffffff'], ['#f2994a', '#ffffff'], ['#111111', '#ffffff']
        ];
        const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
        const [fgColor, bgColor] = pick(colorPairs);

        qrBox.innerHTML = `<div id="qrCodeCanvas"></div><p>Scan to Unlock</p>`;

        qrInstance = new QRCodeStyling({
            width: 160,
            height: 160,
            data: data.code,
            margin: 4,
            dotsOptions: { type: pick(dotStyles), color: fgColor },
            cornersSquareOptions: { type: pick(cornerStyles), color: fgColor },
            backgroundOptions: { color: bgColor }
        });

        qrInstance.append(document.getElementById('qrCodeCanvas'));

    } catch (err) {
        console.error('Failed to load access QR code:', err);
        qrBox.innerHTML = `<i class='bx bx-qr-scan'></i><p>Scan to Unlock</p>`;
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
            if (countdownInterval) clearInterval(countdownInterval);
            if (deadlineBanner) deadlineBanner.style.display = 'none';

            mainContainer.classList.add('status-success');
            
            setElementText('displayBlock', details && details.block ? `Block: ${details.block}` : 'Block: Assigned');
            setElementText('displayRoom', details && details.room_number ? `Room: ${details.room_number}` : 'Room: Assigned');
            setElementText('displayPasscode', details && details.passcode ? details.passcode : 'Active');

            renderAccessQR();

        } else if (['returned', 'rejected', 'fail'].includes(normalizedStatus)) {
            if (countdownInterval) clearInterval(countdownInterval);
            if (deadlineBanner) deadlineBanner.style.display = 'none';

            mainContainer.classList.add('status-fail');
            
            setElementText('failReason', `Reason: ${reason || 'Application needs review/resubmission.'}`);

        } else {
            mainContainer.classList.add('status-pending');
            
            if (allowExpirationCheck && user && user.registration_deadline) {
                if (deadlineBanner) deadlineBanner.style.display = 'block';
                startCountdownTimer(user);
            } else {
                if (countdownInterval) clearInterval(countdownInterval);
                if (deadlineBanner) deadlineBanner.style.display = 'none';
            }
        }

        mainContainer.style.visibility = 'visible';
        mainContainer.style.opacity = '1';
    });
}

function startCountdownTimer(user) {
    if (countdownInterval) clearInterval(countdownInterval);

    if (!user || user.registration_deadline === null) {
        const deadlineBanner = document.getElementById('deadlineBanner');
        if (deadlineBanner) deadlineBanner.style.display = 'none';
        return;
    }

    let targetTime = null;

    if (user.registration_deadline) {
        targetTime = new Date(user.registration_deadline.replace(' ', 'T')).getTime();
    }

    if (!targetTime || isNaN(targetTime)) {
        const deadlineBanner = document.getElementById('deadlineBanner');
        if (deadlineBanner) deadlineBanner.style.display = 'none';
        return;
    }

    function updateTimer() {
        const now = Date.now();
        const diff = targetTime - now;

        const countdownElement = document.getElementById('accountCountdown') 
            || document.querySelector('#deadlineBanner span') 
            || document.querySelector('#deadlineBanner');

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

            showExpiredModal();
            return;
        }

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

    updateTimer();
    
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
        showCustomAlert('User session expired. Please log in again.', 'error');
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

        showCustomAlert('Account details updated successfully!', 'success');
        
        setEditState(false);
        await fetchStudentStatus(userId);

    } catch (err) {
        console.error('Error updating account:', err);
        showCustomAlert(`Error: ${err.message}`, 'error');
    }
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