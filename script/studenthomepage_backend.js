export async function handleStudentRoutes(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;

  // GET Status
  if (method === 'GET' && url.pathname === '/api/student/status') {
    const userId = url.searchParams.get('user_id');
    const app = await env.DB.prepare(
      `SELECT * FROM hostel_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(userId).first();

    return new Response(JSON.stringify({
      status: app ? app.status : 'none',
      reason: app ? app.reason_for_apply : null
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // POST Appeal
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

  return null; // Route not handled by student module
}