/**
 * Dormitoration - Backend Approval Endpoint (Cloudflare Worker)
 * File: /script/approval_backend.js
 */

// Helper to parse Malaysian IC Number (MyKad: YYMMDD-PB-###G)
function parseMalaysianIC(icRaw) {
  if (!icRaw) return null;
  const ic = String(icRaw).replace(/[^0-9]/g, ''); // Strip non-numeric characters
  if (ic.length !== 12) return null;

  const yy = ic.substring(0, 2);
  const mm = ic.substring(2, 4);
  const dd = ic.substring(4, 6);
  const pb = ic.substring(6, 8);
  const lastDigit = parseInt(ic.substring(11, 12), 10);

  // 1. Determine Birth Year & Date
  const currentYearShort = new Date().getFullYear() % 100;
  const fullYear = parseInt(yy, 10) > currentYearShort ? `19${yy}` : `20${yy}`;
  const dob = `${fullYear}-${mm}-${dd}`;

  // 2. Calculate Age
  const birthDate = new Date(`${fullYear}-${mm}-${dd}`);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  // 3. Determine Gender (Odd = Male, Even = Female)
  const gender = (lastDigit % 2 !== 0) ? 'Lelaki' : 'Perempuan';

  // 4. Map State / Place of Birth (JPN Codes)
  const stateCodes = {
    '01': 'Johor', '21': 'Johor', '22': 'Johor', '23': 'Johor', '24': 'Johor',
    '02': 'Kedah', '25': 'Kedah', '26': 'Kedah', '27': 'Kedah',
    '03': 'Kelantan', '28': 'Kelantan', '29': 'Kelantan',
    '04': 'Melaka', '30': 'Melaka',
    '05': 'Negeri Sembilan', '31': 'Negeri Sembilan', '59': 'Negeri Sembilan',
    '06': 'Pahang', '32': 'Pahang', '33': 'Pahang',
    '07': 'Pulau Pinang', '34': 'Pulau Pinang', '35': 'Pulau Pinang',
    '08': 'Perak', '36': 'Perak', '37': 'Perak', '38': 'Perak', '39': 'Perak',
    '09': 'Perlis', '40': 'Perlis',
    '10': 'Selangor', '41': 'Selangor', '42': 'Selangor', '43': 'Selangor', '44': 'Selangor',
    '11': 'Terengganu', '45': 'Terengganu', '46': 'Terengganu',
    '12': 'Sabah', '47': 'Sabah', '48': 'Sabah', '49': 'Sabah',
    '13': 'Sarawak', '50': 'Sarawak', '51': 'Sarawak', '52': 'Sarawak', '53': 'Sarawak',
    '14': 'Kuala Lumpur', '54': 'Kuala Lumpur', '55': 'Kuala Lumpur', '56': 'Kuala Lumpur', '57': 'Kuala Lumpur',
    '15': 'Labuan', '58': 'Labuan',
    '16': 'Putrajaya'
  };

  const stateOfBirth = stateCodes[pb] || 'Lain-Lain';

  return { dob, age, gender, stateOfBirth, formattedIC: `${yy}${mm}${dd}-${pb}-${ic.substring(8)}` };
}

