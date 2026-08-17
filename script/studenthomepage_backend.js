// studenthomepage_backend.js

export async function handleStudentRoutes(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;

  if (method === 'GET' && url.pathname === '/api/student/status') {
    const userId = url.searchParams.get('user_id');

    if (!userId) {
      return new Response(JSON.stringify({ error: 'User ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      // 1. Fetch user & hostel application status using admin_approval
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
          ha.submission_status AS submission_status
        FROM users u
        LEFT JOIN hostel_applications ha ON u.id = ha.user_id
        WHERE u.id = ?
        ORDER BY ha.id DESC 
        LIMIT 1
      `).bind(userId);

      // 2. Query admin duration settings from system_settings table
      const settingsQuery = env.DB.prepare(`
        SELECT setting_key, setting_value 
        FROM system_settings 
        WHERE setting_key IN ('temp_account_deadline_value', 'temp_account_deadline_unit')
      `);

      // Run database operations concurrently
      const [data, settingsResult] = await Promise.all([
        userQuery.first(),
        settingsQuery.all()
      ]);

      if (!data) {
        return new Response(JSON.stringify({ status: 'pending', user: null }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Map system settings values
      const settings = {};
      if (settingsResult && settingsResult.results) {
        settingsResult.results.forEach(row => {
          settings[row.setting_key] = row.setting_value;
        });
      }

      const durationValue = parseFloat(settings['temp_account_deadline_value']) || 24;
      const durationUnit = String(settings['temp_account_deadline_unit'] || 'hours').toLowerCase().trim();

      // Determine approval status prioritizing admin_approval, then account_status
      let rawStatus = (data.admin_approval || data.account_status || 'pending').toLowerCase().trim();
      let normalizedStatus = 'pending';

      if (['approved', 'active', 'success'].includes(rawStatus)) {
        normalizedStatus = 'approved';
      } else if (['returned', 'rejected', 'fail', 'declined'].includes(rawStatus)) {
        normalizedStatus = 'returned';
      } else {
        normalizedStatus = 'pending';
      }

      // Calculate deadline dynamically based on created_at and admin settings
      let calculatedDeadline = data.registration_deadline;

      // If account is approved, force deadline to null to disable timer
      if (normalizedStatus === 'approved') {
        calculatedDeadline = null;
      } else if (!calculatedDeadline && data.created_at) {
        const createdMs = new Date(data.created_at.replace(' ', 'T')).getTime();
        if (!isNaN(createdMs)) {
          let multiplier = 60 * 60 * 1000; // default to hours
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

  return null;
}