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

      // Hardware/rooms: a room counts as "online" if it's flagged active AND
      // reported recently. The ESP32 heartbeats every 5 min (HEARTBEAT_MS in
      // main.cpp) with a 5s retry on failure, so this window allows one full
      // missed beat (10 min) plus some slack before a room reads as offline.
      // Keep this in sync with cloudflare_worker.js's ROOM_OFFLINE_AFTER_SECONDS
      // and main.cpp's HEARTBEAT_MS if any of the three ever change.
      // The scheduled() cron sweep flips is_active back to 0 for stale rooms,
      // so is_active is the persisted signal; the time check here is a safety
      // net for the ~1min window before that sweep next runs.
      const ONLINE_WINDOW_SECONDS = 660; // 11 min
      const cutoffISO = new Date(Date.now() - ONLINE_WINDOW_SECONDS * 1000).toISOString();

      // ASSUMPTION: any room_allocations row for a room counts as "occupied".
      // Adjust the JOIN condition here once room_allocations.status values
      // (e.g. cancelled/ended) are actually in use.
      const { results: rooms = [] } = await env.DB.prepare(
        `SELECT r.id, r.block_name, r.room_number, r.gender, r.capacity, r.is_active, r.last_seen_at,
                COUNT(ra.id) AS student_count
         FROM rooms r
         LEFT JOIN room_allocations ra ON ra.room_id = r.id
         GROUP BY r.id
         ORDER BY r.block_name, r.room_number`
      ).all();

      const roomsWithStatus = rooms.map(r => ({
        id: r.id,
        block_name: r.block_name,
        room_number: r.room_number,
        gender: r.gender || 'M',
        capacity: r.capacity || 0,
        student_count: r.student_count || 0,
        online: !!r.is_active && !!r.last_seen_at && r.last_seen_at >= cutoffISO
      }));

      const onlineCount = roomsWithStatus.filter(r => r.online).length;
      const occupancyPct = roomsWithStatus.length > 0
        ? Math.round((onlineCount / roomsWithStatus.length) * 100)
        : 0;

      return new Response(
        JSON.stringify({
          success: true,
          stats: {
            active_students: activeRes?.total_active || 0,
            pending_applications: pendingRes?.total_pending || 0,
            room_occupancy: occupancyPct,
            hardware: {
              online_count: onlineCount,
              total_rooms: roomsWithStatus.length,
              rooms: roomsWithStatus // [{ id, block_name, room_number, gender, student_count, online }, ...]
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