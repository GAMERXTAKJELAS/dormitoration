/**
 * Dormitoration - Detail Information Script
 * File: /script/detail_info.js
 */

let currentGuardianCount = 1;
let lastLoadedData = null;

function setFormFieldsDisabled(disabled) {
    const form = document.getElementById('detailInfoForm');
    if (!form) return;
    form.querySelectorAll('input, select, textarea, button.btn-add-guardian, button.btn-remove-guardian').forEach(el => {
        if (el.type === 'submit') return;
        el.disabled = disabled;
    });
}

function setPdfSlotsEditable(editable) {
    ALL_SLOTS.forEach(slot => {
        const selectBtn = document.getElementById(slot.selectBtnId);
        const removeBtn = document.getElementById(slot.removeBtnId);
        if (selectBtn) selectBtn.style.display = editable ? 'inline-flex' : 'none';
        if (!editable && removeBtn) removeBtn.style.display = 'none';
    });
}

function enterViewMode() {
    setFormFieldsDisabled(true);
    setPdfSlotsEditable(false);
    const editBtn = document.getElementById('editProfileBtn');
    const firstTimeBtn = document.getElementById('firstTimeSubmitBtn');
    const editControls = document.getElementById('editModeControls');
    if (editBtn) editBtn.style.display = '';
    if (firstTimeBtn) firstTimeBtn.style.display = 'none';
    if (editControls) editControls.style.display = 'none';

    // Display embedded PDF iframe viewer in Read Mode for verified documents
    ALL_SLOTS.forEach(slot => {
        const previewContainer = document.getElementById(slot.previewContainerId);
        const previewFrame = document.getElementById(slot.previewFrameId);
        if (slot.hasExistingFile && slot.existingUrl) {
            if (previewFrame) previewFrame.src = slot.existingUrl;
            if (previewContainer) previewContainer.style.display = 'block';
        }
    });
}

function enterEditMode() {
    setFormFieldsDisabled(false);
    setPdfSlotsEditable(true);
    const editBtn = document.getElementById('editProfileBtn');
    const firstTimeBtn = document.getElementById('firstTimeSubmitBtn');
    const editControls = document.getElementById('editModeControls');
    if (editBtn) editBtn.style.display = 'none';
    if (firstTimeBtn) firstTimeBtn.style.display = 'none';
    if (editControls) editControls.style.display = 'flex';

    // Hide PDF preview frames when in Edit Mode
    ALL_SLOTS.forEach(slot => {
        const previewContainer = document.getElementById(slot.previewContainerId);
        if (previewContainer) previewContainer.style.display = 'none';
    });
}

function cancelEdit() {
    if (lastLoadedData) populateForm(lastLoadedData);
    enterViewMode();
}

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Load Existing Application / User Data from Server and LocalStorage
    await fetchAndPopulateStudentDetails();
    updateGuardianRemoveButtons();

    // 2. Real-time IC Listener (Auto DOB, Age & Gender)
    const icInput = document.getElementById('noIC');
    if (icInput) {
        icInput.addEventListener('input', (e) => parseMalaysianIC(e.target.value));
    }

    // 3. Radio Listeners for Section B (MPP Toggle)
    const mppRadios = document.querySelectorAll('input[name="isMpp"]');
    mppRadios.forEach(radio => {
        radio.addEventListener('change', (e) => toggleMppContributions(e.target.value === 'Yes'));
    });

    // 4. File Upload Listeners
    const csvFileInput = document.getElementById('csvFileInput');
    if (csvFileInput) csvFileInput.addEventListener('change', handleCSVUpload);

    buildDocSlots();
    ALL_SLOTS.forEach(initPdfSlot);

    // 5. Form Submit Handler
    const detailForm = document.getElementById('detailInfoForm');
    const msgDiv = document.getElementById('detailMsg');

    detailForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const semesterVal = parseInt(getValue('semester'), 10);
        if (isNaN(semesterVal) || semesterVal < 2 || semesterVal > 10) {
            if (msgDiv) {
                msgDiv.style.color = '#ff6b6b';
                msgDiv.innerText = 'Application is restricted to students in Semester 2 to 10 for the next intake.';
            }
            return;
        }

        if (msgDiv) {
            msgDiv.style.color = '#ffffff';
            msgDiv.innerText = 'Submitting profile information...';
        }

        const isMppVal = document.querySelector('input[name="isMpp"]:checked')?.value || 'No';
        const isParentMode = document.getElementById('guardiansModeContainer')?.style.display === 'none';

        const updatedDetails = {
            user_id: getStorageData('userData').id || getStorageData('userData').user_id,
            namaPelajar: getValue('namaPelajar'),
            noIC: getValue('noIC'),
    
            tarikhLahir: autoParsedDetails.tarikhLahir,
            umur: autoParsedDetails.umur,
            jantina: autoParsedDetails.jantina,

            noTel: getValue('noTel'),
            alamatRumah: getValue('alamatRumah'),
            poskod: getValue('poskod'),
            bandar: getValue('bandar'),
            negeri: getValue('negeri'),
            sebabMemohon: getValue('sebabMemohon'),
            program: getValue('program'),
            semester: semesterVal,
            gpa: getValue('gpa'),
            cgpa: getValue('cgpa'),
            isMpp: isMppVal,
            sumbangan: isMppVal === 'Yes' 
                ? ['Ahli Majlis Perwakilan Pelajar (MPP)'] 
                : [getValue('sumbangan1'), getValue('sumbangan2'), getValue('sumbangan3')].filter(Boolean),
            familyMode: isParentMode ? 'parents' : 'guardians',
            penjaga1: {
                nama: getValue('namaPenjaga1'),
                ic: getValue('icPenjaga1'),
                tel: getValue('telPenjaga1'),
                hubungan: isParentMode ? 'Father' : getValue('hubunganPenjaga1'),
                pekerjaan: getValue('pekerjaanPenjaga1'),
                pendapatan: getValue('pendapatanPenjaga1')
            },
            penjaga2: isParentMode ? {
                nama: getValue('namaPenjaga2'),
                ic: getValue('icPenjaga2'),
                tel: getValue('telPenjaga2'),
                hubungan: 'Mother',
                pekerjaan: getValue('pekerjaanPenjaga2'),
                pendapatan: getValue('pendapatanPenjaga2')
            } : null,
            tanggunganAnak: getValue('tanggunganAnak')
        };

        const wasEditingExisting = document.getElementById('editModeControls')?.style.display === 'flex';

        try {
            const response = await fetch('/api/student/update-details', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedDetails)
            });

            if (response.ok) {
                const currentData = getStorageData('userData');
                const newUserData = { ...currentData, ...updatedDetails, account_status: 'pending' };
                localStorage.setItem('userData', JSON.stringify(newUserData));

                lastLoadedData = { ...updatedDetails, accountStatus: 'submitted' };

                if (msgDiv) msgDiv.innerText = 'Saving document(s)...';
                const pdfResult = await uploadPendingPdfs(updatedDetails.user_id);
                if (!pdfResult.ok && msgDiv) {
                    msgDiv.style.color = '#ff6b6b';
                    msgDiv.innerText = `Profile saved, but a document failed to upload: ${pdfResult.error}. Please try re-attaching it.`;
                    return;
                }

                try {
                    fetch('/api/student/run-ai-review', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ user_id: updatedDetails.user_id }),
                        keepalive: true
                    }).catch(() => {});
                } catch (e) { /* non-blocking */ }

                if (wasEditingExisting) {
                    if (msgDiv) {
                        msgDiv.style.color = '#47f59b';
                        msgDiv.innerText = 'Changes saved successfully!';
                    }
                    enterViewMode();
                } else {
                    if (msgDiv) {
                        msgDiv.style.color = '#47f59b';
                        msgDiv.innerText = 'Application successfully saved and submitted!';
                    }

                    clearDetailFormDraft();

                    setTimeout(() => {
                        window.location.href = '/student/studenthomepage.html';
                    }, 1200);
                }
            } else {
                const err = await response.json();
                if (msgDiv) {
                    msgDiv.style.color = '#ff6b6b';
                    msgDiv.innerText = err.error || 'Failed to submit details.';
                }
            }
        } catch (err) {
            console.error(err);
            if (msgDiv) {
                msgDiv.style.color = '#ff6b6b';
                msgDiv.innerText = 'Server connection error.';
            }
        }
    });
});

