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
      tarikh_lahir, 
      umur,         
      jantina,      
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

    // =========================================================================
    // 0. AUTO-CLEANUP: Purge Terminated & Expired Accounts
    // =========================================================================
    // If an account is already marked as 'terminated' OR its registration_deadline 
    // has expired, wipe it from D1 so the user (or email/phone) can re-register freshly.
    const nowISO = new Date().toISOString();
    
    await env.DB.prepare(`
      DELETE FROM users 
      WHERE (phone = ? AND phone IS NOT NULL) OR (email = ? AND email IS NOT NULL)
      AND (
        account_status = 'terminated' 
        OR (registration_deadline IS NOT NULL AND registration_deadline <= ?)
      )
    `).bind(phone || null, email || null, nowISO).run();
    // =========================================================================

    // 1. Check if ACTIVE user already exists in `users` table
    const existingCheck = await env.DB.prepare(
      `SELECT id FROM users WHERE (phone = ? AND phone IS NOT NULL) OR (email = ? AND email IS NOT NULL) LIMIT 1`
    ).bind(phone || null, email || null).first();

    if (existingCheck) {
      return new Response(
        JSON.stringify({ error: 'Akaun dengan No. Telefon atau e-mel ini telah wujud.' }), 
        { status: 409, headers }
      );
    }

    // ... [Rest of your step 2 to step 6 code remains exactly the same]

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

// 5. Insert Draft Application with Dynamic Text Session Code
    if (newUserId && ic_number) {

      // Dynamically create session code based on current date (e.g., "JJ26" or "JD26")
      const now = new Date();
      const month = now.getMonth() + 1; // 1-12
      const yearShort = now.getFullYear().toString().slice(-2); // e.g. "26"
      const currentSession = (month >= 1 && month <= 6) ? `JJ${yearShort}` : `JD${yearShort}`;

      await env.DB.prepare(`
        INSERT INTO hostel_applications (
          user_id,
          session_id,
          ic_number,
          dob,
          age,
          gender,
          home_address,
          postcode,
          city,
          state,
          reason_for_apply,
          program,
          semester,
          gpa_cgpa,
          contributions,
          guardian1_name,
          guardian1_ic,
          guardian1_phone,
          guardian1_address,
          guardian1_relationship,
          guardian1_job,
          guardian1_income,
          guardian2_name,
          guardian2_ic,
          guardian2_phone,
          guardian2_address,
          guardian2_relationship,
          guardian2_job,
          guardian2_income,
          dependents_count,
          submission_status,
          head_of_program_support,
          admin_approval
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          '', '', '', '',
          '', '', 1, 0.0, '',
          '', '', '', '', '', '', 0.0,
          '', '', '', '', '', '', 0.0,
          0,
          'draft',
          'pending',
          'pending'
        )
        ON CONFLICT(user_id) DO UPDATE SET
          session_id = excluded.session_id,
          ic_number = excluded.ic_number,
          dob = excluded.dob,
          age = excluded.age,
          gender = excluded.gender
      `).bind(
        newUserId,
        currentSession, // Passes string like "JD26" directly
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