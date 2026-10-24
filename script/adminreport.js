// adminreport.js — admin "Facility Reports" page

const STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', resolved: 'Solved', rejected: 'Closed' };
const PRIORITY_LABELS = { low: 'Low', normal: 'Normal', urgent: 'Urgent' };
const CATEGORY_LABELS = {
    electrical: 'Electrical',
    plumbing: 'Plumbing',
    furniture: 'Furniture',
    aircond_fan: 'Fan / Air-conditioning',
    door_lock: 'Door / Lock',
    cleanliness: 'Cleanliness / Pests',
    internet: 'Internet / WiFi',
    other: 'Other'
};
const ACTIVE_STATUSES = ['open', 'in_progress']; // "Active" tab = not solved yet

let currentFilter = 'all';
let allReports = [];
let selectedReport = null;

/* ---------------- small helpers ---------------- */

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function getAdminId() {
    try {
        const userData = JSON.parse(localStorage.getItem('userData') || '{}');
        return userData.id || userData.user_id || null;
    } catch {
        return null;
    }
}

function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function isActiveReport(report) {
    return ACTIVE_STATUSES.includes(report.status);
}

function studentName(report) {
    return report.full_name || '(account removed)';
}

let toastTimer = null;
function showToast(message, isError) {
    const toast = document.getElementById('rptToast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `rpt-toast show${isError ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'rpt-toast'; }, 3200);
}

/* ---------------- loading + filtering ---------------- */

function visibleReports() {
    const q = document.getElementById('searchInput').value.trim().toLowerCase();
    if (!q) return allReports;
    return allReports.filter(r =>
        [r.full_name, r.title, r.location, r.phone, CATEGORY_LABELS[r.category], r.category]
            .some(v => v && String(v).toLowerCase().includes(q))
    );
}

function setTableMessage(text) {
    const tbody = document.getElementById('reportTableBody');
    tbody.innerHTML = '';
    const tr = el('tr');
    const td = el('td', 'rpt-empty', text);
    td.colSpan = 7;
    tr.appendChild(td);
    tbody.appendChild(tr);
}

function updateCounts(counts) {
    if (!counts) return;
    document.getElementById('countAll').textContent = counts.all;
    document.getElementById('countActive').textContent = counts.active;
    document.getElementById('countInactive').textContent = counts.inactive;
}

async function loadReports() {
    const adminId = getAdminId();
    if (!adminId) {
        setTableMessage('Please log in as an admin to see reports.');
        return;
    }

    try {
        const res = await fetch(`/api/admin/reports?admin_id=${encodeURIComponent(adminId)}&filter=${encodeURIComponent(currentFilter)}`);
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            setTableMessage(data.error || `Could not load reports (error ${res.status}).`);
            return;
        }

        allReports = data.reports || [];
        updateCounts(data.counts);
        renderTable();
    } catch (err) {
        console.error('Load reports error:', err);
        setTableMessage('Network error. Could not load reports.');
    }
}

function buildRow(report) {
    const tr = el('tr', 'rpt-row');
    tr.tabIndex = 0;
    tr.addEventListener('click', () => openDetail(report));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') openDetail(report); });

    tr.appendChild(el('td', '', formatDate(report.created_at)));

    const student = el('td');
    student.appendChild(el('div', 'rpt-cell-title', studentName(report)));
    if (report.phone) student.appendChild(el('div', 'rpt-cell-sub', report.phone));
    tr.appendChild(student);

    tr.appendChild(el('td', '', report.location));

    const issue = el('td');
    issue.appendChild(el('div', 'rpt-cell-title', report.title));
    const sub = `${CATEGORY_LABELS[report.category] || report.category}${report.has_photo ? ' · has photo' : ''}`;
    issue.appendChild(el('div', 'rpt-cell-sub', sub));
    tr.appendChild(issue);

    const priority = el('td');
    priority.appendChild(el('span', `rpt-badge p-${report.priority}`, PRIORITY_LABELS[report.priority] || report.priority));
    tr.appendChild(priority);

    const status = el('td');
    status.appendChild(el('span', `rpt-badge ${report.status}`, STATUS_LABELS[report.status] || report.status));
    tr.appendChild(status);

    const action = el('td');
    action.style.textAlign = 'right';
    if (isActiveReport(report)) {
        const solve = el('button', 'rpt-btn rpt-btn-primary rpt-btn-sm');
        solve.type = 'button';
        solve.innerHTML = "<i class='bx bx-check'></i> Solve";
        solve.addEventListener('click', e => { e.stopPropagation(); openSolveModal(report); });
        action.appendChild(solve);
    } else {
        action.appendChild(el('span', 'rpt-cell-sub', report.resolved_at ? formatDate(report.resolved_at) : '—'));
    }
    tr.appendChild(action);

    return tr;
}