let autoParsedDetails = {
    tarikhLahir: '',
    umur: '',
    jantina: ''
};

/* =========================================================
   MALAYSIAN IC PARSER (Auto-Calculates DOB, Age & Gender)
   ========================================================= */
function parseMalaysianIC(icString) {
    const cleanIC = icString.replace(/\D/g, '');
    if (cleanIC.length < 12) return;

    const yearDigits = parseInt(cleanIC.substring(0, 2), 10);
    const monthDigits = parseInt(cleanIC.substring(2, 4), 10);
    const dayDigits = parseInt(cleanIC.substring(4, 6), 10);
    const lastDigit = parseInt(cleanIC.substring(11, 12), 10);

    const currentTwoDigitYear = new Date().getFullYear() % 100;
    const fullYear = (yearDigits <= currentTwoDigitYear) ? (2000 + yearDigits) : (1900 + yearDigits);

    const monthStr = String(monthDigits).padStart(2, '0');
    const dayStr = String(dayDigits).padStart(2, '0');

    const dob = new Date(fullYear, monthDigits - 1, dayDigits);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
        age--;
    }

    autoParsedDetails.tarikhLahir = `${fullYear}-${monthStr}-${dayStr}`;
    autoParsedDetails.umur = age;
    autoParsedDetails.jantina = (lastDigit % 2 !== 0) ? 'Lelaki' : 'Perempuan';
}

/* =========================================================
   SECTION B: MPP TOGGLE
   ========================================================= */
function toggleMppContributions(isMpp) {
    const wrapper = document.getElementById('nonMppContributionsWrapper');
    if (wrapper) {
        wrapper.style.display = isMpp ? 'none' : 'block';
    }
}

/* =========================================================
   SECTION C: PARENT / GUARDIAN MODE SWITCHER
   ========================================================= */
function switchGuardianMode(mode) {
    const btnParents = document.getElementById('btnModeParents');
    const btnGuardians = document.getElementById('btnModeGuardians');
    const parentsContainer = document.getElementById('parentsModeContainer');
    const guardiansContainer = document.getElementById('guardiansModeContainer');

    if (mode === 'parents') {
        if (btnParents) btnParents.classList.add('active');
        if (btnGuardians) btnGuardians.classList.remove('active');
        if (parentsContainer) parentsContainer.style.display = 'block';
        if (guardiansContainer) guardiansContainer.style.display = 'none';
    } else {
        if (btnGuardians) btnGuardians.classList.add('active');
        if (btnParents) btnParents.classList.remove('active');
        if (parentsContainer) parentsContainer.style.display = 'none';
        if (guardiansContainer) guardiansContainer.style.display = 'block';
    }
}

