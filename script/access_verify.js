// =====================================================================
//  access_verify.js  -  POST /api/access/verify
//  Called by the ESP32 door unit. Checks the scanned QR code against
//  student_rfid.qr_access_code and answers { "access": true|false }.
//
//  Wire it into your router (cloudflare_worker.js):
//    import { handleAccessVerify } from './access_verify.js';
//    ...
//    if (url.pathname === '/api/access/verify' && request.method === 'POST') {
//      return handleAccessVerify(request, env);
//    }
//
//  Secret (never in wrangler.json):
//    npx wrangler secret put DEVICE_API_KEY
//    Local dev: add  DEVICE_API_KEY=test-key  to a .dev.vars file
//
//  ASSUMPTIONS to check against your project:
//    - D1 binding is named DB            (see wrangler.json)
//    - assigned_at is a date string Date() can parse
//    - expiry = 5 months + 2 weeks; swap isExpired() for your shared
//      helper in access_code_utils.js so the rule lives in one place
// =====================================================================

const MAX_CODE_LEN = 128;

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

// TODO: replace with the shared expiry check from access_code_utils.js
function isExpired(assignedAt) {
  const d = new Date(assignedAt);
  if (isNaN(d.getTime())) return true;          // unreadable date = treat as expired
  d.setUTCMonth(d.getUTCMonth() + 5);
  d.setUTCDate(d.getUTCDate() + 14);
  return Date.now() > d.getTime();
}

export async function handleAccessVerify(request, env) {
  // 1. Authenticate the device
  if (!env.DEVICE_API_KEY) return json({ error: 'server_not_configured' }, 500);
  const key = request.headers.get('X-Device-Key') || '';
  if (!safeEqual(key, env.DEVICE_API_KEY)) return json({ error: 'unauthorized' }, 401);

  // 2. Parse and validate the body
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ access: false }, 400);
  }
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code || code.length > MAX_CODE_LEN) return json({ access: false }, 400);

  // 3. Look the code up (parameterized query)
  const row = await env.DB
    .prepare('SELECT assigned_at FROM student_rfid WHERE qr_access_code = ?')
    .bind(code)
    .first();

  // 4. Same answer for "not found" and "expired": no hints to a prober
  if (!row || isExpired(row.assigned_at)) return json({ access: false });

  return json({ access: true });
}
