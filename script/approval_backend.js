/**
 * Dormitoration - Backend Approval Endpoint (Cloudflare Worker)
 * File: /script/approval_backend.js
 */

export async function handleAdminApplications(request, env, headers) {
  const url = new URL(request.url);
  const method = request.method;

  if (method === 'GET' && url.pathname === '/api/admin/applications') {
    try {
      // Query both registered users AND unlinked CSV applications while excluding admins
      const { results } = await env.DB.prepare(`
        SELECT 
          u.id AS user_id,
          h.id AS application_id,
          COALESCE(u.full_name, h.full_name, 'N/A') AS full_name,
          COALESCE(u.email, h.email, '-') AS email,
          COALESCE(u.phone, h.guardian1_phone, '-') AS phone,
          COALESCE(h.ic_number, '-') AS ic_number,
          u.role,
          COALESCE(h.program, 'Pending Fill') AS program,
          COALESCE(h.session_id, '-') AS session_id,
          COALESCE(h.admin_approval, 'pending') AS status
        FROM users u
        LEFT JOIN hostel_applications h ON u.id = h.user_id OR u.ic_number = h.ic_number
        WHERE (u.role IS NULL OR u.role != 'admin')

        UNION ALL

        SELECT 
          NULL AS user_id,
          h.id AS application_id,
          h.full_name,
          h.email,
          '-' AS phone,
          h.ic_number,
          'student' AS role,
          COALESCE(h.program, 'Pending Fill') AS program,
          COALESCE(h.session_id, '-') AS session_id,
          COALESCE(h.admin_approval, 'pending') AS status
        FROM hostel_applications h
        WHERE h.user_id IS NULL AND h.ic_number NOT IN (SELECT ic_number FROM users WHERE ic_number IS NOT NULL)
      `).all();

      return new Response(
        JSON.stringify({ success: true, data: results }),
        { status: 200, headers }
      );
    } catch (err) {
      console.error("Fetch Applications DB Error:", err);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch application list', details: err.message }),
        { status: 500, headers }
      );
    }
  }

  // 2. PATCH Request: Update application status (Approved / Returned)
  if (method === 'PATCH' && url.pathname === '/api/admin/applications/status') {
    try {
      const { user_id, status } = await request.json();

      await env.DB.prepare(`
        UPDATE hostel_applications 
        SET admin_approval = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? OR id = ?
      `).bind(status, user_id, user_id).run();

      return new Response(
        JSON.stringify({ success: true, message: 'Status updated successfully!' }),
        { status: 200, headers }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Database update failed', details: err.message }),
        { status: 500, headers }
      );
    }
  }

  // 3. POST Request: Upload CSV & Sync / Pre-populate Student Records by IC Number
  if (method === 'POST' && url.pathname === '/api/admin/applications/import-csv') {
    try {
      const formData = await request.formData();
      const file = formData.get("file");

      if (!file) {
        return new Response(JSON.stringify({ error: "Tiada fail CSV dimuat naik." }), { status: 400, headers });
      }

      const text = await file.text();
      const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);

      // Skip header row if present
      const rows = lines.slice(1);
      let insertedCount = 0;

      for (const row of rows) {
        // Expected CSV Format: IC_NUMBER, FULL_NAME, PROGRAM, SESSION, EMAIL
        const cols = row.split(",").map(c => c.trim().replace(/^"|"$/g, ''));
        if (cols.length < 2) continue;

        const [ic_number, full_name, program, session_id, email] = cols;

        // Check if student user account already exists with this IC
        const existingUser = await env.DB.prepare(
          `SELECT id FROM users WHERE ic_number = ?`
        ).bind(ic_number).first();

        const userId = existingUser ? existingUser.id : null;

        // UPSERT into hostel_applications and synchronize user_id if account exists
        await env.DB.prepare(`
          INSERT INTO hostel_applications (ic_number, full_name, program, session_id, email, user_id, admin_approval)
          VALUES (?, ?, ?, ?, ?, ?, 'pending')
          ON CONFLICT(ic_number) DO UPDATE SET
            full_name = excluded.full_name,
            program = excluded.program,
            session_id = excluded.session_id,
            email = excluded.email,
            user_id = COALESCE(hostel_applications.user_id, excluded.user_id)
        `).bind(ic_number, full_name, program || 'N/A', session_id || 'N/A', email || '', userId).run();

        insertedCount++;
      }

      return new Response(
        JSON.stringify({ success: true, insertedCount }),
        { status: 200, headers }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Gagal memproses fail CSV", details: err.message }),
        { status: 500, headers }
      );
    }
  }
}