function addGuardianCard() {
    currentGuardianCount++;
    const list = document.getElementById('dynamicGuardiansList');
    if (!list) return;

    const newCard = document.createElement('div');
    newCard.className = 'guardian-card';
    newCard.id = `guardianCard_${currentGuardianCount}`;
    newCard.innerHTML = `
        <div class="guardian-card-header">
            <h3 class="sub-title">Guardian ${currentGuardianCount}</h3>
            <button type="button" class="btn-remove-guardian" onclick="removeGuardianCard('guardianCard_${currentGuardianCount}')" title="Remove this guardian">
                <i class='bx bx-trash'></i> Remove
            </button>
        </div>
        <div class="input-grid">
            <div class="input-box">
                <label>Full Name</label>
                <input type="text" class="g-name" id="namaPenjaga${currentGuardianCount}">
            </div>
            <div class="input-box">
                <label>IC Number</label>
                <input type="text" class="g-ic" id="icPenjaga${currentGuardianCount}">
            </div>
            <div class="input-box">
                <label>Phone Number</label>
                <input type="tel" class="g-tel" id="telPenjaga${currentGuardianCount}">
            </div>
            <div class="input-box">
                <label>Relationship</label>
                <input type="text" class="g-relation" id="hubunganPenjaga${currentGuardianCount}" placeholder="e.g., Uncle / Aunt / Sibling">
            </div>
            <div class="input-box">
                <label>Occupation & Employer</label>
                <input type="text" class="g-job" id="pekerjaanPenjaga${currentGuardianCount}">
            </div>
            <div class="input-box">
                <label>Monthly Income (RM)</label>
                <input type="number" class="g-income" id="pendapatanPenjaga${currentGuardianCount}">
            </div>
        </div>
    `;
    list.appendChild(newCard);
    updateGuardianRemoveButtons();
}

function removeGuardianCard(cardId) {
    const list = document.getElementById('dynamicGuardiansList');
    if (!list) return;

    const cards = list.querySelectorAll('.guardian-card');
    if (cards.length <= 1) return;

    const card = document.getElementById(cardId);
    if (card) card.remove();

    renumberGuardianCards();
    updateGuardianRemoveButtons();
}

function renumberGuardianCards() {
    const list = document.getElementById('dynamicGuardiansList');
    if (!list) return;

    list.querySelectorAll('.guardian-card').forEach((card, index) => {
        const title = card.querySelector('.sub-title');
        if (title) title.textContent = `Guardian ${index + 1}`;
    });
}

function updateGuardianRemoveButtons() {
    const list = document.getElementById('dynamicGuardiansList');
    if (!list) return;

    const cards = list.querySelectorAll('.guardian-card');
    const onlyOneLeft = cards.length <= 1;

    cards.forEach((card) => {
        const btn = card.querySelector('.btn-remove-guardian');
        if (btn) btn.disabled = onlyOneLeft;
    });
}

/* =========================================================
   CSV AUTO-FILL & FIELD MAPPING (Strict Syamsul_Nazir.csv Schema)
   ========================================================= */
function handleCSVUpload(event) {
    const file = event.target.files[0];
    const badge = document.getElementById('csvFileNameDisplay');

    if (!file) return;

    if (badge) {
        badge.style.display = 'block';
        badge.innerText = `📊 CSV Loaded: ${file.name}`;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        const text = e.target.result;
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

        if (lines.length < 2) {
            showDetailMessage('Invalid CSV format. Please ensure there is a header row and at least one data row.', true);
            return;
        }

        const headers = parseCsvLine(lines[0]);
        const values = parseCsvLine(lines[1]);
        const { mapped, unmatched } = mapCsvRowToFormData(headers, values);

        if (Object.keys(mapped).length === 0) {
            showDetailMessage('None of the CSV columns were recognized. Ensure headers match the required CSV format.', true);
            return;
        }

        populateForm(mapped);
        saveDetailFormDraft(mapped);

        let msg = `CSV imported successfully — ${Object.keys(mapped).length} field(s) auto-filled.`;
        if (unmatched.length > 0) {
            msg += ` Skipped unrecognized column(s): ${unmatched.join(', ')}.`;
        }
        showDetailMessage(msg, false);
    };
    reader.readAsText(file);
}

function parseCsvLine(line) {
    const result = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(cur.trim());
            cur = '';
        } else {
            cur += char;
        }
    }
    result.push(cur.trim());
    return result;
}

