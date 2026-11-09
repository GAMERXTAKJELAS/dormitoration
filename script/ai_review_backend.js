/**
 * Dormitoration - AI hostel eligibility review
 * File: /script/ai_review_backend.js
 *
 * HOW IT WORKS
 *  1. When a student picks a PDF, the browser renders page 1 to an image and calls
 *     /api/student/check-payslip. readDocumentWithVision() asks the vision model what the
 *     document says (name, income, IC ...) and saveDocumentRead() stores it in
 *     ai_document_reads. (Server-side PDF rendering is not possible in a Worker, which is why
 *     the browser does this step - it also works for scanned PDFs.)
 *  2. After the student submits and the files are uploaded, the browser calls
 *     POST /api/student/run-ai-review. runAiReview() combines the form data in D1 with those
 *     document readings, computes a 0-100 score with computeReview() (transparent rules, below)
 *     and asks a text model to write a short English explanation. Saved in ai_reviews.
 *  3. Only admins can see the result (Student Details page).
 *
 * SCORING RULES (all in computeReview - easy to tune)
 *   MPP member (form says Yes)                           -> 100 %, always
 *   Start at 40
 *   Household income <= B40 limit (RM5,860, editable)    -> +30   (above the limit: -20)
 *   Salary slip / Sworn declaration (the 2 important):
 *       read OK +10 | received but unreadable +3 | wrong document -5 | missing -15
 *   Document income agrees with the form (within 15 %)   -> +4 each (disagrees: -20 each)
 *   (B40 test uses the HIGHER of form income and document income)
 *   MyKad copy: IC matches the form +4 | differs -25 | optional, no penalty if missing
 *   Program Head letter read OK                          -> +4
 *   Dean's Award (approved document, e.g. in "Other")    -> +10
 *   Cap: 1 important document missing -> max 40 | both missing -> max 25
 *   Verdict: >= 80 Recommended | 50-79 Needs review | < 50 Not recommended
 *   NOT included yet: distance from home (noted for later).
 */

const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const TEXT_MODEL = '@cf/meta/llama-3.1-8b-instruct';

export const REQUIRED_DOCS = ['slip_gaji', 'surat_akuan_sumpah'];
export const OPTIONAL_DOCS = ['salinan_mykad', 'dokumen_sokongan_ketua_program', 'dokumen_lain'];

export const DOC_LABELS = {
  slip_gaji: 'Salary Slip',
  surat_akuan_sumpah: 'Sworn Declaration',
  salinan_mykad: 'MyKad Copy',
  dokumen_sokongan_ketua_program: 'Program Head Support Letter',
  dokumen_lain: 'Other Supporting Document'
};

// What to look for + which fields to read from each document type
const READ_SPECS = {
  slip_gaji: {
    desc: "a Malaysian salary slip ('slip gaji') showing an employee's name, employer and a salary breakdown",
    fields: '"name": employee name or null, "employer": employer or null, "month": pay month or null, ' +
            '"gross_income": monthly gross salary in RM as a plain number or null, "net_income": monthly net salary in RM as a plain number or null'
  },
  surat_akuan_sumpah: {
    desc: "a Malaysian 'Surat Akuan Sumpah' (statutory declaration), usually about income, sworn before a commissioner for oaths",
    fields: '"declarant_name": name of the person declaring or null, "declarant_ic": IC number or null, ' +
            '"stated_income": monthly income stated in RM as a plain number or null, "signed_or_stamped": true or false'
  },
  salinan_mykad: {
    desc: 'a copy of a Malaysian identity card (MyKad), front side',
    fields: '"name": name on the card or null, "ic_number": 12-digit IC number or null'
  },
  dokumen_sokongan_ketua_program: {
    desc: "a Malaysian 'Dokumen Sokongan Ketua Program' (program head support letter or form) signed or stamped by a program head or coordinator",
    fields: '"student_name": the student named or null, "supports_application": true or false, "signed_or_stamped": true or false'
  },
  dokumen_lain: {
    desc: "a supporting document for a hostel application (for example a Dean's Award certificate, 'Anugerah Dekan')",
    fields: '"document_kind": exactly "dean_award" if it is a Dean\'s Award / Anugerah Dekan certificate, otherwise "other", ' +
            '"holder_name": name of the person it was awarded to or null, "title": short title of the document or null'
  }
};

