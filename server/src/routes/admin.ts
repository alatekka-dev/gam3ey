/**
 * University administration.
 * WF16 (approval side), WF17 academic data and records, WF18 knowledge base,
 * map and opportunities, plus announcements and the audit log.
 * Every official change is written to the audit log in the same transaction.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { AppContext, AppError, asyncH, parse, authenticate, requireRole, me, z, idParam, audit, GRADE_POINTS } from '../core.js';
import { indexText } from '../services/text.js';
import { notifyUsers, sectionStudents, deliverOutbox } from '../services/notify.js';
import { findConflicts } from './faculty.js';

const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function adminRoutes(ctx: AppContext) {
  const r = Router();
  r.use(authenticate(ctx), requireRole('admin'));
  const afterCommit = () => setImmediate(() => deliverOutbox(ctx.db, ctx.mailer).catch((e) => console.error('outbox', e)));

  r.get('/dashboard', asyncH(async (_req, res) => {
    res.json(await ctx.db.one(`SELECT
      (SELECT count(*)::int FROM users WHERE role='student') AS students, (SELECT count(*)::int FROM users WHERE role='faculty') AS faculty,
      (SELECT count(*)::int FROM courses) AS courses, (SELECT count(*)::int FROM change_requests WHERE status='pending') AS pending_changes,
      (SELECT count(*)::int FROM enrollments e JOIN sections s ON s.id=e.section_id JOIN terms t ON t.id=s.term_id WHERE t.is_current AND e.status='registered') AS registrations,
      (SELECT count(*)::int FROM email_outbox WHERE status='failed') AS failed_emails,
      (SELECT count(*)::int FROM assistant_log WHERE outcome='insufficient_evidence') AS unanswered_questions`));
  }));

  // ---- Settings and terms ----
  r.get('/settings', asyncH(async (_req, res) => {
    res.json({ settings: Object.fromEntries((await ctx.db.query('SELECT key, value FROM settings')).map((s: any) => [s.key, Number(s.value)])) });
  }));
  r.patch('/settings', asyncH(async (req, res) => {
    const user = me(req);
    const b = parse(z.object({ min_credits: z.number().int().min(0).max(30).optional(), max_credits: z.number().int().min(1).max(30).optional(),
      max_team_size: z.number().int().min(2).max(10).optional() }).refine((x) => !x.min_credits || !x.max_credits || x.min_credits <= x.max_credits, 'min must not exceed max'), req.body);
    await ctx.db.tx(async (q) => {
      for (const [k, v] of Object.entries(b)) {
        const before = await q.one('SELECT value FROM settings WHERE key = $1', [k]);
        await q.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, String(v)]);
        await audit(q, user.id, 'setting.update', 'setting', k, before, { value: v });
      }
    });
    res.json({ ok: true });
  }));

  r.get('/terms', asyncH(async (_req, res) => { res.json({ terms: await ctx.db.query('SELECT * FROM terms ORDER BY starts_on DESC') }); }));
  r.patch('/terms/:id', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    const b = parse(z.object({ reg_opens_at: z.string().datetime({ offset: true }).optional(), reg_closes_at: z.string().datetime({ offset: true }).optional(),
      drop_deadline: z.string().datetime({ offset: true }).optional(), results_published: z.boolean().optional(), is_current: z.boolean().optional() }), req.body);
    const term = await ctx.db.tx(async (q) => {
      const before = await q.one('SELECT * FROM terms WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Term not found');
      if (b.is_current) await q.query('UPDATE terms SET is_current = FALSE WHERE id <> $1', [id]);
      const t = await q.one(`UPDATE terms SET reg_opens_at = COALESCE($2, reg_opens_at), reg_closes_at = COALESCE($3, reg_closes_at),
        drop_deadline = COALESCE($4, drop_deadline), results_published = COALESCE($5, results_published), is_current = COALESCE($6, is_current)
        WHERE id = $1 RETURNING *`, [id, b.reg_opens_at ?? null, b.reg_closes_at ?? null, b.drop_deadline ?? null, b.results_published ?? null, b.is_current ?? null]);
      if (new Date(t.reg_closes_at) <= new Date(t.reg_opens_at)) throw new AppError(400, 'VALIDATION_ERROR', 'Registration must close after it opens');
      await audit(q, user.id, 'term.update', 'term', id, before, t);
      return t;
    });
    res.json({ term });
  }));

  // ---- Courses and sections ----
  r.get('/courses', asyncH(async (_req, res) => {
    res.json({ courses: await ctx.db.query(`SELECT c.*, COALESCE((SELECT json_agg(p.code) FROM course_prereqs cp JOIN courses p ON p.id = cp.prereq_id WHERE cp.course_id = c.id), '[]') AS prereqs
      FROM courses c ORDER BY c.code`) });
  }));
  const courseBody = z.object({ code: z.string().trim().regex(/^[A-Z]{2,5}\d{3}$/), title_en: z.string().trim().min(3), title_ar: z.string().trim().min(3),
    credit_hours: z.number().int().min(1).max(6), description: z.string().default(''), prereqCodes: z.array(z.string()).default([]) });
  r.post('/courses', asyncH(async (req, res) => {
    const user = me(req); const b = parse(courseBody, req.body);
    const course = await ctx.db.tx(async (q) => {
      const c = await q.one(`INSERT INTO courses (code, title_en, title_ar, credit_hours, description) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [b.code, b.title_en, b.title_ar, b.credit_hours, b.description]);
      for (const code of b.prereqCodes) {
        const p = await q.one('SELECT id FROM courses WHERE code = $1', [code]);
        if (!p) throw new AppError(400, 'UNKNOWN_PREREQUISITE', `Unknown prerequisite ${code}`);
        await q.query('INSERT INTO course_prereqs (course_id, prereq_id) VALUES ($1,$2)', [c.id, p.id]);
      }
      await audit(q, user.id, 'course.create', 'course', c.id, null, b);
      return c;
    });
    res.status(201).json({ course });
  }));

  r.get('/sections', asyncH(async (_req, res) => {
    res.json({ sections: await ctx.db.query(`SELECT s.id, s.label, s.capacity, s.day_of_week AS day, to_char(s.start_time,'HH24:MI') AS start, to_char(s.end_time,'HH24:MI') AS "end",
      c.code, c.title_en, c.title_ar, u.name_en AS faculty_en, u.name_ar AS faculty_ar, l.name_en AS location_en, l.name_ar AS location_ar,
      (SELECT count(*)::int FROM enrollments e WHERE e.section_id = s.id AND e.status = 'registered') AS enrolled
      FROM sections s JOIN courses c ON c.id = s.course_id JOIN terms t ON t.id = s.term_id LEFT JOIN users u ON u.id = s.faculty_id
      LEFT JOIN locations l ON l.id = s.location_id WHERE t.is_current ORDER BY c.code, s.label`) });
  }));

  // ---- Students and official records ----
  r.get('/students', asyncH(async (req, res) => {
    const q = typeof req.query.q === 'string' ? `%${req.query.q.toLowerCase()}%` : '%';
    res.json({ students: await ctx.db.query(`SELECT u.id, u.university_id, u.email, u.name_en, u.name_ar, u.active, u.is_demo, st.study_year, m.code AS major
      FROM users u JOIN students st ON st.user_id = u.id JOIN majors m ON m.id = st.major_id
      WHERE lower(u.name_en) LIKE $1 OR u.name_ar LIKE $1 OR u.university_id LIKE $1 ORDER BY u.university_id LIMIT 200`, [q]) });
  }));
  r.post('/students', asyncH(async (req, res) => {
    const user = me(req);
    const b = parse(z.object({ university_id: z.string().regex(/^\d{6,12}$/), email: z.string().email(), name_en: z.string().min(3), name_ar: z.string().min(3),
      major_code: z.string(), study_year: z.number().int().min(1).max(6), initialPassword: z.string().min(8) }), req.body);
    const created = await ctx.db.tx(async (q) => {
      const m = await q.one('SELECT id FROM majors WHERE code = $1', [b.major_code]);
      if (!m) throw new AppError(400, 'UNKNOWN_MAJOR', 'Unknown major');
      const u = await q.one(`INSERT INTO users (university_id, email, password_hash, role, name_en, name_ar) VALUES ($1,$2,$3,'student',$4,$5) RETURNING id, university_id, email`,
        [b.university_id, b.email.toLowerCase(), await bcrypt.hash(b.initialPassword, 10), b.name_en, b.name_ar]);
      await q.query('INSERT INTO students (user_id, major_id, study_year) VALUES ($1,$2,$3)', [u.id, m.id, b.study_year]);
      await audit(q, user.id, 'student.create', 'user', u.id, null, { university_id: b.university_id, major: b.major_code });
      return u;
    });
    res.status(201).json({ student: created });
  }));
  r.patch('/users/:id/active', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    const { active, reason } = parse(z.object({ active: z.boolean(), reason: z.string().trim().min(5) }), req.body);
    if (id === user.id) throw new AppError(409, 'SELF_DEACTIVATION', 'You cannot deactivate your own account');
    await ctx.db.tx(async (q) => {
      const before = await q.one('SELECT active FROM users WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw new AppError(404, 'NOT_FOUND', 'User not found');
      await q.query('UPDATE users SET active = $2 WHERE id = $1', [id, active]);
      await audit(q, user.id, 'user.active', 'user', id, before, { active }, reason);
    });
    res.json({ ok: true });
  }));

  r.get('/students/:id/record', asyncH(async (req, res) => {
    res.json({ record: await ctx.db.query(`SELECT e.id, e.status, e.grade, e.grade_points, c.code, c.title_en, c.title_ar, c.credit_hours, t.code AS term
      FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN courses c ON c.id = s.course_id JOIN terms t ON t.id = s.term_id
      WHERE e.student_id = $1 ORDER BY t.starts_on DESC, c.code`, [idParam(req)]) });
  }));

  // Official grade changes need a reason and are always audited (no silent edits).
  r.patch('/enrollments/:id/grade', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    const { grade, reason } = parse(z.object({ grade: z.enum(Object.keys(GRADE_POINTS) as [string, ...string[]]), reason: z.string().trim().min(5).max(500) }), req.body);
    const out = await ctx.db.tx(async (q) => {
      const before = await q.one('SELECT id, status, grade, grade_points FROM enrollments WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Enrollment not found');
      if (before.status === 'dropped') throw new AppError(409, 'DROPPED', 'Cannot grade a dropped course');
      const after = await q.one(`UPDATE enrollments SET grade = $2, grade_points = $3, status = 'completed' WHERE id = $1 RETURNING id, status, grade, grade_points`,
        [id, grade, GRADE_POINTS[grade]]);
      await audit(q, user.id, 'grade.update', 'enrollment', id, before, after, reason);
      return after;
    });
    res.json({ enrollment: out });
  }));

  // ---- WF16 approval of schedule changes ----
  r.get('/change-requests', asyncH(async (_req, res) => {
    res.json({ changeRequests: await ctx.db.query(`SELECT cr.id, cr.status, cr.reason, cr.created_at, cr.new_day, to_char(cr.new_start,'HH24:MI') AS new_start,
      to_char(cr.new_end,'HH24:MI') AS new_end, cr.new_location_id, nl.name_en AS new_location_en, nl.name_ar AS new_location_ar,
      s.id AS section_id, s.label, s.day_of_week AS old_day, to_char(s.start_time,'HH24:MI') AS old_start, to_char(s.end_time,'HH24:MI') AS old_end,
      ol.name_en AS old_location_en, ol.name_ar AS old_location_ar, c.code, u.name_en AS requested_by_en, u.name_ar AS requested_by_ar
      FROM change_requests cr JOIN sections s ON s.id = cr.section_id JOIN courses c ON c.id = s.course_id JOIN users u ON u.id = cr.requested_by
      LEFT JOIN locations nl ON nl.id = cr.new_location_id LEFT JOIN locations ol ON ol.id = s.location_id
      ORDER BY (cr.status = 'pending') DESC, cr.created_at DESC`) });
  }));

  r.post('/change-requests/:id/decision', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    const { decision, note } = parse(z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(500).default('') }), req.body);
    const result = await ctx.db.tx(async (q) => {
      const cr = await q.one(`SELECT *, to_char(new_start,'HH24:MI') AS ns, to_char(new_end,'HH24:MI') AS ne FROM change_requests WHERE id = $1 FOR UPDATE`, [id]);
      if (!cr) throw new AppError(404, 'NOT_FOUND', 'Change request not found');
      if (cr.status !== 'pending') throw new AppError(409, 'ALREADY_DECIDED', `Already ${cr.status}`);
      if (decision === 'reject') {
        await q.query(`UPDATE change_requests SET status='rejected', decided_by=$2, decided_at=now(), decision_note=$3 WHERE id=$1`, [id, user.id, note]);
        await notifyUsers(q, [cr.requested_by], { kind: 'schedule_change', dedupeKey: `change-rejected:${id}`,
          title_en: 'Your schedule change request was rejected', title_ar: 'تم رفض طلب تعديل الموعد', body_en: note, body_ar: note });
        await audit(q, user.id, 'change_request.reject', 'change_request', id, { status: 'pending' }, { status: 'rejected' }, note);
        return { status: 'rejected', notified: 0 };
      }
      // Re-check conflicts at approval time: the timetable may have changed since the request.
      const conflicts = await findConflicts(q, cr.section_id, { day: cr.new_day, start: cr.ns, end: cr.ne, locationId: cr.new_location_id });
      if (conflicts.length) throw new AppError(409, 'SCHEDULE_CONFLICT', 'The new time now conflicts with another lecture', conflicts);
      const before = await q.one(`SELECT day_of_week, to_char(start_time,'HH24:MI') AS start, to_char(end_time,'HH24:MI') AS "end", location_id FROM sections WHERE id = $1 FOR UPDATE`, [cr.section_id]);
      await q.query(`UPDATE sections SET day_of_week=$2, start_time=$3, end_time=$4, location_id=COALESCE($5, location_id) WHERE id=$1`,
        [cr.section_id, cr.new_day, cr.ns, cr.ne, cr.new_location_id]);
      await q.query(`UPDATE change_requests SET status='approved', decided_by=$2, decided_at=now(), decision_note=$3 WHERE id=$1`, [id, user.id, note]);
      const info = await q.one(`SELECT c.code, l.name_en, l.name_ar FROM sections s JOIN courses c ON c.id = s.course_id LEFT JOIN locations l ON l.id = s.location_id WHERE s.id = $1`, [cr.section_id]);
      const students = await sectionStudents(q, cr.section_id);
      // Notification rows are part of this transaction: they exist only if the change commits.
      const notified = await notifyUsers(q, [...students, cr.requested_by], {
        kind: 'schedule_change', dedupeKey: `schedule-change:${id}`, email: true, link: '/student',
        title_en: `${info.code} lecture moved`, title_ar: `تغيير موعد محاضرة ${info.code}`,
        body_en: `New time: ${DAYS_EN[cr.new_day]} ${cr.ns}-${cr.ne}, ${info.name_en ?? ''}`,
        body_ar: `الموعد الجديد: ${DAYS_AR[cr.new_day]} ${cr.ns}-${cr.ne}، ${info.name_ar ?? ''}`,
      });
      await audit(q, user.id, 'section.reschedule', 'section', cr.section_id, before, { day: cr.new_day, start: cr.ns, end: cr.ne, location_id: cr.new_location_id }, `change request #${id}`);
      return { status: 'approved', notified };
    });
    afterCommit();
    res.json(result);
  }));

  // ---- Announcements (registration windows, tuition reminders, general) ----
  r.post('/announcements', asyncH(async (req, res) => {
    const user = me(req);
    const b = parse(z.object({ audience: z.enum(['all', 'students', 'faculty', 'section']), sectionId: z.number().int().positive().optional(),
      kind: z.enum(['registration', 'tuition', 'general']), title_en: z.string().min(3), title_ar: z.string().min(3),
      body_en: z.string().default(''), body_ar: z.string().default(''), email: z.boolean().default(false),
      dedupeKey: z.string().min(3).max(100) }).refine((x) => x.audience !== 'section' || x.sectionId, 'sectionId required'), req.body);
    const count = await ctx.db.tx(async (q) => {
      const ids = b.audience === 'section' ? await sectionStudents(q, b.sectionId!)
        : (await q.query(`SELECT id FROM users WHERE active AND ($1 = 'all' OR role = $2)`, [b.audience, b.audience === 'students' ? 'student' : 'faculty'])).map((u: any) => u.id);
      const n = await notifyUsers(q, ids, { kind: b.kind, title_en: b.title_en, title_ar: b.title_ar, body_en: b.body_en, body_ar: b.body_ar,
        email: b.email, dedupeKey: `announcement:${b.dedupeKey}` });
      await audit(q, user.id, 'announcement.send', 'announcement', b.dedupeKey, null, { audience: b.audience, kind: b.kind, recipients: n });
      return n;
    });
    afterCommit();
    res.status(201).json({ recipients: count, message: count ? undefined : 'Already sent to this audience (duplicate key)' });
  }));

  r.get('/outbox', asyncH(async (_req, res) => {
    res.json({ outbox: await ctx.db.query('SELECT id, to_email, subject, status, attempts, last_error, created_at, sent_at FROM email_outbox ORDER BY id DESC LIMIT 100') });
  }));
  r.post('/outbox/retry', asyncH(async (_req, res) => { res.json(await deliverOutbox(ctx.db, ctx.mailer)); }));

  // ---- WF18 knowledge base, locations and opportunities ----
  const kbBody = z.object({ category: z.string().min(2), title_en: z.string().min(3), title_ar: z.string().min(3), body_en: z.string().min(10), body_ar: z.string().min(10),
    source: z.string().min(3), contact: z.string().default(''), reviewed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), published: z.boolean().default(false) });
  r.get('/kb', asyncH(async (_req, res) => {
    res.json({ articles: await ctx.db.query('SELECT id, category, title_en, title_ar, body_en, body_ar, source, contact, reviewed_on, published, archived FROM kb_articles ORDER BY archived, category, id') });
  }));
  r.post('/kb', asyncH(async (req, res) => {
    const user = me(req); const b = parse(kbBody, req.body);
    const a = await ctx.db.one(`INSERT INTO kb_articles (category, title_en, title_ar, body_en, body_ar, source, contact, reviewed_on, published, tsv)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, to_tsvector('simple', $10)) RETURNING id, title_en, published`,
      [b.category, b.title_en, b.title_ar, b.body_en, b.body_ar, b.source, b.contact, b.reviewed_on, b.published, indexText(`${b.title_en} ${b.title_ar} ${b.body_en} ${b.body_ar}`)]);
    await audit(ctx.db, user.id, 'kb.create', 'kb_article', a.id, null, { title: b.title_en, published: b.published });
    res.status(201).json({ article: a });
  }));
  r.patch('/kb/:id', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    const b = parse(kbBody.partial().extend({ archived: z.boolean().optional() }), req.body);
    const a = await ctx.db.tx(async (q) => {
      const before = await q.one('SELECT * FROM kb_articles WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Article not found');
      const m = { ...before, ...b };
      const after = await q.one(`UPDATE kb_articles SET category=$2, title_en=$3, title_ar=$4, body_en=$5, body_ar=$6, source=$7, contact=$8, reviewed_on=$9,
        published=$10, archived=$11, tsv=to_tsvector('simple', $12) WHERE id=$1 RETURNING id, title_en, published, archived`,
        [id, m.category, m.title_en, m.title_ar, m.body_en, m.body_ar, m.source, m.contact, m.reviewed_on, m.published, m.archived,
          indexText(`${m.title_en} ${m.title_ar} ${m.body_en} ${m.body_ar}`)]);
      await audit(q, user.id, 'kb.update', 'kb_article', id, { published: before.published, archived: before.archived }, { published: after.published, archived: after.archived });
      return after;
    });
    res.json({ article: a });
  }));

  const locBody = z.object({ code: z.string().min(2), name_en: z.string().min(2), name_ar: z.string().min(2), kind: z.enum(['building', 'hall', 'lab', 'office', 'service']),
    building: z.string().min(1), floor: z.number().int().min(-2).max(20).nullable().default(null), map_x: z.number().min(0).max(100).nullable().default(null),
    map_y: z.number().min(0).max(100).nullable().default(null), directions_en: z.string().default(''), directions_ar: z.string().default(''), published: z.boolean().default(true) });
  r.post('/locations', asyncH(async (req, res) => {
    const user = me(req); const b = parse(locBody, req.body);
    const l = await ctx.db.one(`INSERT INTO locations (code, name_en, name_ar, kind, building, floor, map_x, map_y, directions_en, directions_ar, published)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [b.code, b.name_en, b.name_ar, b.kind, b.building, b.floor, b.map_x, b.map_y, b.directions_en, b.directions_ar, b.published]);
    await audit(ctx.db, user.id, 'location.create', 'location', l.id, null, b);
    res.status(201).json({ location: l });
  }));
  r.patch('/locations/:id', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req); const b = parse(locBody.partial(), req.body);
    const l = await ctx.db.tx(async (q) => {
      const before = await q.one('SELECT * FROM locations WHERE id = $1 FOR UPDATE', [id]);
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Location not found');
      const m = { ...before, ...b };
      const after = await q.one(`UPDATE locations SET code=$2, name_en=$3, name_ar=$4, kind=$5, building=$6, floor=$7, map_x=$8, map_y=$9, directions_en=$10, directions_ar=$11, published=$12
        WHERE id=$1 RETURNING *`, [id, m.code, m.name_en, m.name_ar, m.kind, m.building, m.floor, m.map_x, m.map_y, m.directions_en, m.directions_ar, m.published]);
      await audit(q, user.id, 'location.update', 'location', id, before, after);
      return after;
    });
    res.json({ location: l });
  }));

  const oppBody = z.object({ title: z.string().min(3), provider: z.string().min(2), field: z.string().min(2), kind: z.enum(['internship', 'training', 'job', 'course']),
    skills: z.array(z.string()).default([]), eligibility: z.string().min(3), opens_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    closes_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), url: z.string().url().refine((u) => u.startsWith('https://'), 'Official links must use https'),
    published: z.boolean().default(true) }).refine((o) => o.closes_on >= o.opens_on, 'closing date must be after opening date');
  r.post('/opportunities', asyncH(async (req, res) => {
    const user = me(req); const b = parse(oppBody, req.body);
    const o = await ctx.db.one(`INSERT INTO opportunities (title, provider, field, kind, skills, eligibility, opens_on, closes_on, url, published)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [b.title, b.provider, b.field, b.kind, JSON.stringify(b.skills), b.eligibility, b.opens_on, b.closes_on, b.url, b.published]);
    await audit(ctx.db, user.id, 'opportunity.create', 'opportunity', o.id, null, { title: b.title });
    res.status(201).json({ opportunity: o });
  }));

  r.get('/audit', asyncH(async (req, res) => {
    const entity = typeof req.query.entity === 'string' ? req.query.entity : null;
    res.json({ entries: await ctx.db.query(`SELECT a.*, u.name_en AS actor_en, u.name_ar AS actor_ar FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE ($1::text IS NULL OR a.entity = $1) ORDER BY a.id DESC LIMIT 200`, [entity]) });
  }));

  r.get('/assistant-log', asyncH(async (_req, res) => {
    res.json({ entries: await ctx.db.query('SELECT id, scope, course_id, question, outcome, created_at FROM assistant_log ORDER BY id DESC LIMIT 200') });
  }));

  return r;
}
