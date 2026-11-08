// visualize_backend.js
// Data behind the admin "Data Visualize" page, plus the unusual-hours setting.
//
//   GET  /api/admin/visualize/overview?admin_id=&range=today|7d|30d
//   GET  /api/admin/visualize/hardware?admin_id=
//   GET  /api/admin/settings/anomaly-hours?admin_id=
//   POST /api/admin/settings/anomaly-hours   { admin_id, windows: [{start:"HH:MM", end:"HH:MM"}] }
//
// Needs: access_logs (with the reason + code_hint columns), device_events, rooms, users,
// system_settings  -> see visualize_migration.sql.
// All times shown to the admin are Malaysia time (UTC+8, no daylight saving).

const MY_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS = { today: 1, '7d': 7, '30d': 30 };

const SETTING_KEY = 'anomaly_unusual_hours';
export const DEFAULT_WINDOWS = [{ start: '01:00', end: '05:00' }];
const MAX_WINDOWS = 5;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const BURST_FAILS = 3;     // this many denied scans ...
export const BURST_MINUTES = 5;   // ... at the same door within this many minutes = a burst
// A door unit counts as online if it sent a heartbeat this recently. Keep in sync with
// dashboard_backend.js (ONLINE_WINDOW_SECONDS) and the cron sweep in cloudflare_worker.js.
export const ONLINE_WINDOW_SECONDS = 660;

const POINT_LIMIT = 2000;
const LOG_LIMIT = 100;
const ANOMALY_LIST_LIMIT = 100;
const FAIL_SCAN_LIMIT = 5000;
const EVENT_LIMIT = 200;

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

// Same convention as the report page: the admin id is checked against the users table.
async function requireAdmin(env, adminIdRaw) {
  const adminId = Number(adminIdRaw);
  if (!Number.isInteger(adminId) || adminId <= 0) return { error: 'Missing admin_id', status: 400 };
  const row = await env.DB.prepare(`SELECT id, role FROM users WHERE id = ? LIMIT 1`).bind(adminId).first();
  if (!row || row.role !== 'admin') return { error: 'Admin access required', status: 403 };
  return { adminId };
}

/* ---------------- time helpers ---------------- */

// Start of the selected range as a UTC ISO string. "today" = since midnight Malaysia time.
export function sinceForRange(range, nowMs = Date.now()) {
  const days = RANGE_DAYS[range];
  if (!days) return null;
  const localMidnight = Math.floor((nowMs + MY_OFFSET_MS) / DAY_MS) * DAY_MS;
  return new Date(localMidnight - (days - 1) * DAY_MS - MY_OFFSET_MS).toISOString();
}

// Reads both "2026-10-25T03:04:05.000Z" and SQLite's default "2026-10-25 03:04:05" (both are UTC).
export function parseDbTime(value) {
  if (typeof value !== 'string') return NaN;
  let t = value.trim().replace(' ', 'T');
  if (!/[zZ]$|[+-]\d\d:\d\d$/.test(t)) t += 'Z';
  return Date.parse(t);
}

