/**
 * Dormitoration - Admin Dashboard Backend Handler
 * Route: /api/admin/dashboard/*
 */

export async function handleDashboardRoutes(request, env, headers) {
  const url = new URL(request.url);
  const method = request.method;

  // -------------------------------------------------------------------------
  // 1. GET /api/admin/dashboard/stats - Top Metrics
  // -------------------------------------------------------------------------
  if (method === 'GET' && url.pathname === '/api/admin/dashboard/stats') {
    try {
      // Count total active students
      const activeRes = await env.DB.prepare(
        `SELECT COUNT(*) AS total_active FROM users WHERE role = 'student' AND account_status = 'active'`
      ).first();

      // Count pending applications
      const pendingRes = await env.DB.prepare(
        `SELECT COUNT(*) AS total_pending FROM hostel_applications WHERE admin_approval = 'pending'`
      ).first();

      return new Response(
        JSON.stringify({
          success: true,
          stats: {
            active_students: activeRes?.total_active || 0,
            pending_applications: pendingRes?.total_pending || 0,
            room_occupancy: 0 // Hardware offline
          }
        }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("Dashboard Stats Error:", err);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch dashboard stats', details: err.message }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
  }

// -------------------------------------------------------------------------
  // 2. GET /api/admin/dashboard/active-students - Active Students Directory
  // -------------------------------------------------------------------------
  if (method === 'GET' && url.pathname === '/api/admin/dashboard/active-students') {
    try {
      const query = `
        SELECT 
          u.id AS user_id,
          u.full_name,
          u.email,
          u.phone,
          COALESCE(u.profile_picture, NULL) AS profile_picture,
          COALESCE(u.username, '-') AS matric_number,
          COALESCE(h.ic_number, '-') AS ic_number,
          COALESCE(h.gender, '-') AS gender, -- <--- ADDED GENDER FIELD
          COALESCE(h.program, 'Pending Fill') AS program,
          COALESCE(h.session_id, '-') AS session_id,
          h.id AS application_id
        FROM users u
        LEFT JOIN hostel_applications h ON u.id = h.user_id
        WHERE u.role = 'student' AND u.account_status = 'active'
        ORDER BY u.id DESC
      `;

      const { results } = await env.DB.prepare(query).all();

      return new Response(
        JSON.stringify({ success: true, students: results || [] }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("Dashboard Active Students Error:", err);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch active students', details: err.message }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(JSON.stringify({ error: "Route not found" }), {
    status: 404,
    headers: { ...headers, "Content-Type": "application/json" }
  });
}