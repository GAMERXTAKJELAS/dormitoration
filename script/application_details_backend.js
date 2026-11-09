/**
 * Dormitoration - Admin "Application Details" backend
 * File: /script/application_details_backend.js
 *
 *   GET   /api/admin/application-details?admin_id=&id=<user_id>      (or &app_id=<application_id>)
 *   PATCH /api/admin/application-details   { admin_id, user_id, fields: { ... } }
 *
 * GET returns everything an admin needs on one screen: account, full application,
 * contributions (MPP / items / semester GPA), assigned room, RFID registration state
 * and the list of uploaded documents. The PDFs themselves are streamed by
 * /api/admin/payslip (see payslip_backend.js).
 *
 * PATCH only accepts the whitelisted fields below and logs WHICH fields changed
 * (field names only, never the values) to admin_logs.
 */

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

async function requireAdmin(env, adminIdRaw) {
  const adminId = Number(adminIdRaw);
  if (!Number.isInteger(adminId) || adminId <= 0) return { error: 'Missing admin_id', status: 400 };
  const row = await env.DB.prepare(`SELECT id, role FROM users WHERE id = ? LIMIT 1`).bind(adminId).first();
  if (!row || row.role !== 'admin') return { error: 'Admin access required', status: 403 };
  return { adminId };
}

// Editable columns: type + limits. Anything not listed here cannot be changed from this page
// (e.g. email, approval status, session, AI results).
const USER_FIELDS = {
  full_name: { type: 'text', max: 120, required: true },
  phone: { type: 'text', max: 20, pattern: /^[0-9+\-\s]{6,20}$/ }
};

const APP_FIELDS = {
  ic_number: { type: 'text', max: 20 },
  dob: { type: 'text', max: 20 },
  age: { type: 'int', min: 0, max: 100 },
  gender: { type: 'enum', values: ['Lelaki', 'Perempuan'] },
  home_address: { type: 'text', max: 300 },
  postcode: { type: 'text', max: 10 },
  city: { type: 'text', max: 80 },
  state: { type: 'text', max: 80 },
  reason_for_apply: { type: 'text', max: 1000 },
  program: { type: 'text', max: 80 },
  semester: { type: 'int', min: 1, max: 10 },
  gpa_cgpa: { type: 'real', min: 0, max: 4 },
  dependents_count: { type: 'int', min: 0, max: 30 },
  head_of_program_support: { type: 'text', max: 200 },

  guardian1_name: { type: 'text', max: 120 },
  guardian1_ic: { type: 'text', max: 20 },
  guardian1_phone: { type: 'text', max: 20 },
  guardian1_address: { type: 'text', max: 300 },
  guardian1_relationship: { type: 'text', max: 60 },
  guardian1_job: { type: 'text', max: 100 },
  guardian1_income: { type: 'real', min: 0, max: 10000000 },

  guardian2_name: { type: 'text', max: 120 },
  guardian2_ic: { type: 'text', max: 20 },
  guardian2_phone: { type: 'text', max: 20 },
  guardian2_address: { type: 'text', max: 300 },
  guardian2_relationship: { type: 'text', max: 60 },
  guardian2_job: { type: 'text', max: 100 },
  guardian2_income: { type: 'real', min: 0, max: 10000000 }
};

// Stored inside the `contributions` JSON column: { isMpp, items, gpa }
const CONTRIB_KEYS = ['isMpp', 'sumbangan', 'gpa'];

