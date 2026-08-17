import { handleRegister } from './script/register_backend.js';
import { handleLogin } from './script/login_backend.js';
import { handleAdminStats } from './script/adminpage_backend.js';
import { handleAdminDeadlineSettings } from './script/settings_backend.js';
import { handleAdminApplications } from './script/approval_backend.js';
import { handleStudentRoutes } from './script/studenthomepage_backend.js';
import { handleDashboardRoutes } from './script/dashboard_backend.js';

export default {
  // 1. Standard HTTP Request Router
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

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
      if (url.pathname === '/api/auth/register' && request.method === 'POST') {
        return await handleRegister(request, env, headers);
      }

      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        return await handleLogin(request, env, headers);
      }

      if (url.pathname === '/api/admin/stats' && request.method === 'GET') {
        return await handleAdminStats(env, headers);
      }

      if (url.pathname.startsWith('/api/admin/dashboard')) {
        return await handleDashboardRoutes(request, env, headers);
      }

      if (url.pathname === '/api/admin/settings/deadline') {
        return await handleAdminDeadlineSettings(request, env, headers);
      }

      if (url.pathname.startsWith('/api/admin/applications')) {
        return await handleAdminApplications(request, env, headers);
      }

      if (url.pathname.startsWith('/api/student')) {
        const studentResponse = await handleStudentRoutes(request, env, headers);
        if (studentResponse) return studentResponse;
      }

      return env.ASSETS.fetch(request);

    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Server Error', details: err.message }),
        { status: 500, headers }
      );
    }
  },

  // 2. Automated Background Cron Task Handler
  async scheduled(event, env, ctx) {
    const nowISO = new Date().toISOString();

    try {
      // Safely update only expired pending accounts to 'terminated'
      // Active accounts (status = 'active' or deadline IS NULL) are protected and ignored
      const result = await env.DB.prepare(`
        UPDATE users 
        SET account_status = 'terminated'
        WHERE account_status = 'pending_details'
          AND registration_deadline IS NOT NULL 
          AND registration_deadline <= ?
      `).bind(nowISO).run();

      console.log(`[Cron Job] Expired temporary accounts updated to terminated successfully.`);
    } catch (err) {
      console.error("[Cron Job Error]:", err.message);
    }
  }
};