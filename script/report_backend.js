// report_backend.js
// Student facility/room problem reports.
//
//   POST /api/student/reports            create a report (optional photo, stored in R2)
//   GET  /api/student/reports?user_id=   list the student's own reports
//   GET  /api/student/report-photo?report_id=&user_id=   stream the student's own photo
//
// Needs: env.DB (D1) with the facility_reports table, and env.PAYSLIP_BUCKET (R2).
// Photos are stored under the "reports/" key prefix in the same bucket as the payslips.

const CATEGORIES = ['electrical', 'plumbing', 'furniture', 'aircond_fan', 'door_lock', 'cleanliness', 'internet', 'other'];
const PRIORITIES = ['low', 'normal', 'urgent'];
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB after decoding (the browser shrinks photos first)
const PHOTO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

// Accepts only a base64 data URL of jpeg/png/webp. Returns { bytes, mime, ext } or null.
export function parsePhotoDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return null;

  let binary;
  try {
    binary = atob(match[2]);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mime: match[1], ext: PHOTO_EXT[match[1]] };
}

export async function handleReportRoutes(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;

  // ---------- POST /api/student/reports ----------
  if (method === 'POST' && url.pathname === '/api/student/reports') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid request body' }, 400, corsHeaders);
    }

    const userId = Number(body.user_id);
    const category = String(body.category || '');
    const priority = String(body.priority || 'normal');
    const location = String(body.location || '').trim();
    const title = String(body.title || '').trim();
    const description = String(body.description || '').trim();

    if (!Number.isInteger(userId) || userId <= 0) return json({ error: 'Missing user_id' }, 400, corsHeaders);
    if (!CATEGORIES.includes(category)) return json({ error: 'Please choose a valid category' }, 400, corsHeaders);
    if (!PRIORITIES.includes(priority)) return json({ error: 'Please choose a valid priority' }, 400, corsHeaders);
    if (!location || location.length > 80) return json({ error: 'Location is required (max 80 characters)' }, 400, corsHeaders);
    if (!title || title.length > 100) return json({ error: 'Title is required (max 100 characters)' }, 400, corsHeaders);
    if (!description || description.length > 1000) return json({ error: 'Description is required (max 1000 characters)' }, 400, corsHeaders);

    let photo = null;
    if (body.photo) {
      photo = parsePhotoDataUrl(body.photo);
      if (!photo) return json({ error: 'Photo must be a JPG, PNG or WebP image' }, 400, corsHeaders);
      if (photo.bytes.length > MAX_PHOTO_BYTES) return json({ error: 'Photo is too large (max 2 MB)' }, 413, corsHeaders);
      if (!env.PAYSLIP_BUCKET) return json({ error: 'Photo storage is not configured' }, 500, corsHeaders);
    }

    let photoKey = null;
    try {
      const user = await env.DB.prepare(`SELECT id, account_status FROM users WHERE id = ? LIMIT 1`).bind(userId).first();
      if (!user) return json({ error: 'Student account not found' }, 404, corsHeaders);
      if (user.account_status !== 'active') {
        return json({ error: 'Only approved students can submit a report' }, 403, corsHeaders);
      }

      if (photo) {
        photoKey = `reports/${userId}/${Date.now()}.${photo.ext}`;
        await env.PAYSLIP_BUCKET.put(photoKey, photo.bytes, { httpMetadata: { contentType: photo.mime } });
      }

      const nowISO = new Date().toISOString();
      const result = await env.DB.prepare(`
        INSERT INTO facility_reports
          (user_id, category, priority, location, title, description, photo_key, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
      `).bind(userId, category, priority, location, title, description, photoKey, nowISO, nowISO).run();

      return json({ success: true, report_id: result.meta.last_row_id }, 201, corsHeaders);
    } catch (err) {
      console.error('Report Create Error:', err.message);
      // Don't leave an orphaned photo behind if the database insert failed
      if (photoKey) {
        try { await env.PAYSLIP_BUCKET.delete(photoKey); } catch (e) { /* best effort */ }
      }
      return json({ error: 'Failed to submit report', details: err.message }, 500, corsHeaders);
    }
  }

  // ---------- GET /api/student/reports?user_id= ----------
  if (method === 'GET' && url.pathname === '/api/student/reports') {
    const userId = Number(url.searchParams.get('user_id'));
    if (!Number.isInteger(userId) || userId <= 0) return json({ error: 'Missing user_id' }, 400, corsHeaders);

    try {
      const { results } = await env.DB.prepare(`
        SELECT id, category, priority, location, title, description, status, admin_note,
               (photo_key IS NOT NULL) AS has_photo, created_at, updated_at
        FROM facility_reports
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `).bind(userId).all();

      return json({ reports: results || [] }, 200, corsHeaders);
    } catch (err) {
      console.error('Report List Error:', err.message);
      return json({ error: 'Failed to load reports' }, 500, corsHeaders);
    }
  }

  // ---------- GET /api/student/report-photo?report_id=&user_id= ----------
  if (method === 'GET' && url.pathname === '/api/student/report-photo') {
    const reportId = Number(url.searchParams.get('report_id'));
    const userId = Number(url.searchParams.get('user_id'));
    if (!Number.isInteger(reportId) || !Number.isInteger(userId)) {
      return new Response('Bad request', { status: 400, headers: corsHeaders });
    }

    try {
      const row = await env.DB.prepare(
        `SELECT photo_key FROM facility_reports WHERE id = ? AND user_id = ? LIMIT 1`
      ).bind(reportId, userId).first();
      if (!row || !row.photo_key) return new Response('Not found', { status: 404, headers: corsHeaders });

      const object = await env.PAYSLIP_BUCKET.get(row.photo_key);
      if (!object) return new Response('Not found', { status: 404, headers: corsHeaders });

      return new Response(object.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': (object.httpMetadata && object.httpMetadata.contentType) || 'image/jpeg',
          'Cache-Control': 'private, max-age=300'
        }
      });
    } catch (err) {
      console.error('Report Photo Error:', err.message);
      return new Response('Server error', { status: 500, headers: corsHeaders });
    }
  }

  return null;
}
