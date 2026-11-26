/** WF02 academic overview, WF03 registration, WF04 drop. */
import { Router } from 'express';
import {
  AppContext, AppError, asyncH, parse, authenticate, requireRole, me, z, audit, getSetting,
  overlaps, PASSING_MIN_POINTS,
} from '../core.js';
import type { Queryable } from '../db.js';

type Slot = { day: number; start: string; end: string };

const SECTION_SELECT = `
  SELECT s.id, s.label, s.capacity, s.day_of_week AS day, to_char(s.start_time,'HH24:MI') AS start, to_char(s.end_time,'HH24:MI') AS "end",
         c.id AS course_id, c.code, c.title_en, c.title_ar, c.credit_hours,
         l.id AS location_id, l.code AS location_code, l.name_en AS location_en, l.name_ar AS location_ar,
         f.name_en AS faculty_en, f.name_ar AS faculty_ar,
         (SELECT count(*)::int FROM enrollments e WHERE e.section_id = s.id AND e.status = 'registered') AS enrolled
  FROM sections s JOIN courses c ON c.id = s.course_id
  LEFT JOIN locations l ON l.id = s.location_id LEFT JOIN users f ON f.id = s.faculty_id`;

export async function currentTerm(q: Queryable) {
  const t = await q.one(`SELECT *, (now() BETWEEN reg_opens_at AND reg_closes_at) AS reg_open, (now() <= drop_deadline) AS drop_open
                         FROM terms WHERE is_current LIMIT 1`);
  if (!t) throw new AppError(404, 'NO_CURRENT_TERM', 'No active academic term is configured');
  return t;
}

/** Course ids the student has passed (completed with a passing grade). */
async function passedCourses(q: Queryable, studentId: number): Promise<Set<number>> {
  const rows = await q.query(`SELECT DISTINCT s.course_id FROM enrollments e JOIN sections s ON s.id = e.section_id
    WHERE e.student_id = $1 AND e.status = 'completed' AND e.grade_points >= $2`, [studentId, PASSING_MIN_POINTS]);
  return new Set(rows.map((r: any) => r.course_id));
}

export interface RegistrationCheck {
  ok: boolean;
  totalCredits: number;
  errors: { sectionId?: number; code: string; message: string }[];
}

/** Every registration rule in one place; run on preview and again inside the commit transaction. */
async function checkRegistration(q: Queryable, studentId: number, sectionIds: number[], lock: boolean): Promise<RegistrationCheck> {
  const errors: RegistrationCheck['errors'] = [];
  const term = await currentTerm(q);
  if (!term.reg_open) errors.push({ code: 'REGISTRATION_CLOSED', message: 'The registration window is closed' });
  const minC = await getSetting(q, 'min_credits', 12);
  const maxC = await getSetting(q, 'max_credits', 18);
  if (new Set(sectionIds).size !== sectionIds.length) errors.push({ code: 'DUPLICATE_SELECTION', message: 'A section was selected twice' });

  const sections = await q.query(`${SECTION_SELECT} WHERE s.id = ANY($1::int[]) AND s.term_id = $2 ORDER BY s.id ${lock ? 'FOR UPDATE OF s' : ''}`,
    [sectionIds, term.id]);
  for (const id of sectionIds) if (!sections.find((s: any) => s.id === id)) {
    errors.push({ sectionId: id, code: 'SECTION_NOT_OFFERED', message: 'Section is not offered in the current term' });
  }
  const current = await q.query(`${SECTION_SELECT} JOIN enrollments e ON e.section_id = s.id
    WHERE e.student_id = $1 AND e.status = 'registered' AND s.term_id = $2`, [studentId, term.id]);
  const passed = await passedCourses(q, studentId);
  const prereqs = await q.query(`SELECT course_id, prereq_id, c.code FROM course_prereqs p JOIN courses c ON c.id = p.prereq_id`);

  const seenCourses = new Set(current.map((s: any) => s.course_id));
  const slots: (Slot & { code: string })[] = current.map((s: any) => ({ day: s.day, start: s.start, end: s.end, code: s.code }));
  let total = current.reduce((a: number, s: any) => a + s.credit_hours, 0);

  for (const s of sections) {
    if (seenCourses.has(s.course_id)) {
      errors.push({ sectionId: s.id, code: 'ALREADY_REGISTERED', message: `${s.code} is already registered this term` });
      continue;
    }
    if (passed.has(s.course_id)) errors.push({ sectionId: s.id, code: 'ALREADY_PASSED', message: `${s.code} was already passed` });
    const missing = prereqs.filter((p: any) => p.course_id === s.course_id && !passed.has(p.prereq_id)).map((p: any) => p.code);
    if (missing.length) errors.push({ sectionId: s.id, code: 'PREREQUISITE_MISSING', message: `${s.code} requires ${missing.join(', ')}` });
    if (s.enrolled >= s.capacity) errors.push({ sectionId: s.id, code: 'SECTION_FULL', message: `${s.code} section ${s.label} is full` });
    const clash = slots.find((x) => overlaps(x, s));
    if (clash) errors.push({ sectionId: s.id, code: 'SCHEDULE_CONFLICT', message: `${s.code} conflicts with ${clash.code}` });
    slots.push({ day: s.day, start: s.start, end: s.end, code: s.code });
    seenCourses.add(s.course_id);
    total += s.credit_hours;
  }
  if (total > maxC) errors.push({ code: 'CREDIT_LIMIT_EXCEEDED', message: `Total ${total} credit hours exceeds the maximum of ${maxC}` });
  return { ok: errors.length === 0, totalCredits: total, errors, ...{ minCredits: minC, maxCredits: maxC } } as any;
}

