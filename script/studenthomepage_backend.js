export async function handleStudentRoutes(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;

  // GET Live Status & Room Details
  if (method === 'GET' && url.pathname === '/api/student/status') {
    const userId = url.searchParams.get('user_id');

    if (!userId) {
      return new Response(JSON.stringify({ error: 'User ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch latest application along with optional room info
    const app = await env.DB.prepare(`
      SELECT 
        ha.id AS application_id,
        ha.status,
        ha.reason_for_apply,
        ha.reject_reason,
        r.block,
        r.room_number,
        r.passcode
      FROM hostel_applications ha
      LEFT JOIN rooms r ON ha.room_id = r.id
      WHERE ha.user_id = ?
      ORDER BY ha.created_at DESC 
      LIMIT 1
    `).bind(userId).first();

    if (!app) {
      return new Response(JSON.stringify({ status: 'none' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      status: app.status, // 'pending', 'approved'/'active', 'returned'/'rejected', 'appealed'
      reason: app.reject_reason || app.reason_for_apply,
      roomDetails: app.block ? {
        block: app.block,
        room_number: app.room_number,
        passcode: app.passcode
      } : null
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }

  // POST Appeal (Rayuan)
  if (method === 'POST' && url.pathname === '/api/student/appeal') {
    const { user_id, appeal_reason } = await request.json();

    await env.DB.prepare(`
      UPDATE hostel_applications 
      SET status = 'appealed', 
          reason_for_apply = ?
      WHERE user_id = ?
    `).bind(appeal_reason, user_id).run();

    return new Response(JSON.stringify({ success: true }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }

  // DELETE Account safely
  if (method === 'DELETE' && url.pathname === '/api/student/delete-account') {
    const { user_id } = await request.json();

    await env.DB.prepare(`UPDATE hostel_applications SET user_id = NULL WHERE user_id = ?`).bind(user_id).run();
    await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(user_id).run();

    return new Response(JSON.stringify({ success: true }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }

  return null;
}