function cleanValue(spec, raw, label) {
  if (raw === null || raw === undefined) raw = '';
  if (spec.type === 'text') {
    const v = String(raw).trim();
    if (spec.required && !v) return { error: `${label} cannot be empty.` };
    if (v.length > spec.max) return { error: `${label} is too long (max ${spec.max} characters).` };
    if (spec.pattern && v && !spec.pattern.test(v)) return { error: `${label} format is not valid.` };
    return { value: v };
  }
  if (spec.type === 'enum') {
    const v = String(raw).trim();
    if (v === '') return { value: null };
    if (!spec.values.includes(v)) return { error: `${label} must be one of: ${spec.values.join(', ')}.` };
    return { value: v };
  }
  // numbers: empty -> NULL
  if (String(raw).trim() === '') return { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { error: `${label} must be a number.` };
  if (spec.type === 'int' && !Number.isInteger(n)) return { error: `${label} must be a whole number.` };
  if (n < spec.min || n > spec.max) return { error: `${label} must be between ${spec.min} and ${spec.max}.` };
  return { value: n };
}

// Returns { userId } or { error } - the error says exactly what the link contained,
// so a bad link is easy to spot.
async function resolveUserId(env, url) {
  const rawId = url.searchParams.get('id');
  const rawApp = url.searchParams.get('app_id');

  const userId = Number(rawId);
  if (Number.isInteger(userId) && userId > 0) return { userId };

  const appId = Number(rawApp);
  if (Number.isInteger(appId) && appId > 0) {
    const row = await env.DB.prepare(`SELECT user_id FROM hostel_applications WHERE id = ?`).bind(appId).first();
    return row ? { userId: row.user_id } : { error: `No application found with ID ${appId}.` };
  }
  return { error: `The link has no valid student ID (received id="${rawId ?? ''}", app_id="${rawApp ?? ''}").` };
}

export async function handleApplicationDetails(request, env, headers) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/admin/application-details') return null;

  // ------------------------------------------------------------------ GET
  if (request.method === 'GET') {
    const auth = await requireAdmin(env, url.searchParams.get('admin_id'));
    if (auth.error) return json({ error: auth.error }, auth.status, headers);

    try {
      const resolved = await resolveUserId(env, url);
      if (resolved.error) return json({ error: resolved.error }, 404, headers);
      const userId = resolved.userId;

      const user = await env.DB.prepare(`
        SELECT id, username, full_name, email, phone, role, account_status,
               profile_picture, registration_deadline, created_at
        FROM users WHERE id = ?
      `).bind(userId).first();
      if (!user) return json({ error: `No student account found with ID ${userId}.` }, 404, headers);

      const application = await env.DB.prepare(
        `SELECT * FROM hostel_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1`
      ).bind(userId).first();

      let contributions = { isMpp: 'No', items: [], gpa: '' };
      if (application && application.contributions) {
        try { contributions = { ...contributions, ...JSON.parse(application.contributions) }; } catch (e) { /* keep defaults */ }
      }
      if (application) delete application.contributions;

      let documents = [];
      let room = null;
      if (application) {
        const docs = await env.DB.prepare(`
          SELECT id, document_type, file_name, file_size, ai_flagged, ai_reason, uploaded_at
          FROM application_attachments WHERE application_id = ?
          ORDER BY uploaded_at DESC, id DESC
        `).bind(application.id).all();
        documents = docs.results || [];

        room = await env.DB.prepare(`
          SELECT r.id, r.block_name, r.room_number, r.gender
          FROM room_allocations ra JOIN rooms r ON r.id = ra.room_id
          WHERE ra.application_id = ?
          ORDER BY ra.assigned_at DESC, ra.id DESC LIMIT 1
        `).bind(application.id).first() || null;
      }

      // RFID registration state only - the QR code itself is never sent to the browser.
      const rfidRow = await env.DB.prepare(
        `SELECT matriks_number, rfid_card_uid FROM student_rfid WHERE user_id = ? LIMIT 1`
      ).bind(userId).first();
      const uid = rfidRow ? String(rfidRow.rfid_card_uid || '') : '';
      const rfid = {
        matric_number: rfidRow ? rfidRow.matriks_number : null,
        registered: !!uid && !uid.startsWith('UNASSIGNED-') && !uid.startsWith('PENDING-')
      };

      return json({ success: true, user, application, contributions, documents, room, rfid }, 200, headers);
    } catch (err) {
      console.error('Application details GET error:', err);
      return json({ error: 'Failed to load details', details: err.message }, 500, headers);
    }
  }

  // ---------------------------------------------------------------- PATCH
  if (request.method === 'PATCH') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, headers); }

    const auth = await requireAdmin(env, body.admin_id);
    if (auth.error) return json({ error: auth.error }, auth.status, headers);

    const userId = Number(body.user_id);
    const fields = body.fields && typeof body.fields === 'object' ? body.fields : null;
    if (!Number.isInteger(userId) || !fields) return json({ error: 'user_id and fields are required.' }, 400, headers);

    const userSets = {};
    const appSets = {};
    const contribChanges = {};

    for (const [key, raw] of Object.entries(fields)) {
      if (USER_FIELDS[key]) {
        const r = cleanValue(USER_FIELDS[key], raw, key);
        if (r.error) return json({ error: r.error }, 400, headers);
        userSets[key] = r.value;
      } else if (APP_FIELDS[key]) {
        const r = cleanValue(APP_FIELDS[key], raw, key);
        if (r.error) return json({ error: r.error }, 400, headers);
        appSets[key] = r.value;
      } else if (CONTRIB_KEYS.includes(key)) {
        contribChanges[key] = raw;
      } else {
        return json({ error: `Field "${key}" cannot be edited here.` }, 400, headers);
      }
    }

    if (Object.keys(userSets).length + Object.keys(appSets).length + Object.keys(contribChanges).length === 0) {
      return json({ error: 'Nothing to update.' }, 400, headers);
    }

    try {
      const user = await env.DB.prepare(`SELECT id, full_name, role FROM users WHERE id = ?`).bind(userId).first();
      if (!user || user.role === 'admin') return json({ error: 'Student not found.' }, 404, headers);

      const statements = [];

      if (Object.keys(userSets).length) {
        const cols = Object.keys(userSets);
        statements.push(
          env.DB.prepare(`UPDATE users SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
            .bind(...cols.map(c => userSets[c]), new Date().toISOString(), userId)
        );
      }

      const touchesApp = Object.keys(appSets).length > 0 || Object.keys(contribChanges).length > 0;
      if (touchesApp) {
        const app = await env.DB.prepare(
          `SELECT id, contributions FROM hostel_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1`
        ).bind(userId).first();
        if (!app) return json({ error: 'This student has not started an application yet, so only name and phone can be edited.' }, 400, headers);

        if (Object.keys(contribChanges).length) {
          let blob = { isMpp: 'No', items: [], gpa: '' };
          try { if (app.contributions) blob = { ...blob, ...JSON.parse(app.contributions) }; } catch (e) { /* keep defaults */ }
          if ('isMpp' in contribChanges) blob.isMpp = String(contribChanges.isMpp).toLowerCase() === 'yes' ? 'Yes' : 'No';
          if ('gpa' in contribChanges) {
            const g = cleanValue({ type: 'real', min: 0, max: 4 }, contribChanges.gpa, 'Semester GPA');
            if (g.error) return json({ error: g.error }, 400, headers);
            blob.gpa = g.value === null ? '' : String(g.value);
          }
          if ('sumbangan' in contribChanges) {
            if (!Array.isArray(contribChanges.sumbangan)) return json({ error: 'sumbangan must be a list.' }, 400, headers);
            blob.items = contribChanges.sumbangan.map(v => String(v).trim().slice(0, 100)).filter(Boolean).slice(0, 5);
          }
          appSets.contributions = JSON.stringify(blob);
        }

        const cols = Object.keys(appSets);
        statements.push(
          env.DB.prepare(`UPDATE hostel_applications SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
            .bind(...cols.map(c => appSets[c]), app.id)
        );
      }

      await env.DB.batch(statements);

      const changed = [...Object.keys(userSets), ...Object.keys(appSets).filter(k => k !== 'contributions'), ...Object.keys(contribChanges)];
      try {
        await env.DB.prepare(`INSERT INTO admin_logs (admin_id, action, details, timestamp) VALUES (?, ?, ?, ?)`)
          .bind(auth.adminId, 'student_details_edited', `${user.full_name}: ${changed.join(', ')}`, new Date().toISOString()).run();
      } catch (logErr) {
        console.error('Admin log insert failed:', logErr.message);
      }

      return json({ success: true, changed }, 200, headers);
    } catch (err) {
      console.error('Application details PATCH error:', err);
      return json({ error: 'Failed to save changes', details: err.message }, 500, headers);
    }
  }

  return null;
}