function normalizeHeader(h) {
    return String(h || '')
        .toLowerCase()
        .replace(/['"]/g, '')
        .replace(/[_\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const CSV_FIELD_ALIASES = {
    namaPelajar: ['full name', 'nama pelajar', 'nama penuh'],
    noIC: ['ic number', 'no ic', 'mykad'],
    noTel: ['phone number', 'no tel', 'telefon'],
    alamatRumah: ['home address', 'alamat rumah'],
    bandar: ['city', 'bandar'],
    negeri: ['state', 'negeri'],
    poskod: ['postcode', 'poskod'],
    tanggunganAnak: ['number of dependents', 'tanggungan anak', 'bilangan tanggungan'],
    'penjaga1.nama': ['fathers name', 'father name', 'nama bapa', 'nama penjaga 1'],
    'penjaga1.ic': ['fathers ic', 'father ic', 'ic bapa', 'ic penjaga 1'],
    'penjaga1.tel': ['fathers phone', 'father phone', 'tel bapa', 'phone bapa', 'tel penjaga 1'],
    'penjaga1.pekerjaan': ['fathers job', 'father job', 'pekerjaan bapa', 'pekerjaan penjaga 1'],
    'penjaga1.pendapatan': ['fathers income', 'father income', 'pendapatan bapa', 'gaji bapa'],
    'penjaga2.nama': ['mothers name', 'mother name', 'nama ibu', 'nama penjaga 2'],
    'penjaga2.ic': ['mothers ic', 'mother ic', 'ic ibu', 'ic penjaga 2'],
    'penjaga2.tel': ['mothers phone', 'mother phone', 'tel ibu', 'phone ibu', 'tel penjaga 2'],
    'penjaga2.pekerjaan': ['mothers job', 'mother job', 'pekerjaan ibu', 'pekerjaan penjaga 2'],
    'penjaga2.pendapatan': ['mothers income', 'mother income', 'pendapatan ibu', 'gaji ibu']
};

const CSV_ALIAS_LOOKUP = {};
Object.entries(CSV_FIELD_ALIASES).forEach(([targetKey, aliases]) => {
    aliases.forEach(alias => {
        CSV_ALIAS_LOOKUP[normalizeHeader(alias)] = targetKey;
    });
    CSV_ALIAS_LOOKUP[normalizeHeader(targetKey)] = targetKey;
});

const CURRENCY_FIELD_KEYS = new Set(['penjaga1.pendapatan', 'penjaga2.pendapatan']);

function sanitizeCurrency(value) {
    const cleaned = value.replace(/[^\d.]/g, '');
    return cleaned === '' ? '' : cleaned;
}

function mapCsvRowToFormData(headers, values) {
    const mapped = {};
    const unmatched = [];

    headers.forEach((rawHeader, idx) => {
        const targetKey = CSV_ALIAS_LOOKUP[normalizeHeader(rawHeader)];
        let value = (values[idx] || '').trim();
        if (!value) return;

        if (!targetKey) {
            unmatched.push(rawHeader);
            return;
        }

        if (CURRENCY_FIELD_KEYS.has(targetKey)) {
            value = sanitizeCurrency(value);
            if (value === '') return;
        }

        if (targetKey.includes('.')) {
            const [group, field] = targetKey.split('.');
            if (!mapped[group]) mapped[group] = {};
            mapped[group][field] = value;
        } else {
            mapped[targetKey] = value;
        }
    });

    if (mapped.penjaga1 || mapped.penjaga2) {
        mapped.familyMode = 'parents';
    }

    return { mapped, unmatched };
}

/* =========================================================
   EXPORT STUDENT DETAILS TO CSV (Syamsul_Nazir.csv Schema)
   ========================================================= */
function exportStudentDetailsToCSV() {
    const headers = [
        "Full Name",
        "IC Number",
        "Phone Number",
        "Home Address",
        "City",
        "State",
        "Postcode",
        "Number of Dependents",
        "Father's Name",
        "Father's IC",
        "Father's Phone",
        "Father's Job",
        "Father's Income",
        "Mother's Name",
        "Mother's IC",
        "Mother's Phone",
        "Mother's Job",
        "Mother's Income"
    ];

    const escapeCsv = (val) => {
        const str = (val === null || val === undefined) ? "" : String(val).trim();
        return `"${str.replace(/"/g, '""')}"`;
    };

    const formatIncome = (val) => {
        const str = (val === null || val === undefined) ? "" : String(val).trim();
        if (!str) return "";
        if (str.toUpperCase().startsWith("RM")) return str;
        const num = parseFloat(str.replace(/,/g, ''));
        return isNaN(num) ? str : `RM${num.toLocaleString('en-US')}`;
    };

    const data = [
        escapeCsv(getValue('namaPelajar')),
        escapeCsv(getValue('noIC')),
        escapeCsv(getValue('noTel')),
        escapeCsv(getValue('alamatRumah')),
        escapeCsv(getValue('bandar')),
        escapeCsv(getValue('negeri')),
        escapeCsv(getValue('poskod')),
        escapeCsv(getValue('tanggunganAnak')),
        escapeCsv(getValue('namaPenjaga1')),
        escapeCsv(getValue('icPenjaga1')),
        escapeCsv(getValue('telPenjaga1')),
        escapeCsv(getValue('pekerjaanPenjaga1')),
        escapeCsv(formatIncome(getValue('pendapatanPenjaga1'))),
        escapeCsv(getValue('namaPenjaga2')),
        escapeCsv(getValue('icPenjaga2')),
        escapeCsv(getValue('telPenjaga2')),
        escapeCsv(getValue('pekerjaanPenjaga2')),
        escapeCsv(formatIncome(getValue('pendapatanPenjaga2')))
    ];

    const csvContent = headers.join(",") + "\n" + data.join(",");

    const studentName = getValue('namaPelajar') || 'Student';
    const sanitizedFileName = studentName.replace(/[^a-zA-Z0-9_\-]/g, '_');

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const downloadLink = document.createElement("a");
    downloadLink.href = url;
    downloadLink.download = `${sanitizedFileName}_Details.csv`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(url);
}

function showDetailMessage(text, isError) {
    const msgDiv = document.getElementById('detailMsg');
    if (!msgDiv) return;
    msgDiv.style.color = isError ? '#ff6b6b' : '#47f59b';
    msgDiv.innerText = text;
}

const DETAIL_DRAFT_KEY = 'detailFormDraft';

function saveDetailFormDraft(newData) {
    try {
        const existing = JSON.parse(localStorage.getItem(DETAIL_DRAFT_KEY) || '{}');
        const merged = { ...existing, ...newData };
        if (newData.penjaga1) merged.penjaga1 = { ...(existing.penjaga1 || {}), ...newData.penjaga1 };
        if (newData.penjaga2) merged.penjaga2 = { ...(existing.penjaga2 || {}), ...newData.penjaga2 };
        localStorage.setItem(DETAIL_DRAFT_KEY, JSON.stringify(merged));
    } catch (e) {
        console.error('Failed to save detail form draft:', e);
    }
}

function loadDetailFormDraft() {
    try {
        return JSON.parse(localStorage.getItem(DETAIL_DRAFT_KEY) || '{}');
    } catch (e) {
        return {};
    }
}

function clearDetailFormDraft() {
    localStorage.removeItem(DETAIL_DRAFT_KEY);
}

/* =========================================================
   PAYSLIP / SUPPORT-LETTER PDF — SELECT, PREVIEW, CHECK, UPLOAD
   ========================================================= */
const PRIMARY_SLOT = {
    key: 'primary',
    fileInputId: 'slipGajiPDF',
    selectBtnId: 'btnPdfSelect',
    removeBtnId: 'btnRemovePdf',
    nameDisplayId: 'fileNameDisplay',
    pendingNoteId: 'pdfPendingNote',
    warningBannerId: 'pdfWarningBanner',
    warningTextId: 'pdfWarningText',
    previewContainerId: 'pdfPreviewContainer',
    previewFrameId: 'pdfPreviewFrame',
    viewLinkId: 'pdfViewLink',
    getDocumentType: () => 'slip_gaji',
    typeLabel: () => 'Salary Slip',
    required: true,
    pendingFile: null,
    objectUrl: null,
    hasExistingFile: false,
    existingUrl: null
};

const SECONDARY_SLOT = {
    key: 'secondary',
    fileInputId: 'ketuaProgramPDF',
    selectBtnId: 'btnPdfSelect2',
    removeBtnId: 'btnRemovePdf2',
    nameDisplayId: 'fileNameDisplay2',
    pendingNoteId: 'pdfPendingNote2',
    warningBannerId: 'pdfWarningBanner2',
    warningTextId: 'pdfWarningText2',
    previewContainerId: 'pdfPreviewContainer2',
    previewFrameId: 'pdfPreviewFrame2',
    viewLinkId: 'pdfViewLink2',
    getDocumentType: () => 'dokumen_sokongan_ketua_program',
    typeLabel: () => 'Program Head Support Letter',
    required: false,
    pendingFile: null,
    objectUrl: null,
    hasExistingFile: false,
    existingUrl: null
};

function makeDocSlot(n, key, fileInputId, docType, label, required, help) {
    return {
        key, n, label, help, required,
        fileInputId,
        selectBtnId: `btnPdfSelect${n}`,
        removeBtnId: `btnRemovePdf${n}`,
        nameDisplayId: `fileNameDisplay${n}`,
        pendingNoteId: `pdfPendingNote${n}`,
        warningBannerId: `pdfWarningBanner${n}`,
        warningTextId: `pdfWarningText${n}`,
        previewContainerId: `pdfPreviewContainer${n}`,
        previewFrameId: `pdfPreviewFrame${n}`,
        viewLinkId: `pdfViewLink${n}`,
        getDocumentType: () => docType,
        typeLabel: () => label,
        pendingFile: null,
        objectUrl: null,
        hasExistingFile: false,
        existingUrl: null
    };
}

Object.assign(SECONDARY_SLOT, {
    n: 2,
    label: 'Program Head Support Letter (Dokumen Sokongan Ketua Program)',
    help: '* Optional. Attach only if your Program Head has issued a support letter for your application.'
});

const SWORN_SLOT = makeDocSlot(3, 'sworn', 'swornDeclarationPDF', 'surat_akuan_sumpah',
    'Sworn Declaration (Surat Akuan Sumpah)', false,
    '* Income proof: use this if your parent/guardian has no payslip (for example self-employed). One of the salary slip or the sworn declaration is enough; uploading both gives a more reliable review.');
SWORN_SLOT.tag = 'Income proof (if no payslip)';
const MYKAD_SLOT = makeDocSlot(4, 'mykad', 'mykadPDF', 'salinan_mykad',
    'MyKad Copy', false,
    '* Optional. A clear copy of your MyKad (front side).');
const OTHER_SLOT = makeDocSlot(5, 'other', 'otherDocPDF', 'dokumen_lain',
    'Other Supporting Document', false,
    '* Optional. Anything else that supports your application, for example a Dean\'s Award certificate (Anugerah Dekan).');

const DOC_SLOTS = [SWORN_SLOT, MYKAD_SLOT, SECONDARY_SLOT, OTHER_SLOT];
const ALL_SLOTS = [PRIMARY_SLOT, ...DOC_SLOTS];

function buildDocSlots() {
    const host = document.getElementById('extraDocSlots');
    if (!host || host.dataset.built) return;
    host.dataset.built = '1';

    DOC_SLOTS.forEach(slot => {
        const wrap = document.createElement('div');
        wrap.innerHTML = `
            <div class="pdf-upload-divider"></div>
            <div class="pdf-upload-header">
                <label class="pdf-upload-label">
                    <i class='bx bxs-file-pdf'></i> Upload ${slot.label} — <em>${slot.tag || (slot.required ? 'Important' : 'Optional')}</em>
                </label>
            </div>
            <p class="pdf-note">${slot.help}</p>
            <div class="file-drop-area">
                <button type="button" class="btn-pdf-select" id="${slot.selectBtnId}">
                    <i class='bx bx-upload'></i> Select PDF File
                </button>
                <span id="${slot.nameDisplayId}">No file selected</span>
                <button type="button" class="btn-remove-pdf" id="${slot.removeBtnId}" style="display: none;" title="Remove selected file">
                    <i class='bx bx-x'></i> Remove
                </button>
                <a href="#" id="${slot.viewLinkId}" class="btn-view-pdf" style="display: none;" target="_blank" rel="noopener">
                    <i class='bx bx-show'></i> View PDF
                </a>
                <input type="file" id="${slot.fileInputId}" accept="application/pdf" style="display: none;">
            </div>
            <p class="pdf-note" id="${slot.pendingNoteId}" style="display: none;">* This file will be uploaded when you click Submit/Update below — it hasn't been saved yet.</p>
            <div id="${slot.warningBannerId}" class="pdf-warning-banner" style="display: none;">
                <i class='bx bx-error'></i>
                <span id="${slot.warningTextId}"></span>
            </div>
            <div id="${slot.previewContainerId}" class="pdf-preview-wrapper" style="display: none;">
                <div class="preview-bar">
                    <span><i class='bx bx-show'></i> Document Preview</span>
                    <button type="button" class="btn-close-preview" data-close-preview="1">&times;</button>
                </div>
                <iframe id="${slot.previewFrameId}" src="" class="pdf-iframe"></iframe>
            </div>`;
        host.appendChild(wrap);
        wrap.querySelector('[data-close-preview]').addEventListener('click', () => {
            const box = document.getElementById(slot.previewContainerId);
            if (box) box.style.display = 'none';
        });
    });
}

function initPdfSlot(slot) {
    const selectBtn = document.getElementById(slot.selectBtnId);
    const fileInput = document.getElementById(slot.fileInputId);
    const removeBtn = document.getElementById(slot.removeBtnId);

    if (selectBtn && fileInput) {
        selectBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => handlePdfSelection(slot, e));
    }
    if (removeBtn) {
        removeBtn.addEventListener('click', () => removePdfSlot(slot, { clearServerCopy: false }));
    }
}

function hideWarning(slot) {
    const banner = document.getElementById(slot.warningBannerId);
    if (banner) banner.style.display = 'none';
}

function handlePdfSelection(slot, event) {
    const file = event.target.files[0];
    const nameDisplay = document.getElementById(slot.nameDisplayId);
    const previewContainer = document.getElementById(slot.previewContainerId);
    const removeBtn = document.getElementById(slot.removeBtnId);
    const pendingNote = document.getElementById(slot.pendingNoteId);
    const viewLink = document.getElementById(slot.viewLinkId);

    hideWarning(slot);

    if (!file || file.type !== "application/pdf") {
        if (nameDisplay) nameDisplay.innerText = "No file selected";
        if (previewContainer) previewContainer.style.display = 'none';
        if (removeBtn) removeBtn.style.display = 'none';
        if (pendingNote) pendingNote.style.display = 'none';
        if (viewLink) viewLink.style.display = 'none';
        slot.pendingFile = null;
        return;
    }

    slot.pendingFile = file;
    if (nameDisplay) nameDisplay.innerText = `📄 ${file.name} (not yet saved)`;
    if (removeBtn) removeBtn.style.display = 'inline-flex';
    if (pendingNote) pendingNote.style.display = 'block';
    if (viewLink) viewLink.style.display = 'none';

    if (previewContainer) previewContainer.style.display = 'none';

    runPlausibilityCheck(slot, file);
}

function removePdfSlot(slot, { clearServerCopy }) {
    const fileInput = document.getElementById(slot.fileInputId);
    const nameDisplay = document.getElementById(slot.nameDisplayId);
    const previewContainer = document.getElementById(slot.previewContainerId);
    const removeBtn = document.getElementById(slot.removeBtnId);
    const pendingNote = document.getElementById(slot.pendingNoteId);
    const viewLink = document.getElementById(slot.viewLinkId);

    slot.pendingFile = null;
    if (slot.objectUrl) { URL.revokeObjectURL(slot.objectUrl); slot.objectUrl = null; }
    if (fileInput) fileInput.value = '';
    if (nameDisplay) nameDisplay.innerText = "No file selected";
    if (previewContainer) previewContainer.style.display = 'none';
    if (removeBtn) removeBtn.style.display = 'none';
    if (pendingNote) pendingNote.style.display = 'none';
    if (viewLink) viewLink.style.display = 'none';
    hideWarning(slot);
}

async function runPlausibilityCheck(slot, file) {
    const userData = getStorageData('userData');
    const userId = userData.id || userData.user_id;
    const documentType = slot.getDocumentType();
    const warningBanner = document.getElementById(slot.warningBannerId);
    const warningText = document.getElementById(slot.warningTextId);
    if (!userId) return;

    try {
        const imageBase64 = await renderPdfFirstPageToImageBase64(file);
        if (!imageBase64) return;

        const checkRes = await fetch('/api/student/check-payslip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, document_type: documentType, imageBase64, fileName: file.name, fileSize: file.size })
        });

        const verdict = await checkRes.json();
        if (verdict && verdict.looksValid === false && warningBanner && warningText) {
            warningText.innerText = `This doesn't look like a ${slot.typeLabel(documentType)} — are you sure this is the right file? (${verdict.reason || 'Please double-check.'})`;
            warningBanner.style.display = 'flex';
        } else if (verdict && verdict.readable === false && warningBanner && warningText) {
            warningText.innerText = `The AI could not read this file clearly (${verdict.reason || 'unclear scan'}). It will still be sent and the admin will check it manually. A clearer scan gives a better result.`;
            warningBanner.style.display = 'flex';
        }
    } catch (err) {
        console.error('Plausibility check error:', err);
    }
}

async function renderPdfFirstPageToImageBase64(file) {
    try {
        if (typeof pdfjsLib === 'undefined') return null;
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport }).promise;

        return canvas.toDataURL('image/png').split(',')[1];
    } catch (err) {
        console.error('PDF-to-image conversion failed:', err);
        return null;
    }
}

async function uploadPendingPdfs(userId) {
    for (const slot of ALL_SLOTS) {
        if (!slot.pendingFile) continue;

        const file = slot.pendingFile;
        const documentType = slot.getDocumentType();
        const nameDisplay = document.getElementById(slot.nameDisplayId);
        const pendingNote = document.getElementById(slot.pendingNoteId);
        const viewLink = document.getElementById(slot.viewLinkId);

        try {
            const base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const uploadRes = await fetch('/api/student/upload-payslip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: userId, document_type: documentType, filename: file.name, base64Data })
            });

            if (!uploadRes.ok) {
                const errBody = await uploadRes.json().catch(() => ({}));
                return { ok: false, error: errBody.error || `${slot.typeLabel(documentType)} upload failed` };
            }

            slot.hasExistingFile = true;
            slot.existingUrl = `/api/student/payslip?user_id=${encodeURIComponent(userId)}&document_type=${encodeURIComponent(documentType)}`;

            if (nameDisplay) nameDisplay.innerText = `📄 ${file.name} ✓ saved`;
            if (pendingNote) pendingNote.style.display = 'none';
            if (viewLink) {
                viewLink.href = slot.existingUrl;
                viewLink.style.display = 'inline-flex';
            }
            slot.pendingFile = null;
        } catch (err) {
            console.error('PDF upload error:', err);
            return { ok: false, error: `${slot.typeLabel(documentType)} upload failed` };
        }
    }
    return { ok: true };
}

