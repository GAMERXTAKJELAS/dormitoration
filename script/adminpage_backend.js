/**
 * Dormitoration - Admin Homepage Backend Endpoint
 * File: /script/adminpage_backend.js
 */

export async function handleAdminStats(env, headers) {
  try {
    // 1. Query pending applications count
    const pendingRes = await env.DB.prepare(
      `SELECT COUNT(*) as pending_count 
       FROM hostel_applications 
       WHERE submission_status = 'pending' OR admin_approval = 'pending'`
    ).first();

    // 2. Query total active/approved students for occupancy
    const activeRes = await env.DB.prepare(
      `SELECT COUNT(*) as occupied_count 
       FROM hostel_applications 
       WHERE admin_approval = 'approved' OR submission_status = 'approved'`
    ).first();

    const totalCapacity = 600; // 3 Blocks x 200 rooms capacity
    const occupied = activeRes?.occupied_count || 0;
    const occupancyPercentage = Math.round((occupied / totalCapacity) * 100);

    return new Response(
      JSON.stringify({ 
        success: true,
        pending_count: pendingRes?.pending_count || 0,
        occupancy: {
          occupied: occupied,
          total: totalCapacity,
          percentage: occupancyPercentage
        },
        locks_status: "Offline" // Hardware integration status
      }), 
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("D1 Admin Stats Error:", err);
    return new Response(
      JSON.stringify({ 
        pending_count: 0, 
        occupancy: { occupied: 0, total: 600, percentage: 0 },
        locks_status: "Offline"
      }), 
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }
}