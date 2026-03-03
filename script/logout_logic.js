/**
 * logout_logic.js
 * High-level security and session management
 */

// --- 1. THE SECURITY GUARD ---
// This runs immediately when the script loads
(function() {
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    const currentPage = window.location.pathname;

    // If no session is found and we aren't already on the login page, redirect.
    if (!isLoggedIn && !currentPage.includes('../index.html')) {
        window.location.replace("../index.html");
    }
})();

// --- 2. MODAL CONTROLS ---
function openLogoutModal() {
    const modal = document.getElementById('logout-modal');
    if (modal) modal.style.display = 'flex';
}

function closeLogoutModal() {
    const modal = document.getElementById('logout-modal');
    if (modal) modal.style.display = 'none';
}

// --- 3. THE LOGOUT EXECUTION ---
function executeLogout() {
    // Clear the "Session"
    localStorage.removeItem('isLoggedIn');
    
    // Clear history and force-redirect to login
    // window.location.replace is better than .href because it 
    // removes the admin page from the browser's "Back" history.
    window.location.replace("../index.html");
}

/**
 * logout_logic.js 
 */

// --- 1. THE BACK-BUTTON INTERCEPTOR ---
(function() {
    // Check if logged in first
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    if (!isLoggedIn) {
        window.location.replace("/index.html"); //
        return;
    }

    // Push a "dummy" state so there is something to "go back" from
    window.history.pushState(null, null, window.location.pathname);

    // Listen for the back button click
    window.addEventListener('popstate', function (event) {
        // Stop the browser from actually going back
        window.history.pushState(null, null, window.location.pathname);
        
        // Show your existing logout modal
        openLogoutModal();
    });
})();

// --- 2. EXISTING MODAL & LOGOUT FUNCTIONS ---
function openLogoutModal() {
    const modal = document.getElementById('logout-modal'); //
    if (modal) modal.style.display = 'flex'; //
}

function closeLogoutModal() {
    const modal = document.getElementById('logout-modal'); //
    if (modal) modal.style.display = 'none'; //
}

function executeLogout() {
    localStorage.removeItem('isLoggedIn'); // Clear session
    window.location.replace("/index.html"); // Redirect and clear history
}
