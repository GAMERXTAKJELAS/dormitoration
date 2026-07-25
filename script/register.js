export async function handleRegister(request, env, headers) {
  const { full_name, phone, email, password } = await request.json();

  if (!full_name || !phone || !email || !password) {
    return new Response(
      JSON.stringify({ error: 'All fields (full_name, phone, email, password) are required.' }),
      { status: 400, headers }
    );
  }

  // Calculate deadline: Current time + 7 days
  const now = new Date();
  const deadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Insert into D1 database
  await env.DB.prepare(`
    INSERT INTO users (full_name, phone, email, password_hash, role, account_status, registration_deadline)
    VALUES (?, ?, ?, ?, 'student', 'pending_details', ?)
  `).bind(full_name, phone, email, password, deadline).run();

  return new Response(
    JSON.stringify({
      message: 'Registration successful! You have 1 week to complete your setup.',
      registration_deadline: deadline
    }),
    { status: 201, headers }
  );
}