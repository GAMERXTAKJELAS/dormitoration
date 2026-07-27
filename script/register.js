/**
 * Dormitoration - Register JS Handler
 * Auto-extracts IC details, manages registration, and sets username to null for future profile setup.
 */

document.addEventListener('DOMContentLoaded', () => {
  const registerForm = document.getElementById('registerForm');
  const icInput = document.getElementById('regIC');

  // Real-time IC feedback (Optional UI preview if input fields exist on page)
  if (icInput) {
    icInput.addEventListener('input', (e) => {
      const parsed = parseMalaysianIC(e.target.value);
      if (parsed.valid) {
        setInputValue('previewTarikhLahir', parsed.tarikhLahir);
        setInputValue('previewUmur', parsed.umur);
        setInputValue('previewJantina', parsed.jantina);
        setInputValue('previewNegeri', parsed.negeri);
      }
    });
  }

  // Handle Form Submission
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Collect DOM elements safely
      const rawIC = getInputValue('regIC');
      const matriks = getInputValue('regMatriks');
      const phone = getInputValue('regPhone');
      const password = document.getElementById('regPassword')?.value || '';
      const fullName = getInputValue('regFullName');
      const email = getInputValue('regEmail');

      // 1. Validate IC Number
      const icData = parseMalaysianIC(rawIC);
      if (!icData.valid) {
        alert("Sila masukkan No. IC yang sah (12 digit).");
        return;
      }

      // 2. Validate mandatory fields
      if (!phone || !password) {
        alert("Sila lengkapkan No. Telefon dan Kata Laluan.");
        return;
      }

      // 3. Build registration payload with username EXPLICITLY set to NULL
      const payload = {
        username: null, // Left null for profile setup/editing in next step
        ic_number: icData.cleanIC,
        matriks_number: matriks || null,
        phone: phone,
        password: password,
        full_name: fullName || null,
        email: email || null,
        tarikh_lahir: icData.tarikhLahir,
        umur: icData.umur,
        jantina: icData.jantina,
        negeri: icData.negeri,
        role: 'student'
      };

      try {
        // Submit payload to Cloudflare D1 Backend
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify(payload)
        });

        const resData = await response.json();

        if (response.ok) {
          // Merge API response (containing user ID & account status) with payload
          const userData = {
            ...payload,
            id: resData.user?.id || null,
            account_status: resData.user?.account_status || 'pending_details',
            registration_deadline: resData.user?.registration_deadline || null
          };

          // Save to LocalStorage for immediate use in detailinformation.html
          localStorage.setItem('userData', JSON.stringify(userData));

          alert("Pendaftaran berjaya!");
          window.location.href = '/student/studenthomepage.html';
        } else {
          alert(resData.error || "Pendaftaran gagal. Sila cuba lagi.");
        }
      } catch (err) {
        console.warn("Backend server not reachable. Fallback saving to LocalStorage:", err);

        // Fallback for offline / local testing
        const fallbackData = {
          ...payload,
          id: 'temp_' + Date.now(),
          account_status: 'pending_details'
        };
        
        localStorage.setItem('userData', JSON.stringify(fallbackData));
        alert("Pendaftaran disimpan secara tempatan (Mode Luar Talian).");
        window.location.href = '/student/studenthomepage.html';
      }
    });
  }
});

/* =========================================================
   MALAYSIAN IC EXTRACTOR (DOB, AGE, GENDER, STATE)
   ========================================================= */
function parseMalaysianIC(icString) {
  if (!icString) return { valid: false };

  // Strip non-numeric characters (dashes, spaces)
  const cleanIC = icString.replace(/\D/g, '');

  if (cleanIC.length !== 12) {
    return { valid: false };
  }

  const yearDigits = parseInt(cleanIC.substring(0, 2), 10);
  const monthDigits = parseInt(cleanIC.substring(2, 4), 10);
  const dayDigits = parseInt(cleanIC.substring(4, 6), 10);
  const stateCode = cleanIC.substring(6, 8);
  const lastDigit = parseInt(cleanIC.substring(11, 12), 10);

  // Simple validation for valid month/day ranges
  if (monthDigits < 1 || monthDigits > 12 || dayDigits < 1 || dayDigits > 31) {
    return { valid: false };
  }

  // Century Logic: 00-26 -> 2000s, 27-99 -> 1900s
  const currentTwoDigitYear = new Date().getFullYear() % 100;
  const fullYear = (yearDigits <= currentTwoDigitYear) ? (2000 + yearDigits) : (1900 + yearDigits);

  // Format Date of Birth (YYYY-MM-DD)
  const monthStr = String(monthDigits).padStart(2, '0');
  const dayStr = String(dayDigits).padStart(2, '0');
  const tarikhLahir = `${fullYear}-${monthStr}-${dayStr}`;

  // Calculate Exact Age
  const dob = new Date(fullYear, monthDigits - 1, dayDigits);
  const today = new Date();
  let umur = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    umur--;
  }

  // Determine Gender (Odd = Lelaki, Even = Perempuan)
  const jantina = (lastDigit % 2 !== 0) ? 'Lelaki' : 'Perempuan';

  // Determine State of Birth
  const negeri = getMalaysianState(stateCode);

  return {
    valid: true,
    cleanIC,
    tarikhLahir,
    umur,
    jantina,
    negeri
  };
}

/**
 * Maps Malaysian IC Place of Birth (PB) codes to States
 */
function getMalaysianState(code) {
  const stateMap = {
    '01': 'Johor', '21': 'Johor', '22': 'Johor', '23': 'Johor', '24': 'Johor',
    '02': 'Kedah', '25': 'Kedah', '26': 'Kedah', '27': 'Kedah',
    '03': 'Kelantan', '28': 'Kelantan', '29': 'Kelantan',
    '04': 'Melaka', '30': 'Melaka',
    '05': 'Negeri Sembilan', '31': 'Negeri Sembilan',
    '06': 'Pahang', '32': 'Pahang', '33': 'Pahang',
    '07': 'Pulau Pinang', '34': 'Pulau Pinang', '35': 'Pulau Pinang',
    '08': 'Perak', '36': 'Perak', '37': 'Perak', '38': 'Perak', '39': 'Perak',
    '09': 'Perlis', '40': 'Perlis',
    '10': 'Selangor', '41': 'Selangor', '42': 'Selangor', '43': 'Selangor', '44': 'Selangor',
    '11': 'Terengganu', '45': 'Terengganu', '46': 'Terengganu',
    '12': 'Sabah', '47': 'Sabah', '48': 'Sabah', '49': 'Sabah',
    '13': 'Sarawak', '50': 'Sarawak', '51': 'Sarawak', '52': 'Sarawak', '53': 'Sarawak',
    '14': 'Wilayah Persekutuan Kuala Lumpur', '54': 'Wilayah Persekutuan Kuala Lumpur', '55': 'Wilayah Persekutuan Kuala Lumpur',
    '15': 'Wilayah Persekutuan Labuan', '56': 'Wilayah Persekutuan Labuan',
    '16': 'Wilayah Persekutuan Putrajaya', '57': 'Wilayah Persekutuan Putrajaya'
  };
  return stateMap[code] || 'Lain-lain';
}

/* Helper Utilities */
function getInputValue(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : null;
}

function setInputValue(id, val) {
  const el = document.getElementById(id);
  if (el && val !== undefined && val !== null) {
    el.value = val;
  }
}