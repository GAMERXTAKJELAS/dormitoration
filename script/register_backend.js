/**
 * Dormitoration - Backend Registration Endpoint (Cloudflare Worker)
 * File: /script/register.js
 */

export async function handleRegister(request, env, headers) {
  try {
    const body = await request.json();
    
    const { 
      ic_number, 
      full_name, 
      email, 
      phone, 
      password, 
      tarikh_lahir, // mapped to 'dob' in D1
      umur,         // mapped to 'age' in D1
      jantina,      // mapped to 'gender' in D1
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

    // 1. Check if user already exists in `users` table
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

    // 3. Calculate future registration deadline ISO date
    const deadlineDate = new Date();
    if (durationUnit === 'hours') {
      deadlineDate.setHours(deadlineDate.getHours() + durationVal);
    } else if (durationUnit === 'months') {
      deadlineDate.setMonth(deadlineDate.getMonth() + durationVal);
    } else {
      deadlineDate.setDate(deadlineDate.getDate() + durationVal);
    }

    const registrationDeadline = deadlineDate.toISOString();

    // 4. Insert AUTH data into `users` table
    const userResult = await env.DB.prepare(`
      INSERT INTO users (
        username, 
        phone, 
        full_name, 
        email, 
        password_hash, 
        role, 
        account_status,
        registration_deadline,
        created_at
      ) VALUES (
        NULL, ?, ?, ?, ?, ?, 'pending_details', ?, CURRENT_TIMESTAMP
      )
    `).bind(
      phone || null, 
      full_name || null, 
      email || null, 
      password, 
      role || 'student',
      registrationDeadline
    ).run();

    const newUserId = userResult.meta?.last_row_id;

// 5. Insert Extracted IC & Profile into `hostel_applications` using exact schema column names
    if (newUserId && ic_number) {
      await env.DB.prepare(`
        INSERT INTO hostel_applications (
          user_id,
          ic_number,
          dob,
          age,
          gender
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          ic_number = excluded.ic_number,
          dob = excluded.dob,
          age = excluded.age,
          gender = excluded.gender
      `).bind(
        newUserId,
        ic_number,
        tarikh_lahir || null,
        umur || null,
        jantina || null
      ).run();
    }

    // 6. Return response object
    const createdUser = {
      id: newUserId,
      username: null,
      full_name: full_name || null,
      email: email || null,
      phone: phone || null,
      ic_number: ic_number || null,
      tarikh_lahir: tarikh_lahir || null,
      umur: umur || null,
      jantina: jantina || null,
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