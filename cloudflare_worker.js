import { handleRegister } from './script/register_backend.js';
import { handleLogin } from './script/login_backend.js';
import { handleAdminStats } from './script/adminpage_backend.js';
import { handleAdminDeadlineSettings } from './script/settings_backend.js';
import { handleAdminApplications } from './script/approval_backend.js';
import { handleStudentRoutes } from './script/studenthomepage_backend.js';
import { handleDashboardRoutes } from './script/dashboard_backend.js';
import { handleDetailInfoRoutes } from './script/detail_backend.js';
import { handleHardwareRoutes } from './script/hardware_backend.js';
import { handlePayslipRoutes } from './script/payslip_backend.js';
import { handleAccessVerify, handleDeviceHeartbeat } from './script/access_verify.js';

export default {
  // 1. Standard HTTP Request Router
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

      // ESP32 door unit: verifies a scanned QR access code (device-key protected)
      if (url.pathname === '/api/access/verify' && request.method === 'POST') {
        return await handleAccessVerify(request, env);
      }

      // ESP32 door unit: "I'm online" ping, auto-registers the room (device-key protected)
      if (url.pathname === '/api/access/heartbeat' && request.method === 'POST') {
        return await handleDeviceHeartbeat(request, env);
      }

      if (url.pathname.startsWith('/api/admin/applications')) {
        return await handleAdminApplications(request, env, headers);
      }

      if (url.pathname.startsWith('/api/hardware')) {
        const hardwareResponse = await handleHardwareRoutes(request, env, headers);
        if (hardwareResponse) return hardwareResponse;
      }

      if (
        url.pathname === '/api/student/upload-payslip' ||
        url.pathname === '/api/student/check-payslip' ||
        url.pathname === '/api/student/payslip' ||
        url.pathname === '/api/admin/payslip'
      ) {
        const payslipResponse = await handlePayslipRoutes(request, env, headers);
        if (payslipResponse) return payslipResponse;
      }

      // Handle Detail Information Routes (GET /api/student/details and POST /api/student/update-details)
      const detailInfoResponse = await handleDetailInfoRoutes(request, env, headers);
      if (detailInfoResponse) return detailInfoResponse;

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

    // Mark rooms offline once their ESP32 hasn't heartbeated for a while.
    // The heartbeat itself sets is_active back to 1 on reconnect, so this
    // only ever needs to turn it off, never on.
    try {
      const ROOM_OFFLINE_AFTER_SECONDS = 90;
      const cutoffISO = new Date(Date.now() - ROOM_OFFLINE_AFTER_SECONDS * 1000).toISOString();

      await env.DB.prepare(`
        UPDATE rooms
        SET is_active = 0
        WHERE is_active = 1
          AND (last_seen_at IS NULL OR last_seen_at < ?)
      `).bind(cutoffISO).run();

      console.log(`[Cron Job] Stale room hardware flagged offline.`);
    } catch (err) {
      console.error("[Cron Job Error - rooms offline sweep]:", err.message);
    }
  }
};