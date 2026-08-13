// studenthomepage.js

let countdownInterval = null;
let currentProfileImage = null;

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
// 1. INITIALIZATION
// ==========================================
window.addEventListener('load', async () => {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const userId = userData.id || userData.user_id;

    // Fast initial preview
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
            
            // Re-render header avatar once DB returns gender from hostel_applications
            const headerAvatar = document.getElementById('navHeaderAvatar');
            if (headerAvatar) {
                headerAvatar.src = getDynamicAvatar(mergedUser);
            }

            if (typeof populateAccountModal === 'function') {
                populateAccountModal(mergedUser);
            }
        }

        // Trigger UI status transition
        updateDashboardState(
            data.status || 'pending', 
            data.roomDetails || null, 
            data.reason || null,
            true 
        );

    } catch (err) {
        console.error('Failed to fetch status from server:', err);
        const localData = JSON.parse(localStorage.getItem('userData') || '{}');
        updateDashboardState(localData.status || 'pending', null, null, false);
    }
}

// ==========================================
// 2. DASHBOARD RENDERER
// ==========================================
function updateDashboardState(status, details = null, reason = null, allowExpirationCheck = true) {
    const mainContainer = document.getElementById('mainContainer');
    const deadlineBanner = document.getElementById('deadlineBanner');
    if (!mainContainer) return;

    const normalizedStatus = String(status || '').toLowerCase().trim();

    requestAnimationFrame(() => {
        mainContainer.classList.remove('status-pending', 'status-success', 'status-fail');

        updateStatusPills(normalizedStatus);

        if (['active', 'approved', 'success'].includes(normalizedStatus)) {
            // STOP COUNTDOWN
            if (countdownInterval) clearInterval(countdownInterval);
            if (deadlineBanner) deadlineBanner.style.display = 'none';

            mainContainer.classList.add('status-success');
            
            setElementText('displayBlock', details && details.block ? `Block: ${details.block}` : 'Block: No Data');
            setElementText('displayRoom', details && details.room_number ? `Room: ${details.room_number}` : 'Room: No Data');
            setElementText('displayPasscode', details && details.passcode ? details.passcode : 'No Data');

        } else if (['returned', 'rejected', 'fail'].includes(normalizedStatus)) {
            // STOP COUNTDOWN
            if (countdownInterval) clearInterval(countdownInterval);
            if (deadlineBanner) deadlineBanner.style.display = 'none';

            mainContainer.classList.add('status-fail');
            setElementText('failReason', `Reason: ${reason || 'No Data'}`);

        } else {
            // PENDING STATE
            mainContainer.classList.add('status-pending');
            if (!allowExpirationCheck && deadlineBanner) {
                deadlineBanner.style.display = 'none';
            }
        }

        mainContainer.style.visibility = 'visible';
        mainContainer.style.opacity = '1';
    });
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