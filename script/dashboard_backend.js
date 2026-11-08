/**
 * Dormitoration - Admin Dashboard Backend Handler
 * Route: /api/admin/dashboard/*
 */

// -------------------------------------------------------------------------
// Shared helpers for room assignment
// -------------------------------------------------------------------------
const jsonRes = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

// Same convention as the report / visualize pages: the admin id is checked against the users table.
async function requireAdmin(env, adminIdRaw) {
  const adminId = Number(adminIdRaw);
  if (!Number.isInteger(adminId) || adminId <= 0) return { error: 'Missing admin_id', status: 400 };
  const row = await env.DB.prepare(`SELECT id, role FROM users WHERE id = ? LIMIT 1`).bind(adminId).first();
  if (!row || row.role !== 'admin') return { error: 'Admin access required', status: 403 };
  return { adminId };
}

// Application gender (Lelaki / Perempuan / Male / Female / L / P) -> 'M' | 'F' | null
function normalizeGender(g) {
  const v = String(g || '').toLowerCase().trim();
  if (['perempuan', 'female', 'wanita', 'p', 'f'].includes(v)) return 'F';
  if (['lelaki', 'male', 'l', 'm'].includes(v)) return 'M';
  return null;
}

// rooms.gender is 'M' / 'F'; an empty value is treated as 'M' (same default the dashboard uses).
function roomGender(g) {
  return String(g || 'M').toUpperCase().startsWith('F') ? 'F' : 'M';
}

// Audit trail - never allowed to fail the real action
async function logAdmin(env, adminId, action, details) {
  try {
    await env.DB.prepare(`INSERT INTO admin_logs (admin_id, action, details, timestamp) VALUES (?, ?, ?, ?)`)
      .bind(adminId, action, details, new Date().toISOString()).run();
  } catch (err) {
    console.error('Admin log insert failed:', err.message);
  }
}

const SEM_RANK = (v) => (Number.isFinite(Number(v)) ? Number(v) : 99);

// -------------------------------------------------------------------------
// GET /api/admin/settings/system-logs?admin_id=   (shown on the Settings page)
// Merges admin actions (room assigned, auto-arrange, reports...) with door scans.
// -------------------------------------------------------------------------
const REASON_LABELS = {
  ok: 'Door unlocked',
  unknown_code: 'Unknown QR code',
  expired: 'Expired QR code',
  no_room_info: 'Door unit did not send its block/room',
  room_not_registered: 'Door unit not registered in system',
  not_allocated: 'Student has no assigned room',
  wrong_room: 'Student scanned at a room that is not theirs'
};

export async function handleSystemLogs(request, env, headers) {
  const url = new URL(request.url);
  const auth = await requireAdmin(env, url.searchParams.get('admin_id'));
  if (auth.error) return jsonRes({ error: auth.error }, auth.status, headers);

  const logs = [];
  try {
    const { results: admin = [] } = await env.DB.prepare(`
      SELECT l.action, l.details, l.timestamp, u.full_name
      FROM admin_logs l LEFT JOIN users u ON u.id = l.admin_id
      ORDER BY l.timestamp DESC LIMIT 50
    `).all();
    admin.forEach(r => logs.push({
      time: r.timestamp,
      event: (String(r.action || '').replace(/_/g, ' ')) + (r.details ? ' - ' + r.details : ''),
      actor: r.full_name || 'Admin',
      status: 'info'
    }));
  } catch (err) { console.error('System logs (admin) failed:', err.message); }

  try {
    const { results: scans = [] } = await env.DB.prepare(`
      SELECT a.attempted_at, a.method, a.success, a.reason, a.code_hint,
             r.block_name, r.room_number, u.full_name
      FROM access_logs a
      LEFT JOIN rooms r ON r.id = a.room_id
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.attempted_at DESC LIMIT 50
    `).all();
    scans.forEach(r => {
      const door = r.block_name ? `Block ${r.block_name} / ${r.room_number}` : 'Unknown door';
      logs.push({
        time: r.attempted_at,
        event: `${REASON_LABELS[r.reason] || (r.success ? 'Door unlocked' : 'Access denied')} (${String(r.method || '').toUpperCase()}) - ${door}`,
        actor: r.full_name || (r.code_hint ? `Unknown code ...${r.code_hint}` : 'Unknown'),
        status: r.success ? 'success' : 'danger'
      });
    });
  } catch (err) { console.error('System logs (access) failed:', err.message); }

  logs.sort((a, b) => String(b.time).localeCompare(String(a.time)));
  return jsonRes({ success: true, logs: logs.slice(0, 80) }, 200, headers);
}

