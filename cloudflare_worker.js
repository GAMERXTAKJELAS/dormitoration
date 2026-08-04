import { handleRegister } from './script/register.js';
import { handleLogin } from './script/login.js';
import { handleAdminStats } from './script/adminpage.js'; // Adjust path if needed

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Standard CORS headers
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    try {
      // Route to registration script
      if (url.pathname === '/api/auth/register' && request.method === 'POST') {
        return await handleRegister(request, env, headers);
      }

      // Route to login script
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        return await handleLogin(request, env, headers);
      }

      // Route to admin stats script (GET request for live D1 count)
      if (url.pathname === '/api/admin/stats' && request.method === 'GET') {
        return await handleAdminStats(env, headers);
      }

      // Serve static frontend assets (index.html, etc.)
      return env.ASSETS.fetch(request);

    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Server Error', details: err.message }),
        { status: 500, headers }
      );
    }
  }
};