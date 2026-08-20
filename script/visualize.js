/**
 * Dormitoration - Data Visualization & Analytics Script
 * File: /script/visualize.js
 */

document.addEventListener('DOMContentLoaded', async () => {
    let applications = [];
    try {
        const res = await fetch('/api/admin/pending-applications');
        if (res.ok) {
            applications = await res.json();
        }
    } catch (err) {
        console.warn('Backend unavailable, rendering scatter plot with fallback data.');
    }

    // Fallback dataset if DB is empty or offline
    if (!applications || applications.length === 0) {
        applications = [
            { full_name: "Ahmad Zaki", cgpa: 3.65, income: 2500 },
            { full_name: "Siti Nurhaliza", cgpa: 3.82, income: 1800 },
            { full_name: "Muhammad Ali", cgpa: 2.95, income: 4500 },
            { full_name: "Tan Wei Ming", cgpa: 3.40, income: 3200 },
            { full_name: "Nur Aisyah", cgpa: 3.90, income: 1500 },
            { full_name: "Kavitha Raj", cgpa: 3.10, income: 6000 },
            { full_name: "Syamsul Rizal", cgpa: 3.75, income: 2200 }
        ];
    }

    // Chart Theme Configuration
    const isDark = document.body.classList.contains('dark-mode');
    const textColor = isDark ? '#bcfcd2' : '#1e293b';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';

    // Render Priority Score Scatter Plot
    const scatterCanvas = document.getElementById('gpaIncomeScatterChart');
    if (scatterCanvas) {
        const scatterData = applications.map(app => ({
            x: parseFloat(app.income || 0),
            y: parseFloat(app.cgpa || 0),
            name: app.full_name
        }));

        new Chart(scatterCanvas.getContext('2d'), {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Applicant Distribution',
                    data: scatterData,
                    backgroundColor: '#47f59b',
                    borderColor: '#34d399',
                    pointRadius: 7,
                    pointHoverRadius: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: { display: true, text: 'Monthly Household Income (RM)', color: textColor },
                        grid: { color: gridColor },
                        ticks: { color: textColor }
                    },
                    y: {
                        title: { display: true, text: 'Cumulative GPA (CGPA)', color: textColor },
                        min: 2.0,
                        max: 4.0,
                        grid: { color: gridColor },
                        ticks: { color: textColor }
                    }
                },
                plugins: {
                    legend: { labels: { color: textColor } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const pt = ctx.raw;
                                return `${pt.name || 'Student'}: Income RM${pt.x}, CGPA ${pt.y}`;
                            }
                        }
                    }
                }
            }
        });
    }
});

/**
 * Hardware Terminal Log Clear Utility
 */
function clearHardwareLogs() {
    const container = document.getElementById('hardware-logs-container');
    if (container) {
        container.innerHTML = `<div class="log-entry"><span class="log-time">[${new Date().toLocaleTimeString()}]</span><span class="log-tag info">[SYS]</span><span class="log-msg">Log terminal buffer cleared by Admin.</span></div>`;
    }
}

/**
 * Dynamic Feature Extension Hook
 * Use this function to dynamically register new analytical components later.
 */
function registerAnalyticsFeature(htmlContent) {
    const container = document.getElementById('custom-analytics-container');
    if (container) {
        container.style.display = 'block';
        container.insertAdjacentHTML('beforeend', htmlContent);
    }
}