/**
 * Dormitoration - Admin Dashboard Controller
 * File: /script/dashboard.js
 */

let activeStudentsList = [];
let activeRoomFilter = null; // { id, label } when 'Student Details' was clicked on a room
let dashboardRooms = [];   // rooms from /stats, used by the Assign pop-up

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

    // Auto-arrange: Commit only enables once at least one option is picked.
    // Students WITHOUT a room are sorted (semester > program > name, only the ticked
    // ones apply) and placed room by room; boys and girls use their own rooms.
    const arrangeOptions = document.querySelectorAll(".arrange-option");
    const commitBtn = document.getElementById("btn-commit-arrange");
    if (arrangeOptions.length && commitBtn) {
        arrangeOptions.forEach(cb => cb.addEventListener("change", () => {
            const anyChecked = Array.from(arrangeOptions).some(c => c.checked);
            commitBtn.disabled = !anyChecked;
            commitBtn.classList.toggle("disabled", !anyChecked);
        }));
        commitBtn.addEventListener("click", () => {
            const picked = Array.from(arrangeOptions).filter(c => c.checked).map(c => c.value);
            confirmAutoArrange(picked);
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

            dashboardRooms = (stats.hardware && stats.hardware.rooms) || [];
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
    const hasStudents = (r.student_count || 0) > 0;
    return `
        <div class="room-box ${statusClass}" tabindex="0">
            <span class="room-number">${escapeHtml(r.room_number)}</span>
            <div class="room-hover-card">
                <strong>Room ${escapeHtml(r.room_number)}</strong>
                <p>${escapeHtml(statusText)}</p>
                <div class="room-hover-actions">
                    <button class="btn-room-action" disabled title="Coming soon">Access Codes</button>
                    <button class="btn-room-action btn-room-details" ${hasStudents ? `onclick="filterStudentsByRoom(${Number(r.id)})"` : 'disabled'}
                            title="${hasStudents ? 'Show the students in this room' : 'No students in this room yet'}">Student Details</button>
                </div>
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
        if (activeRoomFilter && student.room_id !== activeRoomFilter.id) return false;
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

    updateRoomFilterBanner();

    if (filtered.length === 0) {
        showEmptyTable(activeRoomFilter ? "No students are assigned to this room." : "No active students found.");
        return;
    }

    filtered.forEach(student => {
        const tr = document.createElement("tr");

        const studentName = student.full_name || 'Student';
        const avatarUrl = getDynamicAvatar(student);
        const fallbackMaleAvatar = '/image/default_Male.svg';

        const userIdVal = student.user_id ? student.user_id : 'null';
        const appIdVal = student.application_id ? student.application_id : 'null';

        // Room state: yellow = on hold (no room), green = boy assigned, pink = girl assigned
        const g = normGender(student.gender);
        const hasRoom = !!student.room_id;
        const roomLabel = hasRoom ? `Block ${student.room_block} / ${student.room_number}` : '';
        const btnClass = !hasRoom ? 'room-hold' : (g === 'F' ? 'room-girl' : 'room-boy');
        const btnTitle = hasRoom ? `${roomLabel} - click to change or remove` : 'On hold (no room yet) - click to assign a room';
        const chip = hasRoom
            ? `<span class="room-chip ${btnClass}">${escapeHtml(roomLabel)}</span>`
            : `<span class="room-chip room-hold">On hold - no room</span>`;

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
                        <small style="color: var(--text-muted);">${student.email || '-'}</small><br>
                        ${chip}
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
                <button class="btn-action-icon ${btnClass}" onclick="openAssignModal(${appIdVal})" title="${escapeHtml(btnTitle)}">
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

// ==========================================================================
// ROOM ASSIGNMENT (manual Assign pop-up + auto-arrange Commit)
// ==========================================================================
function getAdminId() {
    try {
        const u = JSON.parse(localStorage.getItem("userData") || "{}");
        return u.id || u.user_id || null;
    } catch (e) {
        return null;
    }
}

function escapeHtml(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Lelaki / Male / L -> 'M', Perempuan / Female / P -> 'F', anything else -> null
function normGender(g) {
    const v = String(g || '').toLowerCase().trim();
    if (['perempuan', 'female', 'wanita', 'p', 'f'].includes(v)) return 'F';
    if (['lelaki', 'male', 'l', 'm'].includes(v)) return 'M';
    return null;
}

function roomGenderOf(room) {
    return String(room.gender || 'M').toUpperCase().startsWith('F') ? 'F' : 'M';
}

// Small reusable pop-up
function showModal({ title, bodyHtml, buttons }) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'dash-modal';
    overlay.innerHTML = `
        <div class="modal-content dash-modal-content">
            <h2>${escapeHtml(title)}</h2>
            <div class="dash-modal-body">${bodyHtml}</div>
            <div class="modal-btns" id="dash-modal-btns"></div>
        </div>`;
    document.body.appendChild(overlay);

    const btnBox = overlay.querySelector('#dash-modal-btns');
    (buttons || []).forEach(b => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = b.cls || 'btn-secondary';
        btn.textContent = b.label;
        btn.addEventListener('click', () => b.onClick ? b.onClick(btn) : closeModal());
        btnBox.appendChild(btn);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    return overlay;
}

function closeModal() {
    const old = document.getElementById('dash-modal');
    if (old) old.remove();
}

function showInfoModal(title, message) {
    showModal({
        title,
        bodyHtml: `<p>${escapeHtml(message)}</p>`,
        buttons: [{ label: 'OK', cls: 'btn-commit', onClick: closeModal }]
    });
}

async function postJson(path, payload) {
    const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
    if (!res.ok) {
        const base = data.error || `Request failed (${res.status})`;
        throw new Error(data.details ? `${base} - ${data.details}` : base);
    }
    return data;
}

// ---------- Manual assign / change / remove ----------
function openAssignModal(applicationId) {
    const student = activeStudentsList.find(s => s.application_id === applicationId);
    if (!student) return;

    const g = normGender(student.gender);
    if (!g) {
        showInfoModal('Gender missing', `${student.full_name || 'This student'} has no gender on record, so a room cannot be chosen.`);
        return;
    }

    // Rooms for this gender only. Free spaces exclude this student's own current room spot.
    const rooms = dashboardRooms
        .filter(r => roomGenderOf(r) === g)
        .map(r => {
            const taken = (r.student_count || 0) - (r.id === student.room_id ? 1 : 0);
            return { ...r, free: (r.capacity || 0) - taken };
        });

    if (rooms.length === 0) {
        showInfoModal('No rooms available', `No ${g === 'F' ? 'girls' : 'boys'} rooms are registered in the system yet.`);
        return;
    }

    const blocks = [...new Set(rooms.map(r => r.block_name))];
    const startBlock = student.room_id ? student.room_block : blocks[0];

    const overlay = showModal({
        title: student.room_id ? 'Change Room' : 'Assign Room',
        bodyHtml: `
            <p class="dash-modal-sub"><strong>${escapeHtml(student.full_name || 'Student')}</strong>
               &middot; ${g === 'F' ? 'Girl' : 'Boy'} &middot; ${escapeHtml(student.program || '-')}
               ${student.semester ? '&middot; Sem ' + escapeHtml(student.semester) : ''}</p>
            ${student.room_id ? `<p class="dash-modal-sub">Current: Block ${escapeHtml(student.room_block)} / ${escapeHtml(student.room_number)}</p>` : ''}
            <label class="dash-label">Block</label>
            <select id="assign-block" class="dash-select">
                ${blocks.map(b => `<option value="${escapeHtml(b)}" ${b === startBlock ? 'selected' : ''}>Block ${escapeHtml(b)}</option>`).join('')}
            </select>
            <label class="dash-label">Room</label>
            <select id="assign-room" class="dash-select"></select>
            <p id="assign-msg" class="dash-msg"></p>`,
        buttons: [
            { label: 'Cancel', cls: 'btn-secondary', onClick: closeModal },
            ...(student.room_id ? [{ label: 'Remove Room', cls: 'btn-danger', onClick: () => removeRoom(student) }] : []),
            { label: 'Assign', cls: 'btn-commit', onClick: (btn) => submitAssign(student, btn) }
        ]
    });

    const blockSel = overlay.querySelector('#assign-block');
    const roomSel = overlay.querySelector('#assign-room');

    function fillRooms() {
        const inBlock = rooms.filter(r => r.block_name === blockSel.value);
        roomSel.innerHTML = inBlock.map(r => {
            const full = r.free <= 0;
            const label = `${r.room_number} - ${Math.max(r.free, 0)}/${r.capacity || 0} free${r.online ? '' : ' (door offline)'}${full ? ' - FULL' : ''}`;
            const selected = r.id === student.room_id ? 'selected' : '';
            return `<option value="${r.id}" ${full ? 'disabled' : ''} ${selected}>${escapeHtml(label)}</option>`;
        }).join('');
        // If nothing is selected (e.g. first rooms are full), pick the first free one
        if (roomSel.selectedOptions.length === 0 || roomSel.selectedOptions[0].disabled) {
            const firstFree = Array.from(roomSel.options).find(o => !o.disabled);
            if (firstFree) firstFree.selected = true;
        }
    }
    blockSel.addEventListener('change', fillRooms);
    fillRooms();
}

async function submitAssign(student, btn) {
    const roomSel = document.getElementById('assign-room');
    const msg = document.getElementById('assign-msg');
    const roomId = roomSel && roomSel.value ? Number(roomSel.value) : null;
    if (!roomId) { if (msg) msg.textContent = 'Please choose a room with free space.'; return; }

    btn.disabled = true;
    try {
        await postJson('/api/admin/dashboard/assign', {
            admin_id: getAdminId(),
            application_id: student.application_id,
            room_id: roomId
        });
        closeModal();
        await Promise.all([loadDashboardStats(), loadActiveStudents()]);
    } catch (err) {
        btn.disabled = false;
        if (msg) msg.textContent = err.message;
    }
}

async function removeRoom(student) {
    try {
        await postJson('/api/admin/dashboard/unassign', {
            admin_id: getAdminId(),
            application_id: student.application_id
        });
        closeModal();
        await Promise.all([loadDashboardStats(), loadActiveStudents()]);
    } catch (err) {
        const msg = document.getElementById('assign-msg');
        if (msg) msg.textContent = err.message;
    }
}

// ---------- Auto-arrange (Commit) ----------
function confirmAutoArrange(picked) {
    const waiting = activeStudentsList.filter(s => !s.room_id).length;
    if (waiting === 0) {
        showInfoModal('Nothing to arrange', 'Every active student already has a room.');
        return;
    }

    const order = ['semester', 'program', 'name'].filter(k => picked.includes(k))
        .map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(' \u2192 ');

    showModal({
        title: 'Commit Auto-Arrange?',
        bodyHtml: `<p><strong>${waiting}</strong> student(s) without a room will be placed, sorted by <strong>${escapeHtml(order)}</strong>.
                   Students who already have a room are not touched. Boys and girls are placed in their own rooms.</p>`,
        buttons: [
            { label: 'Cancel', cls: 'btn-secondary', onClick: closeModal },
            { label: 'Commit', cls: 'btn-commit', onClick: (btn) => runAutoArrange(picked, btn) }
        ]
    });
}

async function runAutoArrange(picked, btn) {
    btn.disabled = true;
    btn.textContent = 'Working...';
    try {
        const r = await postJson('/api/admin/dashboard/auto-arrange', {
            admin_id: getAdminId(),
            sort_by: picked
        });
        await Promise.all([loadDashboardStats(), loadActiveStudents()]);

        const lines = [`${r.assigned} student(s) assigned.`];
        if (r.unplaced > 0) lines.push(`${r.unplaced} could not be placed (no free room for their gender) and stay on hold.`);
        if (r.skipped_no_gender > 0) lines.push(`${r.skipped_no_gender} skipped because their gender is missing.`);
        showModal({
            title: 'Auto-Arrange Done',
            bodyHtml: lines.map(l => `<p>${escapeHtml(l)}</p>`).join(''),
            buttons: [{ label: 'OK', cls: 'btn-commit', onClick: closeModal }]
        });
    } catch (err) {
        showInfoModal('Auto-arrange failed', err.message);
    }
}

// ---------- Room "Student Details" -> filter the Active Registered Students list ----------
function filterStudentsByRoom(roomId) {
    const room = dashboardRooms.find(r => r.id === roomId);
    if (!room) return;
    activeRoomFilter = { id: room.id, label: `Block ${room.block_name} / ${room.room_number}` };
    renderActiveStudentsTable();

    const table = document.getElementById("active-students-tbody");
    const section = table ? table.closest(".section-container") : null;
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearRoomFilter() {
    activeRoomFilter = null;
    renderActiveStudentsTable();
}

function updateRoomFilterBanner() {
    const banner = document.getElementById("room-filter-banner");
    if (!banner) return;
    if (!activeRoomFilter) {
        banner.hidden = true;
        banner.innerHTML = "";
        return;
    }
    banner.hidden = false;
    banner.innerHTML = `<span>Showing students in <strong>${escapeHtml(activeRoomFilter.label)}</strong></span>
                        <button type="button" class="btn-clear-filter" onclick="clearRoomFilter()">Show all students</button>`;
}