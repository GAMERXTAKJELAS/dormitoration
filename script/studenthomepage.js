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

    // 2. Populate Account Modal Inputs if they exist
    const accFullName = document.getElementById('accFullName');
    const accEmail = document.getElementById('accEmail');
    const accPhone = document.getElementById('accPhone');

    if (accFullName) accFullName.value = userData.full_name || '';
    if (accEmail) accEmail.value = userData.email || '';
    if (accPhone) accPhone.value = userData.phone || '';

    // 3. FORCE COUNTDOWN TO RUN
    // Check if a deadline exists; if missing, calculate 7 days from created_at or current time
    let deadlineStr = userData.registration_deadline;

    if (!deadlineStr) {
        const createdDate = userData.created_at ? new Date(userData.created_at) : new Date();
        const fallbackDeadline = new Date(createdDate.getTime() + (7 * 24 * 60 * 60 * 1000));
        deadlineStr = fallbackDeadline.toISOString();

        // Save fallback back to localStorage for consistency
        userData.registration_deadline = deadlineStr;
        userData.account_status = userData.account_status || 'pending_details';
        localStorage.setItem('userData', JSON.stringify(userData));
    }

    // Trigger the countdown
    startRegistrationCountdown(deadlineStr);

    // 4. Fetch actual room registration status from Cloudflare Workers API
    try {
        const response = await fetch(`/api/student/status?phone=${encodeURIComponent(userData.phone || '')}`);
        if (response.ok) {
            const data = await response.json();
            updateDashboardState(data.status, data.roomDetails);
        } else {
            updateDashboardState('none');
        }
    } catch (err) {
        console.warn("Could not fetch latest live status, fallback to local storage.");
        updateDashboardState('none');
    }
}

function updateDashboardState(status, details = null) {
    const mainContainer = document.getElementById('mainContainer');
    if (!mainContainer) return;
    
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
                const blockEl = document.getElementById('displayBlock');
                const roomEl = document.getElementById('displayRoom');
                const passEl = document.getElementById('displayPasscode');

                if (blockEl) blockEl.innerText = details.block || 'Block A';
                if (roomEl) roomEl.innerText = `Room ${details.room_number || '---'}`;
                if (passEl) passEl.innerText = details.passcode || '#5521';
            }
            break;
        case 'rejected':
        case 'fail':
            mainContainer.classList.add('status-fail');
            if (details && details.reason) {
                const failEl = document.getElementById('failReason');
                if (failEl) failEl.innerText = `Reason: ${details.reason}`;
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
        // Load latest local user data into quick summary fields
        const userData = JSON.parse(localStorage.getItem('userData') || '{}');
        const summaryName = document.getElementById('summaryName');
        const summaryEmail = document.getElementById('summaryEmail');
        const summaryPhone = document.getElementById('summaryPhone');
        const summaryStatus = document.getElementById('summaryStatus');

        if (summaryName) summaryName.innerText = userData.full_name || userData.username || 'Not set';
        if (summaryEmail) summaryEmail.innerText = userData.email || 'Not set';
        if (summaryPhone) summaryPhone.innerText = userData.phone || 'Not set';
        if (summaryStatus) summaryStatus.innerText = userData.account_status || 'Pending';

        contentViews.forEach(view => view.style.display = 'none');
        if (accountSection) accountSection.style.display = 'block';
    } else {
        if (accountSection) accountSection.style.display = 'none';
        contentViews.forEach(view => view.style.display = '');
    }
}

// Live Countdown Timer
function startRegistrationCountdown(deadlineStr) {
    const deadline = new Date(deadlineStr).getTime();
    const banner = document.getElementById('deadlineBanner');
    const countdownEl = document.getElementById('registrationCountdown');

    if (!banner || !countdownEl) return;
    
    // Ensure display is set to flex so it becomes visible
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

// Save Updated Account Details Listener
document.getElementById('accountForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const messageEl = document.getElementById('accMessage');
    
    const fullName = document.getElementById('accFullName')?.value.trim();
    const email = document.getElementById('accEmail')?.value.trim();
    const phone = document.getElementById('accPhone')?.value.trim();

    if (messageEl) {
        messageEl.style.color = '#ffffff';
        messageEl.innerText = 'Updating details...';
    }

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

            if (messageEl) {
                messageEl.style.color = '#47f59b';
                messageEl.innerText = 'Account details updated successfully!';
            }
            setTimeout(() => toggleAccountView(), 1200);
        } else {
            if (messageEl) {
                messageEl.style.color = '#ff6b6b';
                messageEl.innerText = 'Failed to update account details.';
            }
        }
    } catch (err) {
        if (messageEl) {
            messageEl.style.color = '#ff6b6b';
            messageEl.innerText = 'Server error. Try again later.';
        }
    }
});