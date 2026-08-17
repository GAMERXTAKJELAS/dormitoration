/**
 * Dormitoration - Backend Registration Endpoint (Cloudflare Worker D1)
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

    // -------------------------------------------------------------------------
    // 0. Basic Input Validations
    // -------------------------------------------------------------------------
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

    const nowISO = new Date().toISOString();

    // -------------------------------------------------------------------------
    // 1. Check for Existing Account (By Phone or Email)
    // -------------------------------------------------------------------------
    const existingUser = await env.DB.prepare(`
      SELECT id, account_status, registration_deadline 
      FROM users 
      WHERE (phone = ? AND phone IS NOT NULL) 
         OR (email = ? AND email IS NOT NULL)
      LIMIT 1
    `).bind(phone || null, email || null).first();

    if (existingUser) {
      const isTerminated = existingUser.account_status === 'terminated';
      const isExpired = existingUser.registration_deadline && existingUser.registration_deadline <= nowISO;

      if (isTerminated || isExpired) {
        // Unlink application before purging user to prevent foreign key errors
        await env.DB.prepare(`UPDATE hostel_applications SET user_id = NULL WHERE user_id = ?`).bind(existingUser.id).run();
        // Delete expired/terminated user record
        await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(existingUser.id).run();
      } else {
        // Active/pending account exists
        return new Response(
          JSON.stringify({ error: 'Akaun dengan No. Telefon atau e-mel ini telah wujud dan aktif.' }), 
          { status: 409, headers }
        );
      }
    }

    // -------------------------------------------------------------------------
    // 2. Fetch Active Deadline Settings & Calculate Registration Expiry Date
    // -------------------------------------------------------------------------
    const valSetting = await env.DB.prepare(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'temp_account_deadline_value'`
    ).first();

    const unitSetting = await env.DB.prepare(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'temp_account_deadline_unit'`
    ).first();

    const durationVal = valSetting ? parseInt(valSetting.setting_value, 10) : 7;
    const durationUnit = unitSetting ? unitSetting.setting_value : 'days';

    const deadlineDate = new Date();
    if (durationUnit === 'hours') {
      deadlineDate.setHours(deadlineDate.getHours() + durationVal);
    } else if (durationUnit === 'months') {
      deadlineDate.setMonth(deadlineDate.getMonth() + durationVal);
    } else {
      deadlineDate.setDate(deadlineDate.getDate() + durationVal);
    }

    const registrationDeadline = deadlineDate.toISOString();

    // -------------------------------------------------------------------------
    // 3. Insert NEW User Account into `users` Table
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // 4. Update / Re-link Hostel Application DB (Resets admin_approval to 'pending')
    // -------------------------------------------------------------------------
    if (newUserId && ic_number) {
      const now = new Date();
      const month = now.getMonth() + 1; 
      const yearShort = now.getFullYear().toString().slice(-2); 
      const currentSession = (month >= 1 && month <= 6) ? `JJ${yearShort}` : `JD${yearShort}`;

      // Check for existing application record tied to this IC
      const existingApp = await env.DB.prepare(
        `SELECT id, submission_status FROM hostel_applications WHERE ic_number = ? LIMIT 1`
      ).bind(ic_number).first();

      if (existingApp) {
        // Reset admin_approval to 'pending' during re-registration/re-link
        await env.DB.prepare(`
          UPDATE hostel_applications 
          SET user_id = ?,
              dob = COALESCE(NULLIF(?, ''), dob),
              age = COALESCE(?, age),
              gender = COALESCE(NULLIF(?, ''), gender),
              admin_approval = 'pending',
              appeal_reason = NULL
          WHERE ic_number = ?
        `).bind(
          newUserId, 
          tarikh_lahir || null, 
          umur || null, 
          jantina || null, 
          ic_number
        ).run();
      } else {
        // Insert new application record with default status 'pending'
        await env.DB.prepare(`
          INSERT INTO hostel_applications (
            user_id,
            session_id,
            ic_number,
            dob,
            age,
            gender,
            submission_status,
            head_of_program_support,
            admin_approval
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            'draft',
            'pending',
            'pending'
          )
        `).bind(
          newUserId,
          currentSession,
          ic_number,
          tarikh_lahir || null,
          umur || null,
          jantina || null
        ).run();
      }
    }

    // -------------------------------------------------------------------------
    // 5. Build and Send Success Response
    // -------------------------------------------------------------------------
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
      admin_approval: 'pending',
      registration_deadline: registrationDeadline
    };

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Akaun baru berjaya didaftarkan dan dikemaskini!', 
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