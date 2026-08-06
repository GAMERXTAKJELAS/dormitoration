/**
 * Dormitoration - Backend Approval Endpoint (Cloudflare Worker)
 * File: /script/approval_backend.js
 */

export async function handleAdminApplications(request, env, headers) {
  const method = request.method;

  // 1. GET Request: Fetch all student accounts (Excludes Admin Role)
  if (method === 'GET') {
    try {
      const { results } = await env.DB.prepare(`
        SELECT 
          u.id AS user_id,
          u.full_name,
          u.email,
          u.phone,
          u.role,
          h.program,
          h.session_id,
          COALESCE(h.admin_approval, 'pending') AS status
        FROM users u
        LEFT JOIN hostel_applications h ON u.id = h.user_id
        WHERE u.role != 'admin'
        ORDER BY u.created_at DESC
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

  // 2. PATCH Request: Update student application status (Approved / Returned)
  if (method === 'PATCH') {
    try {
      const { user_id, status } = await request.json();

      if (!user_id || !status) {
        return new Response(
          JSON.stringify({ error: 'Maklumat user_id dan status diperlukan.' }),
          { status: 400, headers }
        );
      }

      // Update hostel_applications approval status
      await env.DB.prepare(`
        UPDATE hostel_applications 
        SET admin_approval = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `).bind(status, user_id).run();

      return new Response(
        JSON.stringify({ success: true, message: 'Status updated successfully!' }),
        { status: 200, headers }
      );
    } catch (err) {
      console.error("Update Approval Status DB Error:", err);
      return new Response(
        JSON.stringify({ error: 'Database update failed', details: err.message }),
        { status: 500, headers }
      );
    }
  }
}