/**
 * Dormitoration - Backend Approval Endpoint (Cloudflare Worker)
 * File: /script/approval_backend.js
 */

export async function handleAdminApplications(request, env, headers) {
  const url = new URL(request.url);
  const method = request.method;

  // 1. GET Request: Fetch applications linked directly by user ID
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
          COALESCE(h.admin_approval, 'pending') AS status
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

  // 2. PATCH Request: Update application status using user_id
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

      // Updates existing record or creates a base application row if one doesn't exist yet
      await env.DB.prepare(`
        INSERT INTO hostel_applications (user_id, admin_approval)
        VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          admin_approval = excluded.admin_approval,
          updated_at = CURRENT_TIMESTAMP
      `).bind(user_id, status).run();

      return new Response(
        JSON.stringify({ success: true, message: 'Status updated successfully!' }),
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

  return new Response(JSON.stringify({ error: "Route not found" }), { status: 404, headers });
}