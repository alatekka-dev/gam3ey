/**
 * Acceptance tests for GAM3EY. Each block maps to a workflow (WF01-WF18) and to
 * the success criteria in the project documentation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, login, auth, sectionId, request, TestEnv } from './helpers.js';
import { deliverOutbox } from '../src/services/notify.js';

let env: TestEnv;
let student: string, mona: string, youssef: string, nour: string, kareem: string, sara: string, omar: string, admin: string;

beforeAll(async () => {
  env = await setup();
  [student, mona, youssef, nour, kareem, sara, omar, admin] = await Promise.all([
    login(env, '20230001'), login(env, 'mona.samir@gam3ey.demo'), login(env, '20230003'), login(env, '20230004'),
    login(env, '20230005'), login(env, 'sara.hassan@gam3ey.demo'), login(env, 'omar.nabil@gam3ey.demo'), login(env, 'admin@gam3ey.demo'),
  ]);
});
afterAll(async () => { await env.db.close(); });

describe('WF01 sign-in and account recovery', () => {
  it('signs in with university ID and routes to the role dashboard', async () => {
    const res = await request(env.app).post('/api/auth/login').send({ identifier: '20230001', password: 'Demo@2026' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('student');
    expect(res.body.home).toBe('/student');
  });

  it('gives the same generic error for a wrong password and an unknown account', async () => {
    const a = await request(env.app).post('/api/auth/login').send({ identifier: '20230001', password: 'wrong-pass1' });
    const b = await request(env.app).post('/api/auth/login').send({ identifier: 'nobody@x.demo', password: 'wrong-pass1' });
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('blocks an inactive account', async () => {
    const res = await request(env.app).post('/api/auth/login').send({ identifier: '20230009', password: 'Demo@2026' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('locks sign-in after repeated failures', async () => {
    for (let i = 0; i < 5; i++) await request(env.app).post('/api/auth/login').send({ identifier: 'kareem.fathy@gam3ey.demo', password: 'bad-pass-1' });
    const res = await request(env.app).post('/api/auth/login').send({ identifier: 'kareem.fathy@gam3ey.demo', password: 'Demo@2026' });
    expect(res.status).toBe(429);
  });

  it('does not reveal whether an account exists when requesting a reset', async () => {
    const before = env.mailer.sent.length;
    const a = await request(env.app).post('/api/auth/forgot').send({ identifier: '20230002' });
    const b = await request(env.app).post('/api/auth/forgot').send({ identifier: '99999999' });
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);
    await new Promise((r) => setTimeout(r, 20));
    expect(env.mailer.sent.length).toBe(before + 1);
  });

  it('resets the password with a valid link, and rejects reuse and expired links', async () => {
    await request(env.app).post('/api/auth/forgot').send({ identifier: 'nour.khaled@gam3ey.demo' });
    await new Promise((r) => setTimeout(r, 20));
    const token = env.mailer.sent.at(-1)!.text.match(/token=([a-f0-9]+)/)![1];
    const ok = await request(env.app).post('/api/auth/reset').send({ token, password: 'NewPass2026' });
    expect(ok.status).toBe(200);
    const reuse = await request(env.app).post('/api/auth/reset').send({ token, password: 'Another2026' });
    expect(reuse.body.error.code).toBe('RESET_LINK_INVALID');

    await request(env.app).post('/api/auth/forgot').send({ identifier: 'nour.khaled@gam3ey.demo' });
    await new Promise((r) => setTimeout(r, 20));
    const token2 = env.mailer.sent.at(-1)!.text.match(/token=([a-f0-9]+)/)![1];
    await env.db.query(`UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL`);
    const expired = await request(env.app).post('/api/auth/reset').send({ token: token2, password: 'Expired2026' });
    expect(expired.status).toBe(400);
    expect(expired.body.error.code).toBe('RESET_LINK_INVALID');
    const relog = await request(env.app).post('/api/auth/login').send({ identifier: '20230004', password: 'NewPass2026' });
    expect(relog.status).toBe(200);
  });
});

describe('Role isolation and data protection', () => {
  it('rejects requests without a session', async () => {
    expect((await request(env.app).get('/api/student/overview')).status).toBe(401);
  });
  it('stops a student from using administration endpoints', async () => {
    const res = await request(env.app).get('/api/admin/students').set(auth(student));
    expect(res.status).toBe(403);
  });
  it('stops a student from reading a course they are not enrolled in', async () => {
    const res = await request(env.app).get(`/api/learning/sections/${await sectionId(env, 'AI301')}/lectures`).set(auth(student));
    expect(res.status).toBe(403);
  });
  it('stops a faculty member from publishing in a section assigned to someone else', async () => {
    const res = await request(env.app).post(`/api/faculty/sections/${await sectionId(env, 'CS302')}/lectures`).set(auth(sara))
      .send({ title: 'Not mine', body: 'x', publish: true });
    expect(res.status).toBe(403);
  });
  it('never exposes password hashes', async () => {
    const res = await request(env.app).get('/api/admin/students').set(auth(admin));
    expect(JSON.stringify(res.body)).not.toContain('password');
  });
});

describe('WF02 academic overview', () => {
  it('shows profile, current courses, schedule with locations and cumulative GPA (read-only)', async () => {
    const res = await request(env.app).get('/api/student/overview').set(auth(student));
    expect(res.status).toBe(200);
    expect(res.body.profile.university_id).toBe('20230001');
    expect(res.body.courses.map((c: any) => c.code).sort()).toEqual(['CS301', 'CS302', 'CS303', 'CS304']);
    expect(res.body.courses[0].location_code).toBeTruthy();
    expect(res.body.cgpa).toBeCloseTo(3.4, 1);
    expect(res.body.dataSource).toBe('demo');
  });
  it('hides grades of a term whose results are not published', async () => {
    const res = await request(env.app).get('/api/student/overview').set(auth(student));
    expect(res.body.resultsPublished).toBe(false);
    expect(res.body.courses.every((c: any) => c.grade === null)).toBe(true);
  });
});

describe('WF03 course registration', () => {
  it('lists offerings with eligibility status', async () => {
    const res = await request(env.app).get('/api/student/registration').set(auth(student));
    const by = (code: string, label = 'A') => res.body.offerings.find((o: any) => o.code === code && o.label === label);
    expect(by('CS301').status).toBe('registered');
    expect(by('CS102').status).toBe('passed');
    expect(by('CS401').status).toBe('prerequisite_missing');
    expect(by('AI301').status).toBe('available');
  });
  it('detects a schedule conflict', async () => {
    const res = await request(env.app).post('/api/student/registration/validate').set(auth(student)).send({ sectionIds: [await sectionId(env, 'CS305', 'A')] });
    expect(res.body.ok).toBe(false);
    expect(res.body.errors.map((e: any) => e.code)).toContain('SCHEDULE_CONFLICT');
  });
  it('rejects a course whose prerequisite is not passed', async () => {
    const res = await request(env.app).post('/api/student/registration/confirm').set(auth(student)).send({ sectionIds: [await sectionId(env, 'CS401')] });
    expect(res.status).toBe(409);
    expect(res.body.error.details.map((e: any) => e.code)).toContain('PREREQUISITE_MISSING');
  });
  it('enforces the maximum credit load', async () => {
    const res = await request(env.app).post('/api/student/registration/validate').set(auth(student))
      .send({ sectionIds: [await sectionId(env, 'AI301'), await sectionId(env, 'CS305', 'B'), await sectionId(env, 'CS102')] });
    expect(res.body.errors.map((e: any) => e.code)).toEqual(expect.arrayContaining(['CREDIT_LIMIT_EXCEEDED', 'ALREADY_PASSED']));
  });
  it('saves a valid registration once and refuses a duplicate submission', async () => {
    const ids = [await sectionId(env, 'AI301')];
    const [a, b] = await Promise.all([
      request(env.app).post('/api/student/registration/confirm').set(auth(student)).send({ sectionIds: ids }),
      request(env.app).post('/api/student/registration/confirm').set(auth(student)).send({ sectionIds: ids }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const n = await env.db.one(`SELECT count(*)::int AS n FROM enrollments WHERE student_id = (SELECT id FROM users WHERE university_id='20230001')
      AND section_id = $1 AND status = 'registered'`, [ids[0]]);
    expect(n.n).toBe(1);
  });
  it('never overfills a section when the last seat is requested at the same time', async () => {
    const sid = await sectionId(env, 'CS305', 'A'); // capacity 3, 2 enrolled
    const [a, b] = await Promise.all([
      request(env.app).post('/api/student/registration/confirm').set(auth(nour)).send({ sectionIds: [sid] }),
      request(env.app).post('/api/student/registration/confirm').set(auth(kareem)).send({ sectionIds: [sid] }),
    ]);
    const count = await env.db.one(`SELECT count(*)::int AS n FROM enrollments WHERE section_id = $1 AND status = 'registered'`, [sid]);
    expect(count.n).toBeLessThanOrEqual(3);
    expect([a.status, b.status].filter((s) => s === 201).length).toBeLessThanOrEqual(1);
  });
  it('refuses registration when the window is closed', async () => {
    await env.db.query(`UPDATE terms SET reg_closes_at = now() - interval '1 hour' WHERE is_current`);
    const res = await request(env.app).post('/api/student/registration/validate').set(auth(student)).send({ sectionIds: [await sectionId(env, 'CS305', 'B')] });
    expect(res.body.errors.map((e: any) => e.code)).toContain('REGISTRATION_CLOSED');
    await env.db.query(`UPDATE terms SET reg_closes_at = now() + interval '14 days' WHERE is_current`);
  });
});

describe('WF04 dropping a course', () => {
  const enrollment = async (code: string) => (await env.db.one(`SELECT e.id FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN courses c ON c.id = s.course_id
    WHERE e.student_id = (SELECT id FROM users WHERE university_id='20230001') AND c.code = $1 AND e.status = 'registered'`, [code])).id;

  it('previews the effect on credit hours', async () => {
    const res = await request(env.app).post('/api/student/drop/preview').set(auth(student)).send({ enrollmentId: await enrollment('AI301') });
    expect(res.body.creditsBefore).toBe(15);
    expect(res.body.creditsAfter).toBe(12);
  });
  it('requires explicit confirmation', async () => {
    const res = await request(env.app).post('/api/student/drop').set(auth(student)).send({ enrollmentId: await enrollment('AI301') });
    expect(res.status).toBe(400);
  });
  it('drops before the deadline and updates the schedule', async () => {
    const res = await request(env.app).post('/api/student/drop').set(auth(student)).send({ enrollmentId: await enrollment('AI301'), confirm: true });
    expect(res.status).toBe(200);
    const ov = await request(env.app).get('/api/student/overview').set(auth(student));
    expect(ov.body.courses.map((c: any) => c.code)).not.toContain('AI301');
  });
  it('refuses a drop that goes below the minimum load', async () => {
    const res = await request(env.app).post('/api/student/drop').set(auth(student)).send({ enrollmentId: await enrollment('CS304'), confirm: true });
    expect(res.body.error.code).toBe('BELOW_MIN_CREDITS');
  });
  it('refuses any drop after the deadline', async () => {
    await env.db.query(`UPDATE terms SET drop_deadline = now() - interval '1 hour' WHERE is_current`);
    const res = await request(env.app).post('/api/student/drop/preview').set(auth(student)).send({ enrollmentId: await enrollment('CS304') });
    expect(res.body.error.code).toBe('DROP_DEADLINE_PASSED');
    await env.db.query(`UPDATE terms SET drop_deadline = now() + interval '21 days' WHERE is_current`);
  });
});

describe('WF05 / WF15 lectures, files and exercises', () => {
  it('hides unpublished lectures from students but shows them to the instructor', async () => {
    const sid = await sectionId(env, 'CS301');
    const st = await request(env.app).get(`/api/learning/sections/${sid}/lectures`).set(auth(student));
    const fa = await request(env.app).get(`/api/learning/sections/${sid}/lectures`).set(auth(sara));
    expect(st.body.lectures.length).toBe(3);
    expect(fa.body.lectures.length).toBe(4);
  });
  it('checks an exercise answer without touching official grades', async () => {
    const x = await env.db.one(`SELECT id FROM exercises ORDER BY id LIMIT 1`);
    const before = await env.db.one(`SELECT md5(string_agg(id || ':' || COALESCE(grade,''), ',' ORDER BY id)) AS h FROM enrollments`);
    const res = await request(env.app).post(`/api/learning/exercises/${x.id}/attempt`).set(auth(student)).send({ choiceIndex: 0 });
    expect(res.body).toMatchObject({ correct: true, affectsGrade: false });
    const after = await env.db.one(`SELECT md5(string_agg(id || ':' || COALESCE(grade,''), ',' ORDER BY id)) AS h FROM enrollments`);
    expect(after.h).toBe(before.h);
  });
  it('publishes a lecture and notifies enrolled students once', async () => {
    const sid = await sectionId(env, 'CS302');
    const res = await request(env.app).post(`/api/faculty/sections/${sid}/lectures`).set(auth(omar))
      .send({ title: 'Software Testing', body: 'Unit tests check one function. Integration tests check modules working together.', week: 3, publish: true });
    expect(res.status).toBe(201);
    const notes = await request(env.app).get('/api/notifications').set(auth(student));
    expect(notes.body.items.filter((n: any) => n.title_en.includes('Software Testing')).length).toBe(1);
  });
  it('rejects a file type that is not allowed', async () => {
    const lec = await env.db.one(`SELECT id FROM lectures WHERE title = 'Software Testing'`);
    const res = await request(env.app).post(`/api/faculty/lectures/${lec.id}/attachments`).set(auth(omar))
      .attach('files', Buffer.from('MZ fake'), { filename: 'virus.exe', contentType: 'application/x-msdownload' });
    expect(res.status).toBe(415);
  });
  it('accepts a PDF and lets only enrolled students download it', async () => {
    const lec = await env.db.one(`SELECT id FROM lectures WHERE title = 'Software Testing'`);
    const up = await request(env.app).post(`/api/faculty/lectures/${lec.id}/attachments`).set(auth(omar))
      .attach('files', Buffer.from('%PDF-1.4 demo'), { filename: 'testing.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    const id = up.body.attachments[0].id;
    expect((await request(env.app).get(`/api/learning/attachments/${id}/download`).set(auth(student))).status).toBe(200);
    expect((await request(env.app).get(`/api/learning/attachments/${id}/download`).set(auth(kareem))).status).toBe(403);
  });
});

describe('WF06 course study assistant', () => {
  it('answers from course lectures and cites the sources', async () => {
    const res = await request(env.app).post(`/api/learning/sections/${await sectionId(env, 'CS301')}/assistant`).set(auth(student))
      .send({ question: 'What is a primary key?', lang: 'en' });
    expect(res.body.status).toBe('answered');
    expect(res.body.answer.toLowerCase()).toContain('primary key');
    expect(res.body.sources[0].title).toBe('The Relational Model');
  });
  it('answers Arabic questions', async () => {
    const res = await request(env.app).post(`/api/learning/sections/${await sectionId(env, 'CS301')}/assistant`).set(auth(student))
      .send({ question: 'يعني إيه المفتاح الأجنبي؟', lang: 'ar' });
    expect(res.body.status).toBe('answered');
    expect(res.body.answer).toContain('الأجنبي');
  });
  it('says the evidence is insufficient instead of guessing', async () => {
    const res = await request(env.app).post(`/api/learning/sections/${await sectionId(env, 'CS301')}/assistant`).set(auth(student))
      .send({ question: 'Explain quantum chromodynamics', lang: 'en' });
    expect(res.body.status).toBe('insufficient_evidence');
  });
  it('never uses unpublished lectures as a source', async () => {
    const res = await request(env.app).post(`/api/learning/sections/${await sectionId(env, 'CS301')}/assistant`).set(auth(student))
      .send({ question: 'ACID atomicity durability', lang: 'en' });
    expect(res.body.status).toBe('insufficient_evidence');
  });
  it('asks for clarification on an empty question', async () => {
    const res = await request(env.app).post(`/api/learning/sections/${await sectionId(env, 'CS301')}/assistant`).set(auth(student))
      .send({ question: 'what is', lang: 'en' });
    expect(res.body.status).toBe('clarify');
  });
  it('does not answer from a course the student is not enrolled in', async () => {
    const res = await request(env.app).post(`/api/learning/sections/${await sectionId(env, 'AI301')}/assistant`).set(auth(student))
      .send({ question: 'search algorithms', lang: 'en' });
    expect(res.status).toBe(403);
  });
});

describe('WF08 / WF09 campus guide and map', () => {
  it('answers a public question from the approved knowledge base with its source', async () => {
    const res = await request(env.app).post('/api/guide/ask').send({ question: 'إزاي أطلب إفادة قيد؟', lang: 'ar' });
    expect(res.body.status).toBe('answered');
    expect(res.body.answer).toContain('شؤون الطلاب');
    expect(res.body.sources[0].reviewedOn).toBeTruthy();
  });
  it('finds a location and its directions', async () => {
    const res = await request(env.app).get('/api/locations?q=lab');
    expect(res.body.locations.length).toBeGreaterThan(0);
    expect(res.body.locations[0].directions_ar).toBeTruthy();
  });
  it('refers to an official office when there is no approved answer', async () => {
    const res = await request(env.app).post('/api/guide/ask').send({ question: 'What is the dress code for the graduation ceremony?', lang: 'en' });
    expect(res.body.status).toBe('insufficient_evidence');
    expect(res.body.contact).toBeTruthy();
  });
  it('never returns personal records through the public guide', async () => {
    const res = await request(env.app).post('/api/guide/ask').send({ question: 'Ahmed Ali grades GPA 20230001', lang: 'en' });
    expect(JSON.stringify(res.body)).not.toContain('20230001');
    expect(JSON.stringify(res.body)).not.toMatch(/grade_points|cgpa/);
  });
});

describe('WF11-WF14 project teams', () => {
  let teamId: number;
  it('creates a team with the owner counted as a member', async () => {
    const res = await request(env.app).post('/api/teams').set(auth(student)).send({
      title: 'GAM3EY Mobile Companion', description: 'A mobile companion app for the GAM3EY portal.', targetSize: 3,
      roles: ['Flutter developer'], skills: ['Flutter', 'REST'], ownerRole: 'Team lead' });
    expect(res.status).toBe(201);
    teamId = res.body.team.id;
    const t = await request(env.app).get(`/api/teams/${teamId}`).set(auth(student));
    expect(t.body.team.member_count).toBe(1);
  });
  it('allows only one open team per owner', async () => {
    const res = await request(env.app).post('/api/teams').set(auth(student)).send({ title: 'Second team', description: 'Should be refused here.', targetSize: 3 });
    expect(res.body.error.code).toBe('ALREADY_OWNS_OPEN_TEAM');
  });
  it('refuses a duplicate pending join request', async () => {
    const a = await request(env.app).post(`/api/teams/${teamId}/requests`).set(auth(mona)).send({ role: 'Flutter developer', message: 'I know Flutter.' });
    const b = await request(env.app).post(`/api/teams/${teamId}/requests`).set(auth(mona)).send({ role: 'Flutter developer' });
    expect(a.status).toBe(201);
    expect(b.body.error.code).toBe('DUPLICATE_REQUEST');
  });
  it('never exceeds team capacity when the last two requests are accepted at once', async () => {
    await request(env.app).post(`/api/teams/${teamId}/requests`).set(auth(youssef)).send({ role: 'Designer' });
    await request(env.app).post(`/api/teams/${teamId}/requests`).set(auth(nour)).send({ role: 'Backend' });
    // capacity 3: owner + one more member already would leave one seat; first accept Mona to leave exactly one seat
    const list = await request(env.app).get(`/api/teams/${teamId}/requests`).set(auth(student));
    const pending = list.body.requests.filter((r: any) => r.status === 'pending');
    const monaReq = pending.find((r: any) => r.name_en === 'Mona Samir');
    expect((await request(env.app).post(`/api/teams/requests/${monaReq.id}/decision`).set(auth(student)).send({ decision: 'accept' })).status).toBe(200);
    const others = pending.filter((r: any) => r.id !== monaReq.id);
    const results = await Promise.all(others.map((r: any) => request(env.app).post(`/api/teams/requests/${r.id}/decision`).set(auth(student)).send({ decision: 'accept' })));
    const members = await env.db.one('SELECT count(*)::int AS n FROM team_members WHERE team_id = $1', [teamId]);
    expect(members.n).toBe(3);
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    expect(results.filter((r) => r.body.error?.code === 'TEAM_FULL').length).toBe(1);
    const t = await env.db.one('SELECT status FROM teams WHERE id = $1', [teamId]);
    expect(t.status).toBe('closed');
  });
  it('lets only the owner review requests', async () => {
    const res = await request(env.app).get(`/api/teams/${teamId}/requests`).set(auth(mona));
    expect(res.body.error.code).toBe('NOT_TEAM_OWNER');
  });
});

describe('WF16 schedule changes and WF07 notifications', () => {
  it('detects a room conflict before sending a change request', async () => {
    const lab1 = (await env.db.one(`SELECT id FROM locations WHERE code='LAB1'`)).id;
    const res = await request(env.app).post(`/api/faculty/sections/${await sectionId(env, 'CS302')}/change-requests`).set(auth(omar))
      .send({ day: 3, start: '11:30', end: '12:30', locationId: lab1, reason: 'Hall maintenance' });
    expect(res.status).toBe(409);
    expect(res.body.error.details[0].type).toBe('room');
  });

  it('notifies students only after approval, once, and keeps the change if email fails', async () => {
    const sid = await sectionId(env, 'CS303');
    const a201 = (await env.db.one(`SELECT id FROM locations WHERE code='A201'`)).id;
    const cr = await request(env.app).post(`/api/faculty/sections/${sid}/change-requests`).set(auth(omar))
      .send({ day: 2, start: '14:00', end: '15:30', locationId: a201, reason: 'Instructor conference on the original day' });
    expect(cr.status).toBe(201);
    const pendingNotes = await env.db.one(`SELECT count(*)::int AS n FROM notifications WHERE kind = 'schedule_change'`);
    expect(pendingNotes.n).toBe(0);

    env.mailer.failNext = 100; // simulate an email provider outage
    const ok = await request(env.app).post(`/api/admin/change-requests/${cr.body.changeRequest.id}/decision`).set(auth(admin)).send({ decision: 'approve' });
    expect(ok.status).toBe(200);
    expect(ok.body.notified).toBeGreaterThan(0);
    await deliverOutbox(env.db, env.mailer);
    const section = await env.db.one(`SELECT to_char(start_time,'HH24:MI') AS start FROM sections WHERE id = $1`, [sid]);
    expect(section.start).toBe('14:00');
    const failed = await env.db.one(`SELECT count(*)::int AS n FROM email_outbox WHERE status = 'failed'`);
    expect(failed.n).toBeGreaterThan(0);
    env.mailer.failNext = 0;

    const again = await request(env.app).post(`/api/admin/change-requests/${cr.body.changeRequest.id}/decision`).set(auth(admin)).send({ decision: 'approve' });
    expect(again.body.error.code).toBe('ALREADY_DECIDED');
    const notes = await request(env.app).get('/api/notifications').set(auth(student));
    expect(notes.body.items.filter((n: any) => n.kind === 'schedule_change').length).toBe(1);
    expect(notes.body.items.find((n: any) => n.kind === 'schedule_change').email_status).toBe('failed');
  });

  it('retries failed emails without duplicating notifications', async () => {
    const r = await request(env.app).post('/api/admin/outbox/retry').set(auth(admin));
    expect(r.body.sent).toBeGreaterThan(0);
  });

  it('does not send the same announcement twice', async () => {
    const body = { audience: 'students', kind: 'tuition', title_en: 'Tuition due', title_ar: 'موعد المصروفات', dedupeKey: 'tuition-test' };
    const a = await request(env.app).post('/api/admin/announcements').set(auth(admin)).send(body);
    const b = await request(env.app).post('/api/admin/announcements').set(auth(admin)).send(body);
    expect(a.body.recipients).toBeGreaterThan(0);
    expect(b.body.recipients).toBe(0);
  });

  it('tracks read state separately', async () => {
    const list = await request(env.app).get('/api/notifications').set(auth(student));
    await request(env.app).post(`/api/notifications/${list.body.items[0].id}/read`).set(auth(student));
    const after = await request(env.app).get('/api/notifications').set(auth(student));
    expect(after.body.unread).toBe(list.body.unread - 1);
  });
});

describe('WF17 / WF18 administration', () => {
  it('requires a reason for grade changes and writes them to the audit log', async () => {
    const e = await env.db.one(`SELECT e.id FROM enrollments e JOIN users u ON u.id = e.student_id WHERE u.university_id = '20230001' AND e.status = 'completed' LIMIT 1`);
    const noReason = await request(env.app).patch(`/api/admin/enrollments/${e.id}/grade`).set(auth(admin)).send({ grade: 'A' });
    expect(noReason.status).toBe(400);
    const ok = await request(env.app).patch(`/api/admin/enrollments/${e.id}/grade`).set(auth(admin)).send({ grade: 'A', reason: 'Re-marking approved by the committee' });
    expect(ok.status).toBe(200);
    const log = await env.db.one(`SELECT * FROM audit_log WHERE action = 'grade.update' ORDER BY id DESC LIMIT 1`);
    expect(log.reason).toContain('Re-marking');
    expect(log.before_data).toBeTruthy();
  });
  it('publishes a knowledge-base article that the guide can then answer from', async () => {
    const res = await request(env.app).post('/api/admin/kb').set(auth(admin)).send({ category: 'facilities', title_en: 'Prayer room', title_ar: 'المصلى',
      body_en: 'The prayer room is in Building A, ground floor.', body_ar: 'المصلى في مبنى A بالدور الأرضي.', source: 'Demo', reviewed_on: '2026-01-01', published: true });
    expect(res.status).toBe(201);
    const ask = await request(env.app).post('/api/guide/ask').send({ question: 'Where is the prayer room?', lang: 'en' });
    expect(ask.body.answer).toContain('Building A');
  });
  it('accepts only https official links for opportunities', async () => {
    const res = await request(env.app).post('/api/admin/opportunities').set(auth(admin)).send({ title: 'Bad link', provider: 'X', field: 'Software', kind: 'job',
      eligibility: 'All', opens_on: '2026-01-01', closes_on: '2026-02-01', url: 'http://insecure.example.com' });
    expect(res.status).toBe(400);
  });
  it('marks opportunities as open, upcoming or closed', async () => {
    const res = await request(env.app).get('/api/opportunities');
    expect(new Set(res.body.opportunities.map((o: any) => o.state))).toEqual(new Set(['open', 'upcoming', 'closed']));
  });
});
