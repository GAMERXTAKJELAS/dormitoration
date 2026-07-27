/**
 * Dormitoration - Backend Registration Endpoint (Cloudflare Worker)
 * File: /script/register.js
 */

export async function handleRegister(request, env, headers) {
  try {
    const body = await request.json();
    
    // Extract payload sent from signup.js
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

    // Basic validation
    if (!ic_number && !phone) {
      return new Response(
        JSON.stringify({ error: 'Pengenalan (IC atau No. Telefon) diperlukan.' }), 
        { status: 400, headers }
      );
    }

    if (!password) {
      return new Response(
        JSON.stringify({ error: 'Kata laluan diperlukan.' }), 
        { status: 400, headers }
      );
    }

    // 1. Check if user already exists in Cloudflare D1 (by IC or Phone)
    const existingCheck = await env.DB.prepare(
      `SELECT id FROM users WHERE (ic_number = ? AND ic_number IS NOT NULL) OR (phone = ? AND phone IS NOT NULL) LIMIT 1`
    ).bind(ic_number || null, phone || null).first();

    if (existingCheck) {
      return new Response(
        JSON.stringify({ error: 'Akaun dengan No. IC atau No. Telefon ini telah wujud.' }), 
        { status: 409, headers }
      );
    }

    // 2. Insert new user into D1 (username explicitly set to NULL)
    const query = `
      INSERT INTO users (
        username, 
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
        role, 
        account_status
      ) VALUES (
        NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_details'
      )
    `;

    const result = await env.DB.prepare(query)
      .bind(
        ic_number || null, 
        matriks_number || null, 
        full_name || null, 
        email || null, 
        phone || null, 
        password, 
        tarikh_lahir || null, 
        umur || null, 
        jantina || null, 
        negeri || null, 
        role || 'student'
      )
      .run();

    // 3. Construct response object for frontend session storage
    const createdUser = {
      id: result.meta?.last_row_id || null,
      username: null,
      ic_number: ic_number || null,
      matriks_number: matriks_number || null,
      full_name: full_name || null,
      email: email || null,
      phone: phone || null,
      tarikh_lahir: tarikh_lahir || null,
      umur: umur || null,
      jantina: jantina || null,
      negeri: negeri || null,
      role: role || 'student',
      account_status: 'pending_details'
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