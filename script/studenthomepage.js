// studenthomepage.js

let countdownInterval = null;

/**
 * Updates the dashboard state based on application status and details.
 * @param {string} status - Current application status (none, pending, approved, fail, etc.)
 * @param {Object|null} details - Room/Block/Passcode details if approved
 * @param {string|null} reason - Rejection reason if failed
 */
function updateDashboardState(status, details = null, reason = null) {
    const mainContainer = document.getElementById('mainContainer');
    const deadlineBanner = document.getElementById('deadlineBanner');
    if (!mainContainer) return;

    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const normalizedStatus = String(status || '').toLowerCase().trim();

    // 1. Update Account Quick View Badge
    const summaryStatus = document.getElementById('summaryStatus');
    if (summaryStatus) {
        summaryStatus.innerText = status ? String(status).toUpperCase() : 'NO APPLICATION';
    }

    // 2. Update Top Status Badges / Pills (.active class)
    updateStatusPills(normalizedStatus);

    // 3. Safe DOM cleanup: Hide all view cards & remove status classes
    const views = document.querySelectorAll('.view-register, .view-success, .view-fail, .view-pending, .view-appealed');
    views.forEach(v => v.style.display = 'none');

    mainContainer.classList.remove('status-none', 'status-pending', 'status-success', 'status-fail', 'status-appealed');

    // 4. Finalized statuses that STOP the countdown
    const isFinalized = [
        'active', 
        'approved', 
        'success', 
        'lulus', 
        'returned', 
        'rejected', 
        'fail', 
        'disapproved', 
        'gagal'
    ].includes(normalizedStatus);

    // 5. --- COUNTDOWN CONTROL LOGIC ---
    if (isFinalized) {
        if (countdownInterval) clearInterval(countdownInterval);
        if (deadlineBanner) deadlineBanner.style.display = 'none';
    } else {
        if (deadlineBanner) deadlineBanner.style.display = 'block';

        let deadlineStr = userData.registration_deadline;
        if (!deadlineStr && userData.created_at) {
            const createdDate = new Date(userData.created_at);
            const fallbackDeadline = new Date(createdDate.getTime() + (7 * 24 * 60 * 60 * 1000));
            deadlineStr = fallbackDeadline.toISOString();
        }
        if (deadlineStr) {
            startRegistrationCountdown(deadlineStr);
        }
    }

    // 6. --- VIEW SWITCHING LOGIC ---
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

/**
 * Highlights the active status pill at the top of the dashboard
 * @param {string} status 
 */
function updateStatusPills(status) {
    // Select all status pill elements at top
    const pills = document.querySelectorAll('.status-pill, .badge-status, [data-status]');
    
    pills.forEach(pill => {
        pill.classList.remove('active');
        
        // Match by dataset attribute if available (e.g. data-status="approved")
        const pillStatus = pill.getAttribute('data-status') || pill.innerText.toLowerCase();
        
        if (
            (status === 'pending' && pillStatus.includes('pending')) ||
            (['approved', 'active', 'success', 'lulus'].includes(status) && pillStatus.includes('approve')) ||
            (['returned', 'rejected', 'fail', 'disapproved', 'gagal'].includes(status) && (pillStatus.includes('return') || pillStatus.includes('disapprove'))) ||
            (['appealed', 'rayuan'].includes(status) && pillStatus.includes('appeal'))
        ) {
            pill.classList.add('active');
        }
    });
}

/**
 * Starts the countdown timer given an ISO deadline string.
 * @param {string} deadlineIsoString 
 */
function startRegistrationCountdown(deadlineIsoString) {
    if (countdownInterval) clearInterval(countdownInterval);

    const targetTime = new Date(deadlineIsoString).getTime();
    const timerElement = document.getElementById('countdownTimer');

    function updateTimer() {
        const now = new Date().getTime();
        const difference = targetTime - now;

        if (difference <= 0) {
            if (countdownInterval) clearInterval(countdownInterval);
            if (timerElement) timerElement.innerText = "00d 00h 00m 00s (Masa Tamat)";
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

function showView(selector) {
    const el = document.querySelector(selector);
    if (el) el.style.display = 'block';
}

function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}