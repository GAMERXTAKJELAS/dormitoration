// hardware_backend.js
// Handles requests coming FROM ESP32 door units — not from the browser.
// Single endpoint: POST /api/hardware/verify-access
//
// Request body (sent by the ESP32 as JSON):
// {
//   "block_name": "Block A",
//   "room_number": "101",
//   "method": "keycode" | "qr" | "rfid",
//   "value": "<the code/uid the ESP32 read>",
//   "device_key": "<shared secret, same for every device, set via wrangler secret>"
// }
//
// Response:
// { "access": true, "reason": "ok" }
// { "access": false, "reason": "..." }
//
// NOTE ON room_allocations: this endpoint checks that a student's QR/RFID is
// actually allocated to the room they're scanning at, via
// student_rfid -> hostel_applications -> room_allocations -> rooms.
// Nothing in the codebase populates room_allocations yet (no admin "assign room"
// feature exists), so until that's built, EVERY qr/rfid attempt will correctly
// fail with reason 'not_allocated_to_this_room' even for a fully valid student.
// This is expected, not a bug in this file.

import { isAccessCodeExpired } from './access_code_utils.js';

export async function handleHardwareRoutes(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;

  if (method !== 'POST' || url.pathname !== '/api/hardware/verify-access') {
    return null;
  }

  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ access: false, reason: 'invalid_json' }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  const { block_name, room_number, method: verifyMethod, value, device_key } = body;

  // 1. Device authentication — same shared secret for every ESP32.
  //    Set it once with: wrangler secret put HARDWARE_DEVICE_KEY
  if (!env.HARDWARE_DEVICE_KEY || device_key !== env.HARDWARE_DEVICE_KEY) {
    return new Response(JSON.stringify({ access: false, reason: 'unauthorized_device' }), {
      status: 401,
      headers: jsonHeaders
    });
  }

  if (!block_name || !room_number || !verifyMethod || !value) {
    return new Response(JSON.stringify({ access: false, reason: 'missing_fields' }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  const nowISO = new Date().toISOString();

  try {
    // 2. Resolve (or auto-register) the room this ESP32 is speaking for.
    let room = await env.DB.prepare(
      `SELECT id, keycode FROM rooms WHERE block_name = ? AND room_number = ? LIMIT 1`
    ).bind(block_name, room_number).first();

    if (!room) {
      // First time this device has ever been seen — auto-create its room row.
      // Admin still needs to set a real keycode afterward from the dashboard.
      const insertResult = await env.DB.prepare(`
        INSERT INTO rooms (block_name, room_number, capacity, keycode, is_active, created_at, last_seen_at)
        VALUES (?, ?, ?, NULL, 1, ?, ?)
      `).bind(block_name, room_number, 4, nowISO, nowISO).run();

      room = { id: insertResult.meta.last_row_id, keycode: null };

      await logAttempt(env, room.id, null, verifyMethod, false, nowISO);
      return new Response(JSON.stringify({ access: false, reason: 'room_registered_awaiting_setup' }), {
        status: 200,
        headers: jsonHeaders
      });
    }

    // Room already known — just mark it as seen/online.
    await env.DB.prepare(`UPDATE rooms SET last_seen_at = ? WHERE id = ?`).bind(nowISO, room.id).run();

    // 3. Branch by verification method.
    let accessGranted = false;
    let reason = 'invalid_code';
    let resolvedUserId = null;

    if (verifyMethod === 'keycode') {
      if (room.keycode && room.keycode === value) {
        accessGranted = true;
        reason = 'ok';
      } else {
        reason = room.keycode ? 'wrong_keycode' : 'no_keycode_set';
      }

    } else if (verifyMethod === 'qr' || verifyMethod === 'rfid') {
      const column = verifyMethod === 'qr' ? 'qr_access_code' : 'rfid_card_uid';

      const rfidRow = await env.DB.prepare(`
        SELECT sr.user_id, sr.assigned_at, u.account_status
        FROM student_rfid sr
        JOIN users u ON u.id = sr.user_id
        WHERE sr.${column} = ?
        LIMIT 1
      `).bind(value).first();

      if (!rfidRow) {
        reason = 'code_not_found';
      } else if (rfidRow.account_status !== 'active') {
        reason = 'account_not_active';
      } else if (verifyMethod === 'qr' && isAccessCodeExpired(rfidRow.assigned_at)) {
        reason = 'code_expired';
      } else {
        resolvedUserId = rfidRow.user_id;

        // Confirm this student is actually allocated to THIS room.
        const allocation = await env.DB.prepare(`
          SELECT ra.room_id
          FROM room_allocations ra
          JOIN hostel_applications ha ON ha.id = ra.application_id
          WHERE ha.user_id = ?
          ORDER BY ra.assigned_at DESC
          LIMIT 1
        `).bind(resolvedUserId).first();

        if (!allocation) {
          reason = 'not_allocated_to_any_room';
        } else if (allocation.room_id !== room.id) {
          reason = 'not_allocated_to_this_room';
        } else {
          accessGranted = true;
          reason = 'ok';
        }
      }

    } else {
      reason = 'unknown_method';
    }

    // 4. Log every attempt, success or failure.
    await logAttempt(env, room.id, resolvedUserId, verifyMethod, accessGranted, nowISO);

    return new Response(JSON.stringify({ access: accessGranted, reason }), {
      status: 200,
      headers: jsonHeaders
    });

  } catch (err) {
    console.error('Hardware Verify-Access Error:', err.message);
    return new Response(JSON.stringify({ access: false, reason: 'server_error' }), {
      status: 500,
      headers: jsonHeaders
    });
  }
}

async function logAttempt(env, roomId, userId, method, success, timestamp) {
  try {
    await env.DB.prepare(`
      INSERT INTO access_logs (room_id, user_id, method, success, attempted_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(roomId, userId, method, success ? 1 : 0, timestamp).run();
  } catch (err) {
    // Never let a logging failure block the actual door decision.
    console.error('Access Log Insert Error:', err.message);
  }
}