function closePdfPreview() {
    const previewContainer = document.getElementById('pdfPreviewContainer');
    if (previewContainer) previewContainer.style.display = 'none';
}

function closePdfPreview2() {
    const previewContainer = document.getElementById('pdfPreviewContainer2');
    if (previewContainer) previewContainer.style.display = 'none';
}

/* =========================================================
   INFO POPUP MODAL SYSTEM
   ========================================================= */
const modalContentMap = {
    csv: {
        title: "CSV Auto-Fill Guide",
        body: "You can import your information directly via a standard CSV file. The system will filter out unrelated fields and extract only the relevant data needed for your hostel application."
    },
    sectionA: {
        title: "Section A: Personal Details Guidance",
        body: "Ensure your full name matches your Identity Card (IC). Entering a valid 12-digit Malaysian IC number will automatically calculate your Date of Birth, Age, and Gender."
    },
    sectionB: {
        title: "Section B: Academic Information Guidance",
        body: "Select your enrolled diploma program and current semester (Semesters 2 to 10). If you are an active member of the Student Representative Council (MPP), select 'Yes'."
    },
    sectionC: {
        title: "Section C: Parent & Guardian Guidance",
        body: "Select 'Living with Parents' or 'Under Guardian Care'. Under guardian care, you may attach multiple guardian records using the + Add Guardian button."
    },
    payslip: {
        title: "Payslip Upload Guidance",
        body: "Upload PDF documents for your application. Upload a salary slip OR, if there is no payslip, a sworn declaration as proof of income (one is enough). If neither is uploaded your application is still sent, but the chance of being accepted is much lower. The MyKad copy, program head letter and other documents (for example a Dean's Award certificate) are optional."
    }
};

