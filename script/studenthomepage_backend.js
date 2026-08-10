export async function handleStudentRoutes(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;

  // 1. GET Live Status & Room Details
  if (method === 'GET' && url.pathname === '/api/student/status') {
    const userId = url.searchParams.get('user_id');

    if (!userId) {
      return new Response(JSON.stringify({ error: 'User ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      // Query D1 safely
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
        ORDER BY ha.id DESC 
        LIMIT 1
      `).bind(userId).first();

      // If student has no application record in hostel_applications yet
      if (!app) {
        return new Response(JSON.stringify({ status: 'none', roomDetails: null, reason: null }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Return application state
      return new Response(JSON.stringify({
        status: app.status || 'none',
        reason: app.reject_reason || app.reason_for_apply || null,
        roomDetails: app.block ? {
          block: app.block,
          room_number: app.room_number,
          passcode: app.passcode
        } : null
      }), { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });

    } catch (err) {
      // Return 200 with fallback or 500 with exact SQL error details for debugging
      console.error('D1 Query Error in handleStudentRoutes:', err.message);
      
      return new Response(JSON.stringify({ 
        error: 'Failed to query student status', 
        details: err.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // 2. POST Appeal (Rayuan)
  if (method === 'POST' && url.pathname === '/api/student/appeal') {
    try {
      const { user_id, appeal_reason } = await request.json();

      if (!user_id) {
        return new Response(JSON.stringify({ error: 'User ID is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      await env.DB.prepare(`
        UPDATE hostel_applications 
        SET status = 'appealed', 
            reason_for_apply = ?
        WHERE user_id = ?
      `).bind(appeal_reason || '', user_id).run();

      return new Response(JSON.stringify({ success: true }), { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to process appeal', details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // 3. DELETE Account safely
  if (method === 'DELETE' && url.pathname === '/api/student/delete-account') {
    try {
      const { user_id } = await request.json();

      if (!user_id) {
        return new Response(JSON.stringify({ error: 'User ID is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      await env.DB.prepare(`UPDATE hostel_applications SET user_id = NULL WHERE user_id = ?`).bind(user_id).run();
      await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(user_id).run();

      return new Response(JSON.stringify({ success: true }), { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to delete account', details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  return null;
}