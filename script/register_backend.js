/**
 * Dormitoration - Backend Registration Endpoint (Cloudflare Worker)
 * File: /script/register.js
 */

export async function handleRegister(request, env, headers) {
  try {
    const body = await request.json();
    
    const { 
      ic_number, 
      matriks_number, 
      full_name, 
      email, 
      phone, 
      password, 
      tarikh_lahir, 
      umur, 
      jantina, 
      negeri, 
      role 
    } = body;

    if (!phone && !email) {
      return new Response(
        JSON.stringify({ error: 'No. Telefon atau e-mel diperlukan.' }), 
        { status: 400, headers }
      );
    }

    if (!password) {
      return new Response(
        JSON.stringify({ error: 'Kata laluan diperlukan.' }), 
        { status: 400, headers }
      );
    }

    // 1. Check if user already exists in D1 (by phone or email)
    const existingCheck = await env.DB.prepare(
      `SELECT id FROM users WHERE (phone = ? AND phone IS NOT NULL) OR (email = ? AND email IS NOT NULL) LIMIT 1`
    ).bind(phone || null, email || null).first();

    if (existingCheck) {
      return new Response(
        JSON.stringify({ error: 'Akaun dengan No. Telefon atau e-mel ini telah wujud.' }), 
        { status: 409, headers }
      );
    }

    // 2. Fetch active deadline duration & unit from system_settings
    const valSetting = await env.DB.prepare(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'temp_account_deadline_value'`
    ).first();

    const unitSetting = await env.DB.prepare(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'temp_account_deadline_unit'`
    ).first();

    const durationVal = valSetting ? parseInt(valSetting.setting_value, 10) : 7;
    const durationUnit = unitSetting ? unitSetting.setting_value : 'days';

    // 3. Calculate future DATETIME for ISO format
    const deadlineDate = new Date();
    if (durationUnit === 'hours') {
      deadlineDate.setHours(deadlineDate.getHours() + durationVal);
    } else if (durationUnit === 'months') {
      deadlineDate.setMonth(deadlineDate.getMonth() + durationVal);
    } else {
      // Default: days
      deadlineDate.setDate(deadlineDate.getDate() + durationVal);
    }

    const registrationDeadline = deadlineDate.toISOString();

    // 4. Insert into `users` table including registration_deadline
    const result = await env.DB.prepare(`
      INSERT INTO users (
        username, 
        phone, 
        full_name, 
        email, 
        password_hash, 
        role, 
        account_status,
        registration_deadline
      ) VALUES (
        NULL, ?, ?, ?, ?, ?, 'pending_details', ?
      )
    `).bind(
      phone || null, 
      full_name || null, 
      email || null, 
      password, 
      role || 'student',
      registrationDeadline
    ).run();

    const newUserId = result.meta?.last_row_id;

    // 5. Return user object + IC metadata so frontend can store in localStorage
    const createdUser = {
      id: newUserId,
      username: null,
      full_name: full_name || null,
      email: email || null,
      phone: phone || null,
      ic_number: ic_number || null,
      matriks_number: matriks_number || null,
      tarikh_lahir: tarikh_lahir || null,
      umur: umur || null,
      jantina: jantina || null,
      negeri: negeri || null,
      role: role || 'student',
      account_status: 'pending_details',
      registration_deadline: registrationDeadline
    };

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Akaun berjaya didaftarkan!', 
        user: createdUser 
      }), 
      { status: 200, headers }
    );

  } catch (err) {
    console.error("D1 Register Error:", err);
    return new Response(
      JSON.stringify({ 
        error: 'Ralat pelayan semasa mendaftar.', 
        details: err.message 
      }), 
      { status: 500, headers }
    );
  }
}