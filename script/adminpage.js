export async function handleAdminStats(env, headers) {
  try {
    // Queries D1 directly for pending hostel applications
    const result = await env.DB.prepare(
      `SELECT COUNT(*) as pending_count FROM hostel_applications WHERE submission_status = 'pending' OR admin_approval = 'pending'`
    ).first();

    return new Response(
      JSON.stringify({ 
        pending_count: result?.pending_count || 0 
      }), 
      { status: 200, headers }
    );
  } catch (err) {
    console.error("D1 Stats Error:", err);
    return new Response(
      JSON.stringify({ pending_count: 0 }), 
      { status: 200, headers }
    );
  }
}