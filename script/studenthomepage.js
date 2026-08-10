// studenthomepage.js

let countdownInterval = null;

// ==========================================
// 1. PAGE INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const userId = userData.id || userData.user_id;

    if (!userId) {
        console.warn('No User ID found in localStorage.');
        updateDashboardState('none');
        return;
    }

    // Fetch all backend data FIRST before rendering
    await fetchStudentStatus(userId);
});

/**
 * Calls backend API /api/student/status?user_id=...
 * @param {string|number} userId 
 */
async function fetchStudentStatus(userId) {
    try {
        const response = await fetch(`/api/student/status?user_id=${encodeURIComponent(userId)}`);
        
        if (!response.ok) {
            throw new Error(`Server status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Fetched backend status data:', data);

        // Update state with fetched data
        updateDashboardState(
            data.status || 'none', 
            data.roomDetails || null, 
            data.reason || null
        );

    } catch (err) {
        console.error('Failed to load application status from backend:', err);
        // Fallback to 'none' view if connection or server fails
        updateDashboardState('none');
    }
}

// ==========================================
// 2. DASHBOARD UI STATE RENDERER
// ==========================================
/**
 * Updates the dashboard state purely by changing the CSS class on #mainContainer
 * @param {string} status - Current application status
 * @param {Object|null} details - Room/Block/Passcode details
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
        summaryStatus.innerText = status ? String(status).toUpperCase() : 'N/A';
    }

    // 2. Update Status Indicator Pills
    updateStatusPills(normalizedStatus);

    // 3. Reset mainContainer status classes
    mainContainer.classList.remove('status-none', 'status-pending', 'status-success', 'status-fail', 'status-appealed');

    // 4. Check if application status is finalized
    const isFinalized = [
        'active', 'approved', 'success', 'lulus', 
        'returned', 'rejected', 'fail', 'disapproved', 'gagal'
    ].includes(normalizedStatus);

    // 5. Countdown logic
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

    // 6. Apply Status Class & Assign Data with "N/A" Fallbacks
    switch (normalizedStatus) {
        case 'pending':
            mainContainer.classList.add('status-pending');
            break;

        case 'active':
        case 'approved':
        case 'success':
        case 'lulus':
            mainContainer.classList.add('status-success');
            
            // Populate fields with fallback to N/A
            setElementText('displayBlock', details && details.block ? `Block ${details.block}` : 'Block: N/A');
            setElementText('displayRoom', details && details.room_number ? `Room ${details.room_number}` : 'Room: N/A');
            setElementText('displayPasscode', details && details.passcode ? details.passcode : 'N/A');
            break;

        case 'returned':
        case 'rejected':
        case 'fail':
        case 'disapproved':
        case 'gagal':
            mainContainer.classList.add('status-fail');
            
            // Fallback rejection reason to N/A
            setElementText('failReason', `Sebab: ${reason || 'N/A'}`);
            break;

        case 'appealed':
        case 'rayuan':
            mainContainer.classList.add('status-appealed');
            break;

        default:
            mainContainer.classList.add('status-none');
            break;
    }

    // 7. Make main container visible now that state is officially set
    mainContainer.style.visibility = 'visible';
    mainContainer.style.opacity = '1';
}

// ==========================================
// 3. HELPER FUNCTIONS & COUNTDOWN
// ==========================================

function updateStatusPills(status) {
    const pills = document.querySelectorAll('.status-pill, .badge-status, [data-status]');
    
    pills.forEach(pill => {
        pill.classList.remove('active');
        const pillStatus = (pill.getAttribute('data-status') || pill.innerText).toLowerCase().trim();
        
        if (
            (status === 'pending' && pillStatus.includes('pending')) ||
            (['approved', 'active', 'success', 'lulus'].includes(status) && pillStatus.includes('approve')) ||
            (['returned', 'rejected', 'fail', 'disapproved', 'gagal'].includes(status) && (pillStatus.includes('return') || pillStatus.includes('disapprove') || pillStatus.includes('fail'))) ||
            (['appealed', 'rayuan'].includes(status) && pillStatus.includes('appeal'))
        ) {
            pill.classList.add('active');
        }
    });
}

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

function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}