export async function handleAdminApplications(request, env, headers) {
  const url = new URL(request.url);
  const method = request.method;

  // -------------------------------------------------------------------------
  // 1. GET Request: Query users and applications with IC details
  // -------------------------------------------------------------------------
  if (method === 'GET' && url.pathname === '/api/admin/applications') {
    try {
      const query = `
        SELECT 
          u.id AS user_id,
          h.id AS application_id,
          u.full_name AS full_name,
          u.email AS email,
          u.phone AS phone,
          u.profile_picture AS profile_picture,
          COALESCE(h.ic_number, '-') AS ic_number,
          COALESCE(h.gender, '-') AS gender,
          COALESCE(h.dob, '-') AS dob,
          COALESCE(h.age, '-') AS age,
          COALESCE(h.place_of_birth, '-') AS place_of_birth,
          u.role AS role,
          COALESCE(h.program, 'Pending Fill') AS program,
          COALESCE(h.session_id, '-') AS session_id,
          COALESCE(h.admin_approval, 'pending') AS status,
          u.account_status AS user_account_status
        FROM users u
        LEFT JOIN hostel_applications h ON u.id = h.user_id
        WHERE u.role != 'admin' OR u.role IS NULL
        ORDER BY h.id DESC
      `;

      const { results } = await env.DB.prepare(query).all();

      return new Response(JSON.stringify({ success: true, data: results || [] }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("GET Applications Error:", err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. PATCH Request: Update application status
  // -------------------------------------------------------------------------
  if (method === 'PATCH' && url.pathname === '/api/admin/applications/status') {
    try {
      const body = await request.json();
      const { user_id, status } = body;

      if (!user_id || !status) {
        return new Response(
          JSON.stringify({ error: 'user_id and status are required.' }),
          { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
        );
      }

      let targetAccountStatus = 'pending_details';
      if (status === 'approved') {
        targetAccountStatus = 'active';
      } else if (status === 'returned' || status === 'rejected' || status === 'declined') {
        targetAccountStatus = 'pending_details';
      }

      await env.DB.prepare(`
        UPDATE users 
        SET account_status = ? 
        WHERE id = ?
      `).bind(targetAccountStatus, user_id).run();

      const existingApp = await env.DB.prepare(
        `SELECT id FROM hostel_applications WHERE user_id = ? LIMIT 1`
      ).bind(user_id).first();

      if (existingApp) {
        await env.DB.prepare(`
          UPDATE hostel_applications 
          SET admin_approval = ?,
              submission_status = ?
          WHERE user_id = ?
        `).bind(status, status, user_id).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO hostel_applications (user_id, admin_approval, submission_status)
          VALUES (?, ?, ?)
        `).bind(user_id, status, status).run();
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Status updated successfully!',
          account_status: targetAccountStatus
        }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("Update Approval Status DB Error:", err);
      return new Response(
        JSON.stringify({ error: 'Database update failed', details: err.message }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
  }

  // -------------------------------------------------------------------------
  // 3. POST Request: Batch Import Students with Auto IC Calculations
  // -------------------------------------------------------------------------
  if (method === 'POST' && url.pathname === '/api/admin/applications/import-csv') {
    try {
      const body = await request.json();
      const { students } = body;

      if (!Array.isArray(students) || students.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No student data provided in request' }),
          { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
        );
      }

      const validStudents = students.filter(s => s && s.email);

      if (validStudents.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No valid student rows with email addresses found' }),
          { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
        );
      }

      for (const s of validStudents) {
        const fullName = s.full_name || s.name || '';
        const phone = s.phone || '';
        const randomPass = 'TVET-' + crypto.randomUUID().slice(0, 8);

        // Process IC Number & calculate metadata
        const rawIC = s.ic_number || s.ic || s.mykad || '';
        const icParsed = parseMalaysianIC(rawIC);

        const icNumber = icParsed ? icParsed.formattedIC : (rawIC || '-');
        const dob = icParsed ? icParsed.dob : (s.dob || null);
        const age = icParsed ? icParsed.age : (s.age || null);
        const gender = icParsed ? icParsed.gender : (s.gender || null);
        const placeOfBirth = icParsed ? icParsed.stateOfBirth : (s.place_of_birth || null);

        // Check if user already exists
        const existingUser = await env.DB.prepare(
          `SELECT id FROM users WHERE email = ? LIMIT 1`
        ).bind(s.email).first();

        let userId;

        if (existingUser) {
          userId = existingUser.id;
          await env.DB.prepare(`
            UPDATE users 
            SET full_name = ?, phone = COALESCE(?, phone) 
            WHERE id = ?
          `).bind(fullName, phone, userId).run();
        } else {
          await env.DB.prepare(`
            INSERT INTO users (full_name, email, phone, role, password_hash, account_status)
            VALUES (?, ?, ?, 'student', ?, 'pending_details')
          `).bind(fullName, s.email, phone, randomPass).run();

          const newRecord = await env.DB.prepare(
            `SELECT id FROM users WHERE email = ? LIMIT 1`
          ).bind(s.email).first();
          userId = newRecord?.id;
        }

        // Insert/Update hostel_applications with calculated IC info
        if (userId) {
          const program = s.program || 'Pending Fill';
          const session = s.session || s.session_id || '-';

          const existingApp = await env.DB.prepare(
            `SELECT id FROM hostel_applications WHERE user_id = ? LIMIT 1`
          ).bind(userId).first();

          if (existingApp) {
            await env.DB.prepare(`
              UPDATE hostel_applications 
              SET ic_number = ?, 
                  program = ?, 
                  session_id = ?,
                  gender = COALESCE(?, gender),
                  dob = COALESCE(?, dob),
                  age = COALESCE(?, age),
                  place_of_birth = COALESCE(?, place_of_birth)
              WHERE user_id = ?
            `).bind(icNumber, program, session, gender, dob, age, placeOfBirth, userId).run();
          } else {
            await env.DB.prepare(`
              INSERT INTO hostel_applications 
                (user_id, ic_number, program, session_id, gender, dob, age, place_of_birth, admin_approval, submission_status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending')
            `).bind(userId, icNumber, program, session, gender, dob, age, placeOfBirth).run();
          }
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          insertedCount: validStudents.length 
        }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("CSV Import DB Error:", err);
      return new Response(
        JSON.stringify({ error: 'Failed to import CSV batch', details: err.message }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(JSON.stringify({ error: "Route not found" }), { status: 404, headers });
}