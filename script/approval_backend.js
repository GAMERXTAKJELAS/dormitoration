/**
 * Dormitoration - Backend Approval Endpoint (Cloudflare Worker)
 * File: /script/approval_backend.js
 */

export async function handleAdminApplications(request, env, headers) {
  const url = new URL(request.url);
  const method = request.method;

  // -------------------------------------------------------------------------
  // 1. GET Request: Fetch applications linked directly by user ID
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
          COALESCE(h.ic_number, '-') AS ic_number,
          u.role AS role,
          COALESCE(h.program, 'Pending Fill') AS program,
          COALESCE(h.session_id, '-') AS session_id,
          COALESCE(h.admin_approval, 'pending') AS status,
          u.account_status AS user_account_status
        FROM users u
        LEFT JOIN hostel_applications h ON u.id = h.user_id
        WHERE u.role != 'admin' OR u.role IS NULL
      `;

      const statement = env.DB.prepare(query);
      const { results } = await statement.all();

      return new Response(
        JSON.stringify({ success: true, data: results || [] }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("Fetch Applications DB Error:", err);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Failed to fetch application list', 
          details: err.message || err.toString() 
        }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
  }

  // -------------------------------------------------------------------------
  // 2. PATCH Request: Update application status and sync user account status
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

      // Map application action status -> users.account_status (Satisfies CHECK constraint)
      let targetAccountStatus = 'pending_details';
      if (status === 'approved') {
        targetAccountStatus = 'active';
      } else if (status === 'returned' || status === 'rejected' || status === 'declined') {
        // Must match allowed CHECK constraint values: ('pending_details', 'active', 'terminated')
        targetAccountStatus = 'pending_details';
      }

      // A. Sync status in `users` table so user retains login with updated status
      await env.DB.prepare(`
        UPDATE users 
        SET account_status = ? 
        WHERE id = ?
      `).bind(targetAccountStatus, user_id).run();

      // B. Update existing hostel application row if present
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
        // C. Insert new base record if application row doesn't exist yet
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
  // 3. POST Request: Batch Import Students via CSV (Users + Hostel Applications)
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

      // Step 1: Upsert into `users` (full_name, email, phone, role) with NULL password & status
      const userStatements = [];
      for (const s of validStudents) {
        const fullName = s.full_name || s.name || '';
        const phone = s.phone || '';

        userStatements.push(
          env.DB.prepare(`
            INSERT INTO users (full_name, email, phone, role, password, account_status)
            VALUES (?, ?, ?, 'student', NULL, 'pending_details')
            ON CONFLICT(email) DO UPDATE SET 
              full_name = excluded.full_name,
              phone = COALESCE(excluded.phone, users.phone)
          `).bind(fullName, s.email, phone)
        );
      }

      await env.DB.batch(userStatements);

      // Step 2: Retrieve generated user IDs using emails
      const emails = validStudents.map(s => s.email);
      const placeholders = emails.map(() => '?').join(',');
      const userRecords = await env.DB.prepare(
        `SELECT id, email FROM users WHERE email IN (${placeholders})`
      ).bind(...emails).all();

      const emailToIdMap = {};
      (userRecords.results || []).forEach(u => {
        emailToIdMap[u.email] = u.id;
      });

      // Step 3: Insert into `hostel_applications` (user_id, ic_number, program, session_id)
      const appStatements = [];
      for (const s of validStudents) {
        const userId = emailToIdMap[s.email];
        if (!userId) continue;

        const icNumber = s.ic_number || s.ic || s.mykad || '-';
        const program = s.program || 'Pending Fill';
        const session = s.session || s.session_id || '-';

        appStatements.push(
          env.DB.prepare(`
            INSERT INTO hostel_applications (user_id, ic_number, program, session_id, admin_approval, submission_status)
            VALUES (?, ?, ?, ?, 'pending', 'pending')
            ON CONFLICT(user_id) DO UPDATE SET
              ic_number = COALESCE(excluded.ic_number, hostel_applications.ic_number),
              program = COALESCE(excluded.program, hostel_applications.program),
              session_id = COALESCE(excluded.session_id, hostel_applications.session_id)
          `).bind(userId, icNumber, program, session)
        );
      }

      if (appStatements.length > 0) {
        await env.DB.batch(appStatements);
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