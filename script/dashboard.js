/**
 * Dormitoration - Admin Dashboard Controller
 * File: /script/dashboard.js
 */

let activeStudentsList = [];

document.addEventListener("DOMContentLoaded", () => {
    loadDashboardStats();
    loadActiveStudents();

    const searchInput = document.getElementById("active-student-search");
    if (searchInput) {
        searchInput.addEventListener("input", renderActiveStudentsTable);
    }
});

// Fetch Top Summary Metrics
async function loadDashboardStats() {
    try {
        const res = await fetch("/api/admin/dashboard/stats");
        if (res.ok) {
            const data = await res.json();
            const stats = data.stats || {};

            document.getElementById("stat-active-students").innerText = stats.active_students || 0;
            document.getElementById("stat-pending-apps").innerText = stats.pending_applications || 0;
        }
    } catch (err) {
        console.error("Error fetching stats:", err);
    }
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
            showEmptyTable("Gagal memuatkan senarai pelajar aktif.");
        }
    } catch (err) {
        console.error("Error loading active students:", err);
        showEmptyTable(`Ralat Rangkaian: ${err.message}`);
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
        showEmptyTable("Tiada pelajar aktif dijumpai.");
        return;
    }

    filtered.forEach(student => {
        const tr = document.createElement("tr");

        const studentName = student.full_name || 'Student';
        
        // Match exact SVG path from your project structure
        const gender = (student.gender || "").toLowerCase();
        const defaultAvatarPath = (gender === 'female' || gender === 'wanita' || gender === 'perempuan') 
            ? "/image/default_Female.svg" 
            : "/image/default_Male.svg";

        // Check if student has custom photo, otherwise fallback to local SVG path
        const avatarUrl = (student.profile_picture && student.profile_picture.trim() !== "") 
            ? student.profile_picture 
            : defaultAvatarPath;

        const userIdVal = student.user_id ? student.user_id : 'null';
        const appIdVal = student.application_id ? student.application_id : 'null';

        tr.innerHTML = `
            <td>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <img 
                        src="${avatarUrl}" 
                        alt="${studentName}" 
                        style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(16, 185, 129, 0.3); background-color: #1f2937; flex-shrink: 0;"
                        onerror="this.onerror=null; this.src='${defaultAvatarPath}';"
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
                <!-- View Details Icon Button -->
                <button class="btn-action-icon" onclick="viewStudentDetails(${userIdVal}, ${appIdVal})" title="View Details">
                    <i class='bx bx-info-circle'></i>
                </button>
                
                <!-- Assign Room Block (Greyed Out / Offline) -->
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