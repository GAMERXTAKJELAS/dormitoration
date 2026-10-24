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

// Admin endpoints identify the admin by admin_id (same convention as the student endpoints use
// user_id) and confirm in the database that this user really has role = 'admin'.
async function requireAdmin(env, adminIdRaw) {
  const adminId = Number(adminIdRaw);
  if (!Number.isInteger(adminId) || adminId <= 0) return { error: 'Missing admin_id', status: 400 };
  const row = await env.DB.prepare(`SELECT id, role FROM users WHERE id = ? LIMIT 1`).bind(adminId).first();
  if (!row || row.role !== 'admin') return { error: 'Admin access required', status: 403 };
  return { adminId };
}

const ACTIVE_SQL = `('open', 'in_progress')`; // "active" = not solved yet; everything else is "inactive"
const ADMIN_NOTE_MAX = 500;

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

  // ================= ADMIN =================

  // ---------- GET /api/admin/reports?admin_id=&filter=all|active|inactive ----------
  if (method === 'GET' && url.pathname === '/api/admin/reports') {
    const auth = await requireAdmin(env, url.searchParams.get('admin_id'));
    if (auth.error) return json({ error: auth.error }, auth.status, corsHeaders);

    const filter = url.searchParams.get('filter') || 'all';
    let where = '';
    if (filter === 'active') where = `WHERE r.status IN ${ACTIVE_SQL}`;
    else if (filter === 'inactive') where = `WHERE r.status NOT IN ${ACTIVE_SQL}`;
    else if (filter !== 'all') return json({ error: 'filter must be all, active or inactive' }, 400, corsHeaders);

    try {
      // Unsolved first (urgent before normal before low), solved ones after; newest first within each group.
      const { results } = await env.DB.prepare(`
        SELECT r.id, r.category, r.priority, r.location, r.title, r.description, r.status, r.admin_note,
               (r.photo_key IS NOT NULL) AS has_photo, r.created_at, r.updated_at, r.resolved_at,
               u.full_name, u.phone, u.email
        FROM facility_reports r
        LEFT JOIN users u ON u.id = r.user_id
        ${where}
        ORDER BY
          CASE WHEN r.status IN ${ACTIVE_SQL} THEN 0 ELSE 1 END,
          CASE WHEN r.status IN ${ACTIVE_SQL}
               THEN CASE r.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END
               ELSE 0 END,
          r.created_at DESC
        LIMIT 300
      `).all();

      // Tab counts are always for the whole table, regardless of the selected tab.
      const totals = await env.DB.prepare(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN status IN ${ACTIVE_SQL} THEN 1 ELSE 0 END) AS active
        FROM facility_reports
      `).first();
      const total = (totals && totals.total) || 0;
      const active = (totals && totals.active) || 0;

      return json({ reports: results || [], counts: { all: total, active, inactive: total - active } }, 200, corsHeaders);
    } catch (err) {
      console.error('Admin Report List Error:', err.message);
      return json({ error: 'Failed to load reports' }, 500, corsHeaders);
    }
  }

  // ---------- GET /api/admin/report-photo?admin_id=&report_id= ----------
  if (method === 'GET' && url.pathname === '/api/admin/report-photo') {
    const auth = await requireAdmin(env, url.searchParams.get('admin_id'));
    if (auth.error) return new Response(auth.error, { status: auth.status, headers: corsHeaders });

    const reportId = Number(url.searchParams.get('report_id'));
    if (!Number.isInteger(reportId) || reportId <= 0) return new Response('Bad request', { status: 400, headers: corsHeaders });

    try {
      const row = await env.DB.prepare(`SELECT photo_key FROM facility_reports WHERE id = ? LIMIT 1`).bind(reportId).first();
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
      console.error('Admin Report Photo Error:', err.message);
      return new Response('Server error', { status: 500, headers: corsHeaders });
    }
  }

  // ---------- PATCH /api/admin/reports/status  { admin_id, report_id, status: 'resolved' | 'open', admin_note? } ----------
  if (method === 'PATCH' && url.pathname === '/api/admin/reports/status') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid request body' }, 400, corsHeaders);
    }

    const auth = await requireAdmin(env, body.admin_id);
    if (auth.error) return json({ error: auth.error }, auth.status, corsHeaders);

    const reportId = Number(body.report_id);
    if (!Number.isInteger(reportId) || reportId <= 0) return json({ error: 'Missing report_id' }, 400, corsHeaders);
    if (body.status !== 'resolved' && body.status !== 'open') {
      return json({ error: "status must be 'resolved' or 'open'" }, 400, corsHeaders);
    }

    // admin_note: leave untouched if not sent; an empty string clears it
    let noteProvided = false;
    let note = null;
    if (body.admin_note !== undefined && body.admin_note !== null) {
      noteProvided = true;
      note = String(body.admin_note).trim();
      if (note.length > ADMIN_NOTE_MAX) return json({ error: `Note is too long (max ${ADMIN_NOTE_MAX} characters)` }, 400, corsHeaders);
      if (note === '') note = null;
    }

    try {
      const existing = await env.DB.prepare(
        `SELECT id, status, admin_note FROM facility_reports WHERE id = ? LIMIT 1`
      ).bind(reportId).first();
      if (!existing) return json({ error: 'Report not found' }, 404, corsHeaders);

      const nowISO = new Date().toISOString();
      const newNote = noteProvided ? note : existing.admin_note;
      const resolvedAt = body.status === 'resolved' ? nowISO : null;

      await env.DB.prepare(`
        UPDATE facility_reports
        SET status = ?, admin_note = ?, resolved_at = ?, updated_at = ?
        WHERE id = ?
      `).bind(body.status, newNote, resolvedAt, nowISO, reportId).run();

      // Audit trail — never allowed to fail the actual update
      try {
        await env.DB.prepare(`INSERT INTO admin_logs (admin_id, action, details, timestamp) VALUES (?, ?, ?, ?)`)
          .bind(auth.adminId, body.status === 'resolved' ? 'report_resolved' : 'report_reopened', `facility report #${reportId}`, nowISO).run();
      } catch (logErr) {
        console.error('Admin log insert failed:', logErr.message);
      }

      return json({
        success: true,
        report: { id: reportId, status: body.status, admin_note: newNote, resolved_at: resolvedAt }
      }, 200, corsHeaders);
    } catch (err) {
      console.error('Admin Report Status Error:', err.message);
      return json({ error: 'Failed to update report', details: err.message }, 500, corsHeaders);
    }
  }

  return null;
}
