/**
 * Dormitoration - Global Account Cleanup Endpoint (Cloudflare Worker)
 * File: /script/cleanup_backend.js
 */

export async function purgeExpiredAndTerminatedAccounts(env) {
  try {
    const nowISO = new Date().toISOString();

    // Step 1: Unlink user_id in hostel_applications so student details are PRESERVED
    await env.DB.prepare(`
      UPDATE hostel_applications 
      SET user_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE user_id IN (
        SELECT id FROM users 
        WHERE account_status = 'terminated' 
           OR (registration_deadline IS NOT NULL AND registration_deadline <= ?)
      )
    `).bind(nowISO).run();

    // Step 2: Hard delete terminated/expired records from users table
    const result = await env.DB.prepare(`
      DELETE FROM users 
      WHERE account_status = 'terminated' 
         OR (registration_deadline IS NOT NULL AND registration_deadline <= ?)
    `).bind(nowISO).run();

    return { success: true, deletedCount: result.meta?.changes || 0 };
  } catch (err) {
    console.error("Cleanup Error:", err);
    return { success: false, error: err.message };
  }
}

// Handler if you want to call cleanup via an explicit HTTP endpoint
export async function handleAdminCleanup(request, env, headers) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  const result = await purgeExpiredAndTerminatedAccounts(env);

  if (result.success) {
    return new Response(
      JSON.stringify({ message: 'Pembersihan akaun berjaya!', purgedCount: result.deletedCount }),
      { status: 200, headers }
    );
  } else {
    return new Response(
      JSON.stringify({ error: 'Gagal membersihkan akaun.', details: result.error }),
      { status: 500, headers }
    );
  }
}