// ---------------------------------------------------------------- small helpers
function toNum(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function digits(v) { return String(v || '').replace(/\D/g, ''); }

const NAME_NOISE = new Set(['BIN', 'BINTI', 'BT', 'B', 'ANAK', 'A/L', 'A/P', 'AL', 'AP', 'BINTE']);
function nameTokens(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z\s/]/g, ' ').split(/\s+/).filter(t => t && !NAME_NOISE.has(t));
}
// true when at least half of the shorter name's words appear in the other name
function namesMatch(a, b) {
  const A = nameTokens(a), B = nameTokens(b);
  if (!A.length || !B.length) return false;
  const common = A.filter(t => B.includes(t)).length;
  return common / Math.min(A.length, B.length) >= 0.5;
}

function parseJsonObject(raw) {
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

// ------------------------------------------------- step 1: read one document (vision)
export async function readDocumentWithVision(env, documentType, imageBase64) {
  const spec = READ_SPECS[documentType];
  const unread = (reason) => ({ looksValid: true, readable: false, reason, data: {} });
  if (!spec) return unread('Unknown document type');
  if (!env.AI) return unread('AI service is not configured');

  try {
    const aiResponse = await env.AI.run(VISION_MODEL, {
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Look at this document image. It is supposed to be ${spec.desc}. ` +
                  `Reply with ONLY a JSON object, no other text, in exactly this shape: ` +
                  `{"looks_valid": true or false, "readable": true or false, "reason": "one short sentence", ` +
                  `"data": {${spec.fields}}}. ` +
                  `Set "readable" to false if the text is too blurry, small or dark to read reliably. ` +
                  `Use null for anything you cannot read clearly. Never guess or invent values.`
          },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
        ]
      }]
    });

    const parsed = parseJsonObject(aiResponse && aiResponse.response);
    if (!parsed) return unread('The AI reply could not be understood');

    const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
    for (const k of ['gross_income', 'net_income', 'stated_income']) {
      if (k in data) data[k] = toNum(data[k]);
    }
    return {
      looksValid: parsed.looks_valid !== false,
      readable: parsed.readable !== false,
      reason: String(parsed.reason || '').slice(0, 300),
      data
    };
  } catch (err) {
    console.error('Vision read failed:', err.message);
    return unread('The AI service could not process this file right now');
  }
}

export async function saveDocumentRead(env, applicationId, documentType, fileName, fileSize, read) {
  try {
    await env.DB.prepare(`
      INSERT INTO ai_document_reads (application_id, document_type, file_name, file_size, readable, looks_valid, reason, extracted, read_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(application_id, document_type) DO UPDATE SET
        file_name = excluded.file_name, file_size = excluded.file_size, readable = excluded.readable,
        looks_valid = excluded.looks_valid, reason = excluded.reason, extracted = excluded.extracted, read_at = excluded.read_at
    `).bind(
      applicationId, documentType, fileName || null, Number.isFinite(Number(fileSize)) ? Number(fileSize) : null,
      read.readable ? 1 : 0, read.looksValid ? 1 : 0, read.reason || '', JSON.stringify(read.data || {}), new Date().toISOString()
    ).run();
  } catch (err) {
    // Most likely migrations/ai_review.sql has not been run yet - never break the upload flow.
    console.error('Could not save document read:', err.message);
  }
}

// ----------------------------------------------- step 2: score (pure, easy to test)
/**
 * @param {object} input { app, user, docs, b40Limit }
 *   docs: { [type]: { state: 'missing'|'unreadable'|'invalid'|'ok', reason, data } }
 */
export function computeReview({ app, user, docs, b40Limit }) {
  const factors = [];
  const add = (label, points, note) => factors.push({ label, points, note });
  let score = 40;
  let manualCheck = false;

  let contrib = {};
  try { contrib = app.contributions ? (typeof app.contributions === 'string' ? JSON.parse(app.contributions) : app.contributions) : {}; } catch (e) { contrib = {}; }
  const isMpp = String(contrib.isMpp || '').toLowerCase() === 'yes';

  // ---- household income -------------------------------------------------
  const g1 = toNum(app.guardian1_income), g2 = toNum(app.guardian2_income);
  const formIncome = (g1 === null && g2 === null) ? null : (g1 || 0) + (g2 || 0);
  const slip = docs.slip_gaji, sworn = docs.surat_akuan_sumpah;
  const slipIncome = slip && slip.state === 'ok' ? (toNum(slip.data.gross_income) ?? toNum(slip.data.net_income)) : null;
  const swornIncome = sworn && sworn.state === 'ok' ? toNum(sworn.data.stated_income) : null;
  const verifiedIncome = slipIncome ?? swornIncome;

  // Use the HIGHER of the declared income and the income read from a document (conservative):
  // a student cannot pass the B40 test by declaring less than the salary slip shows.
  let householdIncome = null;
  let incomeSource = '';
  const hasForm = formIncome !== null && formIncome > 0;
  if (hasForm && verifiedIncome !== null && verifiedIncome > formIncome) {
    householdIncome = verifiedIncome; incomeSource = 'read from the uploaded document, which is higher than the form';
  } else if (hasForm) {
    householdIncome = formIncome; incomeSource = 'entered in the form';
  } else if (verifiedIncome !== null) {
    householdIncome = verifiedIncome; incomeSource = 'read from the uploaded document';
  }

  const fmt = (n) => 'RM' + Number(n).toLocaleString('en-MY', { maximumFractionDigits: 0 });
  if (householdIncome === null) {
    add('Household income', 0, 'No household income is available, so the B40 rule could not be applied.');
    manualCheck = true;
  } else if (householdIncome <= b40Limit) {
    add('Household income', +30, `Household income of ${fmt(householdIncome)} per month (${incomeSource}) is within the B40 limit of ${fmt(b40Limit)}.`);
    score += 30;
  } else {
    add('Household income', -20, `Household income of ${fmt(householdIncome)} per month (${incomeSource}) is above the B40 limit of ${fmt(b40Limit)}.`);
    score -= 20;
  }

  // ---- the 2 important documents ----------------------------------------
  let missingRequired = 0;
  for (const type of REQUIRED_DOCS) {
    const d = docs[type] || { state: 'missing' };
    const label = DOC_LABELS[type];
    if (d.state === 'ok') { add(label, +10, `${label} received and read successfully.`); score += 10; }
    else if (d.state === 'unreadable') {
      add(label, +3, `${label} was received but the AI could not read it${d.reason ? ' (' + d.reason + ')' : ''}. Please check it manually.`);
      score += 3; manualCheck = true;
    } else if (d.state === 'invalid') {
      add(label, -5, `The uploaded file does not look like a ${label}${d.reason ? ' (' + d.reason + ')' : ''}.`);
      score -= 5; manualCheck = true;
    } else {
      add(label, -15, `${label} was not uploaded.`);
      score -= 15; missingRequired++;
    }
  }

  // ---- documents vs. form income -----------------------------------------
  const candidates = [g1, g2, formIncome].filter(v => v !== null && v > 0);
  const compareIncome = (type, value) => {
    if (value === null || candidates.length === 0) return;
    const label = DOC_LABELS[type];
    const agrees = candidates.some(c => Math.abs(value - c) <= 0.15 * c);
    if (agrees) { add(`${label} vs form`, +4, `Income on the ${label} (${fmt(value)}) agrees with the form.`); score += 4; }
    else {
      add(`${label} vs form`, -20, `Income on the ${label} (${fmt(value)}) does not match the form (${candidates.map(fmt).join(' / ')}).`);
      score -= 20; manualCheck = true;
    }
  };
  compareIncome('slip_gaji', slipIncome);
  compareIncome('surat_akuan_sumpah', swornIncome);

  // ---- optional documents -------------------------------------------------
  const my = docs.salinan_mykad;
  if (my && my.state === 'ok') {
    const icRead = digits(my.data.ic_number), icForm = digits(app.ic_number);
    if (icRead.length >= 12 && icForm.length >= 12) {
      if (icRead === icForm) { add('MyKad copy', +4, 'IC number on the MyKad matches the form.'); score += 4; }
      else { add('MyKad copy', -25, 'IC number on the MyKad does not match the IC entered in the form.'); score -= 25; manualCheck = true; }
    } else add('MyKad copy', 0, 'MyKad received but the IC number could not be compared.');
  } else if (my && my.state !== 'missing') {
    add('MyKad copy', 0, `MyKad copy received but not usable${my.reason ? ' (' + my.reason + ')' : ''}.`);
  } else add('MyKad copy', 0, 'Optional - not provided.');

  const head = docs.dokumen_sokongan_ketua_program;
  if (head && head.state === 'ok') { add('Program Head letter', +4, 'Program Head support letter received and read.'); score += 4; }
  else if (head && head.state !== 'missing') add('Program Head letter', 0, `Program Head letter received but not usable${head.reason ? ' (' + head.reason + ')' : ''}.`);
  else add('Program Head letter', 0, 'Optional - not provided.');

  // ---- Dean's Award --------------------------------------------------------
  const other = docs.dokumen_lain;
  const cgpa = toNum(app.gpa_cgpa);
  const deanProof = !!(other && other.state === 'ok' && other.data.document_kind === 'dean_award' &&
                       (!other.data.holder_name || namesMatch(other.data.holder_name, user && user.full_name)));
  if (deanProof) {
    add("Dean's Award", +10, `Dean's Award document approved${cgpa !== null ? ' (CGPA ' + cgpa.toFixed(2) + ')' : ''}.`);
    score += 10;
  } else if (other && other.state === 'ok') {
    add('Other document', 0, 'Extra document received and accepted as supporting information.');
  } else if (other && other.state !== 'missing') {
    add('Other document', 0, `Extra document received but not usable${other.reason ? ' (' + other.reason + ')' : ''}.`);
  } else if (cgpa !== null && cgpa >= 3.5) {
    add("Dean's Award", 0, `CGPA is ${cgpa.toFixed(2)} (3.50 or higher) but no Dean's Award document was uploaded to prove it.`);
  }

  // ---- caps and MPP ----------------------------------------------------------
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (missingRequired === 1) {
    if (score > 40) { add('Missing important document', 0, 'One of the two important documents is missing, so the score is limited to 40%.'); }
    score = Math.min(score, 40);
  } else if (missingRequired >= 2) {
    if (score > 25) { add('Missing important documents', 0, 'Both important documents are missing, so the score is limited to 25%.'); }
    score = Math.min(score, 25);
  }

  if (isMpp) {
    add('MPP member', 0, 'The student is an MPP member, so the application is recommended automatically (100%).');
    score = 100;
  }

  const verdict = score >= 80 ? 'Recommended' : (score >= 50 ? 'Needs review' : 'Not recommended');
  return { score, verdict, factors, householdIncome, manualCheck, isMpp };
}

// ----------------------------------------------- step 3: gather data + run + save
async function loadB40Limit(env) {
  try {
    const row = await env.DB.prepare(`SELECT setting_value FROM system_settings WHERE setting_key = 'ai_b40_limit'`).first();
    const n = row ? toNum(row.setting_value) : null;
    return n && n > 0 ? n : 5860;
  } catch (e) { return 5860; }
}

function buildDocStates(attachments, reads) {
  const states = {};
  for (const type of [...REQUIRED_DOCS, ...OPTIONAL_DOCS]) {
    const att = attachments.find(a => a.document_type === type);
    if (!att) { states[type] = { state: 'missing', reason: '', data: {} }; continue; }

    // Use a reading only if it was made for the file that is actually stored
    const read = reads.find(r => r.document_type === type &&
      (r.file_name === att.file_name) && (r.file_size == null || att.file_size == null || Number(r.file_size) === Number(att.file_size)));

    if (!read) { states[type] = { state: 'unreadable', reason: 'the AI check did not run on this file', data: {} }; continue; }

    let data = {};
    try { data = JSON.parse(read.extracted || '{}'); } catch (e) { data = {}; }
    if (!read.readable) states[type] = { state: 'unreadable', reason: read.reason || 'text too unclear', data };
    else if (!read.looks_valid) states[type] = { state: 'invalid', reason: read.reason || '', data };
    else states[type] = { state: 'ok', reason: read.reason || '', data };
  }
  return states;
}

function fallbackSummary(review) {
  const top = [...review.factors].filter(f => f.points !== 0 || /MPP|limited/i.test(f.label + f.note))
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 3).map(f => f.note);
  return `${review.verdict} (${review.score}%). ` + (top.length ? top.join(' ') : 'There was not enough information to give strong reasons.');
}

async function narrate(env, review, facts) {
  if (!env.AI) return fallbackSummary(review);
  try {
    const res = await env.AI.run(TEXT_MODEL, {
      messages: [{
        role: 'user',
        content:
          `You are helping the hostel admin of a Malaysian vocational college. A hostel application was scored automatically. ` +
          `Write 2 to 4 plain English sentences explaining the result and the main reasons, using ONLY the facts below. ` +
          `Do not invent facts, do not mention the scoring formula, and do not address the student. Reply with the text only.\n\n` +
          `Result: ${review.score}% - ${review.verdict}\nStudent facts: ${JSON.stringify(facts)}\n` +
          `Reasons: ${JSON.stringify(review.factors.map(f => f.note))}`
      }]
    });
    const text = String((res && res.response) || '').trim().replace(/^["']|["']$/g, '');
    if (text.length >= 20 && text.length <= 900) return text;
  } catch (err) {
    console.error('Narrative generation failed:', err.message);
  }
  return fallbackSummary(review);
}

export async function runAiReview(env, userId) {
  const app = await env.DB.prepare(`SELECT * FROM hostel_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1`).bind(userId).first();
  if (!app) return { error: 'No application found for this student.' };
  const user = await env.DB.prepare(`SELECT id, full_name FROM users WHERE id = ?`).bind(userId).first();

  const { results: attachments = [] } = await env.DB.prepare(
    `SELECT document_type, file_name, file_size FROM application_attachments WHERE application_id = ? ORDER BY id DESC`
  ).bind(app.id).all();

  let reads = [];
  try {
    const r = await env.DB.prepare(`SELECT * FROM ai_document_reads WHERE application_id = ?`).bind(app.id).all();
    reads = r.results || [];
  } catch (e) { console.error('ai_document_reads unavailable:', e.message); }

  const b40Limit = await loadB40Limit(env);
  const docs = buildDocStates(attachments, reads);
  const review = computeReview({ app, user, docs, b40Limit });

  const facts = {
    program: app.program, semester: app.semester, cgpa: app.gpa_cgpa,
    household_income_rm: review.householdIncome, b40_limit_rm: b40Limit, mpp_member: review.isMpp,
    dependents: app.dependents_count
  };
  review.summary = await narrate(env, review, facts);

  review.documents = [...REQUIRED_DOCS, ...OPTIONAL_DOCS].map(type => ({
    type, label: DOC_LABELS[type], required: REQUIRED_DOCS.includes(type),
    state: docs[type].state, note: docs[type].reason || ''
  }));

  const nowISO = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO ai_reviews (application_id, score, verdict, summary, factors, documents, household_income, manual_check, status, error, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done', NULL, ?)
    ON CONFLICT(application_id) DO UPDATE SET
      score = excluded.score, verdict = excluded.verdict, summary = excluded.summary, factors = excluded.factors,
      documents = excluded.documents, household_income = excluded.household_income, manual_check = excluded.manual_check,
      status = 'done', error = NULL, generated_at = excluded.generated_at
  `).bind(app.id, review.score, review.verdict, review.summary, JSON.stringify(review.factors), JSON.stringify(review.documents),
          review.householdIncome, review.manualCheck ? 1 : 0, nowISO).run();

  return { success: true, application_id: app.id, score: review.score, verdict: review.verdict };
}

// -------------------------------------------------------------------- HTTP routes
const jsonRes = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

export async function handleAiReviewRoutes(request, env, headers, ctx) {
  const url = new URL(request.url);

  // Student finished submitting -> run the review in the background (student never waits for the AI)
  if (request.method === 'POST' && url.pathname === '/api/student/run-ai-review') {
    let body;
    try { body = await request.json(); } catch { return jsonRes({ error: 'Invalid JSON' }, 400, headers); }
    const userId = Number(body.user_id);
    if (!Number.isInteger(userId) || userId <= 0) return jsonRes({ error: 'user_id is required' }, 400, headers);

    const app = await env.DB.prepare(
      `SELECT h.id, h.submission_status, u.role FROM hostel_applications h JOIN users u ON u.id = h.user_id WHERE h.user_id = ? ORDER BY h.id DESC LIMIT 1`
    ).bind(userId).first();
    if (!app || app.role !== 'student') return jsonRes({ error: 'Student application not found' }, 404, headers);
    if (app.submission_status !== 'submitted') return jsonRes({ queued: false, reason: 'Application is not submitted yet' }, 200, headers);

    // Cheap abuse guard: at most one run every 20 seconds per application
    try {
      const last = await env.DB.prepare(`SELECT generated_at FROM ai_reviews WHERE application_id = ?`).bind(app.id).first();
      if (last && last.generated_at && Date.now() - new Date(last.generated_at).getTime() < 20000) {
        return jsonRes({ queued: false, reason: 'A review was just generated' }, 200, headers);
      }
    } catch (e) { /* table not created yet - the run below will log the real problem */ }

    const job = runAiReview(env, userId).catch(err => console.error('AI review failed:', err.message));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job); else await job;
    return jsonRes({ queued: true }, 202, headers);
  }

  // Admin: (re)run for one student and wait for the answer
  if (request.method === 'POST' && url.pathname === '/api/admin/ai-review') {
    let body;
    try { body = await request.json(); } catch { return jsonRes({ error: 'Invalid JSON' }, 400, headers); }
    const adminId = Number(body.admin_id);
    const admin = Number.isInteger(adminId) && adminId > 0
      ? await env.DB.prepare(`SELECT role FROM users WHERE id = ?`).bind(adminId).first() : null;
    if (!admin || admin.role !== 'admin') return jsonRes({ error: 'Admin access required' }, 403, headers);

    const userId = Number(body.user_id);
    if (!Number.isInteger(userId) || userId <= 0) return jsonRes({ error: 'user_id is required' }, 400, headers);
    try {
      const result = await runAiReview(env, userId);
      if (result.error) return jsonRes({ error: result.error }, 404, headers);
      return jsonRes(result, 200, headers);
    } catch (err) {
      const hint = /no such table/i.test(err.message) ? ' - run migrations/ai_review.sql in the D1 console first.' : '';
      return jsonRes({ error: 'AI review failed: ' + err.message + hint }, 500, headers);
    }
  }

  return null;
}
