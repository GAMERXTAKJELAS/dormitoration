// studenthomepage.js

let countdownInterval = null;
let currentProfileImage = null;

// Dynamic Avatar helper matching your other pages
function getDynamicAvatar(student) {
    if (!student) return '/image/default_Male.svg';

    if (student.profile_picture && 
        student.profile_picture.trim() !== '' && 
        !student.profile_picture.includes('ui-avatars.com')) {
        return student.profile_picture;
    }

    const gender = (student.gender || '').toLowerCase().trim();

    if (gender === 'perempuan' || gender === 'female' || gender === 'p') {
        return '/image/default_Female.svg';
    }

    // Default fallback for Lelaki / Male or unspecified
    return '/image/default_Male.svg';
}

document.addEventListener('DOMContentLoaded', async () => {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');
    const userId = userData.id || userData.user_id;

    if (!userId) {
        console.warn('No User ID found in localStorage.');
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
            localStorage.setItem('userData', JSON.stringify({
                ...currentStored,
                ...data.user,
                status: data.status
            }));
            
            // Populate account info & avatar dynamically
            populateAccountModal(data.user);
        }

        updateDashboardState(
            data.status || 'pending', 
            data.roomDetails || null, 
            data.reason || null,
            true
        );

    } catch (err) {
        console.error('Failed to load student status:', err);
        updateDashboardState('pending', null, null, false);
    }
}

// ==========================================
// ACCOUNT MODAL & AVATAR POPULATION
// ==========================================
function populateAccountModal(user) {
    document.getElementById('accUsername').value = user.username || '';
    document.getElementById('accEmail').value = user.email || '';
    document.getElementById('accPhone').value = user.phone || '';

    // Calculate dynamic avatar based on profile_picture and gender
    const avatarSrc = getDynamicAvatar(user);
    
    const modalAvatar = document.getElementById('profileAvatar');
    const headerAvatar = document.getElementById('navHeaderAvatar');

    if (modalAvatar) modalAvatar.src = avatarSrc;
    if (headerAvatar) headerAvatar.src = avatarSrc;
}

// Preview uploaded avatar locally (R2 Upload held up for now)
function handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        currentProfileImage = e.target.result;
        
        const modalAvatar = document.getElementById('profileAvatar');
        const headerAvatar = document.getElementById('navHeaderAvatar');
        
        if (modalAvatar) modalAvatar.src = currentProfileImage;
        if (headerAvatar) headerAvatar.src = currentProfileImage;
    };
    reader.readAsDataURL(file);
}