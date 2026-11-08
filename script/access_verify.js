// =====================================================================
//  script/access_verify.js
//  Handlers for the ESP32 door unit (both protected by X-Device-Key):
//    POST /api/access/verify     -> { "access": true|false }
//    POST /api/access/heartbeat  -> marks the room's hardware online,
//                                   auto-registers the room if missing
//
//  Router (cloudflare_worker.js):
//    import { handleAccessVerify, handleDeviceHeartbeat } from './script/access_verify.js';
//
//  Secret (never in wrangler.json):
//    npx wrangler secret put DEVICE_API_KEY
//    Local dev: add  DEVICE_API_KEY=test-key  to a .dev.vars file
//
//  Every scan is also written to access_logs (for the Data Visualize page) and every
//  online/offline change to device_events. Logging never changes the door's answer and
//  a logging failure is swallowed.
//
//  ASSUMPTIONS to check against your project:
//    - D1 binding is named DB
//    - assigned_at is a date string Date() can parse
//    - expiry = 5 months + 2 weeks; swap isExpired() for your shared
//      helper in access_code_utils.js so the rule lives in one place
//    - rooms.block_name / rooms.room_number hold the same text the
//      ESP32 sends (BLOCK_NAME / ROOM_NUMBER in secrets.h)
//    - timestamps are stored as ISO strings (same as your cron job)
// =====================================================================

const MAX_CODE_LEN = 128;
const ROOM_ID_RE = /^[A-Za-z0-9 _-]{1,20}$/;   // block / room text from the device

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Constant-time string compare so the key can't be guessed by timing
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

// Returns an error Response if the device key is wrong, otherwise null
function checkDeviceKey(request, env) {
  if (!env.DEVICE_API_KEY) return json({ error: 'server_not_configured' }, 500);
  const key = request.headers.get('X-Device-Key') || '';
  if (!safeEqual(key, env.DEVICE_API_KEY)) return json({ error: 'unauthorized' }, 401);
  return null;
}

// TODO: replace with the shared expiry check from access_code_utils.js
function isExpired(assignedAt) {
  const d = new Date(assignedAt);
  if (isNaN(d.getTime())) return true;          // unreadable date = treat as expired
  d.setUTCMonth(d.getUTCMonth() + 5);
  d.setUTCDate(d.getUTCDate() + 14);
  return Date.now() > d.getTime();
}

// ---------------------------------------------------------------------
//  Logging helpers (used by both handlers below)
// ---------------------------------------------------------------------
const ALLOWED_METHODS = ['qr', 'rfid', 'keycode', 'exit'];   // same names the charts use
const DEDUPE_SECONDS = 10;   // the GM65 can re-read one code several times; log it once

// Writes one row to access_logs. Skips the row if an identical scan (same door, method,
// outcome and person/code) was already logged in the last DEDUPE_SECONDS.
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

    // Only for an unknown code: its last 4 characters, never the whole credential
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

// Writes one row to device_events (online / offline history). Never throws.
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
//  Body: { "code": "...", and optionally "block", "room", "method" }
//  The extra fields only feed the log; the decision still depends on "code" alone.
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

  const row = await env.DB
    .prepare('SELECT user_id, assigned_at FROM student_rfid WHERE qr_access_code = ?')
    .bind(code)
    .first();

  // The door unit must say which room it guards (BLOCK_NAME / ROOM_NUMBER in secrets.h).
  const doorBlock = typeof (body.block ?? body.block_name) === 'string' ? (body.block ?? body.block_name).trim() : '';
  const doorRoom = typeof (body.room ?? body.room_number) === 'string' ? (body.room ?? body.room_number).trim() : '';

  // Same answer (access:false) for every failure: no hints to a prober.
  // The real reason is kept in the admin-only access log (Settings > System Activity Logs).
  let granted = false;
  let reason = 'unknown_code';
  if (row) {
    if (isExpired(row.assigned_at)) {
      reason = 'expired';
    } else if (!ROOM_ID_RE.test(doorBlock) || !ROOM_ID_RE.test(doorRoom)) {
      reason = 'no_room_info';
    } else {
      const doorRow = await env.DB
        .prepare('SELECT id FROM rooms WHERE block_name = ? AND room_number = ?')
        .bind(doorBlock, doorRoom)
        .first();

      if (!doorRow) {
        reason = 'room_not_registered';
      } else {
        // The student's current room (latest allocation)
        const alloc = await env.DB
          .prepare(`SELECT ra.room_id
                    FROM room_allocations ra
                    JOIN hostel_applications ha ON ha.id = ra.application_id
                    WHERE ha.user_id = ?
                    ORDER BY ra.assigned_at DESC, ra.id DESC
                    LIMIT 1`)
          .bind(row.user_id)
          .first();

        if (!alloc) {
          reason = 'not_allocated';
        } else if (alloc.room_id !== doorRow.id) {
          reason = 'wrong_room';
        } else {
          granted = true;
          reason = 'ok';
        }
      }
    }
  }

  const rawMethod = typeof body.method === 'string' ? body.method.trim().toLowerCase() : '';
  const logging = logScan(env, {
    block: typeof (body.block ?? body.block_name) === 'string' ? (body.block ?? body.block_name).trim() : '',
    room: typeof (body.room ?? body.room_number) === 'string' ? (body.room ?? body.room_number).trim() : '',
    method: ALLOWED_METHODS.includes(rawMethod) ? rawMethod : 'qr',
    granted,
    reason,
    userId: row ? row.user_id : null,
    code
  });
  // Don't make the door wait for the log write
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(logging);
  else await logging;

  return json({ access: granted });
}

// ---------------------------------------------------------------------
//  POST /api/access/heartbeat   body: { "block": "A", "room": "101" }
//  - room exists  -> refresh rooms.last_seen_at
//  - room missing -> create it (auto-register), then set last_seen_at
//  The dashboard treats a room as online when last_seen_at is recent.
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
      // Offline (or never seen) until now -> this heartbeat is an "online" change
      cameOnline = !row.is_active || !row.last_seen_at;
      eventDetail = row.last_seen_at ? `Back online (last heartbeat ${row.last_seen_at})` : 'First connection';
      await env.DB
        .prepare('UPDATE rooms SET last_seen_at = ?, is_active = 1 WHERE id = ?')
        .bind(now, row.id)
        .run();
    } else {
      // capacity is left to its column default; keycode has no DB default,
      // so give it a clear placeholder the admin can overwrite later.
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