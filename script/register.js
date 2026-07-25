export async function handleRegister(request, env, headers) {
  try {
    const body = await request.json();
    const { username, phone, password, full_name, email, role } = body;

    if (!username || !phone || !password) {
      return new Response(
        JSON.stringify({ error: 'Missing required registration fields.' }),
        { status: 400, headers }
      );
    }

    // Check duplicate username or phone
    const existingUser = await env.DB.prepare(`
      SELECT id FROM users WHERE phone = ? OR username = ?
    `).bind(phone, username).first();

    if (existingUser) {
      return new Response(
        JSON.stringify({ error: 'Username or phone number already registered.' }),
        { status: 409, headers }
      );
    }

    const assignedRole = role || 'student';
    const now = new Date();
    const deadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Insert user into D1
    const result = await env.DB.prepare(`
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
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending_details', ?, ?)
      RETURNING id, username, phone, full_name, email, role, account_status, registration_deadline
    `).bind(
      username,
      phone,
      full_name || username,
      email || `${username}@student.tvetmara.edu.my`,
      password,
      assignedRole,
      deadline.toISOString(),
      now.toISOString()
    ).first();

    return new Response(
      JSON.stringify({
        message: 'Account registered successfully.',
        user: result || {
          username,
          phone,
          role: assignedRole,
          account_status: 'pending_details',
          registration_deadline: deadline.toISOString()
        }
      }),
      { status: 201, headers }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Database Insert Failed', details: err.message }),
      { status: 500, headers }
    );
  }
}