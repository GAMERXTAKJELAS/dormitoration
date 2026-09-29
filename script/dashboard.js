/**
 * Dormitoration - Admin Dashboard Controller
 * File: /script/dashboard.js
 */

let activeStudentsList = [];

document.addEventListener("DOMContentLoaded", () => {
    loadDashboardStats();
    loadActiveStudents();

    // Refresh hardware/stat cards periodically so "online" status stays current
    // without the admin needing to reload the page.
    setInterval(loadDashboardStats, 20000);

    const searchInput = document.getElementById("active-student-search");
    if (searchInput) {
        searchInput.addEventListener("input", renderActiveStudentsTable);
    }
});

// Dynamic local SVG avatar selector based on gender or custom profile picture
function getDynamicAvatar(student) {
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

// Fetch Top Summary Metrics
async function loadDashboardStats() {
    try {
        const res = await fetch("/api/admin/dashboard/stats");
        if (res.ok) {
            const data = await res.json();
            const stats = data.stats || {};

            document.getElementById("stat-active-students").innerText = stats.active_students || 0;
            document.getElementById("stat-pending-apps").innerText = stats.pending_applications || 0;

            renderHardwareStatus(stats.hardware || { online_count: 0, total_rooms: 0, rooms: [] }, stats.room_occupancy || 0);
        }
    } catch (err) {
        console.error("Error fetching stats:", err);
    }
}

// Update the occupancy stat card and the Hostel Blocks Overview section
// based on which rooms have reported a heartbeat recently.
function renderHardwareStatus(hardware, occupancyPct) {
    const pctEl = document.getElementById("stat-hardware-pct");
    const labelEl = document.getElementById("stat-hardware-label");
    const container = document.getElementById("hardware-blocks-container");
    const arrangeBox = document.getElementById("auto-arrange-box");
    if (!container) return;

    const online = hardware.rooms || [];

    if (pctEl) pctEl.innerText = `${occupancyPct}%`;
    if (labelEl) labelEl.innerText = online.length > 0 ? "Hardware Online" : "Room Occupancy (Offline)";

    if (online.length === 0) {
        container.innerHTML = `
            <div class="hardware-offline-card">
                <div class="offline-icon-wrapper">
                    <i class='bx bx-wifi-off'></i>
                </div>
                <div class="offline-content">
                    <h3>No Hardware Online</h3>
                    <p>Smart lock microcontrollers and RFID asset trackers are currently disconnected or unassigned.</p>
                </div>
            </div>
        `;
        if (arrangeBox) arrangeBox.classList.add("disabled-feature");
        return;
    }

    // Group by block so each block gets its own mini-card of rooms.
    const byBlock = {};
    online.forEach(r => {
        const block = r.block_name || "Unassigned";
        (byBlock[block] = byBlock[block] || []).push(r);
    });

    container.innerHTML = `
        <div class="hardware-online-grid" style="display:flex; flex-wrap:wrap; gap:16px;">
            ${Object.entries(byBlock).map(([block, rooms]) => `
                <div class="hardware-block-card" style="border:1px solid rgba(16,185,129,0.3); border-radius:10px; padding:14px 18px; min-width:180px;">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                        <i class='bx bx-wifi' style="color:#10b981;"></i>
                        <strong>Block ${block}</strong>
                    </div>
                    <div style="color: var(--text-muted); font-size: 0.9em;">
                        ${rooms.map(r => `Room ${r.room_number}`).join(', ')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    // Auto-arrange still stays disabled until room_allocations is a real feature;
    // this only reflects that hardware itself is reachable.
    if (arrangeBox) arrangeBox.classList.add("disabled-feature");
}

// Fetch Active Registered Students Directory
async function loadActiveStudents() {
    try {
        const res = await fetch("/api/admin/dashboard/active-students");
        if (res.ok) {
            const data = await res.json();
            activeStudentsList = data.students || [];
            renderActiveStudentsTable();
        } else {
            showEmptyTable("Failed to load active students directory.");
        }
    } catch (err) {
        console.error("Error loading active students:", err);
        showEmptyTable(`Network Error: ${err.message}`);
    }
}

// Render Filtered Active Students Table
function renderActiveStudentsTable() {
    const tbody = document.getElementById("active-students-tbody");
    const searchVal = (document.getElementById("active-student-search")?.value || "").toLowerCase();

    if (!tbody) return;
    tbody.innerHTML = "";

    const filtered = activeStudentsList.filter(student => {
        const name = (student.full_name || "").toLowerCase();
        const email = (student.email || "").toLowerCase();
        const phone = (student.phone || "").toLowerCase();
        const ic = (student.ic_number || "").toLowerCase();
        const matric = (student.matric_number || "").toLowerCase();

        return name.includes(searchVal) ||
               email.includes(searchVal) ||
               phone.includes(searchVal) ||
               ic.includes(searchVal) ||
               matric.includes(searchVal);
    });

    if (filtered.length === 0) {
        showEmptyTable("No active students found.");
        return;
    }

    filtered.forEach(student => {
        const tr = document.createElement("tr");

        const studentName = student.full_name || 'Student';
        const avatarUrl = getDynamicAvatar(student);
        const fallbackMaleAvatar = '/image/default_Male.svg';

        const userIdVal = student.user_id ? student.user_id : 'null';
        const appIdVal = student.application_id ? student.application_id : 'null';

        tr.innerHTML = `
            <td>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <img 
                        src="${avatarUrl}" 
                        alt="${studentName}" 
                        style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(16, 185, 129, 0.3); background-color: #1f2937; flex-shrink: 0;"
                        onerror="this.onerror=null; this.src='${fallbackMaleAvatar}';"
                    />
                    <div>
                        <strong style="color: var(--text-color);">${student.full_name || 'N/A'}</strong><br>
                        <small style="color: var(--text-muted);">${student.email || '-'}</small>
                    </div>
                </div>
            </td>
            <td><strong>${student.matric_number || '-'}</strong></td>
            <td>${student.ic_number || '-'}</td>
            <td>${student.phone || '-'}</td>
            <td>${student.program || 'Pending Fill'}</td>
            <td class="actions-cell">
                <button class="btn-action-icon" onclick="viewStudentDetails(${userIdVal}, ${appIdVal})" title="View Details">
                    <i class='bx bx-info-circle'></i>
                </button>
                <button class="btn-action-icon disabled" disabled title="Hardware Offline - Cannot Assign Room Block">
                    <i class='bx bx-door-open'></i>
                </button>
            </td>
        `;

        tbody.appendChild(tr);
    });
}

function showEmptyTable(message) {
    const tbody = document.getElementById("active-students-tbody");
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">
                    ${message}
                </td>
            </tr>
        `;
    }
}

function viewStudentDetails(userId, appId) {
    const targetQuery = (userId && userId !== 'null') ? `id=${userId}` : `app_id=${appId}`;
    window.location.href = `/admin/application_details.html?${targetQuery}`;
}