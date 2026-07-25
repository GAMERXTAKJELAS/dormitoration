export async function handleLogin(request, env, headers) {
  const { identifier, password } = await request.json();

  if (!identifier || !password) {
    return new Response(
      JSON.stringify({ error: 'Missing phone/username or password.' }),
      { status: 400, headers }
    );
  }

  // Fetch user from D1 database
  const user = await env.DB.prepare(`
    SELECT * FROM users WHERE phone = ? OR username = ?
  `).bind(identifier, identifier).first();

  if (!user || user.password_hash !== password) {
    return new Response(
      JSON.stringify({ error: 'Invalid credentials.' }),
      { status: 401, headers }
    );
  }

  // --- 1-WEEK TIME LIMIT CHECK ---
  const currentTime = new Date();
  const deadlineTime = new Date(user.registration_deadline);

  // If status is still 'pending_details' AND 7 days have passed
  if (user.account_status === 'pending_details' && currentTime > deadlineTime) {
    await env.DB.prepare(`
      UPDATE users SET account_status = 'terminated' WHERE id = ?
    `).bind(user.id).run();

    return new Response(
      JSON.stringify({
        error: 'Account terminated. Your 1-week registration window has expired.'
      }),
      { status: 403, headers }
    );
  }

  // Block if account is already terminated
  if (user.account_status === 'terminated') {
    return new Response(
      JSON.stringify({ error: 'Account terminated.' }),
      { status: 403, headers }
    );
  }

  delete user.password_hash; // Remove sensitive password from response

  return new Response(
    JSON.stringify({
      message: 'Login successful',
      user
    }),
    { status: 200, headers }
  );
}