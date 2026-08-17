/**
 * Dormitoration - Detail Information Backend Handler
 * File: /script/detail_backend.js
 */

export async function handleDetailInfoRoutes(request, env, headers) {
    const url = new URL(request.url);

    // GET /api/student/details
    if (url.pathname === '/api/student/details' && request.method === 'GET') {
        try {
            // Retrieve session token or student ID from request headers (placeholder implementation)
            const authHeader = request.headers.get('Authorization') || '';
            
            const studentDetails = await env.DB.prepare(`
                SELECT * FROM student_applications WHERE user_id = ? LIMIT 1
            `).bind(authHeader).first();

            if (!studentDetails) {
                return new Response(JSON.stringify({}), { status: 200, headers });
            }

            return new Response(JSON.stringify(studentDetails), { status: 200, headers });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
        }
    }

    // POST /api/student/update-details
    if (url.pathname === '/api/student/update-details' && request.method === 'POST') {
        try {
            const body = await request.json();

            // Validate intake semester scope (Semesters 2 to 6)
            const sem = parseInt(body.semester, 10);
            if (isNaN(sem) || sem < 2 || sem > 6) {
                return new Response(
                    JSON.stringify({ error: 'Hostel application is only available for intake Semesters 2 to 6.' }),
                    { status: 400, headers }
                );
            }

            // Save or update student hostel application details in Cloudflare D1
            await env.DB.prepare(`
                INSERT INTO student_applications (
                    username, full_name, ic_number, dob, age, gender, phone, address,
                    postcode, city, state, reason, program, semester, gpa, cgpa,
                    is_mpp, contributions, family_mode, guardian_details, slip_gaji_pdf, account_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
                ON CONFLICT(username) DO UPDATE SET
                    full_name = excluded.full_name,
                    ic_number = excluded.ic_number,
                    dob = excluded.dob,
                    age = excluded.age,
                    gender = excluded.gender,
                    phone = excluded.phone,
                    address = excluded.address,
                    postcode = excluded.postcode,
                    city = excluded.city,
                    state = excluded.state,
                    reason = excluded.reason,
                    program = excluded.program,
                    semester = excluded.semester,
                    gpa = excluded.gpa,
                    cgpa = excluded.cgpa,
                    is_mpp = excluded.is_mpp,
                    contributions = excluded.contributions,
                    family_mode = excluded.family_mode,
                    guardian_details = excluded.guardian_details,
                    slip_gaji_pdf = excluded.slip_gaji_pdf,
                    account_status = 'pending';
            `).bind(
                body.username, body.namaPelajar, body.noIC, body.tarikhLahir, body.umur, body.jantina,
                body.noTel, body.alamatRumah, body.poskod, body.bandar, body.negeri, body.sebabMemohon,
                body.program, body.semester, body.gpa, body.cgpa, body.isMpp,
                JSON.stringify(body.sumbangan || []), body.familyMode,
                JSON.stringify({ penjaga1: body.penjaga1, penjaga2: body.penjaga2 }),
                body.slipGajiPDF
            ).run();

            return new Response(
                JSON.stringify({ message: 'Profile updated successfully.' }),
                { status: 200, headers }
            );
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
        }
    }

    return null;
}