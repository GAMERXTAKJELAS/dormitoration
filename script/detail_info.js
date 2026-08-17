/**
 * Dormitoration - Detail Information Script
 * File: /script/detailinformation.js
 */

let pdfBase64String = "";
let currentGuardianCount = 1;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Load Existing Application / User Data from Server and LocalStorage
    await fetchAndPopulateStudentDetails();

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

    const pdfBtn = document.getElementById('btnPdfSelect');
    const pdfFileInput = document.getElementById('slipGajiPDF');
    if (pdfBtn && pdfFileInput) {
        pdfBtn.addEventListener('click', () => pdfFileInput.click());
        pdfFileInput.addEventListener('change', handlePDFSelection);
    }

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
            username: getStorageData('userData').username || '',
            namaPelajar: getValue('namaPelajar'),
            noIC: getValue('noIC'),
            tarikhLahir: getValue('tarikhLahir'),
            umur: getValue('umur'),
            jantina: getValue('jantina'),
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
                hubungan: isParentMode ? 'Bapa / Ibu' : getValue('hubunganPenjaga1'),
                pekerjaan: getValue('pekerjaanPenjaga1'),
                pendapatan: getValue('pendapatanPenjaga1')
            },
            penjaga2: isParentMode ? {
                nama: getValue('namaPenjaga2'),
                ic: getValue('icPenjaga2'),
                tel: getValue('telPenjaga2'),
                hubungan: 'Ibu',
                pekerjaan: getValue('pekerjaanPenjaga2'),
                pendapatan: getValue('pendapatanPenjaga2')
            } : null,
            tanggunganAnak: getValue('tanggunganAnak'),
            slipGajiPDF: pdfBase64String || getStorageData('userData').slipGajiPDF || ""
        };

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

                if (msgDiv) {
                    msgDiv.style.color = '#47f59b';
                    msgDiv.innerText = 'Application successfully saved and submitted!';
                }

                setTimeout(() => {
                    window.location.href = '/student/studenthomepage.html';
                }, 1200);
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

/* =========================================================
   MALAYSIAN IC PARSER
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
    setInputValue('tarikhLahir', `${fullYear}-${monthStr}-${dayStr}`);

    const dob = new Date(fullYear, monthDigits - 1, dayDigits);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
        age--;
    }
    setInputValue('umur', age);

    const gender = (lastDigit % 2 !== 0) ? 'Lelaki' : 'Perempuan';
    setInputValue('jantina', gender);
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
        <h3 class="sub-title">Guardian ${currentGuardianCount}</h3>
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
        const csvData = parseCSVToJSON(text);

        if (Object.keys(csvData).length > 0) {
            const existingUser = getStorageData('userData');
            const mergedUser = { ...existingUser, ...csvData };

            localStorage.setItem('userData', JSON.stringify(mergedUser));
            loadDataFromLocalStorage();

            alert("Applicable hostel application fields have been auto-filled from your CSV!");
        } else {
            alert("Invalid CSV format. Please ensure the first row contains valid headers.");
        }
    };
    reader.readAsText(file);
}

function parseCSVToJSON(csvText) {
    const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return {};

    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    const values = lines[1].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));

    const result = {};
    headers.forEach((header, index) => {
        result[header] = values[index] || "";
    });

    return result;
}

/* =========================================================
   PAYSLIP PDF UPLOAD & PREVIEW
   ========================================================= */
function handlePDFSelection(event) {
    const file = event.target.files[0];
    const nameDisplay = document.getElementById('fileNameDisplay');
    const previewContainer = document.getElementById('pdfPreviewContainer');
    const previewFrame = document.getElementById('pdfPreviewFrame');

    if (!file || file.type !== "application/pdf") {
        if (nameDisplay) nameDisplay.innerText = "No file selected";
        if (previewContainer) previewContainer.style.display = 'none';
        pdfBase64String = "";
        return;
    }

    if (nameDisplay) nameDisplay.innerText = `📄 ${file.name}`;

    const reader = new FileReader();
    reader.onload = function (e) {
        pdfBase64String = e.target.result;
        if (previewFrame && previewContainer) {
            previewFrame.src = pdfBase64String;
            previewContainer.style.display = 'block';
        }
    };
    reader.readAsDataURL(file);
}

function closePdfPreview() {
    const previewContainer = document.getElementById('pdfPreviewContainer');
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
        const usernameParam = userData.username ? `?username=${encodeURIComponent(userData.username)}` : '';

        const res = await fetch(`/api/student/details${usernameParam}`, {
            headers: {
                'Authorization': userData.username ? `Bearer ${userData.username}` : ''
            }
        });

        if (res.ok) {
            const apiData = await res.json();
            if (apiData && Object.keys(apiData).length > 0) {
                populateForm(apiData);
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

    // If PDF exists in base64 string format, set preview option
    const pdfData = data.slipGajiPDF || data.slip_gaji_pdf;
    if (pdfData && pdfData.startsWith('data:application/pdf')) {
        pdfBase64String = pdfData;
        const nameDisplay = document.getElementById('fileNameDisplay');
        const previewContainer = document.getElementById('pdfPreviewContainer');
        const previewFrame = document.getElementById('pdfPreviewFrame');

        if (nameDisplay) nameDisplay.innerText = "📄 Existing Payslip PDF Loaded";
        if (previewFrame && previewContainer) {
            previewFrame.src = pdfData;
            previewContainer.style.display = 'block';
        }
    }
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