export async function handleRegister(request, env, headers) {
  try {
    const { username, phone, password, role } = await request.json();

    if (!username || !phone || !password) {
      return new Response(
        JSON.stringify({ error: 'Missing required registration fields.' }),
        { status: 400, headers }
      );
    }

    // Check if phone or username already exists
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

    // Compute 1-week deadline (7 days in milliseconds)
    const now = new Date();
    const deadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const deadlineISO = deadline.toISOString();

    // Insert user into Cloudflare D1
    const result = await env.DB.prepare(`
      INSERT INTO users (username, phone, password_hash, role, account_status, registration_deadline, created_at)
      VALUES (?, ?, ?, ?, 'pending_details', ?, ?)
    `).bind(
      username,
      phone,
      password,
      assignedRole,
      deadlineISO,
      now.toISOString()
    ).run();

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: 'Failed to write record to D1 database.' }),
        { status: 500, headers }
      );
    }

    return new Response(
      JSON.stringify({
        message: 'Account registered successfully. You have 7 days to complete your details.',
        registration_deadline: deadlineISO
      }),
      { status: 201, headers }
    );

  } catch (err) {
    // Return explicit error details to frontend for quick debugging
    return new Response(
      JSON.stringify({ error: 'Server or Database Error', details: err.message }),
      { status: 500, headers }
    );
  }
}