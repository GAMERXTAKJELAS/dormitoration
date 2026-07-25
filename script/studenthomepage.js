document.addEventListener('DOMContentLoaded', () => {
    initStudentDashboard();
});

let isAccountViewOpen = false;

async function initStudentDashboard() {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');

    if (userData.full_name || userData.username) {
        const nameHeader = document.getElementById('welcomeUser');
        if (nameHeader) nameHeader.innerText = `Welcome, ${userData.full_name || userData.username}`;
    }

    // Populate Account Modal Inputs
    document.getElementById('accFullName').value = userData.full_name || '';
    document.getElementById('accEmail').value = userData.email || '';
    document.getElementById('accPhone').value = userData.phone || '';

    // Initialize Registration Countdown
    if (userData.registration_deadline && userData.account_status === 'pending_details') {
        startRegistrationCountdown(userData.registration_deadline);
    }

    // Fetch actual room registration status from backend
    try {
        const response = await fetch(`/api/student/status?phone=${encodeURIComponent(userData.phone || '')}`);
        if (response.ok) {
            const data = await response.json();
            updateDashboardState(data.status, data.roomDetails);
        } else {
            // Default fallback based on account_status
            updateDashboardState('none');
        }
    } catch (err) {
        console.warn("Could not fetch latest live status, fallback to local storage.");
        updateDashboardState('none');
    }
}

function updateDashboardState(status, details = null) {
    const mainContainer = document.getElementById('mainContainer');
    
    // Reset status classes
    mainContainer.classList.remove('status-none', 'status-pending', 'status-success', 'status-fail');

    switch (status) {
        case 'pending':
            mainContainer.classList.add('status-pending');
            break;
        case 'approved':
        case 'success':
            mainContainer.classList.add('status-success');
            if (details) {
                document.getElementById('displayBlock').innerText = details.block || 'Block A';
                document.getElementById('displayRoom').innerText = `Room ${details.room_number || '---'}`;
                document.getElementById('displayPasscode').innerText = details.passcode || '#5521';
            }
            break;
        case 'rejected':
        case 'fail':
            mainContainer.classList.add('status-fail');
            if (details && details.reason) {
                document.getElementById('failReason').innerText = `Reason: ${details.reason}`;
            }
            break;
        default:
            mainContainer.classList.add('status-none');
            break;
    }
}

// Account View Toggle Function
function toggleAccountView() {
    const accountSection = document.getElementById('accountSection');
    const contentViews = document.querySelectorAll('.view-register, .view-success, .view-fail, .view-pending');

    isAccountViewOpen = !isAccountViewOpen;

    if (isAccountViewOpen) {
        contentViews.forEach(view => view.style.display = 'none');
        accountSection.style.display = 'block';
    } else {
        accountSection.style.display = 'none';
        contentViews.forEach(view => view.style.display = '');
    }
}

// Live Countdown Timer
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
            alert("Your 7-day registration window has expired. Logging out...");
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

// Save Updated Account Details
document.getElementById('accountForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const messageEl = document.getElementById('accMessage');
    
    const fullName = document.getElementById('accFullName').value.trim();
    const email = document.getElementById('accEmail').value.trim();
    const phone = document.getElementById('accPhone').value.trim();

    messageEl.style.color = '#ffffff';
    messageEl.innerText = 'Updating details...';

    try {
        const response = await fetch('/api/student/update-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullName, email, phone })
        });

        if (response.ok) {
            const userData = JSON.parse(localStorage.getItem('userData') || '{}');
            userData.full_name = fullName;
            userData.email = email;
            userData.phone = phone;
            localStorage.setItem('userData', JSON.stringify(userData));

            messageEl.style.color = '#47f59b';
            messageEl.innerText = 'Account details updated successfully!';
            setTimeout(() => toggleAccountView(), 1200);
        } else {
            messageEl.style.color = '#ff6b6b';
            messageEl.innerText = 'Failed to update account details.';
        }
    } catch (err) {
        messageEl.style.color = '#ff6b6b';
        messageEl.innerText = 'Server error. Try again later.';
    }
});