function toLocalString(ms) {
  return new Date(ms + MY_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

const localTs = (col) => `strftime('%Y-%m-%d %H:%M:%S', datetime(${col}, '+8 hours'))`;

function roomLabel(row) {
  return row && row.block_name && row.room_number ? `${row.block_name}-${row.room_number}` : 'Unknown door';
}

/* ---------------- unusual-hours windows (the setting) ---------------- */

export function validateWindows(input) {
  if (!Array.isArray(input)) return { ok: false, error: 'windows must be a list' };
  if (input.length > MAX_WINDOWS) return { ok: false, error: `At most ${MAX_WINDOWS} windows are allowed` };

  const seen = new Set();
  const windows = [];
  for (const w of input) {
    const start = w && typeof w.start === 'string' ? w.start.trim() : '';
    const end = w && typeof w.end === 'string' ? w.end.trim() : '';
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) return { ok: false, error: 'Times must look like 23:30' };
    if (start === end) return { ok: false, error: 'A window cannot start and end at the same time' };
    const key = `${start}-${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    windows.push({ start, end });
  }
  return { ok: true, windows };
}

async function loadWindows(env) {
  try {
    const row = await env.DB.prepare(`SELECT setting_value FROM system_settings WHERE setting_key = ?`).bind(SETTING_KEY).first();
    if (row && row.setting_value) {
      const checked = validateWindows(JSON.parse(row.setting_value));
      if (checked.ok && checked.windows.length > 0) return { windows: checked.windows, isDefault: false };
    }
  } catch (err) {
    console.error('Could not read anomaly windows, using default:', err.message);
  }
  return { windows: DEFAULT_WINDOWS, isDefault: true };
}

// SQL for "the local (Malaysia) time of day falls inside one of the windows". A window with
// start later than end (e.g. 23:00-05:00) crosses midnight.
function windowClause(windows) {
  const t = `strftime('%H:%M', datetime(l.attempted_at, '+8 hours'))`;
  const parts = [];
  const binds = [];
  for (const w of windows) {
    parts.push(w.start < w.end ? `(${t} >= ? AND ${t} < ?)` : `(${t} >= ? OR ${t} < ?)`);
    binds.push(w.start, w.end);
  }
  return { sql: parts.join(' OR '), binds };
}

/* ---------------- anomaly rules that work on rows in JS ---------------- */

// rows: denied scans { room_id, utc_time, block_name, room_number }.
// A burst = at least `fails` denied scans at the same door within `minutes` minutes.
export function findBursts(rows, fails = BURST_FAILS, minutes = BURST_MINUTES) {
  const windowMs = minutes * 60 * 1000;
  const byDoor = new Map();

  for (const r of rows) {
    const ms = parseDbTime(r.utc_time);
    if (Number.isNaN(ms)) continue;
    const key = r.room_id === null || r.room_id === undefined ? 'none' : String(r.room_id);
    if (!byDoor.has(key)) byDoor.set(key, { label: roomLabel(r), times: [] });
    byDoor.get(key).times.push(ms);
  }

  const bursts = [];
  for (const { label, times } of byDoor.values()) {
    times.sort((a, b) => a - b);
    let i = 0;
    let current = null;
    for (let j = 0; j < times.length; j++) {
      while (times[j] - times[i] > windowMs) i++;
      if (j - i + 1 >= fails) {
        if (current && times[i] <= current.endMs) {
          current.endMs = times[j];                    // overlapping windows are one burst
          current.count = j - current.startIdx + 1;
        } else {
          current = { label, startIdx: i, startMs: times[i], endMs: times[j], count: j - i + 1 };
          bursts.push(current);
        }
      }
    }
  }

  return bursts
    .sort((a, b) => b.startMs - a.startMs)
    .map(b => ({ door: b.label, count: b.count, start_local: toLocalString(b.startMs), end_local: toLocalString(b.endMs) }));
}

// events: device_events rows. Each "offline" event becomes one anomaly; if a later "online"
// event exists for the same room, the outage is shown as recovered.
export function pairOfflineEvents(events) {
  const byRoom = new Map();
  for (const e of events) {
    const ms = parseDbTime(e.occurred_at);
    if (Number.isNaN(ms)) continue;
    if (!byRoom.has(e.room_id)) byRoom.set(e.room_id, []);
    byRoom.get(e.room_id).push({ ...e, ms });
  }

  const items = [];
  for (const list of byRoom.values()) {
    list.sort((a, b) => a.ms - b.ms);
    list.forEach((e, idx) => {
      if (e.event !== 'offline') return;
      const back = list.slice(idx + 1).find(x => x.event === 'online');
      items.push({
        door: roomLabel(e),
        detected_local: toLocalString(e.ms),
        detail: e.detail || '',
        recovered_local: back ? toLocalString(back.ms) : null,
        ongoing: !back,
        _ms: e.ms
      });
    });
  }
  return items.sort((a, b) => b._ms - a._ms).map(({ _ms, ...rest }) => rest);
}

/* ---------------- row shaping ---------------- */

function shapeLog(r) {
  return {
    id: r.id,
    method: r.method,
    success: !!r.success,
    reason: r.reason || null,
    who: r.full_name || (r.code_hint ? `Unregistered \u00B7\u00B7\u00B7\u00B7${r.code_hint}` : 'Unknown'),
    door: roomLabel(r),
    local_time: r.local_time
  };
}

/* ---------------- route handler ---------------- */

export async function handleVisualizeRoutes(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  // ---------- unusual-hours setting ----------
  if (path === '/api/admin/settings/anomaly-hours') {
    if (method === 'GET') {
      const auth = await requireAdmin(env, url.searchParams.get('admin_id'));
      if (auth.error) return json({ error: auth.error }, auth.status, corsHeaders);
      const cfg = await loadWindows(env);
      return json({ windows: cfg.windows, is_default: cfg.isDefault, max_windows: MAX_WINDOWS }, 200, corsHeaders);
    }

    if (method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid request body' }, 400, corsHeaders);
      }
      const auth = await requireAdmin(env, body.admin_id);
      if (auth.error) return json({ error: auth.error }, auth.status, corsHeaders);

      const checked = validateWindows(body.windows);
      if (!checked.ok) return json({ error: checked.error }, 400, corsHeaders);

      try {
        if (checked.windows.length === 0) {
          // An empty list means "go back to the default window"
          await env.DB.prepare(`DELETE FROM system_settings WHERE setting_key = ?`).bind(SETTING_KEY).run();
          return json({ windows: DEFAULT_WINDOWS, is_default: true, max_windows: MAX_WINDOWS }, 200, corsHeaders);
        }
        await env.DB.prepare(`
          INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `).bind(SETTING_KEY, JSON.stringify(checked.windows)).run();
        return json({ windows: checked.windows, is_default: false, max_windows: MAX_WINDOWS }, 200, corsHeaders);
      } catch (err) {
        console.error('Anomaly window save error:', err.message);
        return json({ error: 'Database save failed', details: err.message }, 500, corsHeaders);
      }
    }
    return null;
  }

  // ---------- hardware status (polled often, so it is its own small request) ----------
  if (method === 'GET' && path === '/api/admin/visualize/hardware') {
    const auth = await requireAdmin(env, url.searchParams.get('admin_id'));
    if (auth.error) return json({ error: auth.error }, auth.status, corsHeaders);

    try {
      const { results: roomRows } = await env.DB.prepare(`
        SELECT id, block_name, room_number, last_seen_at
        FROM rooms
        WHERE last_seen_at IS NOT NULL
        ORDER BY block_name, room_number
      `).all();

      const nowMs = Date.now();
      const rooms = (roomRows || []).map(r => {
        const seenMs = parseDbTime(r.last_seen_at);
        const secondsSince = Number.isNaN(seenMs) ? null : Math.max(0, Math.floor((nowMs - seenMs) / 1000));
        return {
          id: r.id,
          label: roomLabel(r),
          online: secondsSince !== null && secondsSince <= ONLINE_WINDOW_SECONDS,
          seconds_since: secondsSince,
          last_seen_local: Number.isNaN(seenMs) ? null : toLocalString(seenMs)
        };
      });

      // History is optional: if the device_events table has not been created yet, the current
      // status above still works.
      let events = [];
      let historyReady = true;
      try {
        const { results } = await env.DB.prepare(`
          SELECT e.event, e.detail, ${localTs('e.occurred_at')} AS local_time, r.block_name, r.room_number
          FROM device_events e JOIN rooms r ON r.id = e.room_id
          ORDER BY datetime(e.occurred_at) DESC LIMIT 50
        `).all();
        events = (results || []).map(e => ({ event: e.event, detail: e.detail || '', door: roomLabel(e), local_time: e.local_time }));
      } catch (err) {
        historyReady = false;
        console.error('device_events not readable:', err.message);
      }

      return json({ rooms, events, history_ready: historyReady, online_window_minutes: Math.round(ONLINE_WINDOW_SECONDS / 60) }, 200, corsHeaders);
    } catch (err) {
      console.error('Visualize hardware error:', err.message);
      return json({ error: 'Failed to load hardware status', details: err.message }, 500, corsHeaders);
    }
  }

  // ---------- overview: charts, anomalies, log ----------
  if (method === 'GET' && path === '/api/admin/visualize/overview') {
    const auth = await requireAdmin(env, url.searchParams.get('admin_id'));
    if (auth.error) return json({ error: auth.error }, auth.status, corsHeaders);

    const range = url.searchParams.get('range') || '7d';
    const since = sinceForRange(range);
    if (!since) return json({ error: 'range must be today, 7d or 30d' }, 400, corsHeaders);

    try {
      const cfg = await loadWindows(env);
      const win = windowClause(cfg.windows);
      const inRange = `datetime(attempted_at) >= datetime(?)`;
      const logSelect = `
        SELECT l.id, l.method, l.success, l.reason, l.code_hint, ${localTs('l.attempted_at')} AS local_time,
               u.full_name, r.block_name, r.room_number
        FROM access_logs l
        LEFT JOIN users u ON u.id = l.user_id
        LEFT JOIN rooms r ON r.id = l.room_id`;
      const unusualWhere = `datetime(l.attempted_at) >= datetime(?) AND (${win.sql})`;

      const results = await env.DB.batch([
        env.DB.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(success), 0) AS granted FROM access_logs WHERE ${inRange}`).bind(since),
        env.DB.prepare(`SELECT method, COUNT(*) AS total, COALESCE(SUM(success), 0) AS granted FROM access_logs WHERE ${inRange} GROUP BY method`).bind(since),
        env.DB.prepare(`SELECT method, CAST(strftime('%H', datetime(attempted_at, '+8 hours')) AS INTEGER) AS hr, COUNT(*) AS n FROM access_logs WHERE ${inRange} GROUP BY method, hr`).bind(since),
        env.DB.prepare(`SELECT id, method, success, ${localTs('attempted_at')} AS local_time FROM access_logs WHERE ${inRange} ORDER BY datetime(attempted_at) DESC LIMIT ${POINT_LIMIT}`).bind(since),
        env.DB.prepare(`${logSelect} WHERE datetime(l.attempted_at) >= datetime(?) ORDER BY datetime(l.attempted_at) DESC LIMIT ${LOG_LIMIT}`).bind(since),
        env.DB.prepare(`${logSelect} WHERE ${unusualWhere} ORDER BY datetime(l.attempted_at) DESC LIMIT ${ANOMALY_LIST_LIMIT}`).bind(since, ...win.binds),
        env.DB.prepare(`SELECT COUNT(*) AS n FROM access_logs l WHERE ${unusualWhere}`).bind(since, ...win.binds),
        env.DB.prepare(`
          SELECT l.room_id, strftime('%Y-%m-%d %H:%M:%S', datetime(l.attempted_at)) AS utc_time, r.block_name, r.room_number
          FROM access_logs l LEFT JOIN rooms r ON r.id = l.room_id
          WHERE l.success = 0 AND datetime(l.attempted_at) >= datetime(?)
          ORDER BY l.room_id, datetime(l.attempted_at) ASC LIMIT ${FAIL_SCAN_LIMIT}`).bind(since),
        env.DB.prepare(`
          SELECT e.room_id, e.event, e.detail, e.occurred_at, r.block_name, r.room_number
          FROM device_events e JOIN rooms r ON r.id = e.room_id
          WHERE datetime(e.occurred_at) >= datetime(?)
          ORDER BY datetime(e.occurred_at) DESC LIMIT ${EVENT_LIMIT}`).bind(since)
      ]);

      const rowsOf = (i) => (results[i] && results[i].results) || [];
      const kpi = rowsOf(0)[0] || { total: 0, granted: 0 };
      const total = Number(kpi.total) || 0;
      const granted = Number(kpi.granted) || 0;
      const failedRows = rowsOf(7);

      return json({
        range,
        since_local: toLocalString(Date.parse(since)),
        generated_at: new Date().toISOString(),
        config: {
          unusual_windows: cfg.windows,
          unusual_is_default: cfg.isDefault,
          burst: { fails: BURST_FAILS, minutes: BURST_MINUTES },
          silent_minutes: Math.round(ONLINE_WINDOW_SECONDS / 60)
        },
        kpis: { total, granted, denied: total - granted, success_rate: total > 0 ? Math.round((granted / total) * 1000) / 10 : null },
        by_method: rowsOf(1).map(r => ({ method: r.method, total: Number(r.total), granted: Number(r.granted) })),
        hourly: rowsOf(2).map(r => ({ method: r.method, hr: Number(r.hr), n: Number(r.n) })),
        points: rowsOf(3).map(r => ({ id: r.id, method: r.method, success: !!r.success, local_time: r.local_time })),
        points_truncated: rowsOf(3).length >= POINT_LIMIT,
        logs: rowsOf(4).map(shapeLog),
        anomalies: {
          unusual_hours: { total: Number((rowsOf(6)[0] || {}).n) || 0, items: rowsOf(5).map(shapeLog) },
          bursts: findBursts(failedRows),
          bursts_truncated: failedRows.length >= FAIL_SCAN_LIMIT,
          silent: pairOfflineEvents(rowsOf(8))
        }
      }, 200, corsHeaders);
    } catch (err) {
      console.error('Visualize overview error:', err.message);
      return json({
        error: 'Could not load the visualization data. Has visualize_migration.sql been run?',
        details: err.message
      }, 500, corsHeaders);
    }
  }

  return null;
}