export async function handleDashboardRoutes(request, env, headers) {
  const url = new URL(request.url);
  const method = request.method;

  // -------------------------------------------------------------------------
  // 1. GET /api/admin/dashboard/stats - Top Metrics
  // -------------------------------------------------------------------------
  if (method === 'GET' && url.pathname === '/api/admin/dashboard/stats') {
    try {
      // Count total active students
      const activeRes = await env.DB.prepare(
        `SELECT COUNT(*) AS total_active FROM users WHERE role = 'student' AND account_status = 'active'`
      ).first();

      // Pending applications - counted exactly the way the Approval page lists them
      // (non-admin users, a missing/blank status counts as 'pending'), so the number
      // on this card always matches what the Pending tab shows. Orphan rows in
      // hostel_applications (no matching user) are ignored.
      const pendingRes = await env.DB.prepare(`
        SELECT COUNT(*) AS total_pending
        FROM users u
        LEFT JOIN hostel_applications h ON u.id = h.user_id
        WHERE (u.role != 'admin' OR u.role IS NULL)
          AND COALESCE(NULLIF(h.admin_approval, ''), 'pending') = 'pending'
      `).first();

      // Hardware/rooms: a room counts as "online" if it's flagged active AND
      // reported recently. The ESP32 heartbeats every 5 min (HEARTBEAT_MS in
      // main.cpp) with a 5s retry on failure, so this window allows one full
      // missed beat (10 min) plus some slack before a room reads as offline.
      // Keep this in sync with cloudflare_worker.js's ROOM_OFFLINE_AFTER_SECONDS
      // and main.cpp's HEARTBEAT_MS if any of the three ever change.
      // The scheduled() cron sweep flips is_active back to 0 for stale rooms,
      // so is_active is the persisted signal; the time check here is a safety
      // net for the ~1min window before that sweep next runs.
      const ONLINE_WINDOW_SECONDS = 660; // 11 min
      const cutoffISO = new Date(Date.now() - ONLINE_WINDOW_SECONDS * 1000).toISOString();

      // ASSUMPTION: any room_allocations row for a room counts as "occupied".
      // Adjust the JOIN condition here once room_allocations.status values
      // (e.g. cancelled/ended) are actually in use.
      const { results: rooms = [] } = await env.DB.prepare(
        `SELECT r.id, r.block_name, r.room_number, r.gender, r.capacity, r.is_active, r.last_seen_at,
                COUNT(ra.id) AS student_count
         FROM rooms r
         LEFT JOIN room_allocations ra ON ra.room_id = r.id
         GROUP BY r.id
         ORDER BY r.block_name, r.room_number`
      ).all();

      const roomsWithStatus = rooms.map(r => ({
        id: r.id,
        block_name: r.block_name,
        room_number: r.room_number,
        gender: r.gender || 'M',
        capacity: r.capacity || 0,
        student_count: r.student_count || 0,
        online: !!r.is_active && !!r.last_seen_at && r.last_seen_at >= cutoffISO
      }));

      const onlineCount = roomsWithStatus.filter(r => r.online).length;
      const occupancyPct = roomsWithStatus.length > 0
        ? Math.round((onlineCount / roomsWithStatus.length) * 100)
        : 0;

      return new Response(
        JSON.stringify({
          success: true,
          stats: {
            active_students: activeRes?.total_active || 0,
            pending_applications: pendingRes?.total_pending || 0,
            room_occupancy: occupancyPct,
            hardware: {
              online_count: onlineCount,
              total_rooms: roomsWithStatus.length,
              rooms: roomsWithStatus // [{ id, block_name, room_number, gender, student_count, online }, ...]
            }
          }
        }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("Dashboard Stats Error:", err);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch dashboard stats', details: err.message }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
  }

// -------------------------------------------------------------------------
  // 2. GET /api/admin/dashboard/active-students - Active Students Directory
  // -------------------------------------------------------------------------
  if (method === 'GET' && url.pathname === '/api/admin/dashboard/active-students') {
    try {
      const query = `
        SELECT 
          u.id AS user_id,
          u.full_name,
          u.email,
          u.phone,
          COALESCE(u.profile_picture, NULL) AS profile_picture,
          COALESCE(u.username, '-') AS matric_number,
          COALESCE(h.ic_number, '-') AS ic_number,
          COALESCE(h.gender, '-') AS gender, -- <--- ADDED GENDER FIELD
          COALESCE(h.program, 'Pending Fill') AS program,
          COALESCE(h.session_id, '-') AS session_id,
          h.id AS application_id,
          h.semester AS semester,
          rm.id AS room_id,
          rm.block_name AS room_block,
          rm.room_number AS room_number
        FROM users u
        LEFT JOIN hostel_applications h ON u.id = h.user_id
        LEFT JOIN room_allocations ra ON ra.id = (
          SELECT id FROM room_allocations WHERE application_id = h.id ORDER BY assigned_at DESC, id DESC LIMIT 1
        )
        LEFT JOIN rooms rm ON rm.id = ra.room_id
        WHERE u.role = 'student' AND u.account_status = 'active'
        ORDER BY u.id DESC
      `;

      const { results } = await env.DB.prepare(query).all();

      return new Response(
        JSON.stringify({ success: true, students: results || [] }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("Dashboard Active Students Error:", err);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch active students', details: err.message }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
  }

  // -------------------------------------------------------------------------
  // POST /api/admin/dashboard/assign   { admin_id, application_id, room_id }
  // Assign (or move) one student to a room. Works even if the door unit is
  // offline - assignment is a database action. Gender + capacity are enforced.
  // -------------------------------------------------------------------------
  if (method === 'POST' && url.pathname === '/api/admin/dashboard/assign') {
    let body;
    try { body = await request.json(); } catch { return jsonRes({ error: 'Invalid JSON' }, 400, headers); }

    const auth = await requireAdmin(env, body.admin_id);
    if (auth.error) return jsonRes({ error: auth.error }, auth.status, headers);

    const applicationId = Number(body.application_id);
    const roomId = Number(body.room_id);
    if (!Number.isInteger(applicationId) || !Number.isInteger(roomId)) {
      return jsonRes({ error: 'application_id and room_id are required.' }, 400, headers);
    }

    try {
      const app = await env.DB.prepare(`
        SELECT h.id, h.gender, u.full_name
        FROM hostel_applications h JOIN users u ON u.id = h.user_id
        WHERE h.id = ? AND u.role = 'student' AND u.account_status = 'active'
      `).bind(applicationId).first();
      if (!app) return jsonRes({ error: 'Active student application not found.' }, 404, headers);

      const studentGender = normalizeGender(app.gender);
      if (!studentGender) return jsonRes({ error: 'This student has no gender on record.' }, 400, headers);

      const room = await env.DB.prepare(
        `SELECT id, block_name, room_number, gender, capacity FROM rooms WHERE id = ?`
      ).bind(roomId).first();
      if (!room) return jsonRes({ error: 'Room not found.' }, 404, headers);

      if (roomGender(room.gender) !== studentGender) {
        return jsonRes({ error: 'Gender mismatch: this room is for ' + (roomGender(room.gender) === 'F' ? 'girls' : 'boys') + '.' }, 409, headers);
      }

      const occ = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM room_allocations WHERE room_id = ? AND application_id != ?`
      ).bind(roomId, applicationId).first();
      const capacity = room.capacity || 0;
      if (capacity <= 0 || (occ?.n || 0) >= capacity) {
        return jsonRes({ error: 'Room is full.' }, 409, headers);
      }

      const nowISO = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM room_allocations WHERE application_id = ?`).bind(applicationId),
        env.DB.prepare(`INSERT INTO room_allocations (application_id, room_id, assigned_at, status) VALUES (?, ?, ?, 'active')`)
          .bind(applicationId, roomId, nowISO)
      ]);

      await logAdmin(env, auth.adminId, 'room_assigned', `${app.full_name} -> Block ${room.block_name} / ${room.room_number}`);
      return jsonRes({ success: true, room: { id: room.id, block_name: room.block_name, room_number: room.room_number } }, 200, headers);
    } catch (err) {
      console.error('Assign room error:', err);
      return jsonRes({ error: 'Failed to assign room', details: err.message }, 500, headers);
    }
  }

  // -------------------------------------------------------------------------
  // POST /api/admin/dashboard/unassign   { admin_id, application_id }
  // -------------------------------------------------------------------------
  if (method === 'POST' && url.pathname === '/api/admin/dashboard/unassign') {
    let body;
    try { body = await request.json(); } catch { return jsonRes({ error: 'Invalid JSON' }, 400, headers); }

    const auth = await requireAdmin(env, body.admin_id);
    if (auth.error) return jsonRes({ error: auth.error }, auth.status, headers);

    const applicationId = Number(body.application_id);
    if (!Number.isInteger(applicationId)) return jsonRes({ error: 'application_id is required.' }, 400, headers);

    try {
      const info = await env.DB.prepare(`
        SELECT u.full_name, rm.block_name, rm.room_number
        FROM hostel_applications h
        JOIN users u ON u.id = h.user_id
        LEFT JOIN room_allocations ra ON ra.application_id = h.id
        LEFT JOIN rooms rm ON rm.id = ra.room_id
        WHERE h.id = ? LIMIT 1
      `).bind(applicationId).first();

      await env.DB.prepare(`DELETE FROM room_allocations WHERE application_id = ?`).bind(applicationId).run();
      await logAdmin(env, auth.adminId, 'room_unassigned',
        info ? `${info.full_name} removed from Block ${info.block_name || '?'} / ${info.room_number || '?'}` : `application #${applicationId}`);
      return jsonRes({ success: true }, 200, headers);
    } catch (err) {
      console.error('Unassign room error:', err);
      return jsonRes({ error: 'Failed to remove room', details: err.message }, 500, headers);
    }
  }

  // -------------------------------------------------------------------------
  // POST /api/admin/dashboard/auto-arrange   { admin_id, sort_by: ["semester","program","name"] }
  // Only students with NO room yet. Priority is always semester -> program -> name
  // (only the ticked ones apply). Students are placed in order, filling a room
  // before moving to the next one; boys and girls use their own rooms.
  // -------------------------------------------------------------------------
  if (method === 'POST' && url.pathname === '/api/admin/dashboard/auto-arrange') {
    let body;
    try { body = await request.json(); } catch { return jsonRes({ error: 'Invalid JSON' }, 400, headers); }

    const auth = await requireAdmin(env, body.admin_id);
    if (auth.error) return jsonRes({ error: auth.error }, auth.status, headers);

    const picked = Array.isArray(body.sort_by) ? body.sort_by.map(v => String(v).toLowerCase()) : [];
    const keys = ['semester', 'program', 'name'].filter(k => picked.includes(k));
    if (keys.length === 0) return jsonRes({ error: 'Choose at least one option (Name, Program or Semester).' }, 400, headers);

    try {
      const { results: students = [] } = await env.DB.prepare(`
        SELECT h.id AS application_id, u.full_name, h.gender, h.program, h.semester
        FROM users u
        JOIN hostel_applications h ON h.user_id = u.id
        WHERE u.role = 'student' AND u.account_status = 'active'
          AND NOT EXISTS (SELECT 1 FROM room_allocations ra WHERE ra.application_id = h.id)
      `).all();

      const { results: roomRows = [] } = await env.DB.prepare(`
        SELECT r.id, r.block_name, r.room_number, r.gender, r.capacity, COUNT(ra.id) AS taken
        FROM rooms r LEFT JOIN room_allocations ra ON ra.room_id = r.id
        GROUP BY r.id
      `).all();

      const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
      const compare = (a, b) => {
        for (const k of keys) {
          let c = 0;
          if (k === 'semester') c = SEM_RANK(a.semester) - SEM_RANK(b.semester);
          else if (k === 'program') c = collator.compare(a.program || '', b.program || '');
          else c = collator.compare(a.full_name || '', b.full_name || '');
          if (c !== 0) return c;
        }
        // stable tie-breakers
        return collator.compare(a.full_name || '', b.full_name || '') || a.application_id - b.application_id;
      };

      const rooms = roomRows
        .map(r => ({ ...r, g: roomGender(r.gender), free: (r.capacity || 0) - (r.taken || 0) }))
        .sort((a, b) => collator.compare(a.block_name || '', b.block_name || '') || collator.compare(String(a.room_number), String(b.room_number)));

      const nowISO = new Date().toISOString();
      const inserts = [];
      let skippedNoGender = 0;
      let unplaced = 0;
      const placed = [];

      for (const gender of ['M', 'F']) {
        const group = students.filter(s => normalizeGender(s.gender) === gender).sort(compare);
        const pool = rooms.filter(r => r.g === gender && r.free > 0);
        let ri = 0;
        for (const st of group) {
          while (ri < pool.length && pool[ri].free <= 0) ri++;
          if (ri >= pool.length) { unplaced++; continue; }
          const room = pool[ri];
          room.free--;
          inserts.push(env.DB.prepare(
            `INSERT INTO room_allocations (application_id, room_id, assigned_at, status) VALUES (?, ?, ?, 'active')`
          ).bind(st.application_id, room.id, nowISO));
          placed.push({ name: st.full_name, block: room.block_name, room: room.room_number });
        }
      }
      skippedNoGender = students.filter(s => !normalizeGender(s.gender)).length;

      for (let i = 0; i < inserts.length; i += 50) {
        await env.DB.batch(inserts.slice(i, i + 50));
      }

      await logAdmin(env, auth.adminId, 'auto_arrange',
        `sorted by ${keys.join(' > ')}: ${placed.length} placed, ${unplaced} no space, ${skippedNoGender} missing gender`);

      return jsonRes({
        success: true,
        assigned: placed.length,
        unplaced,
        skipped_no_gender: skippedNoGender,
        total_candidates: students.length
      }, 200, headers);
    } catch (err) {
      console.error('Auto-arrange error:', err);
      return jsonRes({ error: 'Auto-arrange failed', details: err.message }, 500, headers);
    }
  }

  return new Response(JSON.stringify({ error: "Route not found" }), {
    status: 404,
    headers: { ...headers, "Content-Type": "application/json" }
  });
}