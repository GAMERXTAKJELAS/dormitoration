/**
 * Dormitoration - Backend Approval Endpoint (Cloudflare Worker)
 * File: /script/approval_backend.js
 */

// Robust Malaysian IC Parser
function parseMalaysianIC(icRaw) {
  if (!icRaw) return null;
  
  let icStr = String(icRaw).trim();

  // Handle scientific notation from Excel (e.g. 6.0424E+11)
  if (/e\+/i.test(icStr)) {
    icStr = Number(icStr).toFixed(0);
  }

  // Strip non-numeric characters (hyphens, spaces, letters)
  let ic = icStr.replace(/[^0-9]/g, '');

  // Handle Excel stripping leading zeros for birth years 2000+ (e.g. 060424... -> 60424...)
  if (ic.length === 11) {
    ic = '0' + ic;
  }

  // Must be exactly 12 digits after cleaning
  if (ic.length !== 12) return null;

  const yy = ic.substring(0, 2);
  const mm = ic.substring(2, 4);
  const dd = ic.substring(4, 6);
  const pb = ic.substring(6, 8);
  const lastDigit = parseInt(ic.substring(11, 12), 10);

  // Determine full birth year (Cutoff based on short year)
  const currentYearShort = new Date().getFullYear() % 100;
  const fullYear = parseInt(yy, 10) > currentYearShort ? `19${yy}` : `20${yy}`;
  const dob = `${fullYear}-${mm}-${dd}`;

  // Calculate age accurately
  const birthDate = new Date(`${fullYear}-${mm}-${dd}`);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  // Gender calculation: Odd = Lelaki, Even = Perempuan
  const gender = (lastDigit % 2 !== 0) ? 'Lelaki' : 'Perempuan';

  return { 
    dob, 
    age, 
    gender, 
    formattedIC: `${yy}${mm}${dd}-${pb}-${ic.substring(8)}`,
    rawIC: ic
  };
}

export async function handleAdminApplications(request, env, headers) {
  const url = new URL(request.url);
  const method = request.method;

  // -------------------------------------------------------------------------
  // 1. GET Request: Query users and applications matching exact D1 schema
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
          COALESCE(NULLIF(h.ic_number, ''), '-') AS ic_number,
          COALESCE(NULLIF(h.gender, ''), '-') AS gender,
          COALESCE(NULLIF(h.dob, ''), '-') AS dob,
          COALESCE(NULLIF(h.age, ''), '-') AS age,
          u.role AS role,
          COALESCE(NULLIF(h.program, ''), 'Pending Fill') AS program,
          COALESCE(NULLIF(h.session_id, ''), '-') AS session_id,
          COALESCE(NULLIF(h.admin_approval, ''), 'pending') AS status,
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
  // 3. POST Request: Import CSV & Auto Fill dob, age, gender, ic_number
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
        const fullName = s.full_name || s.name || s.nama || '';
        const phone = s.phone || s.telefon || s.no_hp || '';
        const randomPass = 'TVET-' + crypto.randomUUID().slice(0, 8);

        // 1. Extract raw IC from payload
        const rawIC = s.ic_number || s.ic || s.mykad || s.no_kp || s.nokp || '';
        const icParsed = parseMalaysianIC(rawIC);

        // 2. Format IC Number (Keep cleaned 12 digits or raw)
        const icNumber = icParsed ? icParsed.rawIC : (rawIC ? String(rawIC).replace(/[^0-9]/g, '') : '-');

        // 3. Determine DOB, Age, Gender:
        // Use backend IC parsed values FIRST; if IC was not parsed/missing, fallback to webpage/frontend pre-calculated values
        const dob = (icParsed && icParsed.dob) ? icParsed.dob : (s.dob || null);
        const age = (icParsed && icParsed.age) ? icParsed.age : (s.age || null);
        const gender = (icParsed && icParsed.gender) ? icParsed.gender : (s.gender || null);

        // Check if user already exists
        const existingUser = await env.DB.prepare(
          `SELECT id FROM users WHERE email = ? LIMIT 1`
        ).bind(s.email).first();

        let userId;

        if (existingUser) {
          userId = existingUser.id;
          await env.DB.prepare(`
            UPDATE users 
            SET full_name = COALESCE(NULLIF(?, ''), full_name), 
                phone = COALESCE(NULLIF(?, ''), phone) 
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

        // Insert or update hostel_applications
        if (userId) {
          const program = s.program || s.kursus || 'Pending Fill';
          const session = s.session || s.session_id || s.sesi || '-';

          const existingApp = await env.DB.prepare(
            `SELECT id FROM hostel_applications WHERE user_id = ? LIMIT 1`
          ).bind(userId).first();

          if (existingApp) {
            // Force update fields even if previous DB value was '-' or NULL
            await env.DB.prepare(`
              UPDATE hostel_applications 
              SET ic_number = CASE WHEN ? IS NOT NULL AND ? != '-' THEN ? ELSE ic_number END, 
                  program = COALESCE(NULLIF(?, 'Pending Fill'), program), 
                  session_id = COALESCE(NULLIF(?, '-'), session_id),
                  gender = COALESCE(?, gender),
                  dob = COALESCE(?, dob),
                  age = COALESCE(?, age)
              WHERE user_id = ?
            `).bind(icNumber, icNumber, icNumber, program, session, gender, dob, age, userId).run();
          } else {
            await env.DB.prepare(`
              INSERT INTO hostel_applications 
                (user_id, ic_number, program, session_id, gender, dob, age, admin_approval, submission_status)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'pending')
            `).bind(userId, icNumber, program, session, gender, dob, age).run();
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