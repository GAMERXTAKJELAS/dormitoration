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
//  POST /api/access/verify
// ---------------------------------------------------------------------
export async function handleAccessVerify(request, env) {
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
    .prepare('SELECT assigned_at FROM student_rfid WHERE qr_access_code = ?')
    .bind(code)
    .first();

  // Same answer for "not found" and "expired": no hints to a prober
  if (!row || isExpired(row.assigned_at)) return json({ access: false });

  return json({ access: true });
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
      .prepare('SELECT id FROM rooms WHERE block_name = ? AND room_number = ?')
      .bind(block, room)
      .first();

    let registered = false;
    if (row) {
      await env.DB
        .prepare('UPDATE rooms SET last_seen_at = ? WHERE id = ?')
        .bind(now, row.id)
        .run();
    } else {
      // capacity / keycode are left to their column defaults
      const res = await env.DB
        .prepare(
          'INSERT INTO rooms (block_name, room_number, is_active, created_at, last_seen_at) VALUES (?, ?, 1, ?, ?)'
        )
        .bind(block, room, now, now)
        .run();
      row = { id: res.meta.last_row_id };
      registered = true;
    }

    return json({ ok: true, room_id: row.id, registered });
  } catch (err) {
    return json({ ok: false, error: 'db_error', details: err.message }, 500);
  }
}