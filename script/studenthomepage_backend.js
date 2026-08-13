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
      // Query ONLY existing columns in users and hostel_applications
      const data = await env.DB.prepare(`
        SELECT 
          u.id AS user_id,
          u.username,
          u.email,
          u.phone,
          ha.gender AS gender,
          ha.submission_status
        FROM users u
        LEFT JOIN hostel_applications ha ON u.id = ha.user_id
        WHERE u.id = ?
        ORDER BY ha.id DESC 
        LIMIT 1
      `).bind(userId).first();

      if (!data) {
        return new Response(JSON.stringify({ status: 'pending', user: null }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Check submission_status
      let rawStatus = (data.submission_status || 'pending').toLowerCase().trim();
      let normalizedStatus = 'pending';

      if (['approved', 'active', 'success'].includes(rawStatus)) {
        normalizedStatus = 'approved';
      } else if (['returned', 'rejected', 'fail'].includes(rawStatus)) {
        normalizedStatus = 'returned';
      } else {
        normalizedStatus = 'pending'; // Handles 'pending', 'draft', or null
      }

      return new Response(JSON.stringify({
        status: normalizedStatus,
        user: {
          id: data.user_id,
          username: data.username || 'N/A',
          email: data.email || 'N/A',
          phone: data.phone || 'N/A',
          gender: data.gender || '',
          profile_picture: null // Skipped until R2 is integrated
        }
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

  return null;
}