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
    SELECT * FROM users WHERE phone = ? OR username = ? OR email = ?
  `).bind(identifier, identifier, identifier).first();

  // Validate user existence and password
  if (!user || user.password_hash !== password) {
    return new Response(
      JSON.stringify({ error: 'Invalid credentials.' }),
      { status: 401, headers }
    );
  }

  // --- 1-WEEK TIME LIMIT CHECK FOR STUDENTS ---
  if (user.role === 'student') {
    
    // Explicitly check for terminated status first
    if (user.account_status === 'terminated') {
      return new Response(
        JSON.stringify({ error: 'Account terminated. Please contact administrator.' }),
        { status: 403, headers }
      );
    }

    // Only apply the 7-day expiration check if the student is still in 'pending_details' status
    if (user.account_status === 'pending_details' && user.registration_deadline) {
      const currentTime = new Date();
      const deadlineTime = new Date(user.registration_deadline);

      // Verify deadline is a valid date before comparing
      if (!isNaN(deadlineTime.getTime()) && currentTime > deadlineTime) {
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
    }
  }

  // Remove password before sending payload to client
  delete user.password_hash;

  // Return success response along with user object
  return new Response(
    JSON.stringify({
      message: 'Login successful',
      role: user.role, // 'admin' or 'student'
      user
    }),
    { status: 200, headers }
  );
}