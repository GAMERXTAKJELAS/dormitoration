/**
 * logout_logic.js
 * High-level security and session management for TVETMARA Lumut
 */

// --- 1. THE SECURITY GUARD ---
(function() {
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    const currentPage = window.location.pathname;

    // Allowed public pages that don't require login
    const isPublicPage = currentPage.endsWith('/log_in.html') || 
                         currentPage.endsWith('/index.html') || 
                         currentPage.endsWith('/sign_up.html') || 
                         currentPage === '/';

    // If no session is found and we aren't on a public page, redirect to login
    if (!isLoggedIn && !isPublicPage) {
        window.location.replace("/log_in.html");
    }
})();

// --- 2. BACK-BUTTON INTERCEPTOR ---
(function() {
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    if (!isLoggedIn) return;

    // Push state so back button is trapped on protected pages
    window.history.pushState(null, null, window.location.pathname);

    window.addEventListener('popstate', function () {
        window.history.pushState(null, null, window.location.pathname);
        openLogoutModal();
    });
})();

// --- 3. MODAL CONTROLS ---
function openLogoutModal() {
    const modal = document.getElementById('logout-modal');
    if (modal) modal.style.display = 'flex';
}

function closeLogoutModal() {
    const modal = document.getElementById('logout-modal');
    if (modal) modal.style.display = 'none';
}

// --- 4. THE LOGOUT EXECUTION ---
function executeLogout() {
    // Clear session storage
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('userRole');
    localStorage.removeItem('userData');

    // Force redirect to login page (removes admin page from history)
    window.location.replace("/log_in.html");
}