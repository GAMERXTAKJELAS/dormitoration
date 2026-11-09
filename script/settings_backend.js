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
          JSON.stringify({ error: 'Please enter a valid duration.' }),
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

/**
 * GET/POST /api/admin/settings/system-controls
 * Manages System Control Toggles in D1 (maintenance_mode, autolock_main_gate)
 */
export async function handleAdminSystemControls(request, env, headers) {
  const method = request.method;

  if (method === 'GET') {
    try {
      const maintRow = await env.DB.prepare(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'maintenance_mode'`
      ).first();

      const autolockRow = await env.DB.prepare(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'autolock_main_gate'`
      ).first();

      return new Response(
        JSON.stringify({
          maintenance_mode: maintRow ? maintRow.setting_value === '1' : false,
          autolock_main_gate: autolockRow ? autolockRow.setting_value === '1' : false
        }),
        { status: 200, headers }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ maintenance_mode: false, autolock_main_gate: false, error: err.message }),
        { status: 200, headers }
      );
    }
  }

  if (method === 'POST') {
    try {
      const { key, value } = await request.json();
      if (!['maintenance_mode', 'autolock_main_gate'].includes(key)) {
        return new Response(JSON.stringify({ error: 'Invalid setting key' }), { status: 400, headers });
      }

      const strVal = value ? '1' : '0';

      await env.DB.prepare(`
        INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `).bind(key, strVal).run();

      return new Response(
        JSON.stringify({ message: 'Control setting updated successfully!', key, value: !!value }),
        { status: 200, headers }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Failed to update control setting', details: err.message }),
        { status: 500, headers }
      );
    }
  }
}