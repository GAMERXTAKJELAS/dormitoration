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
// INITIALIZATION & USER DATA FETCH
// ==========================================
window.addEventListener('load', async () => {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const userId = userData.id || userData.user_id;

    if (!userId) {
        showCustomAlert('User session not found. Please log in again.', 'error', () => {
            window.location.href = '/log_in.html';
        });
        return;
    }

    await loadStudentAppealInfo(userId);
});

async function loadStudentAppealInfo(userId) {
    try {
        const response = await fetch(`/api/student/status?user_id=${encodeURIComponent(userId)}`);
        if (!response.ok) {
            throw new Error(`Server returned status ${response.status}`);
        }

        const data = await response.json();
        const user = data.user || {};

        // 1. Populate Summary Card
        document.getElementById('summaryName').textContent = user.username || 'N/A';
        document.getElementById('summaryPhone').textContent = user.phone || 'N/A';
        document.getElementById('summaryEmail').textContent = user.email || 'N/A';
        document.getElementById('summaryReturnReason').textContent = data.reason || 'No reason provided by administration.';

        // 2. Pre-fill Form Contact Fields
        const appealEmail = document.getElementById('appealEmail');
        const appealPhone = document.getElementById('appealPhone');

        if (appealEmail && user.email) appealEmail.value = user.email;
        if (appealPhone && user.phone) appealPhone.value = user.phone;

    } catch (err) {
        console.error('Failed to load appeal details:', err);
        showCustomAlert('Unable to load student profile details. Please try refreshing.', 'error');
    }
}

// ==========================================
// FORM SUBMISSION HANDLER
// ==========================================
async function handleAppealSubmit(e) {
    e.preventDefault();

    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const userId = userData.id || userData.user_id;

    if (!userId) {
        showCustomAlert('User session expired. Please log in again.', 'error', () => {
            window.location.href = '/log_in.html';
        });
        return;
    }

    const email = document.getElementById('appealEmail').value.trim();
    const phone = document.getElementById('appealPhone').value.trim();
    const appealReason = document.getElementById('appealText').value.trim();
    const submitBtn = document.getElementById('submitAppealBtn');

    if (!email || !phone || !appealReason) {
        showCustomAlert('Please complete all required fields before submitting.', 'error');
        return;
    }

    const payload = {
        user_id: userId,
        email: email,
        phone: phone,
        appeal_reason: appealReason
    };

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Submitting...";
        }

        const response = await fetch('/api/student/submit-appeal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to submit appeal letter.');
        }

        // Update local session with updated contact details
        const updatedUser = { ...userData, email, phone };
        localStorage.setItem('userData', JSON.stringify(updatedUser));

        showCustomAlert('Your appeal letter has been submitted successfully! Redirecting to student portal...', 'success', () => {
            window.location.href = '/student/studenthomepage.html';
        });

    } catch (err) {
        console.error('Appeal submission error:', err);
        showCustomAlert(`Error submitting appeal: ${err.message}`, 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<i class='bx bx-send'></i> Submit Appeal";
        }
    }
}