function renderTable() {
    const rows = visibleReports();
    if (rows.length === 0) {
        const searching = document.getElementById('searchInput').value.trim() !== '';
        const where = currentFilter === 'all' ? '' : ` in "${currentFilter === 'active' ? 'Active' : 'Inactive'}"`;
        setTableMessage(searching ? 'No reports match your search.' : `No reports found${where}.`);
        return;
    }
    const tbody = document.getElementById('reportTableBody');
    tbody.innerHTML = '';
    rows.forEach(r => tbody.appendChild(buildRow(r)));
}

/* ---------------- detail modal ---------------- */

function metaItem(label, value) {
    const wrap = el('div');
    wrap.appendChild(el('dt', '', label));
    wrap.appendChild(el('dd', '', value || '—'));
    return wrap;
}

function openDetail(report) {
    selectedReport = report;

    document.getElementById('detailTitle').textContent = report.title;

    const badges = document.getElementById('detailBadges');
    badges.innerHTML = '';
    badges.appendChild(el('span', `rpt-badge ${report.status}`, STATUS_LABELS[report.status] || report.status));
    badges.appendChild(el('span', `rpt-badge p-${report.priority}`, `${PRIORITY_LABELS[report.priority] || report.priority} priority`));

    const meta = document.getElementById('detailMeta');
    meta.innerHTML = '';
    const dl = el('dl');
    dl.style.display = 'contents';
    dl.appendChild(metaItem('Student', studentName(report)));
    dl.appendChild(metaItem('Contact', [report.phone, report.email].filter(Boolean).join(' · ')));
    dl.appendChild(metaItem('Location', report.location));
    dl.appendChild(metaItem('Category', CATEGORY_LABELS[report.category] || report.category));
    dl.appendChild(metaItem('Reported', formatDate(report.created_at)));
    if (report.resolved_at) dl.appendChild(metaItem('Solved on', formatDate(report.resolved_at)));
    meta.appendChild(dl);

    document.getElementById('detailDesc').textContent = report.description;

    // Photo (loaded through the admin-only endpoint)
    const photoWrap = document.getElementById('detailPhotoWrap');
    const photoBox = document.getElementById('detailPhoto');
    photoBox.innerHTML = '';
    if (report.has_photo) {
        const adminId = getAdminId();
        const src = `/api/admin/report-photo?admin_id=${encodeURIComponent(adminId)}&report_id=${encodeURIComponent(report.id)}`;

        const loading = el('div', 'rpt-photo-msg', 'Loading photo...');
        const link = el('a');
        link.href = src;
        link.target = '_blank';
        link.rel = 'noopener';
        link.title = 'Open full size';
        link.style.display = 'none';

        const img = el('img');
        img.alt = 'Photo attached to the report';
        img.addEventListener('load', () => { loading.remove(); link.style.display = ''; });
        img.addEventListener('error', () => { loading.textContent = 'The photo could not be loaded.'; });
        img.src = src;

        link.appendChild(img);
        photoBox.append(loading, link);
        photoWrap.style.display = '';
    } else {
        photoWrap.style.display = 'none';
    }

    const noteWrap = document.getElementById('detailNoteWrap');
    if (report.admin_note) {
        document.getElementById('detailNote').textContent = report.admin_note;
        noteWrap.style.display = '';
    } else {
        noteWrap.style.display = 'none';
    }

    const active = isActiveReport(report);
    document.getElementById('detailSolveBtn').style.display = active ? '' : 'none';
    document.getElementById('detailReopenBtn').style.display = active ? 'none' : '';

    document.getElementById('detailModal').style.display = 'flex';
}

function closeDetail() {
    document.getElementById('detailModal').style.display = 'none';
    document.getElementById('detailPhoto').innerHTML = ''; // stops any in-flight image load
}

