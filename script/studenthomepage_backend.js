// studenthomepage_backend.js

export async function handleStudentRoutes(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;

  // GET: Student Status & Reason
  if (method === 'GET' && url.pathname === '/api/student/status') {
    const userId = url.searchParams.get('user_id');

    if (!userId) {
      return new Response(JSON.stringify({ error: 'User ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      const userQuery = env.DB.prepare(`
        SELECT 
          u.id AS user_id,
          u.username,
          u.email,
          u.phone,
          u.created_at,
          u.registration_deadline,
          u.account_status,
          ha.gender AS gender,
          ha.admin_approval AS admin_approval,
          ha.submission_status AS submission_status,
          ha.appeal_reason AS appeal_reason
        FROM users u
        LEFT JOIN hostel_applications ha ON u.id = ha.user_id
        WHERE u.id = ?
        ORDER BY ha.id DESC 
        LIMIT 1
      `).bind(userId);

      const settingsQuery = env.DB.prepare(`
        SELECT setting_key, setting_value 
        FROM system_settings 
        WHERE setting_key IN ('temp_account_deadline_value', 'temp_account_deadline_unit')
      `);

      const [data, settingsResult] = await Promise.all([
        userQuery.first(),
        settingsQuery.all()
      ]);

      if (!data) {
        return new Response(JSON.stringify({ status: 'pending', user: null, reason: null }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const settings = {};
      if (settingsResult && settingsResult.results) {
        settingsResult.results.forEach(row => {
          settings[row.setting_key] = row.setting_value;
        });
      }

      const durationValue = parseFloat(settings['temp_account_deadline_value']) || 24;
      const durationUnit = String(settings['temp_account_deadline_unit'] || 'hours').toLowerCase().trim();

      let rawStatus = (data.admin_approval || data.account_status || 'pending').toLowerCase().trim();
      let normalizedStatus = 'pending';

      if (['approved', 'active', 'success'].includes(rawStatus)) {
        normalizedStatus = 'approved';
      } else if (['returned', 'rejected', 'fail', 'declined'].includes(rawStatus)) {
        normalizedStatus = 'returned';
      } else {
        normalizedStatus = 'pending';
      }

      let calculatedDeadline = data.registration_deadline;
      if (normalizedStatus === 'approved') {
        calculatedDeadline = null;
      } else if (!calculatedDeadline && data.created_at) {
        const createdMs = new Date(data.created_at.replace(' ', 'T')).getTime();
        if (!isNaN(createdMs)) {
          let multiplier = 60 * 60 * 1000;
          if (durationUnit.startsWith('day')) {
            multiplier = 24 * 60 * 60 * 1000;
          } else if (durationUnit.startsWith('min')) {
            multiplier = 60 * 1000;
          }
          const calculatedTime = new Date(createdMs + (durationValue * multiplier));
          calculatedDeadline = calculatedTime.toISOString();
        }
      }

      return new Response(JSON.stringify({
        status: normalizedStatus,
        reason: data.appeal_reason || null,
        user: {
          id: data.user_id,
          username: data.username || 'N/A',
          email: data.email || 'N/A',
          phone: data.phone || 'N/A',
          gender: data.gender || '',
          created_at: data.created_at || null,
          registration_deadline: calculatedDeadline || null
        }
      }), { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });

    } catch (err) {
      console.error('D1 Query Error:', err.message);
      return new Response(JSON.stringify({ error: 'Failed to query status', details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // POST: Delete User Account ONLY (Retaining hostel_applications history)
  if (method === 'POST' && url.pathname === '/api/student/delete-account') {
    try {
      const { user_id } = await request.json();

      if (!user_id) {
        return new Response(JSON.stringify({ error: 'User ID is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Delete only the record in the users table to keep hostel_applications intact
      const deleteResult = await env.DB.prepare(`
        DELETE FROM users WHERE id = ?
      `).bind(user_id).run();

      if (deleteResult.success) {
        return new Response(JSON.stringify({ message: 'Account deleted successfully' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else {
        throw new Error('Database deletion execution failed.');
      }
    } catch (err) {
      console.error('Delete Account Error:', err.message);
      return new Response(JSON.stringify({ error: 'Failed to delete account', details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  return null;
}