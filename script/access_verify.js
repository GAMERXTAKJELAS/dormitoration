// =====================================================================
//  script/access_verify.js
//  Cloudflare Worker access verification & heartbeat handler for ESP32 door units.
// =====================================================================

const MAX_CODE_LEN = 128;
const ROOM_ID_RE = /^[A-Za-z0-9 _-]{1,20}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Constant-time string compare to prevent timing-attack key discovery
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

// Authenticates incoming requests against the secret DEVICE_API_KEY
function checkDeviceKey(request, env) {
  if (!env.DEVICE_API_KEY) return json({ error: 'server_not_configured' }, 500);
  const key = request.headers.get('X-Device-Key') || '';
  if (!safeEqual(key, env.DEVICE_API_KEY)) return json({ error: 'unauthorized' }, 401);
  return null;
}

const ALLOWED_METHODS = ['qr', 'rfid', 'keycode', 'exit'];
const DEDUPE_SECONDS = 10;

// Writes scan attempt details to access_logs asynchronously with 10s deduplication
async function logScan(env, e) {
  try {
    let roomId = null;
    if (ROOM_ID_RE.test(e.block) && ROOM_ID_RE.test(e.room)) {
      const r = await env.DB
        .prepare('SELECT id FROM rooms WHERE block_name = ? AND room_number = ?')
        .bind(e.block, e.room)
        .first();
      if (r) roomId = r.id;
    }

    const hint = !e.userId && e.code ? e.code.slice(-4) : null;
    const ok = e.granted ? 1 : 0;
    const now = Date.now();
    const nowISO = new Date(now).toISOString();
    const sinceISO = new Date(now - DEDUPE_SECONDS * 1000).toISOString();

    await env.DB
      .prepare(
        `INSERT INTO access_logs (room_id, user_id, method, success, reason, code_hint, attempted_at)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM access_logs
           WHERE room_id IS ? AND method = ? AND success = ? AND user_id IS ? AND code_hint IS ?
             AND attempted_at >= ?
         )`
      )
      .bind(roomId, e.userId, e.method, ok, e.reason, hint, nowISO,
            roomId, e.method, ok, e.userId, hint, sinceISO)
      .run();
  } catch (err) {
    console.error('Access log insert failed:', err.message);
  }
}

// Records hardware connection events in device_events log
async function recordDeviceEvent(env, roomId, event, detail, whenISO) {
  try {
    await env.DB
      .prepare('INSERT INTO device_events (room_id, event, occurred_at, detail) VALUES (?, ?, ?, ?)')
      .bind(roomId, event, whenISO, detail)
      .run();
  } catch (err) {
    console.error('Device event insert failed:', err.message);
  }
}

// ---------------------------------------------------------------------
//  POST /api/access/verify
//  Payload: { "code": "...", "block": "A", "room": "101" }
// ---------------------------------------------------------------------
export async function handleAccessVerify(request, env, ctx) {
  const denied = checkDeviceKey(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ access: false }, 400);
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code || code.length > MAX_CODE_LEN) return json({ access: false }, 400);

  const doorBlock = typeof (body.block ?? body.block_name) === 'string' ? (body.block ?? body.block_name).trim() : '';
  const doorRoom  = typeof (body.room ?? body.room_number) === 'string'  ? (body.room ?? body.room_number).trim()  : '';

  let granted = false;
  let reason = 'unknown_code';
  let userId = null;

  // 1. Fetch student user_id using scanned QR UUID or RFID card UID
  const rfidRow = await env.DB
    .prepare('SELECT user_id FROM student_rfid WHERE qr_access_code = ? OR rfid_card_uid = ? LIMIT 1')
    .bind(code, code)
    .first();

  if (rfidRow) {
    userId = rfidRow.user_id;

    // 2. Traversal join: user_id -> hostel_applications -> room_allocations -> rooms
    const alloc = await env.DB
      .prepare(`SELECT r.block_name, r.room_number, ra.status
                FROM rooms r
                JOIN room_allocations ra ON ra.room_id = r.id
                JOIN hostel_applications ha ON ha.id = ra.application_id
                WHERE ha.user_id = ?
                ORDER BY ra.id DESC
                LIMIT 1`)
      .bind(userId)
      .first();

    if (!alloc) {
      reason = 'not_allocated';
    } else if (!alloc.status || alloc.status.toLowerCase() !== 'active') {
      reason = 'allocation_inactive';
    } else if (alloc.block_name === doorBlock && alloc.room_number === doorRoom) {
      granted = true;
      reason = 'ok';
    } else {
      reason = 'wrong_room';
    }
  }

  const rawMethod = typeof body.method === 'string' ? body.method.trim().toLowerCase() : '';
  const logging = logScan(env, {
    block: doorBlock,
    room: doorRoom,
    method: ALLOWED_METHODS.includes(rawMethod) ? rawMethod : 'qr',
    granted,
    reason,
    userId,
    code
  });

  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(logging);
  else await logging;

  return json({ access: granted });
}

// ---------------------------------------------------------------------
//  POST /api/access/heartbeat
//  Payload: { "block": "A", "room": "101" }
// ---------------------------------------------------------------------
export async function handleDeviceHeartbeat(request, env) {
  const denied = checkDeviceKey(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'bad_json' }, 400);
  }

  const block = typeof body.block === 'string' ? body.block.trim() : '';
  const room  = typeof body.room  === 'string' ? body.room.trim()  : '';
  if (!ROOM_ID_RE.test(block) || !ROOM_ID_RE.test(room)) {
    return json({ ok: false, error: 'bad_block_or_room' }, 400);
  }

  const now = new Date().toISOString();

  try {
    let row = await env.DB
      .prepare('SELECT id, is_active, last_seen_at FROM rooms WHERE block_name = ? AND room_number = ?')
      .bind(block, room)
      .first();

    let registered = false;
    let cameOnline = false;
    let eventDetail = '';
    if (row) {
      cameOnline = !row.is_active || !row.last_seen_at;
      eventDetail = row.last_seen_at ? `Back online (last heartbeat ${row.last_seen_at})` : 'First connection';
      await env.DB
        .prepare('UPDATE rooms SET last_seen_at = ?, is_active = 1 WHERE id = ?')
        .bind(now, row.id)
        .run();
    } else {
      const placeholderKeycode = `PENDING-${block}-${room}`;
      const res = await env.DB
        .prepare(
          'INSERT INTO rooms (block_name, room_number, keycode, is_active, created_at, last_seen_at) VALUES (?, ?, ?, 1, ?, ?)'
        )
        .bind(block, room, placeholderKeycode, now, now)
        .run();
      row = { id: res.meta.last_row_id };
      registered = true;
      cameOnline = true;
      eventDetail = 'First connection (room registered)';
    }

    if (cameOnline) await recordDeviceEvent(env, row.id, 'online', eventDetail, now);

    return json({ ok: true, room_id: row.id, registered });
  } catch (err) {
    return json({ ok: false, error: 'db_error', details: err.message }, 500);
  }
}