/** WF05 lectures, files and exercises; WF06 course study assistant. */
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { AppContext, AppError, asyncH, parse, authenticate, me, z, idParam, AuthUser } from '../core.js';
import type { Queryable } from '../db.js';
import { bestSentences, terms, tsQuery, splitSentences } from '../services/text.js';

/** Returns the access level a user has on a section, or throws 403. */
export async function sectionAccess(q: Queryable, user: AuthUser, sectionId: number): Promise<'student' | 'teacher' | 'admin'> {
  const s = await q.one('SELECT id, faculty_id FROM sections WHERE id = $1', [sectionId]);
  if (!s) throw new AppError(404, 'NOT_FOUND', 'Course section not found');
  if (user.role === 'admin') return 'admin';
  if (user.role === 'faculty' && s.faculty_id === user.id) return 'teacher';
  if (user.role === 'student') {
    const e = await q.one(`SELECT 1 FROM enrollments WHERE student_id = $1 AND section_id = $2 AND status IN ('registered','completed')`, [user.id, sectionId]);
    if (e) return 'student';
  }
  throw new AppError(403, 'FORBIDDEN', 'You are not enrolled in or assigned to this course');
}

export async function retrieve(q: Queryable, sectionId: number, question: string, limit = 4) {
  const tq = tsQuery(question);
  if (!tq) return [];
  return q.query(`SELECT ch.id, ch.text, ch.lecture_id, l.title, ts_rank(ch.tsv, to_tsquery('simple', $2)) AS rank
    FROM content_chunks ch JOIN lectures l ON l.id = ch.lecture_id
    WHERE l.section_id = $1 AND l.published AND l.ai_source AND ch.tsv @@ to_tsquery('simple', $2)
    ORDER BY rank DESC, ch.id LIMIT $3`, [sectionId, tq, limit]);
}

