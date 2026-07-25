document.addEventListener('DOMContentLoaded', () => {
    const userData = JSON.parse(localStorage.getItem('userData') || '{}');

    // 1. Pre-fill existing data from LocalStorage if available
    if (userData.full_name) setInputValue('namaPelajar', userData.full_name);
    if (userData.ic_number) setInputValue('noIC', userData.ic_number);
    if (userData.phone) setInputValue('noTel', userData.phone);
    if (userData.course_name) setInputValue('program', userData.course_name);
    if (userData.semester) setInputValue('semester', userData.semester);
    if (userData.gender) setInputValue('jantina', userData.gender);

    const detailForm = document.getElementById('detailInfoForm');
    const msgDiv = document.getElementById('detailMsg');

    detailForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Check if PDF base64 is prepared
        if (!pdfBase64String) {
            alert("Sila muat naik Slip Gaji (PDF) terlebih dahulu.");
            return;
        }

        if (msgDiv) {
            msgDiv.style.color = '#ffffff';
            msgDiv.innerText = 'Saving details...';
        }

        // 2. Gather ALL form data matching Page 2
        const updatedDetails = {
            username: userData.username,
            // Bahagian A
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

            // Bahagian B
            program: getValue('program'),
            semester: getValue('semester'),
            gpa: getValue('gpa'),
            cgpa: getValue('cgpa'),
            sumbangan: [
                getValue('sumbangan1'),
                getValue('sumbangan2'),
                getValue('sumbangan3')
            ].filter(Boolean),

            // Bahagian C
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

            // Attachment
            slipGajiPDF: pdfBase64String
        };

        try {
            // 3. Send payload to backend
            const response = await fetch('/api/student/update-details', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedDetails)
            });

            if (response.ok) {
                // Update LocalStorage session data so the profile reflects changes
                const newUserData = { 
                    ...userData, 
                    full_name: updatedDetails.namaPelajar,
                    ic_number: updatedDetails.noIC,
                    phone: updatedDetails.noTel,
                    course_name: updatedDetails.program,
                    semester: updatedDetails.semester,
                    account_status: 'pending' // Update status to pending review
                };
                localStorage.setItem('userData', JSON.stringify(newUserData));

                if (msgDiv) {
                    msgDiv.style.color = '#47f59b';
                    msgDiv.innerText = 'Permohonan berjaya dihantar! Redirecting...';
                }

                setTimeout(() => {
                    window.location.href = '/student/studenthomepage.html';
                }, 1200);
            } else {
                const err = await response.json();
                if (msgDiv) {
                    msgDiv.style.color = '#ff6b6b';
                    msgDiv.innerText = err.error || 'Failed to update details.';
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

// Helper functions for cleaner code
function setInputValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

// Age auto-calculator
function calculateAge() {
    const dobInput = getValue('tarikhLahir');
    if (!dobInput) return;
    
    const dob = new Date(dobInput);
    const diff = Date.now() - dob.getTime();
    const ageDate = new Date(diff);
    const age = Math.abs(ageDate.getUTCFullYear() - 1970);
    
    setInputValue('umur', age);
}

// PDF Handler Logic
let pdfBase64String = "";

function handlePDFSelection(event) {
    const file = event.target.files[0];
    const nameDisplay = document.getElementById('fileNameDisplay');

    if (!file) {
        if (nameDisplay) nameDisplay.innerText = "Tiada fail dipilih";
        pdfBase64String = "";
        return;
    }

    if (file.type !== "application/pdf") {
        alert("Sila muat naik fail dalam format PDF sahaja!");
        event.target.value = "";
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