// studenthomepage_backend.js
import { isAccessCodeExpired } from './access_code_utils.js';

export async function handleStudentRoutes(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;

  // GET: Serve Student Avatar Image directly from Cloudflare R2
  if (method === 'GET' && url.pathname === '/api/student/avatar') {
    const userId = url.searchParams.get('user_id');
    if (!userId) {
      return new Response('User ID required', { status: 400, headers: corsHeaders });
    }

    try {
      const objectKey = `avatars/avatar_${userId}.jpg`;
      const object = await env.PAYSLIP_BUCKET.get(objectKey);

      if (!object) {
        return new Response('Avatar not found', { status: 404, headers: corsHeaders });
      }

      const headers = new Headers(corsHeaders);
      headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
      headers.set('Cache-Control', 'public, max-age=3600');
      headers.set('ETag', object.httpEtag);

      return new Response(object.body, { headers });
    } catch (err) {
      console.error('R2 Avatar Fetch Error:', err.message);
      return new Response('Error retrieving avatar', { status: 500, headers: corsHeaders });
    }
  }

  // GET: Student Status & Details
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
          u.profile_picture,
          u.created_at,
          u.registration_deadline,
          u.account_status,
          ha.gender AS gender,
          ha.admin_approval AS admin_approval,
          ha.submission_status AS submission_status,
          ha.id AS application_id,
          ha.submitted_at AS submitted_at,
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

      let roomDetails = null;
      if (normalizedStatus === 'approved') {
        try {
          const roomRow = await env.DB.prepare(`
            SELECT r.block_name, r.room_number
            FROM room_allocations ra
            JOIN hostel_applications ha ON ha.id = ra.application_id
            JOIN rooms r ON r.id = ra.room_id
            WHERE ha.user_id = ?
            ORDER BY ra.assigned_at DESC
            LIMIT 1
          `).bind(userId).first();

          if (roomRow) {
            roomDetails = { block: roomRow.block_name, room_number: roomRow.room_number };
          }
        } catch (roomErr) {
          console.error('Room lookup error:', roomErr.message);
        }
      }

      const isSubmitted = String(data.submission_status || '').toLowerCase() === 'submitted';
      let acceptanceEstimate = null;
      if (normalizedStatus === 'pending' && isSubmitted) {
        acceptanceEstimate = { state: 'unavailable', score: null };
        try {
          const submittedMs = data.submitted_at ? new Date(data.submitted_at).getTime() : NaN;
          const review = data.application_id
            ? await env.DB.prepare(`SELECT score, status, generated_at FROM ai_reviews WHERE application_id = ?`).bind(data.application_id).first()
            : null;
          const reviewMs = review && review.generated_at ? new Date(review.generated_at).getTime() : NaN;

          const isFresh = review && review.status === 'done' && review.score !== null && review.score !== undefined &&
                          (isNaN(submittedMs) || (!isNaN(reviewMs) && reviewMs >= submittedMs));

          if (isFresh) {
            acceptanceEstimate = { state: 'ready', score: Math.max(0, Math.min(100, Math.round(Number(review.score)))) };
          } else if (!isNaN(submittedMs) && Date.now() - submittedMs < 3 * 60 * 1000) {
            acceptanceEstimate = { state: 'calculating', score: null };
          }
        } catch (aiErr) {
          console.error('Acceptance estimate unavailable:', aiErr.message);
        }
      }

      return new Response(JSON.stringify({
        status: normalizedStatus,
        submitted: isSubmitted,
        acceptanceEstimate,
        reason: data.appeal_reason || null,
        roomDetails,
        user: {
          id: data.user_id,
          username: data.username || 'N/A',
          email: data.email || 'N/A',
          phone: data.phone || 'N/A',
          profile_picture: data.profile_picture || null,
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

  // POST: Submit Student Appeal
  if (method === 'POST' && url.pathname === '/api/student/submit-appeal') {
    try {
      const { user_id, email, phone, appeal_reason } = await request.json();

      if (!user_id || !appeal_reason) {
        return new Response(JSON.stringify({ error: 'User ID and appeal explanation are required.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 1. Update student contact details in users table
      await env.DB.prepare(`
        UPDATE users
        SET email = ?, phone = ?, updated_at = ?
        WHERE id = ?
      `).bind(email, phone, new Date().toISOString(), user_id).run();

      // 2. Reset hostel application state to pending review
      await env.DB.prepare(`
        UPDATE hostel_applications
        SET appeal_reason = ?,
            admin_approval = 'pending',
            submission_status = 'submitted',
            submitted_at = ?
        WHERE user_id = ?
      `).bind(appeal_reason, new Date().toISOString(), user_id).run();

      return new Response(JSON.stringify({
        success: true,
        message: 'Appeal submitted successfully. Application is now under admin review.'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (err) {
      console.error('Submit Appeal Error:', err.message);
      return new Response(JSON.stringify({ error: 'Failed to submit appeal', details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // POST: Upload Profile Picture Avatar to Cloudflare R2
  if (method === 'POST' && url.pathname === '/api/student/upload-avatar') {
    try {
      const { user_id, profile_picture } = await request.json();

      if (!user_id || !profile_picture) {
        return new Response(JSON.stringify({ error: 'User ID and image data are required.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const base64Parts = profile_picture.split(',');
      const base64Data = base64Parts.length > 1 ? base64Parts[1] : base64Parts[0];
      const binaryStr = atob(base64Data);
      const buffer = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        buffer[i] = binaryStr.charCodeAt(i);
      }

      const objectKey = `avatars/avatar_${user_id}.jpg`;
      await env.PAYSLIP_BUCKET.put(objectKey, buffer, {
        httpMetadata: { contentType: 'image/jpeg' }
      });

      const avatarUrl = `/api/student/avatar?user_id=${user_id}`;
      await env.DB.prepare(`
        UPDATE users 
        SET profile_picture = ?, updated_at = ?
        WHERE id = ?
      `).bind(avatarUrl, new Date().toISOString(), user_id).run();

      return new Response(JSON.stringify({ 
        success: true, 
        avatar_url: avatarUrl,
        message: 'Profile picture uploaded to R2 successfully.' 
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      console.error('R2 Avatar Upload Error:', err.message);
      return new Response(JSON.stringify({ error: 'Failed to upload profile picture to R2', details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // POST: Delete User Account ONLY
  if (method === 'POST' && url.pathname === '/api/student/delete-account') {
    try {
      const { user_id } = await request.json();

      if (!user_id) {
        return new Response(JSON.stringify({ error: 'User ID is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

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

  // POST: Update simple biodata
  if (method === 'POST' && url.pathname === '/api/student/update-account') {
    try {
      const { user_id, username, email, phone } = await request.json();

      if (!user_id) {
        return new Response(JSON.stringify({ error: 'User ID is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (!email || !phone) {
        return new Response(JSON.stringify({ error: 'Email and phone number cannot be empty.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      await env.DB.prepare(`
        UPDATE users 
        SET username = ?, email = ?, phone = ?, updated_at = ?
        WHERE id = ?
      `).bind(username || null, email, phone, new Date().toISOString(), user_id).run();

      return new Response(JSON.stringify({ success: true, message: 'Account updated successfully' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      console.error('Update Account Error:', err.message);
      const isDuplicate = /unique/i.test(err.message);
      const friendlyMessage = isDuplicate
        ? 'That username or email is already in use by another account.'
        : 'Failed to update account';

      return new Response(JSON.stringify({ error: friendlyMessage, details: err.message }), {
        status: isDuplicate ? 409 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  // GET: Access QR code
  if (method === 'GET' && url.pathname === '/api/student/qr-code') {
    const userId = url.searchParams.get('user_id');

    if (!userId) {
      return new Response(JSON.stringify({ error: 'User ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      const row = await env.DB.prepare(
        `SELECT qr_access_code, assigned_at FROM student_rfid WHERE user_id = ? LIMIT 1`
      ).bind(userId).first();

      const expired = row ? isAccessCodeExpired(row.assigned_at) : false;

      return new Response(JSON.stringify({
        code: (row && !expired) ? row.qr_access_code : null,
        expired
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      console.error('QR Code Fetch Error:', err.message);
      return new Response(JSON.stringify({ error: 'Failed to fetch QR code', details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  return null;
}