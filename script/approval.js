/**
 * Dormitoration - Admin Approval Table Frontend Controller
 * File: /script/approval_frontend.js
 */

let allStudents = [];
let currentFilter = 'all';

document.addEventListener("DOMContentLoaded", () => {
    const searchInput = document.getElementById("search-student");
    const filterBtns = document.querySelectorAll(".filter-btn");
    const csvFileInput = document.getElementById("csv-file-input");

    // Fetch application list from D1 via Worker API
    loadApplications();

    // Bind Live Search
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

    // Handle CSV File Selection & Upload
    if (csvFileInput) {
        csvFileInput.addEventListener("change", handleCSVUpload);
    }
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
        const status = (item.status || "pending").toLowerCase();
        const statusMatch = currentFilter === "all" || status === currentFilter.toLowerCase();

        const name = (item.full_name || "").toLowerCase();
        const email = (item.email || "").toLowerCase();
        const phone = (item.phone || "").toLowerCase();
        const ic = (item.ic_number || "").toLowerCase();
        
        const searchMatch = name.includes(searchVal) || email.includes(searchVal) || phone.includes(searchVal) || ic.includes(searchVal);

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
                <small style="color: var(--text-muted);">${student.email || student.ic_number || student.phone || '-'}</small>
            </td>
            <td>${student.program || 'Pending Fill'}</td>
            <td>${student.session_id || '-'}</td>
            <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
            <td>
                <div class="action-btns">
                    <button class="btn-icon view" onclick="viewDetails(${student.user_id || student.id})" title="More Details">
                        <i class='bx bx-info-circle'></i>
                    </button>
                    <button class="btn-icon approve" onclick="updateApplicationStatus(${student.user_id || student.id}, 'approved')" title="Approve">
                        <i class='bx bx-check'></i>
                    </button>
                    <button class="btn-icon reject" onclick="updateApplicationStatus(${student.user_id || student.id}, 'returned')" title="Return">
                        <i class='bx bx-x'></i>
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

// 3. Handle CSV File Upload & Parsing
async function handleCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
        const res = await fetch("/api/admin/applications/import-csv", {
            method: "POST",
            body: formData
        });

        const result = await res.json();
        if (res.ok) {
            alert(`Muat naik CSV berjaya! ${result.insertedCount || 0} rekod pelajar telah ditambah/diselaraskan.`);
            loadApplications(); // Refresh list
        } else {
            alert(`Gagal memuat naik CSV: ${result.error || 'Server error'}`);
        }
    } catch (err) {
        console.error("Error uploading CSV:", err);
        alert(`Ralat rangkaian semasa muat naik CSV: ${err.message}`);
    } finally {
        event.target.value = ''; // Reset input
    }
}

// Update Application Status Action
async function updateApplicationStatus(userId, newStatus) {
    const actionText = newStatus === 'returned' ? 'kembalikan (returned)' : 'luluskan (approved)';
    if (!confirm(`Adakah anda pasti mahu ${actionText} permohonan ini?`)) return;

    try {
        const res = await fetch("/api/admin/applications/status", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId, status: newStatus })
        });

        const data = await res.json();

        if (res.ok) {
            alert("Status permohonan berjaya dikemaskini!");
            loadApplications();
        } else {
            alert(`Gagal mengemaskini: ${data.error || 'Server error'}`);
        }
    } catch (err) {
        console.error("Error updating status:", err);
        alert(`Ralat rangkaian: ${err.message}`);
    }
}

function viewDetails(userId) {
    window.location.href = `/admin/application_details.html?id=${userId}`;
}