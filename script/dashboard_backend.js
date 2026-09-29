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

      // Pending applications
      const pendingRes = await env.DB.prepare(
        `SELECT COUNT(*) AS total_pending FROM hostel_applications WHERE admin_approval = 'pending'`
      ).first();

      // Hardware/rooms: a room counts as "online" if it reported within the
      // last 90 seconds (ESP32 heartbeats every 30s, so this allows for one
      // missed beat before flipping offline).
      const ONLINE_WINDOW_SECONDS = 90;
      const cutoffISO = new Date(Date.now() - ONLINE_WINDOW_SECONDS * 1000).toISOString();

      const { results: onlineRooms = [] } = await env.DB.prepare(
        `SELECT id, block_name, room_number, last_seen_at
         FROM rooms
         WHERE last_seen_at IS NOT NULL AND last_seen_at >= ?
         ORDER BY block_name, room_number`
      ).bind(cutoffISO).all();

      const totalRoomsRes = await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM rooms WHERE is_active = 1`
      ).first();
      const totalRooms = totalRoomsRes?.total || 0;
      const occupancyPct = totalRooms > 0
        ? Math.round((onlineRooms.length / totalRooms) * 100)
        : 0;

      return new Response(
        JSON.stringify({
          success: true,
          stats: {
            active_students: activeRes?.total_active || 0,
            pending_applications: pendingRes?.total_pending || 0,
            room_occupancy: occupancyPct,
            hardware: {
              online_count: onlineRooms.length,
              total_rooms: totalRooms,
              rooms: onlineRooms // [{ id, block_name, room_number, last_seen_at }, ...]
            }
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