import { handleRegister } from './script/register_backend.js';
import { handleLogin } from './script/login_backend.js';
import { handleAdminStats } from './script/adminpage_backend.js';
import { handleAdminDeadlineSettings } from './script/settings_backend.js';
import { handleAdminApplications } from './script/approval_backend.js';
import { handleStudentRoutes } from './script/studenthomepage_backend.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Standard CORS headers (ADDED 'DELETE' to Access-Control-Allow-Methods)
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

      // Route to admin stats script
      if (url.pathname === '/api/admin/stats' && request.method === 'GET') {
        return await handleAdminStats(env, headers);
      }

      // Route to settings backend (Handles GET and POST)
      if (url.pathname === '/api/admin/settings/deadline') {
        return await handleAdminDeadlineSettings(request, env, headers);
      }

      // Route to approval applications backend (Handles GET and PATCH)
      if (url.pathname.startsWith('/api/admin/applications')) {
        return await handleAdminApplications(request, env, headers);
      }

      // -----------------------------------------------------------------
      // ADDED: Route to Student Portal backend (/api/student/*)
      // -----------------------------------------------------------------
      if (url.pathname.startsWith('/api/student')) {
        const studentResponse = await handleStudentRoutes(request, env, headers);
        if (studentResponse) return studentResponse;
      }

      // Serve static frontend assets
      return env.ASSETS.fetch(request);

    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Server Error', details: err.message }),
        { status: 500, headers }
      );
    }
  }
};