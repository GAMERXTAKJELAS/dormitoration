/**
 * Dormitoration - Detail Information Backend Handler
 * File: /script/detail_backend.js
 *
 * IMPORTANT: A hostel_applications row is already created at registration time
 * (see register_backend.js), keyed by user_id, with submission_status = 'draft'.
 * This file's job is to fill in the REST of that existing row — not create a new one —
 * and to update users.full_name / users.phone alongside it (those live on `users`,
 * not on hostel_applications).
 *
 * Two schema notes worth knowing:
 * - hostel_applications.gpa_cgpa is a single REAL column, but the form collects both
 *   GPA and CGPA separately. CGPA (cumulative) is stored in gpa_cgpa; GPA is packed
 *   into the `contributions` JSON blob alongside MPP/contribution data since there's
 *   no dedicated column for it.
 * - guardian1_address / guardian2_address columns exist in the DB but the form doesn't
 *   currently collect a separate guardian address field, so those stay NULL for now.
 */

export async function handleDetailInfoRoutes(request, env, headers) {
    const url = new URL(request.url);

    // GET /api/student/details?user_id=...
    if (url.pathname === '/api/student/details' && request.method === 'GET') {
        try {
            const userId = url.searchParams.get('user_id');

            if (!userId) {
                return new Response(JSON.stringify({ error: 'Unauthorized: Missing user_id' }), {
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

            // contributions column carries { isMpp, items, gpa } as JSON — see file header note
            let parsedContributions = { isMpp: 'No', items: [], gpa: '' };
            try {
                if (row.contributions) parsedContributions = { ...parsedContributions, ...JSON.parse(row.contributions) };
            } catch (e) {
                // keep defaults on parse failure
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
                gpa: parsedContributions.gpa || '',
                cgpa: row.gpa_cgpa,
                isMpp: parsedContributions.isMpp || 'No',
                sumbangan: parsedContributions.items || [],
                familyMode: row.guardian2_name ? 'parents' : 'guardians',
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
                accountStatus: row.submission_status || 'draft'
            };

            return new Response(JSON.stringify(studentDetails), { status: 200, headers });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
        }
    }

    // POST /api/student/update-details
    if (url.pathname === '/api/student/update-details' && request.method === 'POST') {
        try {
            const body = await request.json();

            if (!body.user_id) {
                return new Response(JSON.stringify({ error: 'Missing user_id' }), { status: 400, headers });
            }

            // Validate intake semester scope (Semesters 2 to 6)
            const sem = parseInt(body.semester, 10);
            if (isNaN(sem) || sem < 2 || sem > 6) {
                return new Response(
                    JSON.stringify({ error: 'Hostel application is only available for intake Semesters 2 to 6.' }),
                    { status: 400, headers }
                );
            }

            const contributionsBlob = JSON.stringify({
                isMpp: body.isMpp || 'No',
                items: body.sumbangan || [],
                gpa: body.gpa || ''
            });

            const penjaga1 = body.penjaga1 || {};
            const penjaga2 = body.penjaga2 || null;
            const nowISO = new Date().toISOString();

            // users.full_name / users.phone live on a different table — update separately
            await env.DB.prepare(`
                UPDATE users SET full_name = ?, phone = ? WHERE id = ?
            `).bind(body.namaPelajar || null, body.noTel || null, body.user_id).run();

            // The row already exists from registration — check first, then UPDATE or INSERT accordingly
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
                    body.noIC || null, body.tarikhLahir || null, body.umur || null, body.jantina || null,
                    body.alamatRumah || null, body.poskod || null, body.bandar || null, body.negeri || null,
                    body.sebabMemohon || null, body.program || null, sem, body.cgpa || null,
                    contributionsBlob,
                    penjaga1.nama || null, penjaga1.ic || null, penjaga1.tel || null,
                    penjaga1.hubungan || null, penjaga1.pekerjaan || null, penjaga1.pendapatan || null,
                    penjaga2 ? penjaga2.nama : null, penjaga2 ? penjaga2.ic : null, penjaga2 ? penjaga2.tel : null,
                    penjaga2 ? penjaga2.hubungan : null, penjaga2 ? penjaga2.pekerjaan : null, penjaga2 ? penjaga2.pendapatan : null,
                    body.tanggunganAnak || 0, nowISO,
                    body.user_id
                ).run();
            } else {
                // Fallback for the edge case where no draft row exists yet (e.g. registration had no IC)
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
                    body.user_id, body.noIC || null, body.tarikhLahir || null, body.umur || null, body.jantina || null,
                    body.alamatRumah || null, body.poskod || null, body.bandar || null, body.negeri || null,
                    body.sebabMemohon || null, body.program || null, sem, body.cgpa || null, contributionsBlob,
                    penjaga1.nama || null, penjaga1.ic || null, penjaga1.tel || null, penjaga1.hubungan || null, penjaga1.pekerjaan || null, penjaga1.pendapatan || null,
                    penjaga2 ? penjaga2.nama : null, penjaga2 ? penjaga2.ic : null, penjaga2 ? penjaga2.tel : null, penjaga2 ? penjaga2.hubungan : null, penjaga2 ? penjaga2.pekerjaan : null, penjaga2 ? penjaga2.pendapatan : null,
                    body.tanggunganAnak || 0, nowISO, nowISO
                ).run();
            }

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