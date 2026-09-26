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
            console.log("Loaded Students Data:", allStudents);
            renderTable();
        } else {
            showEmptyTable("Gagal memuatkan data permohonan.");
        }
    } catch (err) {
        console.error("Error loading applications:", err);
        showEmptyTable(`Ralat Rangkaian: ${err.message}`);
    }
}

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

// Render dynamic table rows with local SVG avatar integration & deep search
function renderTable() {
    const tbody = document.getElementById("approval-table-body");
    const searchVal = (document.getElementById("search-student")?.value || "").toLowerCase().trim();

    if (!tbody) return;
    tbody.innerHTML = "";

    const filtered = allStudents.filter(item => {
        // 1. Status Filter (All, Pending, Approved, Returned)
        const status = (item.status || "pending").toLowerCase();
        const statusMatch = currentFilter === "all" || status === currentFilter.toLowerCase();

        // 2. Multi-field Search Filter across ALL properties from users & hostel_applications tables
        let searchMatch = true;
        if (searchVal) {
            searchMatch = Object.values(item).some(value => {
                if (value === null || value === undefined) return false;
                return String(value).toLowerCase().includes(searchVal);
            });
        }

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
        const isFlagged = Number(student.flagged_attachment_count) > 0;

        // Get SVG image path based on gender or custom profile picture
        const avatarUrl = getDynamicAvatar(student);
        const fallbackMaleAvatar = '/image/default_Male.svg';

        tr.innerHTML = `
            <td>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <img 
                        src="${avatarUrl}" 
                        alt="${student.full_name || 'Student'}" 
                        style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 1px solid rgba(16, 185, 129, 0.3); background-color: #1f2937; flex-shrink: 0;"
                        onerror="this.onerror=null; this.src='${fallbackMaleAvatar}';"
                    />
                    <div>
                        <strong style="color: var(--text-color, #ffffff);">${student.full_name || 'N/A'}</strong><br>
                        <small style="color: var(--text-muted, #94a3b8);">${student.email || student.ic_number || student.phone || '-'}</small>
                    </div>
                </div>
            </td>
            <td>${student.program || 'Pending Fill'}</td>
            <td>${student.session_id || '-'}</td>
            <td>
                <span class="badge ${badgeClass}">${statusLabel}</span>
                ${isFlagged ? `<span class="badge danger" title="AI flagged an attached document as suspicious" style="margin-left: 6px;"><i class='bx bx-error'></i> Check File</span>` : ''}
            </td>
            <td>
                <div class="action-btns">
                    ${isFlagged ? `
                    <button class="btn-icon reject" onclick="reviewFlaggedAttachment(${appIdVal})" title="Review flagged attachment">
                        <i class='bx bx-file-find'></i>
                    </button>` : ''}
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

function reviewFlaggedAttachment(appId) {
    if (!appId || appId === 'null') return;
    window.open(`/api/admin/payslip?application_id=${appId}`, '_blank');
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

// Robust CSV Reader with Auto-Delimiter Detection & Quotes Handling
async function handleCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            const text = e.target.result;
            const cleanedText = text.replace(/^\uFEFF/, '');
            const lines = cleanedText.split(/\r\n|\n/).map(line => line.trim()).filter(line => line.length > 0);
            
            if (lines.length <= 1) {
                alert("Fail CSV tidak mempunyai rekod data.");
                return;
            }

            // Detect delimiter (, or ;)
            const firstLine = lines[0];
            const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

            const parseCSVRow = (rowStr) => {
                const result = [];
                let insideQuotes = false;
                let currentValue = '';

                for (let i = 0; i < rowStr.length; i++) {
                    const char = rowStr[i];
                    if (char === '"' || char === "'") {
                        insideQuotes = !insideQuotes;
                    } else if (char === delimiter && !insideQuotes) {
                        result.push(currentValue.trim().replace(/^["']|["']$/g, ''));
                        currentValue = '';
                    } else {
                        currentValue += char;
                    }
                }
                result.push(currentValue.trim().replace(/^["']|["']$/g, ''));
                return result;
            };

            const rawHeaders = parseCSVRow(lines[0]);
            const normalizedHeaders = rawHeaders.map(h => 
                h.toLowerCase()
                 .replace(/[^a-z0-9]/g, '_')
                 .replace(/_+/g, '_')
                 .replace(/^_+|_+$/g, '')
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

            console.log("Parsed CSV Batch:", studentData);

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

// Custom Confirm Modal (replaces native browser confirm())
function showConfirmModal({ title, message, iconClass = 'bx-check-circle', iconColor = 'var(--primary-color)', confirmText = 'Confirm', confirmClass = 'btn-confirm', hideCancel = false }) {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirm-action-modal');
        const titleEl = document.getElementById('confirm-modal-title');
        const msgEl = document.getElementById('confirm-modal-message');
        const iconEl = document.getElementById('confirm-modal-icon');
        const okBtn = document.getElementById('confirm-modal-ok');
        const cancelBtn = document.getElementById('confirm-modal-cancel');

        titleEl.textContent = title;
        msgEl.textContent = message;
        iconEl.className = `bx ${iconClass}`;
        iconEl.style.color = iconColor;
        okBtn.textContent = confirmText;
        okBtn.className = confirmClass;
        cancelBtn.style.display = hideCancel ? 'none' : '';

        modal.style.display = 'flex';

        function cleanup(result) {
            modal.style.display = 'none';
            cancelBtn.style.display = '';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            resolve(result);
        }
        function onOk() { cleanup(true); }
        function onCancel() { cleanup(false); }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
    });
}

// Custom Info/Alert Modal (replaces native browser alert()) — single "OK" button
function showInfoModal({ title, message, iconClass = 'bx-check-circle', iconColor = 'var(--primary-color)', okText = 'OK' }) {
    return showConfirmModal({
        title,
        message,
        iconClass,
        iconColor,
        confirmText: okText,
        confirmClass: 'btn-confirm',
        hideCancel: true
    });
}

// Update Application Status Action
async function updateApplicationStatus(userId, appId, newStatus) {
    const isApprove = newStatus !== 'returned';
    const actionText = isApprove ? 'approve' : 'return';

    const confirmed = await showConfirmModal({
        title: isApprove ? 'Approve Application?' : 'Return Application?',
        message: `Are you sure you want to ${actionText} this application?`,
        iconClass: isApprove ? 'bx-check-circle' : 'bx-undo',
        iconColor: isApprove ? 'var(--primary-color)' : '#f2994a',
        confirmText: isApprove ? 'Yes, Approve' : 'Yes, Return',
        confirmClass: isApprove ? 'btn-confirm' : 'btn-danger'
    });
    if (!confirmed) return;

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
            if (data.qrWarning) {
                await showInfoModal({
                    title: 'Status Updated — QR Code Issue',
                    message: `Application status updated successfully, but the QR access code failed to generate: ${data.qrWarning}`,
                    iconClass: 'bx-error',
                    iconColor: '#f2994a'
                });
            } else {
                await showInfoModal({
                    title: 'Success',
                    message: 'Application status updated successfully!',
                    iconClass: 'bx-check-circle',
                    iconColor: 'var(--primary-color)'
                });
            }

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
            await showInfoModal({
                title: 'Update Failed',
                message: `Failed to update: ${data.error || 'Server error'}`,
                iconClass: 'bx-x-circle',
                iconColor: '#ef4444'
            });
        }
    } catch (err) {
        console.error("Error updating status:", err);
        await showInfoModal({
            title: 'Network Error',
            message: `Network error: ${err.message}`,
            iconClass: 'bx-wifi-off',
            iconColor: '#ef4444'
        });
    }
}

function viewDetails(userId, appId) {
    const targetQuery = (userId && userId !== 'null') ? `id=${userId}` : `app_id=${appId}`;
    window.location.href = `/admin/application_details.html?${targetQuery}`;
}