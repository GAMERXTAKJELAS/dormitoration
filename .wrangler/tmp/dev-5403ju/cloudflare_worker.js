var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// script/register_backend.js
async function handleRegister(request, env, headers) {
  try {
    const body = await request.json();
    const {
      ic_number,
      matriks_number,
      full_name,
      email,
      phone,
      password,
      tarikh_lahir,
      umur,
      jantina,
      negeri,
      role
    } = body;
    if (!phone && !email) {
      return new Response(
        JSON.stringify({ error: "No. Telefon atau e-mel diperlukan." }),
        { status: 400, headers }
      );
    }
    if (!password) {
      return new Response(
        JSON.stringify({ error: "Kata laluan diperlukan." }),
        { status: 400, headers }
      );
    }
    const nowISO = (/* @__PURE__ */ new Date()).toISOString();
    const existingUser = await env.DB.prepare(`
      SELECT id, account_status, registration_deadline 
      FROM users 
      WHERE (phone = ? AND phone IS NOT NULL) 
         OR (email = ? AND email IS NOT NULL)
      LIMIT 1
    `).bind(phone || null, email || null).first();
    if (existingUser) {
      const isTerminated = existingUser.account_status === "terminated";
      const isExpired = existingUser.registration_deadline && existingUser.registration_deadline <= nowISO;
      if (isTerminated || isExpired) {
        await env.DB.prepare(`UPDATE hostel_applications SET user_id = NULL WHERE user_id = ?`).bind(existingUser.id).run();
        await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(existingUser.id).run();
      } else {
        return new Response(
          JSON.stringify({ error: "Akaun dengan No. Telefon atau e-mel ini telah wujud dan aktif." }),
          { status: 409, headers }
        );
      }
    }
    const valSetting = await env.DB.prepare(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'temp_account_deadline_value'`
    ).first();
    const unitSetting = await env.DB.prepare(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'temp_account_deadline_unit'`
    ).first();
    const durationVal = valSetting ? parseInt(valSetting.setting_value, 10) : 7;
    const durationUnit = unitSetting ? unitSetting.setting_value : "days";
    const deadlineDate = /* @__PURE__ */ new Date();
    if (durationUnit === "hours") {
      deadlineDate.setHours(deadlineDate.getHours() + durationVal);
    } else if (durationUnit === "months") {
      deadlineDate.setMonth(deadlineDate.getMonth() + durationVal);
    } else {
      deadlineDate.setDate(deadlineDate.getDate() + durationVal);
    }
    const registrationDeadline = deadlineDate.toISOString();
    const userResult = await env.DB.prepare(`
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
      ) VALUES (
        NULL, ?, ?, ?, ?, ?, 'pending_details', ?, CURRENT_TIMESTAMP
      )
    `).bind(
      phone || null,
      full_name || null,
      email || null,
      password,
      role || "student",
      registrationDeadline
    ).run();
    const newUserId = userResult.meta?.last_row_id;
    if (newUserId && ic_number) {
      const now = /* @__PURE__ */ new Date();
      const month = now.getMonth() + 1;
      const yearShort = now.getFullYear().toString().slice(-2);
      const currentSession = month >= 1 && month <= 6 ? `JJ${yearShort}` : `JD${yearShort}`;
      const existingApp = await env.DB.prepare(
        `SELECT id, submission_status FROM hostel_applications WHERE ic_number = ? LIMIT 1`
      ).bind(ic_number).first();
      if (existingApp) {
        await env.DB.prepare(`
          UPDATE hostel_applications 
          SET user_id = ?,
              dob = COALESCE(NULLIF(?, ''), dob),
              age = COALESCE(?, age),
              gender = COALESCE(NULLIF(?, ''), gender),
              admin_approval = 'pending',
              appeal_reason = NULL
          WHERE ic_number = ?
        `).bind(
          newUserId,
          tarikh_lahir || null,
          umur || null,
          jantina || null,
          ic_number
        ).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO hostel_applications (
            user_id,
            session_id,
            ic_number,
            dob,
            age,
            gender,
            submission_status,
            head_of_program_support,
            admin_approval
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            'draft',
            'pending',
            'pending'
          )
        `).bind(
          newUserId,
          currentSession,
          ic_number,
          tarikh_lahir || null,
          umur || null,
          jantina || null
        ).run();
      }
    }
    const createdUser = {
      id: newUserId,
      username: null,
      full_name: full_name || null,
      email: email || null,
      phone: phone || null,
      ic_number: ic_number || null,
      matriks_number: matriks_number || null,
      tarikh_lahir: tarikh_lahir || null,
      umur: umur || null,
      jantina: jantina || null,
      negeri: negeri || null,
      role: role || "student",
      account_status: "pending_details",
      admin_approval: "pending",
      registration_deadline: registrationDeadline
    };
    return new Response(
      JSON.stringify({
        success: true,
        message: "Akaun baru berjaya didaftarkan dan dikemaskini!",
        user: createdUser
      }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error("D1 Register Error:", err);
    return new Response(
      JSON.stringify({
        error: "Ralat pelayan semasa mendaftar.",
        details: err.message
      }),
      { status: 500, headers }
    );
  }
}
__name(handleRegister, "handleRegister");

// script/login_backend.js
async function handleLogin(request, env, headers) {
  const { identifier, password } = await request.json();
  if (!identifier || !password) {
    return new Response(
      JSON.stringify({ error: "Missing phone/username or password." }),
      { status: 400, headers }
    );
  }
  const user = await env.DB.prepare(`
    SELECT * FROM users WHERE phone = ? OR username = ? OR email = ?
  `).bind(identifier, identifier, identifier).first();
  if (!user || user.password_hash !== password) {
    return new Response(
      JSON.stringify({ error: "Invalid credentials." }),
      { status: 401, headers }
    );
  }
  if (user.role === "student") {
    if (user.account_status === "terminated") {
      return new Response(
        JSON.stringify({ error: "Account terminated. Please contact administrator." }),
        { status: 403, headers }
      );
    }
    if (user.account_status === "pending_details" && user.registration_deadline) {
      const currentTime = /* @__PURE__ */ new Date();
      const deadlineTime = new Date(user.registration_deadline);
      if (!isNaN(deadlineTime.getTime()) && currentTime > deadlineTime) {
        await env.DB.prepare(`
          UPDATE users SET account_status = 'terminated' WHERE id = ?
        `).bind(user.id).run();
        return new Response(
          JSON.stringify({
            error: "Account terminated. Your registration window has expired."
          }),
          { status: 403, headers }
        );
      }
    }
  }
  delete user.password_hash;
  return new Response(
    JSON.stringify({
      message: "Login successful",
      role: user.role,
      // 'admin' or 'student'
      user
    }),
    { status: 200, headers }
  );
}
__name(handleLogin, "handleLogin");

// script/adminpage_backend.js
async function handleAdminStats(env, headers) {
  try {
    const pendingRes = await env.DB.prepare(
      `SELECT COUNT(*) as pending_count 
       FROM hostel_applications 
       WHERE submission_status = 'pending' OR admin_approval = 'pending'`
    ).first();
    const activeRes = await env.DB.prepare(
      `SELECT COUNT(*) as occupied_count 
       FROM hostel_applications 
       WHERE admin_approval = 'approved' OR submission_status = 'approved'`
    ).first();
    const totalCapacity = 600;
    const occupied = activeRes?.occupied_count || 0;
    const occupancyPercentage = Math.round(occupied / totalCapacity * 100);
    return new Response(
      JSON.stringify({
        success: true,
        pending_count: pendingRes?.pending_count || 0,
        occupancy: {
          occupied,
          total: totalCapacity,
          percentage: occupancyPercentage
        },
        locks_status: "Offline"
        // Hardware integration status
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("D1 Admin Stats Error:", err);
    return new Response(
      JSON.stringify({
        pending_count: 0,
        occupancy: { occupied: 0, total: 600, percentage: 0 },
        locks_status: "Offline"
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }
}
__name(handleAdminStats, "handleAdminStats");

// script/settings_backend.js
async function handleAdminDeadlineSettings(request, env, headers) {
  const method = request.method;
  if (method === "GET") {
    try {
      const valResult = await env.DB.prepare(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'temp_account_deadline_value'`
      ).first();
      const unitResult = await env.DB.prepare(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'temp_account_deadline_unit'`
      ).first();
      return new Response(
        JSON.stringify({
          value: valResult ? parseInt(valResult.setting_value, 10) : 7,
          unit: unitResult ? unitResult.setting_value : "days"
        }),
        { status: 200, headers }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ value: 7, unit: "days", error: err.message }),
        { status: 200, headers }
      );
    }
  }
  if (method === "POST") {
    try {
      const { value, unit } = await request.json();
      if (!value || isNaN(value) || value < 1) {
        return new Response(
          JSON.stringify({ error: "Sila masukkan tempoh masa yang sah." }),
          { status: 400, headers }
        );
      }
      await env.DB.prepare(`
        INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at)
        VALUES ('temp_account_deadline_value', ?, CURRENT_TIMESTAMP)
      `).bind(value.toString()).run();
      await env.DB.prepare(`
        INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at)
        VALUES ('temp_account_deadline_unit', ?, CURRENT_TIMESTAMP)
      `).bind(unit.toString()).run();
      return new Response(
        JSON.stringify({ message: "Setting saved successfully!" }),
        { status: 200, headers }
      );
    } catch (err) {
      console.error("Settings DB Error:", err);
      return new Response(
        JSON.stringify({ error: "Database save failed", details: err.message }),
        { status: 500, headers }
      );
    }
  }
}
__name(handleAdminDeadlineSettings, "handleAdminDeadlineSettings");

// script/access_code_utils.js
function isAccessCodeExpired(assignedAtRaw, validityMonths = 6) {
  if (!assignedAtRaw) return false;
  const assigned = new Date(String(assignedAtRaw).replace(" ", "T"));
  if (isNaN(assigned.getTime())) return false;
  const expiry = new Date(assigned);
  expiry.setMonth(expiry.getMonth() + validityMonths);
  return /* @__PURE__ */ new Date() >= expiry;
}
__name(isAccessCodeExpired, "isAccessCodeExpired");

// script/approval_backend.js
function parseMalaysianIC(icRaw) {
  if (!icRaw) return null;
  let icStr = String(icRaw).trim();
  if (/e\+/i.test(icStr)) {
    icStr = Number(icStr).toFixed(0);
  }
  let ic = icStr.replace(/[^0-9]/g, "");
  if (ic.length === 11) {
    ic = "0" + ic;
  }
  if (ic.length !== 12) return null;
  const yy = ic.substring(0, 2);
  const mm = ic.substring(2, 4);
  const dd = ic.substring(4, 6);
  const pb = ic.substring(6, 8);
  const lastDigit = parseInt(ic.substring(11, 12), 10);
  const currentYearShort = (/* @__PURE__ */ new Date()).getFullYear() % 100;
  const fullYear = parseInt(yy, 10) > currentYearShort ? `19${yy}` : `20${yy}`;
  const dob = `${fullYear}-${mm}-${dd}`;
  const birthDate = /* @__PURE__ */ new Date(`${fullYear}-${mm}-${dd}`);
  const today = /* @__PURE__ */ new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || monthDiff === 0 && today.getDate() < birthDate.getDate()) {
    age--;
  }
  const gender = lastDigit % 2 !== 0 ? "Lelaki" : "Perempuan";
  return {
    dob,
    age,
    gender,
    formattedIC: `${yy}${mm}${dd}-${pb}-${ic.substring(8)}`,
    rawIC: ic
  };
}
__name(parseMalaysianIC, "parseMalaysianIC");
async function handleAdminApplications(request, env, headers) {
  const url = new URL(request.url);
  const method = request.method;
  if (method === "GET" && url.pathname === "/api/admin/applications") {
    try {
      const query = `
        SELECT 
          u.id AS user_id,
          h.id AS application_id,
          u.full_name AS full_name,
          u.email AS email,
          u.phone AS phone,
          u.profile_picture AS profile_picture,
          COALESCE(NULLIF(h.ic_number, ''), '-') AS ic_number,
          COALESCE(NULLIF(h.gender, ''), '-') AS gender,
          COALESCE(NULLIF(h.dob, ''), '-') AS dob,
          COALESCE(NULLIF(h.age, ''), '-') AS age,
          u.role AS role,
          COALESCE(NULLIF(h.program, ''), 'Pending Fill') AS program,
          COALESCE(NULLIF(h.session_id, ''), '-') AS session_id,
          COALESCE(NULLIF(h.admin_approval, ''), 'pending') AS status,
          COALESCE(NULLIF(h.submission_status, ''), 'draft') AS submission_status,
          u.account_status AS user_account_status
        FROM users u
        LEFT JOIN hostel_applications h ON u.id = h.user_id
        WHERE u.role != 'admin' OR u.role IS NULL
        ORDER BY h.id DESC
      `;
      const { results } = await env.DB.prepare(query).all();
      return new Response(JSON.stringify({ success: true, data: results || [] }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("GET Applications Error:", err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" }
      });
    }
  }
  if (method === "PATCH" && url.pathname === "/api/admin/applications/status") {
    try {
      const body = await request.json();
      const { user_id, status } = body;
      if (!user_id || !status) {
        return new Response(
          JSON.stringify({ error: "user_id and status are required." }),
          { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
        );
      }
      let targetAccountStatus = "pending_details";
      let qrWarning = null;
      if (status === "approved") {
        targetAccountStatus = "active";
        await env.DB.prepare(`
          UPDATE users 
          SET account_status = 'active',
              registration_deadline = NULL 
          WHERE id = ?
        `).bind(user_id).run();
        try {
          const existingRfid = await env.DB.prepare(
            `SELECT id, qr_access_code, assigned_at FROM student_rfid WHERE user_id = ? LIMIT 1`
          ).bind(user_id).first();
          const nowISO = (/* @__PURE__ */ new Date()).toISOString();
          if (!existingRfid) {
            const qrCode = crypto.randomUUID();
            await env.DB.prepare(`
              INSERT INTO student_rfid (user_id, matriks_number, rfid_card_uid, qr_access_code, assigned_at)
              VALUES (?, ?, ?, ?, ?)
            `).bind(user_id, "", "", qrCode, nowISO).run();
          } else if (!existingRfid.qr_access_code || isAccessCodeExpired(existingRfid.assigned_at)) {
            const qrCode = crypto.randomUUID();
            await env.DB.prepare(`
              UPDATE student_rfid SET qr_access_code = ?, assigned_at = ? WHERE id = ?
            `).bind(qrCode, nowISO, existingRfid.id).run();
          }
        } catch (rfidErr) {
          console.error("QR Access Code Issuance Error:", rfidErr.message);
          qrWarning = rfidErr.message;
        }
      } else {
        targetAccountStatus = "pending_details";
        await env.DB.prepare(`
          UPDATE users 
          SET account_status = 'pending_details' 
          WHERE id = ?
        `).bind(user_id).run();
      }
      const existingApp = await env.DB.prepare(
        `SELECT id FROM hostel_applications WHERE user_id = ? LIMIT 1`
      ).bind(user_id).first();
      if (existingApp) {
        await env.DB.prepare(`
          UPDATE hostel_applications 
          SET admin_approval = ?
          WHERE user_id = ?
        `).bind(status, user_id).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO hostel_applications (user_id, admin_approval, submission_status)
          VALUES (?, ?, 'draft')
        `).bind(user_id, status).run();
      }
      return new Response(
        JSON.stringify({
          success: true,
          message: "Status updated successfully!",
          account_status: targetAccountStatus,
          qrWarning
        }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("Update Approval Status DB Error:", err);
      return new Response(
        JSON.stringify({ error: "Database update failed", details: err.message }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
  }
  if (method === "POST" && url.pathname === "/api/admin/applications/import-csv") {
    try {
      const body = await request.json();
      const { students } = body;
      if (!Array.isArray(students) || students.length === 0) {
        return new Response(
          JSON.stringify({ error: "No student data provided in request" }),
          { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
        );
      }
      const validStudents = students.filter((s) => s && s.email);
      if (validStudents.length === 0) {
        return new Response(
          JSON.stringify({ error: "No valid student rows with email addresses found" }),
          { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
        );
      }
      for (const s of validStudents) {
        const fullName = s.full_name || s.name || s.nama || "";
        const phone = s.phone || s.telefon || s.no_hp || "";
        const randomPass = "TVET-" + crypto.randomUUID().slice(0, 8);
        const rawIC = s.ic_number || s.ic || s.mykad || s.no_kp || s.nokp || "";
        const icParsed = parseMalaysianIC(rawIC);
        const icNumber = icParsed ? icParsed.rawIC : rawIC ? String(rawIC).replace(/[^0-9]/g, "") : "-";
        const dob = icParsed && icParsed.dob ? icParsed.dob : s.dob || null;
        const age = icParsed && icParsed.age ? icParsed.age : s.age || null;
        const gender = icParsed && icParsed.gender ? icParsed.gender : s.gender || null;
        const existingUser = await env.DB.prepare(
          `SELECT id FROM users WHERE email = ? LIMIT 1`
        ).bind(s.email).first();
        let userId;
        if (existingUser) {
          userId = existingUser.id;
          await env.DB.prepare(`
            UPDATE users 
            SET full_name = COALESCE(NULLIF(?, ''), full_name), 
                phone = COALESCE(NULLIF(?, ''), phone) 
            WHERE id = ?
          `).bind(fullName, phone, userId).run();
        } else {
          await env.DB.prepare(`
            INSERT INTO users (full_name, email, phone, role, password_hash, account_status)
            VALUES (?, ?, ?, 'student', ?, 'pending_details')
          `).bind(fullName, s.email, phone, randomPass).run();
          const newRecord = await env.DB.prepare(
            `SELECT id FROM users WHERE email = ? LIMIT 1`
          ).bind(s.email).first();
          userId = newRecord?.id;
        }
        if (userId) {
          const program = s.program || s.kursus || "Pending Fill";
          const session = s.session || s.session_id || s.sesi || "-";
          const existingApp = await env.DB.prepare(
            `SELECT id FROM hostel_applications WHERE user_id = ? LIMIT 1`
          ).bind(userId).first();
          if (existingApp) {
            await env.DB.prepare(`
              UPDATE hostel_applications 
              SET ic_number = CASE WHEN ? IS NOT NULL AND ? != '-' THEN ? ELSE ic_number END, 
                  program = COALESCE(NULLIF(?, 'Pending Fill'), program), 
                  session_id = COALESCE(NULLIF(?, '-'), session_id),
                  gender = COALESCE(?, gender),
                  dob = COALESCE(?, dob),
                  age = COALESCE(?, age)
              WHERE user_id = ?
            `).bind(icNumber, icNumber, icNumber, program, session, gender, dob, age, userId).run();
          } else {
            await env.DB.prepare(`
              INSERT INTO hostel_applications 
                (user_id, ic_number, program, session_id, gender, dob, age, admin_approval, submission_status)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'draft')
            `).bind(userId, icNumber, program, session, gender, dob, age).run();
          }
        }
      }
      return new Response(
        JSON.stringify({
          success: true,
          insertedCount: validStudents.length
        }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("CSV Import DB Error:", err);
      return new Response(
        JSON.stringify({ error: "Failed to import CSV batch", details: err.message }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
  }
  return new Response(JSON.stringify({ error: "Route not found" }), { status: 404, headers });
}
__name(handleAdminApplications, "handleAdminApplications");

// script/studenthomepage_backend.js
async function handleStudentRoutes(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;
  if (method === "GET" && url.pathname === "/api/student/status") {
    const userId = url.searchParams.get("user_id");
    if (!userId) {
      return new Response(JSON.stringify({ error: "User ID is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    try {
      const userQuery = env.DB.prepare(`
        SELECT 
          u.id AS user_id,
          u.username,
          u.email,
          u.phone,
          u.created_at,
          u.registration_deadline,
          u.account_status,
          ha.gender AS gender,
          ha.admin_approval AS admin_approval,
          ha.submission_status AS submission_status,
          ha.appeal_reason AS appeal_reason
        FROM users u
        LEFT JOIN hostel_applications ha ON u.id = ha.user_id
        WHERE u.id = ?
        ORDER BY ha.id DESC 
        LIMIT 1
      `).bind(userId);
      const settingsQuery = env.DB.prepare(`
        SELECT setting_key, setting_value 
        FROM system_settings 
        WHERE setting_key IN ('temp_account_deadline_value', 'temp_account_deadline_unit')
      `);
      const [data, settingsResult] = await Promise.all([
        userQuery.first(),
        settingsQuery.all()
      ]);
      if (!data) {
        return new Response(JSON.stringify({ status: "pending", user: null, reason: null }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const settings = {};
      if (settingsResult && settingsResult.results) {
        settingsResult.results.forEach((row) => {
          settings[row.setting_key] = row.setting_value;
        });
      }
      const durationValue = parseFloat(settings["temp_account_deadline_value"]) || 24;
      const durationUnit = String(settings["temp_account_deadline_unit"] || "hours").toLowerCase().trim();
      let rawStatus = (data.admin_approval || data.account_status || "pending").toLowerCase().trim();
      let normalizedStatus = "pending";
      if (["approved", "active", "success"].includes(rawStatus)) {
        normalizedStatus = "approved";
      } else if (["returned", "rejected", "fail", "declined"].includes(rawStatus)) {
        normalizedStatus = "returned";
      } else {
        normalizedStatus = "pending";
      }
      let calculatedDeadline = data.registration_deadline;
      if (normalizedStatus === "approved") {
        calculatedDeadline = null;
      } else if (!calculatedDeadline && data.created_at) {
        const createdMs = new Date(data.created_at.replace(" ", "T")).getTime();
        if (!isNaN(createdMs)) {
          let multiplier = 60 * 60 * 1e3;
          if (durationUnit.startsWith("day")) {
            multiplier = 24 * 60 * 60 * 1e3;
          } else if (durationUnit.startsWith("min")) {
            multiplier = 60 * 1e3;
          }
          const calculatedTime = new Date(createdMs + durationValue * multiplier);
          calculatedDeadline = calculatedTime.toISOString();
        }
      }
      return new Response(JSON.stringify({
        status: normalizedStatus,
        reason: data.appeal_reason || null,
        user: {
          id: data.user_id,
          username: data.username || "N/A",
          email: data.email || "N/A",
          phone: data.phone || "N/A",
          gender: data.gender || "",
          created_at: data.created_at || null,
          registration_deadline: calculatedDeadline || null
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("D1 Query Error:", err.message);
      return new Response(JSON.stringify({ error: "Failed to query status", details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
  if (method === "POST" && url.pathname === "/api/student/delete-account") {
    try {
      const { user_id } = await request.json();
      if (!user_id) {
        return new Response(JSON.stringify({ error: "User ID is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const deleteResult = await env.DB.prepare(`
        DELETE FROM users WHERE id = ?
      `).bind(user_id).run();
      if (deleteResult.success) {
        return new Response(JSON.stringify({ message: "Account deleted successfully" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } else {
        throw new Error("Database deletion execution failed.");
      }
    } catch (err) {
      console.error("Delete Account Error:", err.message);
      return new Response(JSON.stringify({ error: "Failed to delete account", details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
  if (method === "POST" && url.pathname === "/api/student/update-account") {
    try {
      const { user_id, username, email, phone } = await request.json();
      if (!user_id) {
        return new Response(JSON.stringify({ error: "User ID is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (!email || !phone) {
        return new Response(JSON.stringify({ error: "Email and phone number cannot be empty." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      await env.DB.prepare(`
        UPDATE users 
        SET username = ?, email = ?, phone = ?, updated_at = ?
        WHERE id = ?
      `).bind(username || null, email, phone, (/* @__PURE__ */ new Date()).toISOString(), user_id).run();
      return new Response(JSON.stringify({ success: true, message: "Account updated successfully" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("Update Account Error:", err.message);
      const isDuplicate = /unique/i.test(err.message);
      const friendlyMessage = isDuplicate ? "That username or email is already in use by another account." : "Failed to update account";
      return new Response(JSON.stringify({ error: friendlyMessage, details: err.message }), {
        status: isDuplicate ? 409 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
  if (method === "GET" && url.pathname === "/api/student/qr-code") {
    const userId = url.searchParams.get("user_id");
    if (!userId) {
      return new Response(JSON.stringify({ error: "User ID is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    try {
      const row = await env.DB.prepare(
        `SELECT qr_access_code, assigned_at FROM student_rfid WHERE user_id = ? LIMIT 1`
      ).bind(userId).first();
      const expired = row ? isAccessCodeExpired(row.assigned_at) : false;
      return new Response(JSON.stringify({
        code: row && !expired ? row.qr_access_code : null,
        expired
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } catch (err) {
      console.error("QR Code Fetch Error:", err.message);
      return new Response(JSON.stringify({ error: "Failed to fetch QR code", details: err.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
  return null;
}
__name(handleStudentRoutes, "handleStudentRoutes");

// script/dashboard_backend.js
async function handleDashboardRoutes(request, env, headers) {
  const url = new URL(request.url);
  const method = request.method;
  if (method === "GET" && url.pathname === "/api/admin/dashboard/stats") {
    try {
      const activeRes = await env.DB.prepare(
        `SELECT COUNT(*) AS total_active FROM users WHERE role = 'student' AND account_status = 'active'`
      ).first();
      const pendingRes = await env.DB.prepare(
        `SELECT COUNT(*) AS total_pending FROM hostel_applications WHERE admin_approval = 'pending'`
      ).first();
      return new Response(
        JSON.stringify({
          success: true,
          stats: {
            active_students: activeRes?.total_active || 0,
            pending_applications: pendingRes?.total_pending || 0,
            room_occupancy: 0
            // Hardware offline
          }
        }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("Dashboard Stats Error:", err);
      return new Response(
        JSON.stringify({ error: "Failed to fetch dashboard stats", details: err.message }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
  }
  if (method === "GET" && url.pathname === "/api/admin/dashboard/active-students") {
    try {
      const query = `
        SELECT 
          u.id AS user_id,
          u.full_name,
          u.email,
          u.phone,
          COALESCE(u.profile_picture, NULL) AS profile_picture,
          COALESCE(u.username, '-') AS matric_number,
          COALESCE(h.ic_number, '-') AS ic_number,
          COALESCE(h.gender, '-') AS gender, -- <--- ADDED GENDER FIELD
          COALESCE(h.program, 'Pending Fill') AS program,
          COALESCE(h.session_id, '-') AS session_id,
          h.id AS application_id
        FROM users u
        LEFT JOIN hostel_applications h ON u.id = h.user_id
        WHERE u.role = 'student' AND u.account_status = 'active'
        ORDER BY u.id DESC
      `;
      const { results } = await env.DB.prepare(query).all();
      return new Response(
        JSON.stringify({ success: true, students: results || [] }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("Dashboard Active Students Error:", err);
      return new Response(
        JSON.stringify({ error: "Failed to fetch active students", details: err.message }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
  }
  return new Response(JSON.stringify({ error: "Route not found" }), {
    status: 404,
    headers: { ...headers, "Content-Type": "application/json" }
  });
}
__name(handleDashboardRoutes, "handleDashboardRoutes");

// script/detail_backend.js
async function handleDetailInfoRoutes(request, env, headers) {
  const url = new URL(request.url);
  if (url.pathname === "/api/student/details" && request.method === "GET") {
    try {
      const userId = url.searchParams.get("user_id");
      if (!userId) {
        return new Response(JSON.stringify({ error: "Unauthorized: Missing user_id" }), {
          status: 401,
          headers
        });
      }
      const row = await env.DB.prepare(`
                SELECT ha.*, u.full_name, u.phone
                FROM hostel_applications ha
                JOIN users u ON u.id = ha.user_id
                WHERE ha.user_id = ?
                LIMIT 1
            `).bind(userId).first();
      if (!row) {
        return new Response(JSON.stringify({}), { status: 200, headers });
      }
      let parsedContributions = { isMpp: "No", items: [], gpa: "" };
      try {
        if (row.contributions) parsedContributions = { ...parsedContributions, ...JSON.parse(row.contributions) };
      } catch (e) {
      }
      const studentDetails = {
        user_id: row.user_id,
        namaPelajar: row.full_name,
        noIC: row.ic_number,
        tarikhLahir: row.dob,
        umur: row.age,
        jantina: row.gender,
        noTel: row.phone,
        alamatRumah: row.home_address,
        poskod: row.postcode,
        bandar: row.city,
        negeri: row.state,
        sebabMemohon: row.reason_for_apply,
        program: row.program,
        semester: row.semester,
        gpa: parsedContributions.gpa || "",
        cgpa: row.gpa_cgpa,
        isMpp: parsedContributions.isMpp || "No",
        sumbangan: parsedContributions.items || [],
        familyMode: row.guardian2_name ? "parents" : "guardians",
        penjaga1: row.guardian1_name ? {
          nama: row.guardian1_name,
          ic: row.guardian1_ic,
          tel: row.guardian1_phone,
          hubungan: row.guardian1_relationship,
          pekerjaan: row.guardian1_job,
          pendapatan: row.guardian1_income
        } : null,
        penjaga2: row.guardian2_name ? {
          nama: row.guardian2_name,
          ic: row.guardian2_ic,
          tel: row.guardian2_phone,
          hubungan: row.guardian2_relationship,
          pekerjaan: row.guardian2_job,
          pendapatan: row.guardian2_income
        } : null,
        tanggunganAnak: row.dependents_count,
        accountStatus: row.submission_status || "draft"
      };
      return new Response(JSON.stringify(studentDetails), { status: 200, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }
  if (url.pathname === "/api/student/update-details" && request.method === "POST") {
    try {
      const body = await request.json();
      if (!body.user_id) {
        return new Response(JSON.stringify({ error: "Missing user_id" }), { status: 400, headers });
      }
      const sem = parseInt(body.semester, 10);
      if (isNaN(sem) || sem < 2 || sem > 6) {
        return new Response(
          JSON.stringify({ error: "Hostel application is only available for intake Semesters 2 to 6." }),
          { status: 400, headers }
        );
      }
      const contributionsBlob = JSON.stringify({
        isMpp: body.isMpp || "No",
        items: body.sumbangan || [],
        gpa: body.gpa || ""
      });
      const penjaga1 = body.penjaga1 || {};
      const penjaga2 = body.penjaga2 || null;
      const nowISO = (/* @__PURE__ */ new Date()).toISOString();
      await env.DB.prepare(`
                UPDATE users SET full_name = ?, phone = ? WHERE id = ?
            `).bind(body.namaPelajar || null, body.noTel || null, body.user_id).run();
      const existing = await env.DB.prepare(
        `SELECT id FROM hostel_applications WHERE user_id = ? LIMIT 1`
      ).bind(body.user_id).first();
      if (existing) {
        await env.DB.prepare(`
                    UPDATE hostel_applications SET
                        ic_number = ?, dob = ?, age = ?, gender = ?,
                        home_address = ?, postcode = ?, city = ?, state = ?,
                        reason_for_apply = ?, program = ?, semester = ?, gpa_cgpa = ?,
                        contributions = ?,
                        guardian1_name = ?, guardian1_ic = ?, guardian1_phone = ?,
                        guardian1_relationship = ?, guardian1_job = ?, guardian1_income = ?,
                        guardian2_name = ?, guardian2_ic = ?, guardian2_phone = ?,
                        guardian2_relationship = ?, guardian2_job = ?, guardian2_income = ?,
                        dependents_count = ?, submission_status = 'submitted', submitted_at = ?
                    WHERE user_id = ?
                `).bind(
          body.noIC || null,
          body.tarikhLahir || null,
          body.umur || null,
          body.jantina || null,
          body.alamatRumah || null,
          body.poskod || null,
          body.bandar || null,
          body.negeri || null,
          body.sebabMemohon || null,
          body.program || null,
          sem,
          body.cgpa || null,
          contributionsBlob,
          penjaga1.nama || null,
          penjaga1.ic || null,
          penjaga1.tel || null,
          penjaga1.hubungan || null,
          penjaga1.pekerjaan || null,
          penjaga1.pendapatan || null,
          penjaga2 ? penjaga2.nama : null,
          penjaga2 ? penjaga2.ic : null,
          penjaga2 ? penjaga2.tel : null,
          penjaga2 ? penjaga2.hubungan : null,
          penjaga2 ? penjaga2.pekerjaan : null,
          penjaga2 ? penjaga2.pendapatan : null,
          body.tanggunganAnak || 0,
          nowISO,
          body.user_id
        ).run();
      } else {
        await env.DB.prepare(`
                    INSERT INTO hostel_applications (
                        user_id, ic_number, dob, age, gender,
                        home_address, postcode, city, state,
                        reason_for_apply, program, semester, gpa_cgpa, contributions,
                        guardian1_name, guardian1_ic, guardian1_phone, guardian1_relationship, guardian1_job, guardian1_income,
                        guardian2_name, guardian2_ic, guardian2_phone, guardian2_relationship, guardian2_job, guardian2_income,
                        dependents_count, submission_status, admin_approval, created_at, submitted_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', 'pending', ?, ?)
                `).bind(
          body.user_id,
          body.noIC || null,
          body.tarikhLahir || null,
          body.umur || null,
          body.jantina || null,
          body.alamatRumah || null,
          body.poskod || null,
          body.bandar || null,
          body.negeri || null,
          body.sebabMemohon || null,
          body.program || null,
          sem,
          body.cgpa || null,
          contributionsBlob,
          penjaga1.nama || null,
          penjaga1.ic || null,
          penjaga1.tel || null,
          penjaga1.hubungan || null,
          penjaga1.pekerjaan || null,
          penjaga1.pendapatan || null,
          penjaga2 ? penjaga2.nama : null,
          penjaga2 ? penjaga2.ic : null,
          penjaga2 ? penjaga2.tel : null,
          penjaga2 ? penjaga2.hubungan : null,
          penjaga2 ? penjaga2.pekerjaan : null,
          penjaga2 ? penjaga2.pendapatan : null,
          body.tanggunganAnak || 0,
          nowISO,
          nowISO
        ).run();
      }
      return new Response(
        JSON.stringify({ message: "Profile updated successfully." }),
        { status: 200, headers }
      );
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }
  return null;
}
__name(handleDetailInfoRoutes, "handleDetailInfoRoutes");

// script/hardware_backend.js
async function handleHardwareRoutes(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;
  if (method !== "POST" || url.pathname !== "/api/hardware/verify-access") {
    return null;
  }
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ access: false, reason: "invalid_json" }), {
      status: 400,
      headers: jsonHeaders
    });
  }
  const { block_name, room_number, method: verifyMethod, value, device_key } = body;
  if (!env.HARDWARE_DEVICE_KEY || device_key !== env.HARDWARE_DEVICE_KEY) {
    return new Response(JSON.stringify({ access: false, reason: "unauthorized_device" }), {
      status: 401,
      headers: jsonHeaders
    });
  }
  if (!block_name || !room_number || !verifyMethod || !value) {
    return new Response(JSON.stringify({ access: false, reason: "missing_fields" }), {
      status: 400,
      headers: jsonHeaders
    });
  }
  const nowISO = (/* @__PURE__ */ new Date()).toISOString();
  try {
    let room = await env.DB.prepare(
      `SELECT id, keycode FROM rooms WHERE block_name = ? AND room_number = ? LIMIT 1`
    ).bind(block_name, room_number).first();
    if (!room) {
      const insertResult = await env.DB.prepare(`
        INSERT INTO rooms (block_name, room_number, capacity, keycode, is_active, created_at, last_seen_at)
        VALUES (?, ?, ?, NULL, 1, ?, ?)
      `).bind(block_name, room_number, 4, nowISO, nowISO).run();
      room = { id: insertResult.meta.last_row_id, keycode: null };
      await logAttempt(env, room.id, null, verifyMethod, false, nowISO);
      return new Response(JSON.stringify({ access: false, reason: "room_registered_awaiting_setup" }), {
        status: 200,
        headers: jsonHeaders
      });
    }
    await env.DB.prepare(`UPDATE rooms SET last_seen_at = ? WHERE id = ?`).bind(nowISO, room.id).run();
    let accessGranted = false;
    let reason = "invalid_code";
    let resolvedUserId = null;
    if (verifyMethod === "keycode") {
      if (room.keycode && room.keycode === value) {
        accessGranted = true;
        reason = "ok";
      } else {
        reason = room.keycode ? "wrong_keycode" : "no_keycode_set";
      }
    } else if (verifyMethod === "qr" || verifyMethod === "rfid") {
      const column = verifyMethod === "qr" ? "qr_access_code" : "rfid_card_uid";
      const rfidRow = await env.DB.prepare(`
        SELECT sr.user_id, sr.assigned_at, u.account_status
        FROM student_rfid sr
        JOIN users u ON u.id = sr.user_id
        WHERE sr.${column} = ?
        LIMIT 1
      `).bind(value).first();
      if (!rfidRow) {
        reason = "code_not_found";
      } else if (rfidRow.account_status !== "active") {
        reason = "account_not_active";
      } else if (verifyMethod === "qr" && isAccessCodeExpired(rfidRow.assigned_at)) {
        reason = "code_expired";
      } else {
        resolvedUserId = rfidRow.user_id;
        const allocation = await env.DB.prepare(`
          SELECT ra.room_id
          FROM room_allocations ra
          JOIN hostel_applications ha ON ha.id = ra.application_id
          WHERE ha.user_id = ?
          ORDER BY ra.assigned_at DESC
          LIMIT 1
        `).bind(resolvedUserId).first();
        if (!allocation) {
          reason = "not_allocated_to_any_room";
        } else if (allocation.room_id !== room.id) {
          reason = "not_allocated_to_this_room";
        } else {
          accessGranted = true;
          reason = "ok";
        }
      }
    } else {
      reason = "unknown_method";
    }
    await logAttempt(env, room.id, resolvedUserId, verifyMethod, accessGranted, nowISO);
    return new Response(JSON.stringify({ access: accessGranted, reason }), {
      status: 200,
      headers: jsonHeaders
    });
  } catch (err) {
    console.error("Hardware Verify-Access Error:", err.message);
    return new Response(JSON.stringify({ access: false, reason: "server_error" }), {
      status: 500,
      headers: jsonHeaders
    });
  }
}
__name(handleHardwareRoutes, "handleHardwareRoutes");
async function logAttempt(env, roomId, userId, method, success, timestamp) {
  try {
    await env.DB.prepare(`
      INSERT INTO access_logs (room_id, user_id, method, success, attempted_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(roomId, userId, method, success ? 1 : 0, timestamp).run();
  } catch (err) {
    console.error("Access Log Insert Error:", err.message);
  }
}
__name(logAttempt, "logAttempt");

// cloudflare_worker.js
var cloudflare_worker_default = {
  // 1. Standard HTTP Request Router
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }
    try {
      if (url.pathname === "/api/auth/register" && request.method === "POST") {
        return await handleRegister(request, env, headers);
      }
      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        return await handleLogin(request, env, headers);
      }
      if (url.pathname === "/api/admin/stats" && request.method === "GET") {
        return await handleAdminStats(env, headers);
      }
      if (url.pathname.startsWith("/api/admin/dashboard")) {
        return await handleDashboardRoutes(request, env, headers);
      }
      if (url.pathname === "/api/admin/settings/deadline") {
        return await handleAdminDeadlineSettings(request, env, headers);
      }
      if (url.pathname.startsWith("/api/admin/applications")) {
        return await handleAdminApplications(request, env, headers);
      }
      if (url.pathname.startsWith("/api/hardware")) {
        const hardwareResponse = await handleHardwareRoutes(request, env, headers);
        if (hardwareResponse) return hardwareResponse;
      }
      const detailInfoResponse = await handleDetailInfoRoutes(request, env, headers);
      if (detailInfoResponse) return detailInfoResponse;
      if (url.pathname.startsWith("/api/student")) {
        const studentResponse = await handleStudentRoutes(request, env, headers);
        if (studentResponse) return studentResponse;
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Server Error", details: err.message }),
        { status: 500, headers }
      );
    }
  },
  // 2. Automated Background Cron Task Handler
  async scheduled(event, env, ctx) {
    const nowISO = (/* @__PURE__ */ new Date()).toISOString();
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
  }
};

// ../../../Users/User/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../Users/User/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-8X3Hig/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = cloudflare_worker_default;

// ../../../Users/User/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-8X3Hig/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=cloudflare_worker.js.map