/* ---------------- solve / reopen ---------------- */

function openSolveModal(report) {
    selectedReport = report;
    document.getElementById('solveText').textContent = `"${report.title}" reported by ${studentName(report)}. The student will see it as resolved.`;
    document.getElementById('solveNote').value = report.admin_note || '';
    document.getElementById('solveError').style.display = 'none';
    document.getElementById('solveConfirmBtn').disabled = false;
    document.getElementById('solveModal').style.display = 'flex';
    document.getElementById('solveNote').focus();
}

function closeSolveModal() {
    document.getElementById('solveModal').style.display = 'none';
}

async function sendStatus(report, status, note) {
    const adminId = getAdminId();
    const payload = { admin_id: adminId, report_id: report.id, status };
    if (note !== undefined) payload.admin_note = note;

    const res = await fetch('/api/admin/reports/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
}

async function confirmSolve() {
    if (!selectedReport) return;
    const btn = document.getElementById('solveConfirmBtn');
    const errBox = document.getElementById('solveError');
    btn.disabled = true;
    errBox.style.display = 'none';

    try {
        await sendStatus(selectedReport, 'resolved', document.getElementById('solveNote').value);
        closeSolveModal();
        closeDetail();
        showToast('Report marked as solved.');
        await loadReports();
    } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = '';
        btn.disabled = false;
    }
}

async function reopenSelected() {
    if (!selectedReport) return;
    const btn = document.getElementById('detailReopenBtn');
    btn.disabled = true;
    try {
        await sendStatus(selectedReport, 'open'); // note left as it was
        closeDetail();
        showToast('Report reopened.');
        await loadReports();
    } catch (err) {
        showToast(err.message, true);
    } finally {
        btn.disabled = false;
    }
}

/* ---------------- CSV export (what is currently shown) ---------------- */

function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    // A cell starting with = + - @ can run as a formula when opened in Excel, so defuse it
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
}

function buildReportsCsv(reports) {
    const header = ['ID', 'Reported', 'Student', 'Phone', 'Email', 'Location', 'Category', 'Priority', 'Title', 'Description', 'Status', 'Admin note', 'Solved on'];
    const lines = [header.map(csvCell).join(',')];
    reports.forEach(r => {
        lines.push([
            r.id,
            r.created_at,
            studentName(r),
            r.phone,
            r.email,
            r.location,
            CATEGORY_LABELS[r.category] || r.category,
            PRIORITY_LABELS[r.priority] || r.priority,
            r.title,
            r.description,
            STATUS_LABELS[r.status] || r.status,
            r.admin_note,
            r.resolved_at
        ].map(csvCell).join(','));
    });
    return lines.join('\r\n');
}

function exportCsv() {
    const rows = visibleReports();
    if (rows.length === 0) {
        showToast('There is nothing to export.', true);
        return;
    }
    const blob = new Blob(['\ufeff' + buildReportsCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `facility-reports-${currentFilter}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/* ---------------- init ---------------- */

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.rpt-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.rpt-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            loadReports();
        });
    });

    document.getElementById('searchInput').addEventListener('input', renderTable);
    document.getElementById('btnExport').addEventListener('click', exportCsv);

    document.getElementById('detailCloseX').addEventListener('click', closeDetail);
    document.getElementById('detailCloseBtn').addEventListener('click', closeDetail);
    document.getElementById('detailSolveBtn').addEventListener('click', () => openSolveModal(selectedReport));
    document.getElementById('detailReopenBtn').addEventListener('click', reopenSelected);
    document.getElementById('solveCancelBtn').addEventListener('click', closeSolveModal);
    document.getElementById('solveConfirmBtn').addEventListener('click', confirmSolve);

    // Clicking the dark backdrop closes a modal; Escape closes the top-most one
    document.getElementById('detailModal').addEventListener('click', e => { if (e.target.id === 'detailModal') closeDetail(); });
    document.getElementById('solveModal').addEventListener('click', e => { if (e.target.id === 'solveModal') closeSolveModal(); });
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (document.getElementById('solveModal').style.display === 'flex') closeSolveModal();
        else if (document.getElementById('detailModal').style.display === 'flex') closeDetail();
    });

    loadReports();
});