export function learningRoutes(ctx: AppContext) {
  const r = Router();
  r.use(authenticate(ctx));

  // Courses for the signed-in user (student: current registrations; faculty: assigned sections).
  r.get('/courses', asyncH(async (req, res) => {
    const user = me(req);
    const base = `SELECT s.id AS section_id, s.label, c.id AS course_id, c.code, c.title_en, c.title_ar, c.credit_hours, t.name_en AS term_en, t.name_ar AS term_ar,
      (SELECT count(*)::int FROM lectures l WHERE l.section_id = s.id AND l.published) AS lecture_count
      FROM sections s JOIN courses c ON c.id = s.course_id JOIN terms t ON t.id = s.term_id`;
    const rows = user.role === 'student'
      ? await ctx.db.query(`${base} JOIN enrollments e ON e.section_id = s.id WHERE e.student_id = $1 AND e.status = 'registered' AND t.is_current ORDER BY c.code`, [user.id])
      : user.role === 'faculty'
        ? await ctx.db.query(`${base} WHERE s.faculty_id = $1 AND t.is_current ORDER BY c.code`, [user.id])
        : await ctx.db.query(`${base} WHERE t.is_current ORDER BY c.code`);
    res.json({ courses: rows });
  }));

  r.get('/sections/:id/lectures', asyncH(async (req, res) => {
    const user = me(req); const sectionId = idParam(req);
    const access = await sectionAccess(ctx.db, user, sectionId);
    const course = await ctx.db.one(`SELECT s.id AS section_id, s.label, c.code, c.title_en, c.title_ar, c.description FROM sections s
      JOIN courses c ON c.id = s.course_id WHERE s.id = $1`, [sectionId]);
    // Unpublished lectures stay hidden from students.
    const lectures = await ctx.db.query(`SELECT l.id, l.title, l.week, l.published, l.ai_source, l.published_at, l.created_at,
      (SELECT count(*)::int FROM attachments a WHERE a.lecture_id = l.id) AS attachment_count,
      (SELECT count(*)::int FROM exercises x WHERE x.lecture_id = l.id) AS exercise_count
      FROM lectures l WHERE l.section_id = $1 ${access === 'student' ? 'AND l.published' : ''} ORDER BY l.week NULLS LAST, l.id`, [sectionId]);
    res.json({ course, lectures, canEdit: access !== 'student' });
  }));

  r.get('/lectures/:id', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    const l = await ctx.db.one('SELECT * FROM lectures WHERE id = $1', [id]);
    if (!l) throw new AppError(404, 'NOT_FOUND', 'Lecture not found');
    const access = await sectionAccess(ctx.db, user, l.section_id);
    if (access === 'student' && !l.published) throw new AppError(404, 'NOT_FOUND', 'Lecture not found');
    const attachments = await ctx.db.query('SELECT id, filename, mime, size_bytes FROM attachments WHERE lecture_id = $1 ORDER BY id', [id]);
    const exercises = await ctx.db.query(`SELECT id, question, choices ${access === 'student' ? '' : ', correct_index, model_answer, feedback'}
      FROM exercises WHERE lecture_id = $1 ORDER BY id`, [id]);
    res.json({ lecture: l, attachments, exercises });
  }));

  r.get('/attachments/:id/download', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    const a = await ctx.db.one(`SELECT a.*, l.section_id, l.published FROM attachments a JOIN lectures l ON l.id = a.lecture_id WHERE a.id = $1`, [id]);
    if (!a) throw new AppError(404, 'NOT_FOUND', 'File not found');
    const access = await sectionAccess(ctx.db, user, a.section_id);
    if (access === 'student' && !a.published) throw new AppError(404, 'NOT_FOUND', 'File not found');
    const file = path.join(ctx.config.uploadDir, a.storage_key);
    if (!fs.existsSync(file)) throw new AppError(410, 'FILE_UNAVAILABLE', 'The file is no longer available');
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
    fs.createReadStream(file).pipe(res);
  }));

  // Optional practice: checks an answer and returns feedback. Never writes a grade.
  r.post('/exercises/:id/attempt', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    const body = parse(z.object({ choiceIndex: z.number().int().min(0).optional(), answer: z.string().max(4000).optional() }), req.body);
    const x = await ctx.db.one(`SELECT x.*, l.section_id, l.published FROM exercises x JOIN lectures l ON l.id = x.lecture_id WHERE x.id = $1`, [id]);
    if (!x || !x.published) throw new AppError(404, 'NOT_FOUND', 'Exercise not found');
    await sectionAccess(ctx.db, user, x.section_id);
    const correct = x.correct_index == null ? null : body.choiceIndex === x.correct_index;
    res.json({ correct, feedback: x.feedback, modelAnswer: x.model_answer, affectsGrade: false });
  }));

  // WF06: course-scoped study assistant (retrieval over authorised lecture passages only).
  r.post('/sections/:id/assistant', asyncH(async (req, res) => {
    const user = me(req); const sectionId = idParam(req);
    const { question, lang } = parse(z.object({ question: z.string().trim().min(1).max(1000), lang: z.enum(['ar', 'en']).default('ar') }), req.body);
    await sectionAccess(ctx.db, user, sectionId);
    const log = (outcome: string, sources: unknown[] = []) => ctx.db.query(
      `INSERT INTO assistant_log (user_id, scope, course_id, question, outcome, sources) VALUES ($1,'course',$2,$3,$4,$5)`,
      [user.id, sectionId, question, outcome, JSON.stringify(sources)]);

    if (terms(question).length < 1) {
      await log('clarify');
      return res.json({ status: 'clarify', message: lang === 'ar'
        ? 'ممكن توضح سؤالك أكتر؟ اذكر الموضوع أو المصطلح اللي عايز تفهمه.'
        : 'Could you clarify your question? Mention the topic or term you want to understand.' });
    }
    const hits = await retrieve(ctx.db, sectionId, question);
    if (!hits.length) {
      await log('insufficient_evidence');
      return res.json({ status: 'insufficient_evidence', message: lang === 'ar'
        ? 'مش لاقي في محاضرات المقرر المنشورة معلومة كافية للإجابة. راجع عضو هيئة التدريس أو جرّب صياغة تانية.'
        : 'The published lectures of this course do not contain enough evidence to answer. Ask your instructor or rephrase.' });
    }
    const sources = hits.map((h: any, i: number) => ({ n: i + 1, chunkId: h.id, lectureId: h.lecture_id, title: h.title,
      excerpt: h.text.length > 240 ? h.text.slice(0, 240) + '…' : h.text }));
    let answer: string | null = null; let mode = 'extractive';
    if (ctx.llm) {
      answer = await ctx.llm.answer(question, hits.map((h: any) => ({ id: h.id, title: h.title, text: h.text })), lang);
      if (answer) mode = 'llm';
    }
    if (!answer) {
      const picked = bestSentences(question, hits.map((h: any) => h.text), 3);
      if (!picked.length) {
        await log('insufficient_evidence');
        return res.json({ status: 'insufficient_evidence', message: lang === 'ar' ? 'الأدلة المتاحة غير كافية للإجابة.' : 'Not enough evidence to answer.' });
      }
      answer = picked.map((s) => {
        const n = hits.findIndex((h: any) => h.text.includes(s)) + 1;
        return `${s} [${n || 1}]`;
      }).join(' ');
    }
    await log('answered', sources);
    res.json({ status: 'answered', mode, answer, sources });
  }));

  // Lecture summary: key sentences (extractive) from a published lecture.
  r.post('/lectures/:id/summary', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    const l = await ctx.db.one('SELECT * FROM lectures WHERE id = $1', [id]);
    if (!l) throw new AppError(404, 'NOT_FOUND', 'Lecture not found');
    const access = await sectionAccess(ctx.db, user, l.section_id);
    if (access === 'student' && (!l.published || !l.ai_source)) throw new AppError(404, 'NOT_FOUND', 'Lecture not available to the assistant');
    const paragraphs = l.body.split(/\n\s*\n/).filter((p: string) => p.trim());
    const points = paragraphs.map((p: string) => splitSentences(p)[0]).filter(Boolean).slice(0, 6);
    res.json({ title: l.title, points, source: { lectureId: l.id, title: l.title } });
  }));

  return r;
}
