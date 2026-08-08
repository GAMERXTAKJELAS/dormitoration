/**
 * Dormitoration - Admin Approval Table Frontend Controller
 * File: /script/approval_frontend.js
 */

let allStudents = [];
let currentFilter = 'all';

document.addEventListener("DOMContentLoaded", () => {
    const searchInput = document.getElementById("search-student");
    const filterBtns = document.querySelectorAll(".filter-btn");

    // Fetch existing application list from D1 via Worker API
    loadApplications();

    // Bind Live Search Input
    if (searchInput) {
        searchInput.addEventListener("input", renderTable);
    }

    // Bind Filter Buttons (All, Pending, Approved, Returned)
    filterBtns.forEach(btn => {
        btn.addEventListener("click", (e) => {
            filterBtns.forEach(b => b.classList.remove("active"));
            e.target.classList.add("active");
            currentFilter = e.target.getAttribute("data-filter");
            renderTable();
        });
    });
});

// Fetch data from Cloudflare Worker Endpoint
async function loadApplications() {
    try {
        const res = await fetch("/api/admin/applications");
        if (res.ok) {
            const data = await res.json();
            allStudents = data.data || [];
            renderTable();
        } else {
            showEmptyTable("Gagal memuatkan data permohonan.");
        }
    } catch (err) {
        console.error("Error loading applications:", err);
        showEmptyTable(`Ralat Rangkaian: ${err.message}`);
    }
}

// Render dynamic table rows
function renderTable() {
    const tbody = document.getElementById("approval-table-body");
    const searchVal = (document.getElementById("search-student")?.value || "").toLowerCase();

    if (!tbody) return;
    tbody.innerHTML = "";

    const filtered = allStudents.filter(item => {
        // 1. Status Filter Matching
        const status = (item.status || "pending").toLowerCase();
        const statusMatch = currentFilter === "all" || status === currentFilter.toLowerCase();

        // 2. Search Text Matching (Name, Email, Phone)
        const name = (item.full_name || "").toLowerCase();
        const email = (item.email || "").toLowerCase();
        const phone = (item.phone || "").toLowerCase();
        const searchMatch = name.includes(searchVal) || email.includes(searchVal) || phone.includes(searchVal);

        return statusMatch && searchMatch;
    });

    if (filtered.length === 0) {
        showEmptyTable("Tiada permohonan pelajar dijumpai.");
        return;
    }

    filtered.forEach(student => {
        const tr = document.createElement("tr");
        
        const status = (student.status || "pending").toLowerCase();
        let badgeClass = "warning";
        let statusLabel = "Pending";

        if (status === "approved") {
            badgeClass = "success";
            statusLabel = "Approved";
        } else if (status === "returned" || status === "rejected") {
            badgeClass = "danger";
            statusLabel = "Returned";
        }

        tr.innerHTML = `
            <td>
                <strong>${student.full_name || 'N/A'}</strong><br>
                <small style="color: var(--text-muted);">${student.email || student.phone || '-'}</small>
            </td>
            <td>${student.program || 'Pending Fill'}</td>
            <td>${student.session_id || '-'}</td>
            <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
            <td>
                <div class="action-btns">
                    <button class="btn-icon view" onclick="viewDetails(${student.user_id})" title="More Details">
                        <i class='bx bx-info-circle'></i>
                    </button>
                    <button class="btn-icon approve" onclick="updateApplicationStatus(${student.user_id}, 'approved')" title="Approve">
                        <i class='bx bx-check'></i>
                    </button>
                    <button class="btn-icon reject" onclick="updateApplicationStatus(${student.user_id}, 'returned')" title="Return">
                        <i class='bx bx-undo'></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function showEmptyTable(message) {
    const tbody = document.getElementById("approval-table-body");
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 30px;">
                    ${message}
                </td>
            </tr>
        `;
    }
}

// Update Application Status Action
async function updateApplicationStatus(userId, newStatus) {
    if (!confirm(`Adakah anda pasti mahu mengubah status permohonan kepada ${newStatus}?`)) return;

    try {
        const res = await fetch("/api/admin/applications/status", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId, status: newStatus })
        });

        const data = await res.json();

        if (res.ok) {
            alert("Status permohonan berjaya dikemaskini!");
            // Update local state and re-render
            const target = allStudents.find(s => s.user_id === userId);
            if (target) target.status = newStatus;
            renderTable();
        } else {
            alert(`Gagal mengemaskini: ${data.error || 'Server error'}`);
        }
    } catch (err) {
        console.error("Error updating status:", err);
        alert(`Ralat rangkaian: ${err.message}`);
    }
}

// Navigate to details page
function viewDetails(userId) {
    window.location.href = `/admin/application_details.html?id=${userId}`;
}