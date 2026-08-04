/**
 * Dormitoration - Backend Settings Endpoint (Cloudflare Worker)
 * File: /script/settings_backend.js
 */

export async function handleAdminDeadlineSettings(request, env, headers) {
  const method = request.method;

  // 1. GET Request: Fetch current deadline settings from D1
  if (method === 'GET') {
    try {
      const valResult = await env.DB.prepare(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'temp_account_deadline_value'`
      ).first();

      const unitResult = await env.DB.prepare(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'temp_account_deadline_unit'`
      ).first();

      return new Response(
        JSON.stringify({
          value: valResult ? parseInt(valResult.setting_value, 10) : 7,
          unit: unitResult ? unitResult.setting_value : 'days'
        }),
        { status: 200, headers }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ value: 7, unit: 'days', error: err.message }),
        { status: 200, headers }
      );
    }
  }

  // 2. POST Request: Save updated deadline settings into D1
  if (method === 'POST') {
    try {
      const { value, unit } = await request.json();

      if (!value || isNaN(value) || value < 1) {
        return new Response(
          JSON.stringify({ error: 'Sila masukkan tempoh masa yang sah.' }),
          { status: 400, headers }
        );
      }

      // Safe SQLite UPSERT for D1
      await env.DB.prepare(`
        INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at)
        VALUES ('temp_account_deadline_value', ?, CURRENT_TIMESTAMP)
      `).bind(value.toString()).run();

      await env.DB.prepare(`
        INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at)
        VALUES ('temp_account_deadline_unit', ?, CURRENT_TIMESTAMP)
      `).bind(unit.toString()).run();

      return new Response(
        JSON.stringify({ message: 'Setting saved successfully!' }),
        { status: 200, headers }
      );
    } catch (err) {
      console.error("Settings DB Error:", err);
      return new Response(
        JSON.stringify({ error: 'Database save failed', details: err.message }),
        { status: 500, headers }
      );
    }
  }
}