document.addEventListener('DOMContentLoaded', () => {
    initStudentDashboard();
});

let isAccountViewOpen = false;
let countdownInterval = null;

async function initStudentDashboard() {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');

    // 1. Set Welcome Name & Account Info safely
    const nameHeader = document.getElementById('welcomeUser');
    if (nameHeader) nameHeader.innerText = `Welcome, ${userData.full_name || userData.username || 'Student'}`;

    const sumName = document.getElementById('summaryName');
    const sumEmail = document.getElementById('summaryEmail');
    const sumPhone = document.getElementById('summaryPhone');

    if (sumName) sumName.innerText = userData.full_name || '--';
    if (sumEmail) sumEmail.innerText = userData.email || '--';
    if (sumPhone) sumPhone.innerText = userData.phone || '--';

    // 2. Fetch live status from D1 Database
    if (userData.id) {
        await fetchLiveStatus(userData.id);
    } else {
        updateDashboardState('none');
    }
}

async function fetchLiveStatus(userId) {
    try {
        const response = await fetch(`/api/student/status?user_id=${encodeURIComponent(userId)}`);
        if (response.ok) {
            const data = await response.json();
            console.log("D1 Live Status Data:", data); // Debug log to see response in F12 Console
            updateDashboardState(data.status, data.roomDetails, data.reason);
        } else {
            console.warn("Status fetch failed with status:", response.status);
            updateDashboardState('none');
        }
    } catch (err) {
        console.warn("Could not fetch status from database:", err);
        updateDashboardState('none');
    }
}

function updateDashboardState(status, details = null, reason = null) {
    const mainContainer = document.getElementById('mainContainer');
    const deadlineBanner = document.getElementById('deadlineBanner');
    if (!mainContainer) return;

    const userData = JSON.parse(localStorage.getItem('userData') || '{}');

    // Update Account Quick View Badge
    const summaryStatus = document.getElementById('summaryStatus');
    if (summaryStatus) summaryStatus.innerText = status ? String(status).toUpperCase() : 'NO APPLICATION';

    // Hide all view sections safely
    const views = document.querySelectorAll('.view-register, .view-success, .view-fail, .view-pending, .view-appealed');
    views.forEach(v => v.style.display = 'none');

    // Remove old status classes from main container
    mainContainer.classList.remove('status-none', 'status-pending', 'status-success', 'status-fail', 'status-appealed');

    const normalizedStatus = String(status || '').toLowerCase().trim();

    // Check if application is active/approved
    const isApproved = ['active', 'approved', 'success', 'lulus'].includes(normalizedStatus);

    // --- COUNTDOWN LOGIC ---
    if (isApproved) {
        if (countdownInterval) clearInterval(countdownInterval);
        if (deadlineBanner) deadlineBanner.style.display = 'none';
    } else {
        let deadlineStr = userData.registration_deadline;
        if (!deadlineStr && userData.created_at) {
            const createdDate = new Date(userData.created_at);
            const fallbackDeadline = new Date(createdDate.getTime() + (7 * 24 * 60 * 60 * 1000));
            deadlineStr = fallbackDeadline.toISOString();
        }
        if (deadlineStr) startRegistrationCountdown(deadlineStr);
    }

    // --- VIEW SWITCHING (SAFE DOM MANIPULATION) ---
    switch (normalizedStatus) {
        case 'pending':
            mainContainer.classList.add('status-pending');
            showView('.view-pending');
            break;

        case 'active':
        case 'approved':
        case 'success':
        case 'lulus':
            mainContainer.classList.add('status-success');
            showView('.view-success');
            if (details) {
                setElementText('displayBlock', details.block ? `Block ${details.block}` : 'Block --');
                setElementText('displayRoom', details.room_number ? `Room ${details.room_number}` : 'Room ---');
                setElementText('displayPasscode', details.passcode || '#----');
            }
            break;

        case 'returned':
        case 'rejected':
        case 'fail':
        case 'disapproved':
        case 'gagal':
            mainContainer.classList.add('status-fail');
            showView('.view-fail');
            if (reason) {
                setElementText('failReason', `Sebab: ${reason}`);
            }
            break;

        case 'appealed':
        case 'rayuan':
            mainContainer.classList.add('status-appealed');
            showView('.view-appealed');
            break;

        default:
            mainContainer.classList.add('status-none');
            showView('.view-register');
            break;
    }
}

// Helper function to safely show view
function showView(selector) {
    const el = document.querySelector(selector);
    if (el) el.style.display = 'block';
}

// Helper function to safely set innerText
function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

/* Modal and Navigation Handlers */
function openAppealModal() { 
    const modal = document.getElementById('appeal-modal');
    if (modal) modal.style.display = 'flex'; 
}

function closeAppealModal() { 
    const modal = document.getElementById('appeal-modal');
    if (modal) modal.style.display = 'none'; 
}

function openDeleteModal() { 
    const modal = document.getElementById('delete-modal');
    if (modal) modal.style.display = 'flex'; 
}

function closeDeleteModal() { 
    const modal = document.getElementById('delete-modal');
    if (modal) modal.style.display = 'none'; 
}

document.getElementById('appealForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const reasonEl = document.getElementById('appealReason');
    const reason = reasonEl ? reasonEl.value : '';

    try {
        const response = await fetch('/api/student/appeal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userData.id, appeal_reason: reason })
        });

        if (response.ok) {
            alert('Rayuan anda telah berjaya dihantar!');
            closeAppealModal();
            updateDashboardState('appealed');
        } else {
            alert('Gagal menghantar rayuan. Sila cuba lagi.');
        }
    } catch (err) {
        alert('Ralat pelayan. Sila cuba lagi kemudian.');
    }
});

async function confirmDeleteAccount() {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');

    try {
        const response = await fetch('/api/student/delete-account', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userData.id })
        });

        if (response.ok) {
            alert('Akaun anda telah dipadamkan.');
            localStorage.clear();
            window.location.replace('/log_in.html');
        } else {
            alert('Gagal memadam akaun.');
        }
    } catch (err) {
        alert('Ralat pelayan semasa memadam akaun.');
    }
}

function toggleAccountView() {
    const accountSection = document.getElementById('accountSection');
    if (!accountSection) return;
    isAccountViewOpen = !isAccountViewOpen;
    accountSection.style.display = isAccountViewOpen ? 'block' : 'none';
}

function startRegistrationCountdown(deadlineStr) {
    const deadline = new Date(deadlineStr).getTime();
    const banner = document.getElementById('deadlineBanner');
    const countdownEl = document.getElementById('registrationCountdown');

    if (!banner || !countdownEl || isNaN(deadline)) return;
    banner.style.display = 'flex';

    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        const now = new Date().getTime();
        const diff = deadline - now;

        if (diff <= 0) {
            clearInterval(countdownInterval);
            countdownEl.innerText = "EXPIRED";
            alert("Registration window expired.");
            localStorage.clear();
            window.location.replace('/log_in.html');
            return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const secs = Math.floor((diff % (1000 * 60)) / 1000);

        countdownEl.innerText = `${days}d ${hours}h ${mins}m ${secs}s`;
    }, 1000);
}