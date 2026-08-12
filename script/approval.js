/**
 * Dormitoration - Admin Approval Table Frontend Controller
 * File: /script/approval.js
 */

let allStudents = [];
let currentFilter = 'all';

document.addEventListener("DOMContentLoaded", () => {
    const searchInput = document.getElementById("search-student");
    const filterBtns = document.querySelectorAll(".filter-btn");
    const csvFileInput = document.getElementById("csv-file-input");

    loadApplications();

    if (searchInput) {
        searchInput.addEventListener("input", renderTable);
    }

    filterBtns.forEach(btn => {
        btn.addEventListener("click", (e) => {
            filterBtns.forEach(b => b.classList.remove("active"));
            e.target.classList.add("active");
            currentFilter = e.target.getAttribute("data-filter");
            renderTable();
        });
    });

    if (csvFileInput) {
        csvFileInput.addEventListener("change", handleCSVUpload);
    }
});

// Fetch application data from Cloudflare Worker Endpoint
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

// Render dynamic table rows with Profile Picture integration
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

        const userIdVal = student.user_id ? student.user_id : 'null';
        const appIdVal = student.application_id ? student.application_id : 'null';

        // Profile Picture Logic: Fallback to generated initials avatar if empty/null
        const studentName = student.full_name || 'Student';
        const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(studentName)}&background=10B981&color=fff&bold=true`;
        const avatarUrl = student.profile_picture || defaultAvatar;

        tr.innerHTML = `
            <td>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <img 
                        src="${avatarUrl}" 
                        alt="${studentName}" 
                        style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(16, 185, 129, 0.3); background-color: #1f2937; flex-shrink: 0;"
                        onerror="this.onerror=null; this.src='${defaultAvatar}';"
                    />
                    <div>
                        <strong style="color: #ffffff;">${student.full_name || 'N/A'}</strong><br>
                        <small style="color: var(--text-muted);">${student.email || student.ic_number || student.phone || '-'}</small>
                    </div>
                </div>
            </td>
            <td>${student.program || 'Pending Fill'}</td>
            <td>${student.session_id || '-'}</td>
            <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
            <td>
                <div class="action-btns">
                    <button class="btn-icon view" onclick="viewDetails(${userIdVal}, ${appIdVal})" title="More Details">
                        <i class='bx bx-info-circle'></i>
                    </button>
                    <button class="btn-icon approve" onclick="updateApplicationStatus(${userIdVal}, ${appIdVal}, 'approved')" title="Approve">
                        <i class='bx bx-check'></i>
                    </button>
                    <button class="btn-icon reject" onclick="updateApplicationStatus(${userIdVal}, ${appIdVal}, 'returned')" title="Return">
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

// Robust CSV Reader with Header Normalization & Quotes Handling
async function handleCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            const text = e.target.result;
            // Remove UTF-8 BOM if present and split lines
            const cleanedText = text.replace(/^\uFEFF/, '');
            const lines = cleanedText.split(/\r\n|\n/).map(line => line.trim()).filter(line => line.length > 0);
            
            if (lines.length <= 1) {
                alert("Fail CSV tidak mempunyai rekod data.");
                return;
            }

            // Regex-based CSV row splitter to support commas inside quotes
            const parseCSVRow = (rowStr) => {
                const result = [];
                let insideQuotes = false;
                let currentValue = '';

                for (let i = 0; i < rowStr.length; i++) {
                    const char = rowStr[i];
                    if (char === '"' || char === "'") {
                        insideQuotes = !insideQuotes;
                    } else if (char === ',' && !insideQuotes) {
                        result.push(currentValue.trim().replace(/^["']|["']$/g, ''));
                        currentValue = '';
                    } else {
                        currentValue += char;
                    }
                }
                result.push(currentValue.trim().replace(/^["']|["']$/g, ''));
                return result;
            };

            // Parse and normalize headers (e.g., "NO. IC / MYKAD" -> "no_ic_mykad")
            const rawHeaders = parseCSVRow(lines[0]);
            const normalizedHeaders = rawHeaders.map(h => 
                h.toLowerCase()
                 .replace(/[^a-z0-9]/g, '_') // Replace symbols/spaces with underscores
                 .replace(/_+/g, '_')        // Collapse duplicate underscores
                 .replace(/^_+|_+$/g, '')    // Trim leading/trailing underscores
            );

            const studentData = [];

            for (let i = 1; i < lines.length; i++) {
                const values = parseCSVRow(lines[i]);
                if (values.length === 0 || (values.length === 1 && !values[0])) continue;

                let rowObj = {};
                normalizedHeaders.forEach((header, idx) => {
                    rowObj[header] = values[idx] !== undefined ? values[idx] : '';
                });

                studentData.push(rowObj);
            }

            console.log("Parsed CSV Batch:", studentData); // Debug log to inspect parsed payload

            // POST parsed array as JSON to Worker
            const res = await fetch("/api/admin/applications/import-csv", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ students: studentData })
            });

            const result = await res.json();

            if (res.ok) {
                alert(`Muat naik CSV berjaya! ${result.insertedCount || 0} rekod pelajar telah ditambah/diselaraskan.`);
                loadApplications();
            } else {
                alert(`Gagal memuat naik CSV: ${result.error || 'Server error'}`);
            }

        } catch (err) {
            console.error("Error processing CSV:", err);
            alert(`Ralat memproses fail CSV: ${err.message}`);
        } finally {
            event.target.value = '';
        }
    };

    reader.readAsText(file);
}

// Update Application Status Action
async function updateApplicationStatus(userId, appId, newStatus) {
    const actionText = newStatus === 'returned' ? 'kembalikan (returned)' : 'luluskan (approved)';
    if (!confirm(`Adakah anda pasti mahu ${actionText} permohonan ini?`)) return;

    try {
        const res = await fetch("/api/admin/applications/status", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                user_id: userId !== 'null' ? userId : null, 
                application_id: appId !== 'null' ? appId : null, 
                status: newStatus 
            })
        });

        const data = await res.json();

        if (res.ok) {
            alert("Status permohonan berjaya dikemaskini!");
            
            // Update local state for immediate response
            const target = allStudents.find(s => 
                (userId !== 'null' && Number(s.user_id) === Number(userId)) || 
                (appId !== 'null' && Number(s.application_id) === Number(appId))
            );
            if (target) {
                target.status = newStatus;
            }
            renderTable();
        } else {
            alert(`Gagal mengemaskini: ${data.error || 'Server error'}`);
        }
    } catch (err) {
        console.error("Error updating status:", err);
        alert(`Ralat rangkaian: ${err.message}`);
    }
}

function viewDetails(userId, appId) {
    const targetQuery = (userId && userId !== 'null') ? `id=${userId}` : `app_id=${appId}`;
    window.location.href = `/admin/application_details.html?${targetQuery}`;
}