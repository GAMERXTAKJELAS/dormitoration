// payslip_backend.js
// Handles the payslip/sworn-declaration document lifecycle:
//   - Upload to R2 (replacing any prior version of the same document type)
//   - Serve it back (student's own view, or admin review)
//   - AI plausibility check via Cloudflare Workers AI (free, same account, no API key)
//
// R2 bucket binding expected: env.PAYSLIP_BUCKET
// Workers AI binding expected: env.AI

const DOCUMENT_PROMPTS = {
  slip_gaji: "a Malaysian salary slip ('slip gaji') showing an employee's name, employer, and a salary/wage breakdown",
  surat_akuan_sumpah: "a Malaysian 'Surat Akuan Sumpah' (statutory declaration / sworn affidavit), typically used by self-employed individuals, usually referencing being sworn before a Commissioner for Oaths"
};

async function resolveApplicationId(env, userId) {
  const row = await env.DB.prepare(
    `SELECT id FROM hostel_applications WHERE user_id = ? LIMIT 1`
  ).bind(userId).first();
  return row ? row.id : null;
}

function base64ToBytes(base64Data) {
  const raw = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function handlePayslipRoutes(request, env, corsHeaders) {
  const url = new URL(request.url);
  const method = request.method;
  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  // POST /api/student/upload-payslip
  if (method === 'POST' && url.pathname === '/api/student/upload-payslip') {
    try {
      const { user_id, document_type, filename, base64Data } = await request.json();

      if (!user_id || !document_type || !base64Data) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: jsonHeaders });
      }
      if (!DOCUMENT_PROMPTS[document_type]) {
        return new Response(JSON.stringify({ error: 'Unknown document_type' }), { status: 400, headers: jsonHeaders });
      }
      if (!env.PAYSLIP_BUCKET) {
        return new Response(JSON.stringify({ error: 'PAYSLIP_BUCKET binding is not configured on this Worker' }), { status: 500, headers: jsonHeaders });
      }

      const applicationId = await resolveApplicationId(env, user_id);
      if (!applicationId) {
        return new Response(JSON.stringify({ error: 'No hostel application found for this student' }), { status: 404, headers: jsonHeaders });
      }

      const bytes = base64ToBytes(base64Data);
      const key = `payslips/${user_id}/${Date.now()}-${(filename || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      // Replace any previous upload of the same document type — delete old R2 object + row first
      const existing = await env.DB.prepare(
        `SELECT id, file_url FROM application_attachments WHERE application_id = ? AND document_type = ? LIMIT 1`
      ).bind(applicationId, document_type).first();

      if (existing) {
        try { await env.PAYSLIP_BUCKET.delete(existing.file_url); } catch (e) { /* old object may already be gone */ }
        await env.DB.prepare(`DELETE FROM application_attachments WHERE id = ?`).bind(existing.id).run();
      }

      await env.PAYSLIP_BUCKET.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });

      const insertResult = await env.DB.prepare(`
        INSERT INTO application_attachments (application_id, document_type, file_name, file_url, file_size, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(applicationId, document_type, filename || 'document.pdf', key, bytes.length, new Date().toISOString()).run();

      return new Response(JSON.stringify({
        success: true,
        attachment_id: insertResult.meta.last_row_id,
        file_url: key
      }), { status: 200, headers: jsonHeaders });

    } catch (err) {
      console.error('Payslip Upload Error:', err.message);
      return new Response(JSON.stringify({ error: 'Upload failed', details: err.message }), { status: 500, headers: jsonHeaders });
    }
  }

  // POST /api/student/check-payslip — AI plausibility check (never blocks submission, just flags)
  if (method === 'POST' && url.pathname === '/api/student/check-payslip') {
    try {
      const { user_id, document_type, imageBase64 } = await request.json();

      if (!user_id || !document_type || !imageBase64) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: jsonHeaders });
      }

      const expectedDescription = DOCUMENT_PROMPTS[document_type];
      if (!expectedDescription) {
        return new Response(JSON.stringify({ error: 'Unknown document_type' }), { status: 400, headers: jsonHeaders });
      }

      if (!env.AI) {
        return new Response(JSON.stringify({ looksValid: true, reason: 'AI binding not configured — check skipped' }), { status: 200, headers: jsonHeaders });
      }

      const imageBytes = Array.from(base64ToBytes(imageBase64));

      const aiResponse = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Look at this document image. It is supposed to be ${expectedDescription}. ` +
                      `Reply with ONLY a JSON object, no other text, in exactly this shape: ` +
                      `{"looks_valid": true or false, "reason": "one short sentence explaining why"}`
              },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
            ]
          }
        ]
      });

      let verdict = { looksValid: true, reason: 'Could not analyze document — proceeding without a flag.' };
      try {
        const raw = aiResponse.response || '';
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          verdict = { looksValid: !!parsed.looks_valid, reason: parsed.reason || '' };
        }
      } catch (parseErr) {
        console.error('AI verdict parse failure:', parseErr.message, aiResponse.response);
      }

      const applicationId = await resolveApplicationId(env, user_id);
      if (applicationId) {
        await env.DB.prepare(`
          UPDATE application_attachments SET ai_flagged = ?, ai_reason = ?
          WHERE application_id = ? AND document_type = ?
        `).bind(verdict.looksValid ? 0 : 1, verdict.reason, applicationId, document_type).run();
      }

      return new Response(JSON.stringify(verdict), { status: 200, headers: jsonHeaders });

    } catch (err) {
      console.error('Payslip AI Check Error:', err.message);
      return new Response(JSON.stringify({ looksValid: true, reason: 'Check unavailable' }), { status: 200, headers: jsonHeaders });
    }
  }

  // GET /api/student/payslip?user_id=...&document_type=... (student's own document)
  if (method === 'GET' && url.pathname === '/api/student/payslip') {
    return servePayslipByApplication(env, corsHeaders, url, 'student');
  }

  // GET /api/admin/payslip?application_id=...&document_type=... (admin review)
  if (method === 'GET' && url.pathname === '/api/admin/payslip') {
    return servePayslipByApplication(env, corsHeaders, url, 'admin');
  }

  return null;
}

async function servePayslipByApplication(env, corsHeaders, url, mode) {
  try {
    if (!env.PAYSLIP_BUCKET) {
      return new Response('PAYSLIP_BUCKET binding is not configured on this Worker', { status: 500, headers: corsHeaders });
    }

    const documentType = url.searchParams.get('document_type');
    let applicationId;

    if (mode === 'student') {
      const userId = url.searchParams.get('user_id');
      if (!userId) return new Response('Missing user_id', { status: 400, headers: corsHeaders });
      applicationId = await resolveApplicationId(env, userId);
    } else {
      applicationId = url.searchParams.get('application_id');
    }

    if (!applicationId) return new Response('Application not found', { status: 404, headers: corsHeaders });

    let query = `SELECT file_url FROM application_attachments WHERE application_id = ?`;
    const binds = [applicationId];
    if (documentType) {
      query += ` AND document_type = ?`;
      binds.push(documentType);
    }
    query += ` ORDER BY uploaded_at DESC LIMIT 1`;

    const row = await env.DB.prepare(query).bind(...binds).first();
    if (!row) return new Response('No document found', { status: 404, headers: corsHeaders });

    const object = await env.PAYSLIP_BUCKET.get(row.file_url);
    if (!object) return new Response('Document missing from storage', { status: 404, headers: corsHeaders });

    return new Response(object.body, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/pdf' }
    });
  } catch (err) {
    console.error('Payslip Serve Error:', err.message);
    return new Response('Server error', { status: 500, headers: corsHeaders });
  }
}