function openInfoModal(key) {
    const modal = document.getElementById('infoModalOverlay');
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');

    const content = modalContentMap[key] || { title: "Information", body: "No details available." };

    if (modal && title && body) {
        title.innerHTML = `<i class='bx bx-info-circle'></i> ${content.title}`;
        body.innerText = content.body;
        modal.style.display = 'flex';
    }
}

function closeInfoModal() {
    const modal = document.getElementById('infoModalOverlay');
    if (modal) modal.style.display = 'none';
}

/* =========================================================
   HELPERS & DATA LOADERS
   ========================================================= */
async function fetchAndPopulateStudentDetails() {
    try {
        const userData = getStorageData('userData');
        const userId = userData.id || userData.user_id;
        const userIdParam = userId ? `?user_id=${encodeURIComponent(userId)}` : '';

        const res = await fetch(`/api/student/details${userIdParam}`);

        if (res.ok) {
            const apiData = await res.json();
            if (apiData && Object.keys(apiData).length > 0) {
                let dataToRender = apiData;
                if (apiData.accountStatus !== 'submitted') {
                    const draft = loadDetailFormDraft();
                    if (Object.keys(draft).length > 0) {
                        dataToRender = mergeDraftOverEmptyFields(apiData, draft);
                    }
                } else {
                    clearDetailFormDraft();
                }

                populateForm(dataToRender);
                lastLoadedData = apiData;

                if (apiData.accountStatus === 'submitted') {
                    enterViewMode();
                }

                const updatedCache = { ...userData, ...apiData };
                localStorage.setItem('userData', JSON.stringify(updatedCache));
                return;
            }
        }
    } catch (err) {
        console.log('Fetching backend data failed, using local storage cache.');
    }
    loadDataFromLocalStorage();
}

