let pdfBase64String = "";

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initial load from LocalStorage
    loadDataFromLocalStorage();

    // 2. Real-time IC Auto-Fill Listener
    const icInput = document.getElementById('noIC');
    if (icInput) {
        icInput.addEventListener('input', (e) => parseMalaysianIC(e.target.value));
    }

    // 3. CSV File Upload Listener
    const csvFileInput = document.getElementById('csvFileInput');
    if (csvFileInput) {
        csvFileInput.addEventListener('change', handleCSVUpload);
    }

    // 4. PDF Upload Listener
    const pdfBtn = document.getElementById('btnPdfSelect');
    const pdfFileInput = document.getElementById('slipGajiPDF');
    if (pdfBtn && pdfFileInput) {
        pdfBtn.addEventListener('click', () => pdfFileInput.click());
        pdfFileInput.addEventListener('change', handlePDFSelection);
    }

    // 5. Form Submit Listener
    const detailForm = document.getElementById('detailInfoForm');
    const msgDiv = document.getElementById('detailMsg');

    detailForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (msgDiv) {
            msgDiv.style.color = '#ffffff';
            msgDiv.innerText = 'Menyimpan maklumat...';
        }

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
            semester: getValue('semester'),
            gpa: getValue('gpa'),
            cgpa: getValue('cgpa'),
            sumbangan: [
                getValue('sumbangan1'),
                getValue('sumbangan2'),
                getValue('sumbangan3')
            ].filter(Boolean),
            penjaga1: {
                nama: getValue('namaPenjaga1'),
                ic: getValue('icPenjaga1'),
                tel: getValue('telPenjaga1'),
                hubungan: getValue('hubunganPenjaga1'),
                pekerjaan: getValue('pekerjaanPenjaga1'),
                pendapatan: getValue('pendapatanPenjaga1')
            },
            penjaga2: {
                nama: getValue('namaPenjaga2'),
                ic: getValue('icPenjaga2'),
                tel: getValue('telPenjaga2'),
                hubungan: getValue('hubunganPenjaga2'),
                pekerjaan: getValue('pekerjaanPenjaga2'),
                pendapatan: getValue('pendapatanPenjaga2')
            },
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
                    msgDiv.innerText = 'Maklumat berjaya dihantar ke pangkalan data!';
                }

                setTimeout(() => {
                    window.location.href = '/student/studenthomepage.html';
                }, 1200);
            } else {
                const err = await response.json();
                if (msgDiv) {
                    msgDiv.style.color = '#ff6b6b';
                    msgDiv.innerText = err.error || 'Gagal menyimpan maklumat.';
                }
            }
        } catch (err) {
            console.error(err);
            if (msgDiv) {
                msgDiv.style.color = '#ff6b6b';
                msgDiv.innerText = 'Ralat sambungan pelayan.';
            }
        }
    });
});

/* =========================================================
   MALAYSIAN IC PARSER (AUTO DOB, AGE & GENDER)
   ========================================================= */
function parseMalaysianIC(icString) {
    const cleanIC = icString.replace(/\D/g, ''); // Clean dashes/spaces

    if (cleanIC.length < 12) return;

    const yearDigits = parseInt(cleanIC.substring(0, 2), 10);
    const monthDigits = parseInt(cleanIC.substring(2, 4), 10);
    const dayDigits = parseInt(cleanIC.substring(4, 6), 10);
    const lastDigit = parseInt(cleanIC.substring(11, 12), 10);

    // Determine Century (Cutoff year set to 30 e.g. 03 -> 2003, 98 -> 1998)
    const currentTwoDigitYear = new Date().getFullYear() % 100;
    const fullYear = (yearDigits <= currentTwoDigitYear) ? (2000 + yearDigits) : (1900 + yearDigits);

    // Format DOB: YYYY-MM-DD
    const monthStr = String(monthDigits).padStart(2, '0');
    const dayStr = String(dayDigits).padStart(2, '0');
    const dobFormatted = `${fullYear}-${monthStr}-${dayStr}`;

    setInputValue('tarikhLahir', dobFormatted);

    // Calculate Age
    const dob = new Date(fullYear, monthDigits - 1, dayDigits);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
        age--;
    }
    setInputValue('umur', age);

    // Determine Gender (Odd = Lelaki, Even = Perempuan)
    const gender = (lastDigit % 2 !== 0) ? 'Lelaki' : 'Perempuan';
    setInputValue('jantina', gender);
}

/* =========================================================
   CSV AUTO-FILL & LOCALSTORAGE HANDLER
   ========================================================= */
