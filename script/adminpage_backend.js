/**
 * Dormitoration - Admin Homepage Backend Endpoint
 * File: /script/adminpage_backend.js
 */

export async function handleAdminStats(env, headers) {
  try {
    // 1. Pending applications - same rule as the Approval page / System Overview card
    //    (non-admin users; a missing or blank status counts as 'pending').
    const pendingRes = await env.DB.prepare(
      `SELECT COUNT(*) AS pending_count
       FROM users u
       LEFT JOIN hostel_applications h ON u.id = h.user_id
       WHERE (u.role != 'admin' OR u.role IS NULL)
         AND COALESCE(NULLIF(h.admin_approval, ''), 'pending') = 'pending'`
    ).first();

    // 2. Room occupancy = students assigned to a room / total capacity of the rooms
    //    that are registered in the system (rooms are auto-registered by the door units).
    const capacityRes = await env.DB.prepare(
      `SELECT COALESCE(SUM(capacity), 0) AS total_capacity FROM rooms`
    ).first();

    const occupiedRes = await env.DB.prepare(
      `SELECT COUNT(*) AS occupied_count
       FROM room_allocations ra
       JOIN rooms r ON r.id = ra.room_id
       WHERE COALESCE(ra.status, 'active') = 'active'`
    ).first();

    // 3. Smart locks: "Online" if at least ONE door unit has reported recently.
    //    Same rule as the dashboard (active room + heartbeat within 11 minutes).
    const ONLINE_WINDOW_SECONDS = 660;
    const cutoffISO = new Date(Date.now() - ONLINE_WINDOW_SECONDS * 1000).toISOString();
    let locksOnline = 0;
    let locksTotal = 0;
    try {
      const lockRes = await env.DB.prepare(
        `SELECT COUNT(*) AS total_rooms,
                SUM(CASE WHEN is_active = 1 AND last_seen_at IS NOT NULL AND last_seen_at >= ? THEN 1 ELSE 0 END) AS online_rooms
         FROM rooms`
      ).bind(cutoffISO).first();
      locksTotal = lockRes?.total_rooms || 0;
      locksOnline = lockRes?.online_rooms || 0;
    } catch (lockErr) {
      console.error("Smart lock status query failed:", lockErr.message);
    }

    const totalCapacity = capacityRes?.total_capacity || 0;
    const occupied = occupiedRes?.occupied_count || 0;
    const occupancyPercentage = totalCapacity > 0
      ? Math.round((occupied / totalCapacity) * 100)
      : 0;

    return new Response(
      JSON.stringify({ 
        success: true,
        pending_count: pendingRes?.pending_count || 0,
        occupancy: {
          occupied: occupied,
          total: totalCapacity,
          percentage: occupancyPercentage
        },
        locks_status: locksOnline > 0 ? "Online" : "Offline",
        locks: { online: locksOnline, total: locksTotal }
      }), 
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("D1 Admin Stats Error:", err);
    return new Response(
      JSON.stringify({ 
        pending_count: 0, 
        occupancy: { occupied: 0, total: 0, percentage: 0 },
        locks_status: "Offline"
      }), 
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }
}