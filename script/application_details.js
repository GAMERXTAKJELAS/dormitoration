/**
 * Dormitoration - Admin "Student Details" page
 * File: /script/application_details.js
 *
 * Opened from the info button (dashboard / approval) as
 *   /admin/application_details.html?id=<user_id>   or   ?app_id=<application_id>
 *
 * Read-only by default. "Edit" turns the fields into inputs; "Save Changes" sends only
 * the fields that actually changed. Uploaded PDFs are shown with an embedded viewer.
 * There are intentionally NO approve / return buttons here, and "Register RFID" is
 * a disabled placeholder until the RFID flow is built.
 */
(function () {
    'use strict';

    // window.__ddSearch is captured by an inline script in the page <head> before logout_logic.js runs
    const params = new URLSearchParams(typeof window.__ddSearch === 'string' ? window.__ddSearch : window.location.search);
    const startHash = typeof window.__ddHash === 'string' ? window.__ddHash : window.location.hash;
    let adminId = null;
    try {
        const u = JSON.parse(localStorage.getItem('userData') || '{}');
        adminId = u.id || u.user_id || null;
    } catch (e) { /* not logged in */ }

    let data = null;      // last response from the server
    let editing = false;

    const $ = (id) => document.getElementById(id);

    // ---------------------------------------------------------------- helpers
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function isEmpty(v) { return v === null || v === undefined || String(v).trim() === ''; }

    function fmtDate(v) {
        if (isEmpty(v)) return '';
        const d = new Date(v);
        if (isNaN(d.getTime())) return String(v);
        return d.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false });
    }

    function fmtMoney(v) {
        if (isEmpty(v)) return '';
        const n = Number(v);
        return Number.isFinite(n) ? 'RM ' + n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
    }

    function fmtSize(bytes) {
        const n = Number(bytes);
        if (!Number.isFinite(n) || n <= 0) return '';
        return n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
    }

    function normGender(g) {
        const v = String(g || '').toLowerCase().trim();
        if (['perempuan', 'female', 'wanita', 'p', 'f'].includes(v)) return 'Perempuan';
        if (['lelaki', 'male', 'l', 'm'].includes(v)) return 'Lelaki';
        return '';
    }

    function docLabel(type) {
        const known = {
            slip_gaji: 'Salary Slip',
            surat_akuan_sumpah: 'Sworn Declaration',
            salinan_mykad: 'MyKad Copy',
            dokumen_sokongan_ketua_program: 'Program Head Support Letter',
            dokumen_lain: 'Other Supporting Document'
        };
        if (known[type]) return known[type];
        return String(type || 'Document').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function showMessage(text, kind) {
        const box = $('dd-message');
        if (!text) { box.style.display = 'none'; return; }
        box.textContent = text;
        box.className = 'dd-message' + (kind ? ' ' + kind : '');
        box.style.display = 'block';
    }

    // ------------------------------------------------------- field definitions
    // src: where the value lives (user | app | contrib | custom)
    // edit: true = can be changed with the Edit button
    const A = (key, label, extra) => Object.assign({ src: 'app', key, label, type: 'text', edit: true }, extra);
    const U = (key, label, extra) => Object.assign({ src: 'user', key, label, type: 'text', edit: true }, extra);
    const RO = (label, get, extra) => Object.assign({ src: 'custom', label, get, edit: false, type: 'text' }, extra);

    function guardianFields(n) {
        const p = 'guardian' + n + '_';
        return [
            A(p + 'name', 'Full name'),
            A(p + 'ic', 'IC number'),
            A(p + 'phone', 'Phone'),
            A(p + 'relationship', 'Relationship'),
            A(p + 'job', 'Occupation'),
            A(p + 'income', 'Monthly income', { type: 'real', fmt: fmtMoney }),
            A(p + 'address', 'Address', { type: 'textarea', wide: true })
        ];
    }

    const SECTIONS = [
        {
            title: 'Student', icon: 'bx-user', fields: [
                U('full_name', 'Full name'),
                RO('Email', d => d.user.email),
                U('phone', 'Phone'),
                A('ic_number', 'MyKad / IC'),
                A('dob', 'Date of birth'),
                A('age', 'Age', { type: 'int' }),
                A('gender', 'Gender', { type: 'select', options: ['Lelaki', 'Perempuan'], norm: normGender }),
                RO('Matric number', d => d.rfid && d.rfid.matric_number),
                RO('Account status', d => d.user.account_status),
                RO('Registered on', d => fmtDate(d.user.created_at))
            ]
        },
        {
            title: 'Home Address', icon: 'bx-home', fields: [
                A('home_address', 'Address', { type: 'textarea', wide: true }),
                A('postcode', 'Postcode'),
                A('city', 'City'),
                A('state', 'State')
            ]
        },
        {
            title: 'Application', icon: 'bx-file', fields: [
                A('program', 'Program'),
                A('semester', 'Semester', { type: 'int' }),
                A('gpa_cgpa', 'CGPA', { type: 'real' }),
                { src: 'contrib', key: 'gpa', payload: 'gpa', label: 'Semester GPA', type: 'real', edit: true },
                { src: 'contrib', key: 'isMpp', payload: 'isMpp', label: 'MPP member', type: 'select', options: ['Yes', 'No'], edit: true },
                A('dependents_count', 'Dependents', { type: 'int' }),
                { src: 'contrib', key: 'items', payload: 'sumbangan', label: 'Contributions / activities', type: 'items', edit: true, wide: true },
                A('reason_for_apply', 'Reason for applying', { type: 'textarea', wide: true }),
                A('head_of_program_support', 'Head of program support'),
                RO('Session', d => d.application && d.application.session_id),
                RO('Submission status', d => d.application && d.application.submission_status),
                RO('Approval status', d => d.application && d.application.admin_approval),
                RO('Submitted on', d => fmtDate(d.application && d.application.submitted_at)),
                RO('Appeal reason', d => d.application && d.application.appeal_reason, { wide: true })
            ]
        },
        { title: 'Guardian 1', icon: 'bx-group', fields: guardianFields(1) },
        { title: 'Guardian 2', icon: 'bx-group', fields: guardianFields(2) },
        {
            title: 'Room & RFID', icon: 'bx-door-open', fields: [
                RO('Assigned room', d => d.room ? `Block ${d.room.block_name} / ${d.room.room_number}` : ''),
                RO('RFID card', d => d.rfid && d.rfid.registered ? 'Registered' : 'Not registered yet')
            ]
        }
    ];

    // current value of a field, as a plain string (items -> array)
    function rawValue(f) {
        if (!data) return '';
        let v;
        if (f.src === 'user') v = data.user[f.key];
        else if (f.src === 'app') v = data.application ? data.application[f.key] : '';
        else if (f.src === 'contrib') v = data.contributions ? data.contributions[f.key] : '';
        else v = f.get(data);
        if (f.type === 'items') return Array.isArray(v) ? v : [];
        if (f.norm) return f.norm(v);
        return isEmpty(v) ? '' : String(v);
    }

    function displayText(f) {
        const v = rawValue(f);
        if (f.type === 'items') return v.length ? v.join('\n') : '';
        if (f.fmt) return f.fmt(v);
        return v;
    }

    // ----------------------------------------------------------------- render
    const inputs = [];   // { f, input } while editing

    function buildInput(f) {
        const value = rawValue(f);
        let input;

        if (f.type === 'select') {
            input = el('select', 'dd-input');
            const blank = el('option', null, '-');
            blank.value = '';
            input.appendChild(blank);
            f.options.forEach(o => { const opt = el('option', null, o); opt.value = o; input.appendChild(opt); });
            input.value = value;
        } else if (f.type === 'textarea') {
            input = el('textarea', 'dd-input');
            input.value = value;
        } else if (f.type === 'items') {
            const wrap = el('div');
            const list = [];
            for (let i = 0; i < 3; i++) {
                const one = el('input', 'dd-input');
                one.type = 'text';
                one.placeholder = 'Item ' + (i + 1);
                one.value = value[i] || '';
                one.style.marginBottom = '6px';
                wrap.appendChild(one);
                list.push(one);
            }
            wrap._list = list;
            return wrap;
        } else {
            input = el('input', 'dd-input');
            input.type = (f.type === 'int' || f.type === 'real') ? 'number' : 'text';
            if (f.type === 'int') input.step = '1';
            if (f.type === 'real') input.step = 'any';
            input.value = value;
        }
        return input;
    }

    function renderFieldBlock(f) {
        const block = el('div', 'dd-field' + (f.wide ? ' wide' : ''));
        block.appendChild(el('span', 'dd-label', f.label));

        if (editing && f.edit) {
            const input = buildInput(f);
            block.appendChild(input);
            inputs.push({ f, input });
        } else {
            const text = displayText(f);
            const val = el('div', 'dd-value' + (text ? '' : ' empty'), text || '-');
            block.appendChild(val);
        }
        return block;
    }

    // ------------------------------------------------------------- AI hostel review
    const DOC_STATE_TEXT = {
        ok: ['Received and read', 'ok'],
        unreadable: ['Received - AI could not read it', 'warn'],
        invalid: ['Does not look like the right document', 'bad'],
        missing: ['Not uploaded', 'bad']
    };

    function renderAiCard() {
        const review = data.ai_review;
        const card = el('section', 'dd-card');
        card.id = 'ai-review';

        const h = el('h2');
        h.appendChild(el('i', 'bx bx-bot'));
        h.appendChild(document.createTextNode('AI Hostel Review'));
        card.appendChild(h);

        const runBtn = el('button', 'dd-btn dd-btn-ghost');
        runBtn.type = 'button';
        runBtn.textContent = review ? 'Run again' : 'Run AI review';
        runBtn.addEventListener('click', async () => {
            runBtn.disabled = true;
            runBtn.textContent = 'Running...';
            try {
                const res = await fetch('/api/admin/ai-review', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ admin_id: adminId, user_id: data.user.id })
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
                await load();
                showMessage('AI review updated.', 'success');
            } catch (err) {
                runBtn.disabled = false;
                runBtn.textContent = review ? 'Run again' : 'Run AI review';
                showMessage('AI review failed: ' + err.message, 'error');
            }
        });

        if (!review) {
            card.appendChild(el('p', 'dd-empty',
                data.application
                    ? 'No AI review has been generated yet. It runs automatically when the student submits the application.'
                    : 'This student has not started an application yet.'));
            if (data.application) {
                const row = el('div', 'dd-ai-actions');
                row.appendChild(runBtn);
                card.appendChild(row);
            }
            return card;
        }

        // headline: percentage + verdict
        const kind = review.score >= 80 ? 'ok' : (review.score >= 50 ? 'warn' : 'bad');
        const top = el('div', 'dd-ai-top');
        const scoreBox = el('div', 'dd-ai-score ' + kind);
        scoreBox.appendChild(el('span', 'dd-ai-score-num', review.score + '%'));
        scoreBox.appendChild(el('span', 'dd-ai-score-label', 'chance of acceptance'));
        top.appendChild(scoreBox);

        const side = el('div', 'dd-ai-side');
        const badges = el('div', 'dd-badges');
        badges.appendChild(el('span', 'dd-badge ' + kind, review.verdict));
        if (Number(review.manual_check) === 1) badges.appendChild(el('span', 'dd-badge warn', 'Needs a manual check'));
        side.appendChild(badges);
        side.appendChild(el('div', 'dd-doc-meta', review.generated_at ? 'Generated ' + fmtDate(review.generated_at) : ''));
        const bar = el('div', 'dd-ai-bar');
        const fill = el('div', 'dd-ai-bar-fill ' + kind);
        fill.style.width = Math.max(0, Math.min(100, review.score)) + '%';
        bar.appendChild(fill);
        side.appendChild(bar);
        const actions = el('div', 'dd-ai-actions');
        actions.appendChild(runBtn);
        side.appendChild(actions);
        top.appendChild(side);
        card.appendChild(top);

        if (review.summary) card.appendChild(el('p', 'dd-ai-summary', review.summary));

        // why this score
        card.appendChild(el('div', 'dd-label', 'Why this score'));
        const list = el('ul', 'dd-ai-list');
        (review.factors || []).forEach(f => {
            const li = el('li');
            const pts = Number(f.points) || 0;
            li.appendChild(el('span', 'dd-ai-pts ' + (pts > 0 ? 'ok' : (pts < 0 ? 'bad' : '')), (pts > 0 ? '+' : '') + pts));
            const text = el('span', 'dd-ai-note');
            text.appendChild(el('strong', null, f.label + ': '));
            text.appendChild(document.createTextNode(f.note || ''));
            li.appendChild(text);
            list.appendChild(li);
        });
        card.appendChild(list);

        // documents
        card.appendChild(el('div', 'dd-label', 'Documents checked'));
        const docList = el('ul', 'dd-ai-list');
        (review.documents || []).forEach(d => {
            const li = el('li');
            const [text, k] = DOC_STATE_TEXT[d.state] || [d.state, ''];
            li.appendChild(el('span', 'dd-badge ' + k, text));
            const note = el('span', 'dd-ai-note');
            note.appendChild(el('strong', null, d.label + (d.required ? ' (important)' : ' (optional)')));
            if (d.note && d.state !== 'ok') note.appendChild(document.createTextNode(' - ' + d.note));
            li.appendChild(note);
            docList.appendChild(li);
        });
        card.appendChild(docList);

        card.appendChild(el('p', 'dd-doc-meta', 'Advisory only. Distance from the campus is not part of this score yet.'));
        return card;
    }

    function renderDocuments() {
        const card = el('section', 'dd-card');
        card.id = 'documents';
        const h = el('h2');
        h.appendChild(el('i', 'bx bx-folder-open'));
        h.appendChild(document.createTextNode('Uploaded Documents'));
        card.appendChild(h);

        const docs = data.documents || [];
        if (!data.application || docs.length === 0) {
            card.appendChild(el('p', 'dd-empty', 'No documents have been uploaded yet.'));
            return card;
        }

        docs.forEach((doc, index) => {
            const url = `/api/admin/payslip?application_id=${encodeURIComponent(data.application.id)}` +
                        `&attachment_id=${encodeURIComponent(doc.id)}&admin_id=${encodeURIComponent(adminId)}`;
            const flagged = Number(doc.ai_flagged) === 1;

            const box = el('div', 'dd-doc' + (flagged ? ' flagged' : ''));
            const head = el('div', 'dd-doc-head');

            const left = el('div');
            left.appendChild(el('div', 'dd-doc-title', docLabel(doc.document_type)));
            const meta = [doc.file_name, fmtSize(doc.file_size), doc.uploaded_at ? 'Uploaded ' + fmtDate(doc.uploaded_at) : '']
                .filter(Boolean).join(' · ');
            left.appendChild(el('div', 'dd-doc-meta', meta));
            head.appendChild(left);

            const actions = el('div', 'dd-doc-actions');
            const viewBtn = el('button', 'dd-btn dd-btn-ghost');
            viewBtn.type = 'button';
            viewBtn.textContent = 'View';
            const open = el('a', 'dd-btn dd-btn-ghost', 'Open in new tab');
            open.href = url;
            open.target = '_blank';
            open.rel = 'noopener';
            actions.appendChild(viewBtn);
            actions.appendChild(open);
            head.appendChild(actions);
            box.appendChild(head);

            if (flagged) {
                box.appendChild(el('div', 'dd-doc-flag', 'AI flagged this document: ' + (doc.ai_reason || 'no reason given')));
            } else if (doc.ai_reason) {
                box.appendChild(el('div', 'dd-doc-meta', 'AI check: ' + doc.ai_reason));
            }

            let viewer = null;
            function toggle() {
                if (viewer) {
                    viewer.remove();
                    viewer = null;
                    viewBtn.textContent = 'View';
                } else {
                    viewer = el('iframe', 'dd-viewer');
                    viewer.src = url;
                    viewer.title = docLabel(doc.document_type);
                    box.appendChild(viewer);
                    viewBtn.textContent = 'Hide';
                }
            }
            viewBtn.addEventListener('click', toggle);
            if (index === 0) toggle();   // first document opens automatically

            card.appendChild(box);
        });
        return card;
    }

    function renderHeader() {
        const u = data.user;
        $('dd-name').textContent = u.full_name || 'Student';
        document.title = 'Dormitoration | ' + (u.full_name || 'Student Details');

        const pic = u.profile_picture && u.profile_picture.trim() && !u.profile_picture.includes('ui-avatars.com');
        const g = normGender(data.application && data.application.gender);
        $('dd-avatar').src = pic ? u.profile_picture : (g === 'Perempuan' ? '/image/default_Female.svg' : '/image/default_Male.svg');

        const badges = $('dd-badges');
        badges.innerHTML = '';
        const approval = (data.application && data.application.admin_approval) || 'pending';
        badges.appendChild(el('span', 'dd-badge ' + (approval === 'approved' ? 'ok' : (approval === 'pending' ? 'warn' : 'bad')),
            'Application: ' + approval));
        if (data.room) {
            badges.appendChild(el('span', 'dd-badge ' + (g === 'Perempuan' ? 'girl' : 'ok'),
                `Block ${data.room.block_name} / ${data.room.room_number}`));
        } else {
            badges.appendChild(el('span', 'dd-badge warn', 'On hold - no room'));
        }
        badges.appendChild(el('span', 'dd-badge ' + (data.rfid && data.rfid.registered ? 'ok' : ''),
            data.rfid && data.rfid.registered ? 'RFID registered' : 'RFID not registered'));
    }

    function render() {
        inputs.length = 0;
        renderHeader();

        const content = $('dd-content');
        content.innerHTML = '';

        SECTIONS.forEach(section => {
            const card = el('section', 'dd-card');
            const h = el('h2');
            h.appendChild(el('i', 'bx ' + section.icon));
            h.appendChild(document.createTextNode(section.title));
            card.appendChild(h);

            const grid = el('div', 'dd-grid');
            section.fields.forEach(f => grid.appendChild(renderFieldBlock(f)));
            card.appendChild(grid);
            content.appendChild(card);
        });

        content.appendChild(renderAiCard());
        content.appendChild(renderDocuments());

        $('btn-edit').style.display = editing ? 'none' : '';
        $('btn-save').style.display = editing ? '' : 'none';
        $('btn-cancel').style.display = editing ? '' : 'none';
        // Editing needs an application row for the application fields, but name/phone always work.
        $('btn-edit').disabled = false;
    }

    // ------------------------------------------------------------------- data
    async function load() {
        if (!adminId) {
            $('dd-content').innerHTML = '';
            showMessage('Please log in as an admin to view student details.', 'error');
            return;
        }
        const query = params.get('id') ? `id=${encodeURIComponent(params.get('id'))}` : `app_id=${encodeURIComponent(params.get('app_id') || '')}`;
        try {
            const res = await fetch(`/api/admin/application-details?admin_id=${encodeURIComponent(adminId)}&${query}`);
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
            data = body;
            render();
            if (startHash === '#documents') {
                const docs = $('documents');
                if (docs) docs.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        } catch (err) {
            $('dd-content').innerHTML = '';
            showMessage('Could not load student details: ' + err.message, 'error');
        }
    }

    function collectChanges() {
        const changes = {};
        inputs.forEach(({ f, input }) => {
            const original = rawValue(f);
            if (f.type === 'items') {
                const now = input._list.map(i => i.value.trim()).filter(Boolean);
                if (JSON.stringify(now) !== JSON.stringify(original)) changes[f.payload] = now;
                return;
            }
            const now = input.value.trim();
            if (now !== String(original).trim()) changes[f.payload || f.key] = now;
        });
        return changes;
    }

    async function save() {
        const changes = collectChanges();
        if (Object.keys(changes).length === 0) {
            editing = false;
            render();
            showMessage('No changes to save.', '');
            return;
        }

        const btn = $('btn-save');
        btn.disabled = true;
        try {
            const res = await fetch('/api/admin/application-details', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ admin_id: adminId, user_id: data.user.id, fields: changes })
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);

            editing = false;
            await load();
            showMessage('Saved: ' + (body.changed || []).join(', ') + '.', 'success');
        } catch (err) {
            showMessage('Could not save: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        // Back arrow: return to the admin page we came from (history.back() would open the logout pop-up)
        const back = $('dd-back');
        try {
            const ref = new URL(document.referrer);
            if (back && ref.origin === window.location.origin && ref.pathname.startsWith('/admin/') &&
                !ref.pathname.endsWith('application_details.html')) {
                back.href = ref.pathname + ref.search;
            }
        } catch (e) { /* no referrer: keep the dashboard link */ }

        $('btn-edit').addEventListener('click', () => { if (!data) return; editing = true; showMessage(''); render(); });
        $('btn-cancel').addEventListener('click', () => { editing = false; showMessage(''); render(); });
        $('btn-save').addEventListener('click', save);
        load();
    });
})();
