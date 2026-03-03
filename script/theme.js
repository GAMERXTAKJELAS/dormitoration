/* --- UNIVERSAL THEME MANAGER --- */
document.addEventListener('DOMContentLoaded', () => {
    const themeBtn = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');

    // 1. Function to apply the theme and swap icons
    const setTheme = (theme) => {
        if (theme === 'light') {
            document.body.classList.add('light-mode');
            if (themeIcon) themeIcon.classList.replace('bx-moon', 'bx-sun');
        } else {
            document.body.classList.remove('light-mode');
            if (themeIcon) themeIcon.classList.replace('bx-sun', 'bx-moon');
        }
    };

    // 2. Immediate Check: What is in the browser's memory?
    const savedTheme = localStorage.getItem('dorm-theme') || 'dark';
    setTheme(savedTheme);

    // 3. Listener: Only if the button exists on the current page
    if (themeBtn) {
        themeBtn.onclick = () => {
            const isCurrentlyLight = document.body.classList.contains('light-mode');
            const newTheme = isCurrentlyLight ? 'dark' : 'light';
            
            // Update LocalStorage (The Memory)
            localStorage.setItem('dorm-theme', newTheme);
            
            // Update the UI
            setTheme(newTheme);
        };
    }
});