function loadDataFromLocalStorage() {
    const data = getStorageData('userData');
    populateForm(data);
}

function mergeDraftOverEmptyFields(serverData, draftData) {
    const result = { ...serverData };

    Object.keys(draftData).forEach(key => {
        if (key === 'penjaga1' || key === 'penjaga2') {
            const serverGuardian = serverData[key] || {};
            const draftGuardian = draftData[key] || {};
            const mergedGuardian = { ...draftGuardian, ...serverGuardian };
            Object.keys(draftGuardian).forEach(gKey => {
                if (!serverGuardian[gKey]) mergedGuardian[gKey] = draftGuardian[gKey];
            });
            result[key] = mergedGuardian;
            return;
        }

        if (!serverData[key]) {
            result[key] = draftData[key];
        }
    });

    return result;
}

function populateForm(data) {
    if (!data) return;

    if (data.namaPelajar || data.full_name) setInputValue('namaPelajar', data.namaPelajar || data.full_name);
    if (data.noIC || data.ic_number) {
        const icVal = data.noIC || data.ic_number;
        setInputValue('noIC', icVal);
        parseMalaysianIC(icVal);
    }
    if (data.noTel || data.phone) setInputValue('noTel', data.noTel || data.phone);
    if (data.alamatRumah || data.address) setInputValue('alamatRumah', data.alamatRumah || data.address);
    if (data.poskod || data.postcode) setInputValue('poskod', data.poskod || data.postcode);
    if (data.bandar || data.city) setInputValue('bandar', data.bandar || data.city);
    if (data.negeri || data.state) setInputValue('negeri', data.negeri || data.state);
    if (data.sebabMemohon || data.reason) setInputValue('sebabMemohon', data.sebabMemohon || data.reason);

    if (data.program) setInputValue('program', data.program);
    if (data.semester) setInputValue('semester', data.semester);
    if (data.gpa) setInputValue('gpa', data.gpa);
    if (data.cgpa) setInputValue('cgpa', data.cgpa);

    const isMppVal = data.isMpp || data.is_mpp;
    if (isMppVal === 'Yes') {
        const mppYes = document.querySelector('input[name="isMpp"][value="Yes"]');
        if (mppYes) {
            mppYes.checked = true;
            toggleMppContributions(true);
        }
    } else {
        const mppNo = document.querySelector('input[name="isMpp"][value="No"]');
        if (mppNo) {
            mppNo.checked = true;
            toggleMppContributions(false);
        }
    }

    if (data.sumbangan) {
        if (Array.isArray(data.sumbangan)) {
            setInputValue('sumbangan1', data.sumbangan[0] || '');
            setInputValue('sumbangan2', data.sumbangan[1] || '');
            setInputValue('sumbangan3', data.sumbangan[2] || '');
        }
    }

    const mode = data.familyMode || data.family_mode;
    if (mode === 'guardians') {
        switchGuardianMode('guardians');
    } else {
        switchGuardianMode('parents');
    }

    if (data.penjaga1) {
        setInputValue('namaPenjaga1', data.penjaga1.nama || '');
        setInputValue('icPenjaga1', data.penjaga1.ic || '');
        setInputValue('telPenjaga1', data.penjaga1.tel || '');
        setInputValue('hubunganPenjaga1', data.penjaga1.hubungan || '');
        setInputValue('pekerjaanPenjaga1', data.penjaga1.pekerjaan || '');
        setInputValue('pendapatanPenjaga1', data.penjaga1.pendapatan || '');
    }

    if (data.penjaga2) {
        setInputValue('namaPenjaga2', data.penjaga2.nama || '');
        setInputValue('icPenjaga2', data.penjaga2.ic || '');
        setInputValue('telPenjaga2', data.penjaga2.tel || '');
        setInputValue('pekerjaanPenjaga2', data.penjaga2.pekerjaan || '');
        setInputValue('pendapatanPenjaga2', data.penjaga2.pendapatan || '');
    }

    if (data.tanggunganAnak) setInputValue('tanggunganAnak', data.tanggunganAnak);

    const uidForPdfCheck = data.user_id || data.id;
    if (uidForPdfCheck) {
        ALL_SLOTS.forEach(slot => loadExistingPdfForSlot(slot, uidForPdfCheck, [slot.getDocumentType()]));
    }
}

