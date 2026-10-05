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

    // Auto-arrange: Commit only enables once at least one grouping is picked.
    // The actual assignment algorithm (capacity, MPP rooms, gender matching,
    // tie-breaking) isn't built yet, so Commit is intentionally a placeholder
    // until that's designed - it does not silently pretend to succeed.
    const arrangeOptions = document.querySelectorAll(".arrange-option");
    const commitBtn = document.getElementById("btn-commit-arrange");
    if (arrangeOptions.length && commitBtn) {
        arrangeOptions.forEach(cb => cb.addEventListener("change", () => {
            const anyChecked = Array.from(arrangeOptions).some(c => c.checked);
            commitBtn.disabled = !anyChecked;
            commitBtn.classList.toggle("disabled", !anyChecked);
        }));
        commitBtn.addEventListener("click", () => {
            alert("Room auto-assignment isn't built yet - the rules (capacity, MPP rooms, gender matching) still need to be finalized.");
        });
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

// Update the occupancy stat card and the Hostel Blocks Overview section.
// Room box colors (status only - same meaning for boy and girl blocks):
//   red    -> offline (ESP32 hasn't heartbeated recently)
//   yellow -> online, standby (room has space - 0 or partial occupancy)
//   green  -> online, full (student_count has reached capacity)
// Gender is shown on the BLOCK card border instead (green = boy, pink = girl),
// not per room, since a block houses one gender.
// A block only ever appears once a room inside it has registered via heartbeat.
function renderHardwareStatus(hardware, occupancyPct) {
    const pctEl = document.getElementById("stat-hardware-pct");
    const labelEl = document.getElementById("stat-hardware-label");
    const container = document.getElementById("hardware-blocks-container");
    const rooms = hardware.rooms || [];

    if (pctEl) pctEl.innerText = `${occupancyPct}%`;
    if (labelEl) labelEl.innerText = hardware.online_count > 0 ? "Hardware Online" : "Room Occupancy (Offline)";

    if (!container) return;

    if (rooms.length === 0) {
        container.innerHTML = `
            <div class="hardware-offline-card">
                <div class="offline-icon-wrapper"><i class='bx bx-wifi-off'></i></div>
                <div class="offline-content">
                    <h3>No Hardware Online</h3>
                    <p>Smart lock microcontrollers and RFID asset trackers are currently disconnected or unassigned.</p>
                </div>
            </div>
        `;
        return;
    }

    const byBlock = {};
    rooms.forEach(r => (byBlock[r.block_name || "Unassigned"] = byBlock[r.block_name || "Unassigned"] || []).push(r));

    container.innerHTML = `
        <div class="block-grid">
            ${Object.entries(byBlock).map(([block, blockRooms]) => {
                // ASSUMPTION: every room in a block shares one gender, so the
                // block border takes the first room's gender as the block's.
                const isGirlBlock = blockRooms[0]?.gender === 'F';
                return `
                <div class="block-card ${isGirlBlock ? 'block-girl' : ''}">
                    <div class="block-card-header">
                        <strong>Block ${block}</strong>
                    </div>
                    <div class="room-box-grid">
                        ${blockRooms.map(r => roomBoxHtml(r)).join('')}
                    </div>
                </div>
            `;
            }).join('')}
        </div>
    `;
}

function roomStatusClass(r) {
    if (!r.online) return "room-offline";
    const capacity = r.capacity || 0;
    if (capacity > 0 && r.student_count >= capacity) return "room-full";
    return "room-standby";
}

function roomBoxHtml(r) {
    const statusClass = roomStatusClass(r);
    const capacity = r.capacity || 0;
    const statusText = !r.online
        ? "Offline"
        : (capacity > 0 ? `${r.student_count}/${capacity} students` : `${r.student_count} student(s)`);
    return `
        <div class="room-box ${statusClass}" tabindex="0">
            <span class="room-number">${r.room_number}</span>
            <div class="room-hover-card">
                <strong>Room ${r.room_number}</strong>
                <p>${statusText}</p>
                ${r.student_count > 0 ? `
                    <div class="room-hover-actions">
                        <button class="btn-room-action" disabled title="Coming soon">Access Codes</button>
                        <button class="btn-room-action" disabled title="Coming soon">Student Details</button>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
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