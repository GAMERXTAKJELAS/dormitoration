/**
 * Dormitoration - Backend Approval Endpoint (Cloudflare Worker)
 * File: /script/approval_backend.js
 */

export async function handleAdminApplications(request, env, headers) {
  const url = new URL(request.url);
  const method = request.method;

// -------------------------------------------------------------------------
  // 1. GET Request: Fetch all applications with Profile Picture fallback
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
          COALESCE(u.profile_picture, NULL) AS profile_picture,
          COALESCE(h.ic_number, '-') AS ic_number,
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

      return new Response(JSON.stringify(results || []), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" }
      });
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
  // 3. POST Request: Batch Import Students (No ON CONFLICT dependency)
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

      // Step 1: Process Users one by one or via clean queries
      for (const s of validStudents) {
        const fullName = s.full_name || s.name || '';
        const phone = s.phone || '';
        const randomPass = 'TVET-' + crypto.randomUUID().slice(0, 8);

        // Check if user already exists by email
        const existingUser = await env.DB.prepare(
          `SELECT id FROM users WHERE email = ? LIMIT 1`
        ).bind(s.email).first();

        let userId;

        if (existingUser) {
          userId = existingUser.id;
          // Update existing user details
          await env.DB.prepare(`
            UPDATE users 
            SET full_name = ?, phone = COALESCE(?, phone) 
            WHERE id = ?
          `).bind(fullName, phone, userId).run();
        } else {
          // Insert new user
          const insertRes = await env.DB.prepare(`
            INSERT INTO users (full_name, email, phone, role, password_hash, account_status)
            VALUES (?, ?, ?, 'student', ?, 'pending_details')
          `).bind(fullName, s.email, phone, randomPass).run();

          // Get inserted ID
          const newRecord = await env.DB.prepare(
            `SELECT id FROM users WHERE email = ? LIMIT 1`
          ).bind(s.email).first();
          userId = newRecord?.id;
        }

        // Step 2: Insert or update hostel_applications for this user ID
        if (userId) {
          const icNumber = s.ic_number || s.ic || s.mykad || '-';
          const program = s.program || 'Pending Fill';
          const session = s.session || s.session_id || '-';

          const existingApp = await env.DB.prepare(
            `SELECT id FROM hostel_applications WHERE user_id = ? LIMIT 1`
          ).bind(userId).first();

          if (existingApp) {
            await env.DB.prepare(`
              UPDATE hostel_applications 
              SET ic_number = ?, program = ?, session_id = ?
              WHERE user_id = ?
            `).bind(icNumber, program, session, userId).run();
          } else {
            await env.DB.prepare(`
              INSERT INTO hostel_applications (user_id, ic_number, program, session_id, admin_approval, submission_status)
              VALUES (?, ?, ?, ?, 'pending', 'pending')
            `).bind(userId, icNumber, program, session).run();
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