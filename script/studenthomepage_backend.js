// studenthomepage_backend.js
export async function handleStudentRoutes(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;

  // 1. GET Account Status & Room Details
  if (method === 'GET' && url.pathname === '/api/student/status') {
    const userId = url.searchParams.get('user_id');

    if (!userId) {
      return new Response(JSON.stringify({ error: 'User ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      // Fetch user account details + hostel application data
      const data = await env.DB.prepare(`
        SELECT 
          u.id AS user_id,
          u.username,
          u.email,
          u.phone,
          u.profile_picture,
          u.status AS account_status,
          u.registration_deadline,
          u.created_at,
          ha.id AS application_id,
          ha.reject_reason,
          r.block,
          r.room_number,
          r.passcode
        FROM users u
        LEFT JOIN hostel_applications ha ON u.id = ha.user_id
        LEFT JOIN rooms r ON ha.room_id = r.id
        WHERE u.id = ?
        ORDER BY ha.id DESC 
        LIMIT 1
      `).bind(userId).first();

      if (!data) {
        return new Response(JSON.stringify({ status: 'pending', user: null, roomDetails: null }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        status: data.account_status || 'pending',
        user: {
          id: data.user_id,
          username: data.username || 'N/A',
          email: data.email || 'N/A',
          phone: data.phone || 'N/A',
          profile_picture: data.profile_picture || null,
          registration_deadline: data.registration_deadline,
          created_at: data.created_at
        },
        reason: data.reject_reason || null,
        roomDetails: data.block ? {
          block: data.block,
          room_number: data.room_number,
          passcode: data.passcode
        } : null
      }), { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });

    } catch (err) {
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

  // 2. UPDATE Profile Data
  if (method === 'PUT' && url.pathname === '/api/student/update-profile') {
    try {
      const { user_id, username, email, phone, profile_picture } = await request.json();

      if (!user_id) {
        return new Response(JSON.stringify({ error: 'User ID is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      await env.DB.prepare(`
        UPDATE users 
        SET username = COALESCE(?, username),
            email = COALESCE(?, email),
            phone = COALESCE(?, phone),
            profile_picture = COALESCE(?, profile_picture)
        WHERE id = ?
      `).bind(username, email, phone, profile_picture, user_id).run();

      return new Response(JSON.stringify({ success: true }), { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Failed to update profile', details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // 3. DELETE Account
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