export function studentRoutes(ctx: AppContext) {
  const r = Router();
  r.use(authenticate(ctx), requireRole('student'));

  // WF02: academic overview for a selected term
  r.get('/overview', asyncH(async (req, res) => {
    const user = me(req);
    const profile = await ctx.db.one(`SELECT u.id, u.university_id, u.email, u.name_en, u.name_ar, u.is_demo, st.study_year,
      m.code AS major_code, m.name_en AS major_en, m.name_ar AS major_ar
      FROM users u JOIN students st ON st.user_id = u.id JOIN majors m ON m.id = st.major_id WHERE u.id = $1`, [user.id]);
    const terms = await ctx.db.query(`SELECT DISTINCT t.id, t.code, t.name_en, t.name_ar, t.is_current, t.results_published, t.starts_on
      FROM terms t JOIN sections s ON s.term_id = t.id JOIN enrollments e ON e.section_id = s.id
      WHERE e.student_id = $1 OR t.is_current ORDER BY t.starts_on DESC`, [user.id]);
    const termId = req.query.termId ? Number(req.query.termId) : terms.find((t: any) => t.is_current)?.id ?? terms[0]?.id;
    const term = terms.find((t: any) => t.id === termId);
    const courses = term ? await ctx.db.query(`${SECTION_SELECT.replace('SELECT s.id', 'SELECT e.id AS enrollment_id, e.status, e.grade, e.grade_points, s.id')}
      JOIN enrollments e ON e.section_id = s.id
      WHERE e.student_id = $1 AND s.term_id = $2 AND e.status <> 'dropped' ORDER BY s.day_of_week, s.start_time`, [user.id, term.id]) : [];
    // Official grades are read-only and only visible once results are published.
    for (const c of courses as any[]) if (!term.results_published) { c.grade = null; c.grade_points = null; }
    const gpa = await ctx.db.one(`SELECT round(sum(e.grade_points * c.credit_hours) / NULLIF(sum(c.credit_hours),0), 2) AS cgpa,
      sum(CASE WHEN e.grade_points >= $2 THEN c.credit_hours ELSE 0 END)::int AS earned
      FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN courses c ON c.id = s.course_id JOIN terms t ON t.id = s.term_id
      WHERE e.student_id = $1 AND e.status = 'completed' AND t.results_published`, [user.id, PASSING_MIN_POINTS]);
    const termGpa = term?.results_published ? await ctx.db.one(`SELECT round(sum(e.grade_points * c.credit_hours) / NULLIF(sum(c.credit_hours),0), 2) AS gpa
      FROM enrollments e JOIN sections s ON s.id = e.section_id JOIN courses c ON c.id = s.course_id
      WHERE e.student_id = $1 AND s.term_id = $2 AND e.status = 'completed'`, [user.id, term.id]) : null;
    const updated = await ctx.db.one(`SELECT max(at) AS at FROM audit_log WHERE entity IN ('enrollment','section','term','system')`);
    res.json({
      profile, terms, term: term ?? null, courses,
      cgpa: gpa?.cgpa != null ? Number(gpa.cgpa) : null, earnedCredits: gpa?.earned ?? 0,
      termGpa: termGpa?.gpa != null ? Number(termGpa.gpa) : null,
      resultsPublished: !!term?.results_published,
      lastUpdated: updated?.at ?? null,
      dataSource: profile?.is_demo ? 'demo' : 'official',
    });
  }));

  // WF03: what can be registered right now
  r.get('/registration', asyncH(async (req, res) => {
    const user = me(req);
    const term = await currentTerm(ctx.db);
    const passed = await passedCourses(ctx.db, user.id);
    const prereqs = await ctx.db.query(`SELECT course_id, prereq_id, c.code FROM course_prereqs p JOIN courses c ON c.id = p.prereq_id`);
    const registered = await ctx.db.query(`${SECTION_SELECT.replace('SELECT s.id', 'SELECT e.id AS enrollment_id, s.id')}
      JOIN enrollments e ON e.section_id = s.id WHERE e.student_id = $1 AND e.status = 'registered' AND s.term_id = $2`, [user.id, term.id]);
    const regCourses = new Set(registered.map((s: any) => s.course_id));
    const offerings = (await ctx.db.query(`${SECTION_SELECT} WHERE s.term_id = $1 ORDER BY c.code, s.label`, [term.id])).map((s: any) => {
      const missing = prereqs.filter((p: any) => p.course_id === s.course_id && !passed.has(p.prereq_id)).map((p: any) => p.code);
      let status = 'available';
      if (regCourses.has(s.course_id)) status = 'registered';
      else if (passed.has(s.course_id)) status = 'passed';
      else if (missing.length) status = 'prerequisite_missing';
      else if (s.enrolled >= s.capacity) status = 'full';
      return { ...s, seatsLeft: Math.max(0, s.capacity - s.enrolled), missingPrereqs: missing, status };
    });
    res.json({
      term: { id: term.id, code: term.code, name_en: term.name_en, name_ar: term.name_ar, reg_opens_at: term.reg_opens_at,
        reg_closes_at: term.reg_closes_at, drop_deadline: term.drop_deadline, regOpen: term.reg_open, dropOpen: term.drop_open },
      minCredits: await getSetting(ctx.db, 'min_credits', 12), maxCredits: await getSetting(ctx.db, 'max_credits', 18),
      registeredCredits: registered.reduce((a: number, s: any) => a + s.credit_hours, 0),
      registered, offerings,
    });
  }));

  r.post('/registration/validate', asyncH(async (req, res) => {
    const { sectionIds } = parse(z.object({ sectionIds: z.array(z.number().int().positive()).min(1).max(10) }), req.body);
    res.json(await checkRegistration(ctx.db, me(req).id, sectionIds, false));
  }));

  r.post('/registration/confirm', asyncH(async (req, res) => {
    const user = me(req);
    const { sectionIds } = parse(z.object({ sectionIds: z.array(z.number().int().positive()).min(1).max(10) }), req.body);
    const result = await ctx.db.tx(async (q) => {
      // Re-validate under row locks so seats and rules cannot change between check and save.
      const check = await checkRegistration(q, user.id, sectionIds, true);
      if (!check.ok) throw new AppError(409, 'REGISTRATION_REJECTED', 'Registration could not be completed', check.errors);
      for (const id of sectionIds) {
        const e = await q.one(`INSERT INTO enrollments (student_id, section_id, status) VALUES ($1,$2,'registered') RETURNING id`, [user.id, id]);
        await audit(q, user.id, 'enrollment.register', 'enrollment', e.id, null, { sectionId: id });
      }
      return check;
    });
    res.status(201).json({ message: 'Registration saved', totalCredits: result.totalCredits });
  }));

  // WF04: preview the effect of dropping, then drop with explicit confirmation
  async function dropCheck(q: Queryable, studentId: number, enrollmentId: number, lock: boolean) {
    const term = await currentTerm(q);
    const e = await q.one(`SELECT e.id, e.status, s.term_id, c.code, c.credit_hours, s.id AS section_id FROM enrollments e
      JOIN sections s ON s.id = e.section_id JOIN courses c ON c.id = s.course_id
      WHERE e.id = $1 AND e.student_id = $2 ${lock ? 'FOR UPDATE OF e' : ''}`, [enrollmentId, studentId]);
    if (!e) throw new AppError(404, 'NOT_FOUND', 'Registered course not found');
    if (e.status !== 'registered' || e.term_id !== term.id) throw new AppError(409, 'NOT_DROPPABLE', 'Only courses registered in the current term can be dropped');
    if (!term.drop_open) throw new AppError(409, 'DROP_DEADLINE_PASSED', 'The drop deadline has passed');
    const cur = await q.one(`SELECT COALESCE(sum(c.credit_hours),0)::int AS total FROM enrollments e JOIN sections s ON s.id = e.section_id
      JOIN courses c ON c.id = s.course_id WHERE e.student_id = $1 AND e.status = 'registered' AND s.term_id = $2`, [studentId, term.id]);
    const minC = await getSetting(q, 'min_credits', 12);
    const after = cur.total - e.credit_hours;
    return { enrollment: e, creditsBefore: cur.total, creditsAfter: after, minCredits: minC, belowMinimum: after < minC };
  }

  r.post('/drop/preview', asyncH(async (req, res) => {
    const { enrollmentId } = parse(z.object({ enrollmentId: z.number().int().positive() }), req.body);
    res.json(await dropCheck(ctx.db, me(req).id, enrollmentId, false));
  }));

  r.post('/drop', asyncH(async (req, res) => {
    const user = me(req);
    const { enrollmentId, confirm } = parse(z.object({ enrollmentId: z.number().int().positive(), confirm: z.literal(true) }), req.body);
    const out = await ctx.db.tx(async (q) => {
      const c = await dropCheck(q, user.id, enrollmentId, true);
      if (c.belowMinimum) throw new AppError(409, 'BELOW_MIN_CREDITS', `Dropping leaves ${c.creditsAfter} credit hours, below the minimum of ${c.minCredits}`);
      await q.query(`UPDATE enrollments SET status = 'dropped', dropped_at = now() WHERE id = $1`, [enrollmentId]);
      await audit(q, user.id, 'enrollment.drop', 'enrollment', enrollmentId, { status: 'registered' }, { status: 'dropped' });
      return c;
    });
    res.json({ message: `${out.enrollment.code} dropped`, creditsAfter: out.creditsAfter });
  }));

  return r;
}
