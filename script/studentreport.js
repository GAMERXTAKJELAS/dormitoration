// studentreport.js — student "Submit a Report" page

const MAX_ORIGINAL_BYTES = 15 * 1024 * 1024; // refuse absurdly large originals before even trying to resize
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;    // must match MAX_PHOTO_BYTES in report_backend.js
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const STATUS_LABELS = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', rejected: 'Rejected' };
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

let photoDataUrl = '';

function getUserId() {
    try {
        const userData = JSON.parse(localStorage.getItem('userData') || '{}');
        return userData.id || userData.user_id || null;
    } catch {
        return null;
    }
}

function showMessage(text, type) {
    const box = document.getElementById('reportMsg');
    if (!box) return;
    box.className = `message-banner ${type}`;
    box.textContent = text;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearMessage() {
    const box = document.getElementById('reportMsg');
    if (box) { box.className = 'message-banner'; box.textContent = ''; }
}

/* ---------------- photo handling ---------------- */

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
        img.src = url;
    });
}

// Shrinks the photo so a phone camera picture (often 4-8 MB) becomes a few hundred KB.
async function shrinkImage(file) {
    const img = await loadImage(file);

    const attempts = [
        { maxSide: 1280, quality: 0.8 },
        { maxSide: 1280, quality: 0.6 },
        { maxSide: 960, quality: 0.6 }
    ];

    for (const { maxSide, quality } of attempts) {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; // PNG transparency would turn black in JPEG otherwise
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const approxBytes = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
        if (approxBytes <= MAX_UPLOAD_BYTES) return dataUrl;
    }
    throw new Error('That photo is still too large after resizing. Please choose a smaller one.');
}

async function handlePhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
        showMessage('Photo must be a JPG, PNG or WebP image.', 'error');
        event.target.value = '';
        return;
    }
    if (file.size > MAX_ORIGINAL_BYTES) {
        showMessage('That photo is too large. Please choose one under 15 MB.', 'error');
        event.target.value = '';
        return;
    }

    clearMessage();
    document.getElementById('photoName').textContent = 'Processing photo...';

    try {
        photoDataUrl = await shrinkImage(file);
        const preview = document.getElementById('photoPreview');
        preview.src = photoDataUrl;
        preview.style.display = 'block';
        document.getElementById('photoName').textContent = file.name;
        document.getElementById('btnPhotoRemove').style.display = '';
    } catch (err) {
        photoDataUrl = '';
        document.getElementById('photoName').textContent = 'No photo selected';
        showMessage(err.message, 'error');
        event.target.value = '';
    }
}

function removePhoto() {
    photoDataUrl = '';
    document.getElementById('photoInput').value = '';
    document.getElementById('photoName').textContent = 'No photo selected';
    document.getElementById('photoPreview').style.display = 'none';
    document.getElementById('btnPhotoRemove').style.display = 'none';
}

/* ---------------- submit ---------------- */

function validateForm() {
    const required = ['category', 'location', 'title', 'description'];
    let firstBad = null;

    required.forEach(id => {
        const el = document.getElementById(id);
        const bad = !el.value.trim();
        el.classList.toggle('invalid', bad);
        if (bad && !firstBad) firstBad = el;
    });

    if (firstBad) {
        firstBad.focus();
        showMessage('Please fill in all the required fields.', 'error');
        return false;
    }
    return true;
}

async function handleSubmit(event) {
    event.preventDefault();
    clearMessage();

    const userId = getUserId();
    if (!userId) {
        showMessage('Your session has expired. Please log in again.', 'error');
        return;
    }
    if (!validateForm()) return;

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> Submitting...";

    try {
        const res = await fetch('/api/student/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: userId,
                category: document.getElementById('category').value,
                priority: document.getElementById('priority').value,
                location: document.getElementById('location').value.trim(),
                title: document.getElementById('title').value.trim(),
                description: document.getElementById('description').value.trim(),
                photo: photoDataUrl || null
            })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            showMessage(data.error || 'Could not submit your report. Please try again.', 'error');
            return;
        }

        showMessage('Report submitted. The administration has been notified.', 'success');
        document.getElementById('reportForm').reset();
        document.getElementById('descCount').textContent = '0';
        removePhoto();
        await loadMyReports();
    } catch (err) {
        console.error('Report submit error:', err);
        showMessage('Network error. Please check your connection and try again.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = "<i class='bx bx-paper-plane'></i> Submit Report";
    }
}

/* ---------------- my reports ---------------- */

function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function buildReportItem(report, userId) {
    const item = document.createElement('div');
    item.className = 'report-item';

    const top = document.createElement('div');
    top.className = 'report-top';

    const left = document.createElement('div');
    const title = document.createElement('p');
    title.className = 'report-title';
    title.textContent = report.title;
    const meta = document.createElement('div');
    meta.className = 'report-meta';
    meta.textContent = `${CATEGORY_LABELS[report.category] || report.category} · ${report.location} · ${formatDate(report.created_at)}`;
    left.append(title, meta);

    const right = document.createElement('div');
    const status = document.createElement('span');
    status.className = `badge ${report.status}`;
    status.textContent = STATUS_LABELS[report.status] || report.status;
    right.appendChild(status);
    if (report.priority === 'urgent') {
        const urgent = document.createElement('span');
        urgent.className = 'badge urgent';
        urgent.textContent = 'Urgent';
        right.appendChild(urgent);
    }

    top.append(left, right);
    item.appendChild(top);

    const desc = document.createElement('p');
    desc.className = 'report-desc';
    desc.textContent = report.description;
    item.appendChild(desc);

    if (report.has_photo) {
        const link = document.createElement('a');
        link.className = 'report-photo-link';
        link.href = `/api/student/report-photo?report_id=${encodeURIComponent(report.id)}&user_id=${encodeURIComponent(userId)}`;
        link.target = '_blank';
        link.rel = 'noopener';
        link.innerHTML = "<i class='bx bx-image'></i> View photo";
        item.appendChild(link);
    }

    if (report.admin_note) {
        const note = document.createElement('div');
        note.className = 'report-note';
        note.textContent = `Admin note: ${report.admin_note}`;
        item.appendChild(note);
    }

    return item;
}

async function loadMyReports() {
    const list = document.getElementById('myReports');
    const userId = getUserId();
    if (!list) return;

    if (!userId) {
        list.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'Log in to see your reports.';
        list.appendChild(p);
        return;
    }

    try {
        const res = await fetch(`/api/student/reports?user_id=${encodeURIComponent(userId)}`);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const { reports } = await res.json();

        list.innerHTML = '';
        if (!reports || reports.length === 0) {
            const p = document.createElement('p');
            p.className = 'muted';
            p.textContent = 'You have not submitted any reports yet.';
            list.appendChild(p);
            return;
        }
        reports.forEach(r => list.appendChild(buildReportItem(r, userId)));
    } catch (err) {
        console.error('Load reports error:', err);
        list.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'Could not load your reports right now.';
        list.appendChild(p);
    }
}

/* ---------------- init ---------------- */

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('reportForm').addEventListener('submit', handleSubmit);
    document.getElementById('btnPhotoSelect').addEventListener('click', () => document.getElementById('photoInput').click());
    document.getElementById('photoInput').addEventListener('change', handlePhotoSelect);
    document.getElementById('btnPhotoRemove').addEventListener('click', removePhoto);

    document.getElementById('description').addEventListener('input', e => {
        document.getElementById('descCount').textContent = e.target.value.length;
    });

    ['category', 'location', 'title', 'description'].forEach(id => {
        document.getElementById(id).addEventListener('input', e => e.target.classList.remove('invalid'));
    });

    loadMyReports();
});
