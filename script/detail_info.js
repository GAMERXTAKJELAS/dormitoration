/**
 * Dormitoration - Detail Information Script
 * File: /script/detailinformation.js
 */

let currentGuardianCount = 1;
let lastLoadedData = null;

function setFormFieldsDisabled(disabled) {
    const form = document.getElementById('detailInfoForm');
    if (!form) return;
    form.querySelectorAll('input, select, textarea, button.btn-add-guardian, button.btn-remove-guardian').forEach(el => {
        if (el.type === 'submit') return; // visibility of submit buttons is handled separately
        el.disabled = disabled;
    });
}

// setFormFieldsDisabled only covers plain input/select/textarea — the PDF
// slots' Select/Remove buttons aren't form controls, so they need their own
// show/hide here. In view mode: no editing controls, just the "View PDF"
// confirmation link (set by loadExistingPdfForSlot) so it clearly reads as
// "here's what you submitted", not an active upload form.
function setPdfSlotsEditable(editable) {
    [PRIMARY_SLOT, SECONDARY_SLOT].forEach(slot => {
        const selectBtn = document.getElementById(slot.selectBtnId);
        const removeBtn = document.getElementById(slot.removeBtnId);
        const typeSelect = slot === PRIMARY_SLOT ? document.getElementById('documentType') : null;
        if (selectBtn) selectBtn.style.display = editable ? 'inline-flex' : 'none';
        if (!editable && removeBtn) removeBtn.style.display = 'none'; // only re-shown by a fresh selection
        if (typeSelect) typeSelect.disabled = !editable;
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

    initPdfSlot(PRIMARY_SLOT);
    initPdfSlot(SECONDARY_SLOT);

    // 5. Form Submit Handler
    const detailForm = document.getElementById('detailInfoForm');
    const msgDiv = document.getElementById('detailMsg');

    detailForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const semesterVal = parseInt(getValue('semester'), 10);
        if (isNaN(semesterVal) || semesterVal < 2 || semesterVal > 6) {
            if (msgDiv) {
                msgDiv.style.color = '#ff6b6b';
                msgDiv.innerText = 'Application is restricted to students in Semester 2 to 6 for the next intake.';
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
    
            // Grab automatically parsed background values
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

                // Details are saved — now persist any PDF the student selected but
                // hadn't uploaded yet. upload-payslip replaces any prior document of
                // the same type, so this is also how a PDF swap in edit mode happens.
                if (msgDiv) msgDiv.innerText = 'Saving document(s)...';
                const pdfResult = await uploadPendingPdfs(updatedDetails.user_id);
                if (!pdfResult.ok && msgDiv) {
                    msgDiv.style.color = '#ff6b6b';
                    msgDiv.innerText = `Profile saved, but a document failed to upload: ${pdfResult.error}. Please try re-attaching it.`;
                    return; // stay on the page so the student can retry the PDF
                }

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

// Store calculated values in memory
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

    // Save values directly in background state instead of DOM inputs
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
    if (cards.length <= 1) return; // Always keep at least 1 guardian box

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
   CSV AUTO-FILL & FIELD MAPPING
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
            showDetailMessage('None of the CSV columns were recognized. Check your column names and try again.', true);
            return;
        }

        populateForm(mapped);
        saveDetailFormDraft(mapped);

        let msg = `CSV imported — ${Object.keys(mapped).length} field(s) auto-filled.`;
        if (unmatched.length > 0) {
            msg += ` Skipped unrecognized column(s): ${unmatched.join(', ')}.`;
        }
        showDetailMessage(msg, false);
    };
    reader.readAsText(file);
}

// Splits one CSV line into fields, respecting "quoted, commas, inside quotes"
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

// Lowercases, strips apostrophes/underscores/extra spaces so header matching
// isn't broken by capitalization, punctuation, or spacing differences.
function normalizeHeader(h) {
    return String(h || '')
        .toLowerCase()
        .replace(/['"]/g, '')
        .replace(/[_\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// English-first alias list. Add more variants (or a Malay set) here as needed —
// the matching logic itself doesn't change, just this dictionary.
const CSV_FIELD_ALIASES = {
    namaPelajar: ['full name', 'name', 'student name', 'nama', 'nama penuh'],
    noIC: ['ic number', 'ic', 'nric', 'identity card', 'identity card number', 'mykad'],
    tarikhLahir: ['date of birth', 'dob', 'birth date'],
    noTel: ['phone number', 'phone', 'contact number', 'mobile number', 'mobile', 'tel', 'telephone'],
    alamatRumah: ['home address', 'address', 'residential address'],
    poskod: ['postcode', 'postal code', 'zip code', 'zip'],
    bandar: ['city', 'town'],
    negeri: ['state'],
    sebabMemohon: ['reason for applying', 'reason to apply', 'reason', 'reason for application'],
    program: ['program', 'programme', 'course', 'academic program'],
    semester: ['semester', 'sem'],
    gpa: ['gpa', 'current gpa'],
    cgpa: ['cgpa', 'cumulative gpa'],
    tanggunganAnak: ['dependents', 'number of dependents', 'total dependents', 'dependents count'],
    isMpp: ['mpp member', 'is mpp', 'mpp'],
    'penjaga1.nama': ["father name", "fathers name", "guardian 1 name", "guardian name"],
    'penjaga1.ic': ['father ic', 'fathers ic', 'guardian 1 ic'],
    'penjaga1.tel': ['father phone', 'fathers phone', 'guardian 1 phone'],
    'penjaga1.pekerjaan': ['father job', 'fathers job', 'father occupation', 'guardian 1 job'],
    'penjaga1.pendapatan': ['father income', 'fathers income', 'guardian 1 income'],
    'penjaga2.nama': ['mother name', 'mothers name', 'guardian 2 name'],
    'penjaga2.ic': ['mother ic', 'mothers ic', 'guardian 2 ic'],
    'penjaga2.tel': ['mother phone', 'mothers phone', 'guardian 2 phone'],
    'penjaga2.pekerjaan': ['mother job', 'mothers job', 'guardian 2 job'],
    'penjaga2.pendapatan': ['mother income', 'mothers income', 'guardian 2 income']
};

const CSV_ALIAS_LOOKUP = {};
Object.entries(CSV_FIELD_ALIASES).forEach(([targetKey, aliases]) => {
    aliases.forEach(alias => {
        CSV_ALIAS_LOOKUP[normalizeHeader(alias)] = targetKey;
    });
    CSV_ALIAS_LOOKUP[normalizeHeader(targetKey)] = targetKey; // exact internal key still works too
});

// Income fields render into <input type="number">. Browsers silently refuse
// to set .value on a number input to anything non-numeric, so "RM1,200" (a
// perfectly valid CSV value) would just leave the field blank. Strip the
// currency prefix and thousands separators down to a plain number string.
const CURRENCY_FIELD_KEYS = new Set(['penjaga1.pendapatan', 'penjaga2.pendapatan']);

function sanitizeCurrency(value) {
    const cleaned = value.replace(/[^\d.]/g, ''); // drop "RM", commas, spaces, etc.
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
            if (value === '') return; // nothing numeric left — skip rather than insert blank
        }

        if (targetKey.includes('.')) {
            const [group, field] = targetKey.split('.');
            if (!mapped[group]) mapped[group] = {};
            mapped[group][field] = value;
        } else {
            mapped[targetKey] = value;
        }
    });

    return { mapped, unmatched };
}

function showDetailMessage(text, isError) {
    const msgDiv = document.getElementById('detailMsg');
    if (!msgDiv) return;
    msgDiv.style.color = isError ? '#ff6b6b' : '#47f59b';
    msgDiv.innerText = text;
}

// Draft cache for a NOT-YET-SUBMITTED application, kept separate from `userData`
// (which is session/account info, not form-in-progress data). This survives the
// user closing the tab or navigating away before hitting Submit.
const DETAIL_DRAFT_KEY = 'detailFormDraft';

function saveDetailFormDraft(newData) {
    try {
        const existing = JSON.parse(localStorage.getItem(DETAIL_DRAFT_KEY) || '{}');
        const merged = { ...existing, ...newData };
        // Merge nested guardian objects instead of letting one overwrite the other
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
   =========================================================
   Design: selecting a file only previews it locally and runs the (free,
   non-blocking) AI plausibility check — it does NOT touch R2 yet. The
   actual /api/student/upload-payslip call only fires once the student
   clicks Submit/Update, right after their details save successfully.
   This is what makes "Remove" (task 3) a pure no-network action, and
   what makes an edit-mode swap (task 4) only replace the stored file
   when the student actually clicks Update — upload-payslip's existing
   delete-old-then-insert-new logic (payslip_backend.js) handles the
   "replace" itself; this file just controls WHEN that call happens.
   ========================================================= */

// One slot's config + its own pending-file state live together in one object,
// so the primary (dropdown type) and secondary (fixed, optional type) slots
// run through the exact same logic instead of two near-duplicate copies.
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
    getDocumentType: () => document.getElementById('documentType')?.value || 'slip_gaji',
    typeLabel: (docType) => docType === 'slip_gaji' ? 'Salary Slip' : 'Sworn Declaration',
    required: true,
    pendingFile: null,
    objectUrl: null
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
    objectUrl: null
};

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

    // Re-run the plausibility check if the document type changes after a file
    // was already selected — otherwise a stale verdict could linger.
    if (slot === PRIMARY_SLOT) {
        const typeSelect = document.getElementById('documentType');
        if (typeSelect) {
            typeSelect.addEventListener('change', () => {
                hideWarning(slot);
                if (slot.pendingFile) runPlausibilityCheck(slot, slot.pendingFile);
            });
        }
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
    const previewFrame = document.getElementById(slot.previewFrameId);
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

    // "View PDF" opens the file in a new tab via a blob URL — this is the
    // reliable way to let the student confirm what they picked. The iframe
    // preview below is a bonus; some browsers silently refuse to render a
    // data: URI PDF inside an iframe, which is why a file could "select"
    // successfully but never visibly show up.
    if (slot.objectUrl) URL.revokeObjectURL(slot.objectUrl);
    slot.objectUrl = URL.createObjectURL(file);
    if (viewLink) {
        viewLink.href = slot.objectUrl;
        viewLink.style.display = 'inline-flex';
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        if (previewFrame && previewContainer) {
            previewFrame.src = e.target.result;
            previewContainer.style.display = 'block';
        }
    };
    reader.readAsDataURL(file);

    runPlausibilityCheck(slot, file);
}

// Removes the locally-selected file. Since nothing is uploaded until Submit/
// Update, this never needs to touch the server for a file picked this
// session. clearServerCopy exists for completeness but isn't used by the
// Remove button today — the student removes the OLD file by simply
// attaching a replacement instead, which the submit-time upload swaps in.
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
        if (!imageBase64) return; // pdf.js unavailable — skip silently, never blocks the student

        const checkRes = await fetch('/api/student/check-payslip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, document_type: documentType, imageBase64 })
        });

        const verdict = await checkRes.json();
        if (verdict && verdict.looksValid === false && warningBanner && warningText) {
            warningText.innerText = `This doesn't look like a ${slot.typeLabel(documentType)} — are you sure this is the right file? (${verdict.reason || 'Please double-check.'})`;
            warningBanner.style.display = 'flex';
        }
    } catch (err) {
        console.error('Plausibility check error:', err);
        // Non-blocking by design — a failed check just means no warning shown.
    }
}

// Renders page 1 of the PDF to a PNG and returns it as raw base64 (no data: prefix),
// using pdf.js loaded via CDN. Returns null if pdf.js isn't available for any reason —
// callers treat that as "skip the AI check", never as a failure to block on.
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

// Called once, right after /api/student/update-details succeeds. Uploads
// whichever slot(s) actually have a pending (not-yet-saved) file. A slot the
// student never touched this session is left alone — its existing R2 file,
// if any, stays exactly as it was.
async function uploadPendingPdfs(userId) {
    for (const slot of [PRIMARY_SLOT, SECONDARY_SLOT]) {
        if (!slot.pendingFile) continue;

        const file = slot.pendingFile;
        const documentType = slot.getDocumentType();
        const nameDisplay = document.getElementById(slot.nameDisplayId);
        const pendingNote = document.getElementById(slot.pendingNoteId);

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

            if (nameDisplay) nameDisplay.innerText = `📄 ${file.name} ✓ saved`;
            if (pendingNote) pendingNote.style.display = 'none';
            slot.pendingFile = null; // persisted now — no longer "pending"
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
        body: "Select your enrolled diploma program and current semester (Semesters 2 to 6). If you are an active member of the Student Representative Council (MPP), select 'Yes'."
    },
    sectionC: {
        title: "Section C: Parent & Guardian Guidance",
        body: "Select 'Living with Parents' or 'Under Guardian Care'. Under guardian care, you may attach multiple guardian records using the + Add Guardian button."
    },
    payslip: {
        title: "Payslip Upload Guidance",
        body: "Upload your parent or guardian's latest monthly payslip or official income statement in PDF format for priority allocation processing."
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
                // A draft row always exists from registration, so apiData "having keys"
                // doesn't mean the application was actually submitted. If it's still a
                // draft, restore any unsaved CSV-filled progress on top of the sparse
                // server data — server values win only where they're actually non-empty.
                let dataToRender = apiData;
                if (apiData.accountStatus !== 'submitted') {
                    const draft = loadDetailFormDraft();
                    if (Object.keys(draft).length > 0) {
                        dataToRender = mergeDraftOverEmptyFields(apiData, draft);
                    }
                } else {
                    clearDetailFormDraft(); // already submitted — a lingering draft is now stale
                }

                populateForm(dataToRender);
                lastLoadedData = apiData;

                // Already submitted once? Start in read-only view with an Edit button,
                // instead of the normal fillable first-time form.
                if (apiData.accountStatus === 'submitted') {
                    enterViewMode();
                }

                // Sync backend data to localStorage cache
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

// Fills in draft values only where the server's own value is empty/null — a real
// submitted value always wins over a leftover draft.
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

    // The PDF itself no longer travels through this JSON payload (it's uploaded
    // separately to R2) — if this student already has one on file, preview it
    // by pointing the iframe straight at the serving endpoint.
    // NOTE: data.user_id isn't always the key present — localStorage's cached
    // user object (and some code paths) use "id" instead. Same fallback this
    // file already uses everywhere else (see getStorageData callers).
    const uidForPdfCheck = data.user_id || data.id;
    if (uidForPdfCheck) {
        loadExistingPdfForSlot(PRIMARY_SLOT, uidForPdfCheck, ['slip_gaji', 'surat_akuan_sumpah']);
        loadExistingPdfForSlot(SECONDARY_SLOT, uidForPdfCheck, ['dokumen_sokongan_ketua_program']);
    }
}

// Checks each candidate document_type in order (HEAD request) and previews
// the first one found. For the primary slot this also sets the "Document
// Type" dropdown to match whichever type is actually on file, so an edit
// later re-checks/replaces the correct one. Shows "No file selected" if
// none of the candidates exist yet (nothing uploaded for this slot so far).
function loadExistingPdfForSlot(slot, userId, candidateTypes) {
    const nameDisplay = document.getElementById(slot.nameDisplayId);
    const previewContainer = document.getElementById(slot.previewContainerId);
    const previewFrame = document.getElementById(slot.previewFrameId);
    const viewLink = document.getElementById(slot.viewLinkId);
    if (nameDisplay) nameDisplay.innerText = "📄 Checking for existing document...";

    const tryNext = (i) => {
        if (i >= candidateTypes.length) {
            if (nameDisplay) nameDisplay.innerText = "No file selected";
            if (viewLink) viewLink.style.display = 'none';
            return;
        }
        const docType = candidateTypes[i];
        const url = `/api/student/payslip?user_id=${encodeURIComponent(userId)}&document_type=${encodeURIComponent(docType)}`;

        fetch(url, { method: 'HEAD' })
            .then(res => {
                if (res.ok) {
                    if (nameDisplay) nameDisplay.innerText = "📄 Existing document on file";
                    if (previewFrame && previewContainer) {
                        previewFrame.src = url;
                        previewContainer.style.display = 'block';
                    }
                    // Same reliable "open in a new tab" affordance as a freshly
                    // selected file — points straight at the serving endpoint.
                    if (viewLink) {
                        viewLink.href = url;
                        viewLink.style.display = 'inline-flex';
                    }
                    if (slot === PRIMARY_SLOT) {
                        const typeSelect = document.getElementById('documentType');
                        if (typeSelect) typeSelect.value = docType;
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