document.addEventListener('DOMContentLoaded', () => {
    initStudentDashboard();
});

let isAccountViewOpen = false;

async function initStudentDashboard() {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');

    // 1. Set Welcome Name
    if (userData.full_name || userData.username) {
        const nameHeader = document.getElementById('welcomeUser');
        if (nameHeader) nameHeader.innerText = `Welcome, ${userData.full_name || userData.username}`;
    }

    // 2. Countdown logic
    let deadlineStr = userData.registration_deadline;
    if (!deadlineStr) {
        const createdDate = userData.created_at ? new Date(userData.created_at) : new Date();
        const fallbackDeadline = new Date(createdDate.getTime() + (7 * 24 * 60 * 60 * 1000));
        deadlineStr = fallbackDeadline.toISOString();

        userData.registration_deadline = deadlineStr;
        userData.account_status = userData.account_status || 'pending_details';
        localStorage.setItem('userData', JSON.stringify(userData));
    }

    startRegistrationCountdown(deadlineStr);

    // 3. Fetch status from API
    fetchLiveStatus(userData.id || userData.phone);
}

async function fetchLiveStatus(identifier) {
    try {
        const response = await fetch(`/api/student/status?user_id=${encodeURIComponent(identifier)}`);
        if (response.ok) {
            const data = await response.json();
            updateDashboardState(data.status, data.roomDetails, data.reason);
        } else {
            updateDashboardState('none');
        }
    } catch (err) {
        console.warn("Could not fetch live status, falling back.");
        updateDashboardState('none');
    }
}

function updateDashboardState(status, details = null, reason = null) {
    const mainContainer = document.getElementById('mainContainer');
    if (!mainContainer) return;

    // Hide all view containers
    const views = document.querySelectorAll('.view-register, .view-success, .view-fail, .view-pending, .view-appealed');
    views.forEach(v => v.style.display = 'none');

    mainContainer.classList.remove('status-none', 'status-pending', 'status-success', 'status-fail', 'status-appealed');

    switch (status) {
        case 'pending':
            mainContainer.classList.add('status-pending');
            document.querySelector('.view-pending').style.display = 'block';
            break;

        case 'approved':
        case 'success':
            mainContainer.classList.add('status-success');
            document.querySelector('.view-success').style.display = 'block';
            if (details) {
                document.getElementById('displayBlock').innerText = details.block || 'Block A';
                document.getElementById('displayRoom').innerText = `Room ${details.room_number || '---'}`;
                document.getElementById('displayPasscode').innerText = details.passcode || '#5521';
            }
            break;

        case 'returned':
        case 'rejected':
        case 'fail':
            mainContainer.classList.add('status-fail');
            document.querySelector('.view-fail').style.display = 'block';
            if (reason) {
                document.getElementById('failReason').innerText = `Sebab Ditolak: ${reason}`;
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

/* Modals Management */
function openAppealModal() {
    document.getElementById('appeal-modal').style.display = 'flex';
}

function closeAppealModal() {
    document.getElementById('appeal-modal').style.display = 'none';
}

function openDeleteModal() {
    document.getElementById('delete-modal').style.display = 'flex';
}

function closeDeleteModal() {
    document.getElementById('delete-modal').style.display = 'none';
}

/* Rayuan Form Submission */
document.getElementById('appealForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const reason = document.getElementById('appealReason').value;

    try {
        const response = await fetch('/api/student/appeal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: userData.id,
                appeal_reason: reason
            })
        });

        if (response.ok) {
            alert('Rayuan anda telah berjaya dihantar!');
            closeAppealModal();
            updateDashboardState('appealed');
        } else {
            alert('Gagal menghantar rayuan. Sila cuba lagi.');
        }
    } catch (err) {
        alert('Ralat pelayan. Cuba lagi kemudian.');
    }
});

/* Account Deletion Logic (Deletes user only, unlinks application) */
async function confirmDeleteAccount() {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');

    try {
        const response = await fetch(`/api/student/delete-account`, {
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

    if (!banner || !countdownEl) return;
    banner.style.display = 'flex';

    const interval = setInterval(() => {
        const now = new Date().getTime();
        const diff = deadline - now;

        if (diff <= 0) {
            clearInterval(interval);
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

        countdownEl.innerText = `${days}d ${hours}h ${mins}m ${secs}s remaining`;
    }, 1000);
}