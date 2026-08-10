document.addEventListener('DOMContentLoaded', () => {
    initStudentDashboard();
});

let isAccountViewOpen = false;
let countdownInterval = null;

async function initStudentDashboard() {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');

    // 1. Set Welcome Name & Account Info
    if (userData.full_name || userData.username) {
        const nameHeader = document.getElementById('welcomeUser');
        if (nameHeader) nameHeader.innerText = `Welcome, ${userData.full_name || userData.username}`;
    }

    if (document.getElementById('summaryName')) document.getElementById('summaryName').innerText = userData.full_name || '--';
    if (document.getElementById('summaryEmail')) document.getElementById('summaryEmail').innerText = userData.email || '--';
    if (document.getElementById('summaryPhone')) document.getElementById('summaryPhone').innerText = userData.phone || '--';

    // 2. Fetch status from D1 Database (Countdown logic handles hiding/showing inside updateDashboardState)
    if (userData.id) {
        fetchLiveStatus(userData.id);
    } else {
        updateDashboardState('none');
    }
}

async function fetchLiveStatus(userId) {
    try {
        const response = await fetch(`/api/student/status?user_id=${encodeURIComponent(userId)}`);
        if (response.ok) {
            const data = await response.json();
            updateDashboardState(data.status, data.roomDetails, data.reason);
        } else {
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
    if (summaryStatus) summaryStatus.innerText = status ? status.toUpperCase() : 'NO APPLICATION';

    // Reset view visibility
    const views = document.querySelectorAll('.view-register, .view-success, .view-fail, .view-pending, .view-appealed');
    views.forEach(v => v.style.display = 'none');

    // Remove old status classes from main container
    mainContainer.classList.remove('status-none', 'status-pending', 'status-success', 'status-fail', 'status-appealed');

    const normalizedStatus = (status || '').toLowerCase();

    // Check if application is active/approved
    const isApproved = ['active', 'approved', 'success'].includes(normalizedStatus);

    // --- COUNTDOWN LOGIC ---
    if (isApproved) {
        // Stop countdown and hide deadline banner if approved
        if (countdownInterval) clearInterval(countdownInterval);
        if (deadlineBanner) deadlineBanner.style.display = 'none';
    } else {
        // Run countdown if still pending / registering
        let deadlineStr = userData.registration_deadline;
        if (!deadlineStr && userData.created_at) {
            const createdDate = new Date(userData.created_at);
            const fallbackDeadline = new Date(createdDate.getTime() + (7 * 24 * 60 * 60 * 1000));
            deadlineStr = fallbackDeadline.toISOString();
        }
        if (deadlineStr) startRegistrationCountdown(deadlineStr);
    }

    // --- VIEW SWITCHING ---
    switch (normalizedStatus) {
        case 'pending':
            mainContainer.classList.add('status-pending');
            document.querySelector('.view-pending').style.display = 'block';
            break;

        case 'active':
        case 'approved':
        case 'success':
            mainContainer.classList.add('status-success');
            document.querySelector('.view-success').style.display = 'block';
            if (details) {
                document.getElementById('displayBlock').innerText = details.block || 'Block --';
                document.getElementById('displayRoom').innerText = details.room_number ? `Room ${details.room_number}` : 'Room ---';
                document.getElementById('displayPasscode').innerText = details.passcode || '#----';
            }
            break;

        case 'returned':
        case 'rejected':
        case 'fail':
        case 'disapproved':
            mainContainer.classList.add('status-fail');
            document.querySelector('.view-fail').style.display = 'block';
            if (reason) {
                document.getElementById('failReason').innerText = `Sebab: ${reason}`;
            }
            break;

        case 'appealed':
            mainContainer.classList.add('status-appealed');
            document.querySelector('.view-appealed').style.display = 'block';
            break;

        default:
            mainContainer.classList.add('status-none');
            document.querySelector('.view-register').style.display = 'block';
            break;
    }
}

/* Modal and Navigation Handlers */
function openAppealModal() { document.getElementById('appeal-modal').style.display = 'flex'; }
function closeAppealModal() { document.getElementById('appeal-modal').style.display = 'none'; }
function openDeleteModal() { document.getElementById('delete-modal').style.display = 'flex'; }
function closeDeleteModal() { document.getElementById('delete-modal').style.display = 'none'; }

document.getElementById('appealForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const reason = document.getElementById('appealReason').value;

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