function loadExistingPdfForSlot(slot, userId, candidateTypes) {
    const nameDisplay = document.getElementById(slot.nameDisplayId);
    const previewContainer = document.getElementById(slot.previewContainerId);
    const previewFrame = document.getElementById(slot.previewFrameId);
    const viewLink = document.getElementById(slot.viewLinkId);
    if (nameDisplay) nameDisplay.innerText = "📄 Checking document status...";

    const tryNext = (i) => {
        if (i >= candidateTypes.length) {
            if (nameDisplay) nameDisplay.innerText = "No file selected";
            if (viewLink) viewLink.style.display = 'none';
            if (previewContainer) previewContainer.style.display = 'none';
            slot.hasExistingFile = false;
            slot.existingUrl = null;
            return;
        }
        const docType = candidateTypes[i];
        const url = `/api/student/payslip?user_id=${encodeURIComponent(userId)}&document_type=${encodeURIComponent(docType)}`;

        // Use GET request method to prevent 405 Method Not Allowed errors on serverless API routes
        fetch(url, { method: 'GET' })
            .then(res => {
                if (res.ok) {
                    slot.hasExistingFile = true;
                    slot.existingUrl = url;
                    if (nameDisplay) nameDisplay.innerText = "📄 Document Attached & Verified";
                    if (viewLink) {
                        viewLink.href = url;
                        viewLink.style.display = 'inline-flex';
                    }

                    const isEditMode = document.getElementById('editModeControls')?.style.display === 'flex';
                    if (!isEditMode && previewFrame && previewContainer) {
                        previewFrame.src = url;
                        previewContainer.style.display = 'block';
                    } else if (previewContainer) {
                        previewContainer.style.display = 'none';
                    }
                } else {
                    tryNext(i + 1);
                }
            })
            .catch(() => tryNext(i + 1));
    };

    tryNext(0);
}

function getStorageData(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || '{}');
    } catch (e) {
        return {};
    }
}

function setInputValue(id, val) {
    const el = document.getElementById(id);
    if (el && val !== null && val !== undefined) el.value = val;
}

function getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}