function handleCSVUpload(event) {
    const file = event.target.files[0];
    const nameDisplay = document.getElementById('csvFileNameDisplay');

    if (!file) return;

    if (nameDisplay) nameDisplay.innerText = `📊 ${file.name}`;

    const reader = new FileReader();
    reader.onload = function (e) {
        const text = e.target.result;
        const csvData = parseCSVToJSON(text);

        if (Object.keys(csvData).length > 0) {
            // Merge CSV data with existing localStorage userData
            const existingUser = getStorageData('userData');
            const mergedUser = { ...existingUser, ...csvData };

            // Save to LocalStorage
            localStorage.setItem('userData', JSON.stringify(mergedUser));

            // Populate Form fields automatically
            loadDataFromLocalStorage();

            alert("Data dari CSV berjaya dimasukkan ke borang! Anda boleh menyunting (edit) sebelum menekan butang hantar.");
        } else {
            alert("Format CSV tidak sah. Sila pastikan baris pertama mengandungi tajuk kolum.");
        }
    };
    reader.readAsText(file);
}

// Convert CSV Header-Value pairs to Object
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
   FORM & STORAGE HELPERS
   ========================================================= */
function loadDataFromLocalStorage() {
    const data = getStorageData('userData');

    if (data.namaPelajar || data.full_name) setInputValue('namaPelajar', data.namaPelajar || data.full_name);
    if (data.noIC || data.ic_number) {
        const icVal = data.noIC || data.ic_number;
        setInputValue('noIC', icVal);
        parseMalaysianIC(icVal); // Trigger auto-fill for DOB, Age, Gender
    }
    if (data.noTel || data.phone) setInputValue('noTel', data.noTel || data.phone);
    if (data.alamatRumah) setInputValue('alamatRumah', data.alamatRumah);
    if (data.poskod) setInputValue('poskod', data.poskod);
    if (data.bandar) setInputValue('bandar', data.bandar);
    if (data.negeri) setInputValue('negeri', data.negeri);
    if (data.sebabMemohon) setInputValue('sebabMemohon', data.sebabMemohon);

    if (data.program || data.course_name) setInputValue('program', data.program || data.course_name);
    if (data.semester) setInputValue('semester', data.semester);
    if (data.gpa) setInputValue('gpa', data.gpa);
    if (data.cgpa) setInputValue('cgpa', data.cgpa);

    if (data.sumbangan1) setInputValue('sumbangan1', data.sumbangan1);
    if (data.sumbangan2) setInputValue('sumbangan2', data.sumbangan2);
    if (data.sumbangan3) setInputValue('sumbangan3', data.sumbangan3);

    if (data.namaPenjaga1) setInputValue('namaPenjaga1', data.namaPenjaga1);
    if (data.icPenjaga1) setInputValue('icPenjaga1', data.icPenjaga1);
    if (data.telPenjaga1) setInputValue('telPenjaga1', data.telPenjaga1);
    if (data.pekerjaanPenjaga1) setInputValue('pekerjaanPenjaga1', data.pekerjaanPenjaga1);
    if (data.pendapatanPenjaga1) setInputValue('pendapatanPenjaga1', data.pendapatanPenjaga1);

    if (data.namaPenjaga2) setInputValue('namaPenjaga2', data.namaPenjaga2);
    if (data.icPenjaga2) setInputValue('icPenjaga2', data.icPenjaga2);
    if (data.telPenjaga2) setInputValue('telPenjaga2', data.telPenjaga2);
    if (data.pekerjaanPenjaga2) setInputValue('pekerjaanPenjaga2', data.pekerjaanPenjaga2);
    if (data.pendapatanPenjaga2) setInputValue('pendapatanPenjaga2', data.pendapatanPenjaga2);

    if (data.tanggunganAnak) setInputValue('tanggunganAnak', data.tanggunganAnak);
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
    if (el && val !== undefined) el.value = val;
}

function getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

function handlePDFSelection(event) {
    const file = event.target.files[0];
    const nameDisplay = document.getElementById('fileNameDisplay');

    if (!file || file.type !== "application/pdf") {
        if (nameDisplay) nameDisplay.innerText = "Tiada fail dipilih";
        pdfBase64String = "";
        return;
    }

    if (nameDisplay) nameDisplay.innerText = `📄 ${file.name}`;

    const reader = new FileReader();
    reader.onload = function (e) {
        pdfBase64String = e.target.result;
    };
    reader.readAsDataURL(file);
}