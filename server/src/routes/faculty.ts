/** WF15 publish lectures and exercises; WF16 propose a lecture time/room change. */
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppContext, AppError, asyncH, parse, authenticate, requireRole, me, z, idParam, audit, overlaps } from '../core.js';
import type { Queryable } from '../db.js';
import { chunk, indexText } from '../services/text.js';
import { notifyUsers, sectionStudents } from '../services/notify.js';

export const ALLOWED_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'image/png': '.png', 'image/jpeg': '.jpg', 'text/plain': '.txt', 'application/zip': '.zip',
};

/** Rebuilds the assistant's search index for one lecture. Only published, AI-eligible lectures are indexed. */
export async function indexLecture(q: Queryable, lectureId: number) {
  await q.query('DELETE FROM content_chunks WHERE lecture_id = $1', [lectureId]);
  const l = await q.one(`SELECT l.*, s.course_id FROM lectures l JOIN sections s ON s.id = l.section_id WHERE l.id = $1`, [lectureId]);
  if (!l || !l.published || !l.ai_source) return 0;
  const parts = chunk(`${l.title}\n\n${l.body}`);
  for (let i = 0; i < parts.length; i++) {
    await q.query(`INSERT INTO content_chunks (lecture_id, course_id, ordinal, text, tsv) VALUES ($1,$2,$3,$4, to_tsvector('simple', $5))`,
      [lectureId, l.course_id, i, parts[i], indexText(parts[i])]);
  }
  return parts.length;
}

/** Room and instructor clashes for a proposed slot in the same term. */
export async function findConflicts(q: Queryable, sectionId: number, slot: { day: number; start: string; end: string; locationId: number | null }) {
  const s = await q.one('SELECT term_id, faculty_id FROM sections WHERE id = $1', [sectionId]);
  const others = await q.query(`SELECT s.id, c.code, s.label, s.day_of_week AS day, to_char(s.start_time,'HH24:MI') AS start,
    to_char(s.end_time,'HH24:MI') AS "end", s.location_id, s.faculty_id FROM sections s JOIN courses c ON c.id = s.course_id
    WHERE s.term_id = $1 AND s.id <> $2`, [s.term_id, sectionId]);
  const conflicts: { type: 'room' | 'instructor'; sectionId: number; code: string }[] = [];
  for (const o of others) {
    if (!overlaps(slot, o)) continue;
    if (slot.locationId && o.location_id === slot.locationId) conflicts.push({ type: 'room', sectionId: o.id, code: `${o.code}-${o.label}` });
    if (s.faculty_id && o.faculty_id === s.faculty_id) conflicts.push({ type: 'instructor', sectionId: o.id, code: `${o.code}-${o.label}` });
  }
  return conflicts;
}

export function facultyRoutes(ctx: AppContext) {
  const r = Router();
  r.use(authenticate(ctx), requireRole('faculty', 'admin'));
  fs.mkdirSync(ctx.config.uploadDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: ctx.config.uploadDir,
      filename: (_req, file, cb) => cb(null, crypto.randomUUID() + (ALLOWED_MIME[file.mimetype] ?? '')),
    }),
    limits: { fileSize: ctx.config.maxUploadBytes, files: 5 },
    fileFilter: (_req, file, cb) => ALLOWED_MIME[file.mimetype] ? cb(null, true)
      : cb(new AppError(415, 'FILE_TYPE_NOT_ALLOWED', `File type ${file.mimetype} is not allowed`) as any),
  });

  async function ownSection(userId: number, role: string, sectionId: number) {
    const s = await ctx.db.one('SELECT * FROM sections WHERE id = $1', [sectionId]);
    if (!s) throw new AppError(404, 'NOT_FOUND', 'Section not found');
    if (role !== 'admin' && s.faculty_id !== userId) throw new AppError(403, 'FORBIDDEN', 'This section is not assigned to you');
    return s;
  }
  async function ownLecture(userId: number, role: string, lectureId: number) {
    const l = await ctx.db.one('SELECT * FROM lectures WHERE id = $1', [lectureId]);
    if (!l) throw new AppError(404, 'NOT_FOUND', 'Lecture not found');
    await ownSection(userId, role, l.section_id);
    return l;
  }

  r.get('/sections', asyncH(async (req, res) => {
    const user = me(req);
    const rows = await ctx.db.query(`SELECT s.id, s.label, s.capacity, s.day_of_week AS day, to_char(s.start_time,'HH24:MI') AS start,
      to_char(s.end_time,'HH24:MI') AS "end", c.code, c.title_en, c.title_ar, l.id AS location_id, l.name_en AS location_en, l.name_ar AS location_ar,
      (SELECT count(*)::int FROM enrollments e WHERE e.section_id = s.id AND e.status = 'registered') AS enrolled,
      (SELECT count(*)::int FROM lectures x WHERE x.section_id = s.id) AS lectures
      FROM sections s JOIN courses c ON c.id = s.course_id JOIN terms t ON t.id = s.term_id LEFT JOIN locations l ON l.id = s.location_id
      WHERE t.is_current AND ($1::text = 'admin' OR s.faculty_id = $2) ORDER BY c.code`, [user.role, user.id]);
    res.json({ sections: rows });
  }));

  const lectureBody = z.object({
    title: z.string().trim().min(3).max(200), body: z.string().max(50000).default(''),
    week: z.number().int().min(1).max(16).nullable().optional(), aiSource: z.boolean().default(true), publish: z.boolean().default(false),
  });

  r.post('/sections/:id/lectures', asyncH(async (req, res) => {
    const user = me(req); const sectionId = idParam(req);
    await ownSection(user.id, user.role, sectionId);
    const b = parse(lectureBody, req.body);
    const lecture = await ctx.db.tx(async (q) => {
      const l = await q.one(`INSERT INTO lectures (section_id, title, body, week, published, ai_source, created_by, published_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $5 THEN now() END) RETURNING *`,
        [sectionId, b.title, b.body, b.week ?? null, b.publish, b.aiSource, user.id]);
      await indexLecture(q, l.id);
      if (b.publish) await announceLecture(q, l);
      await audit(q, user.id, 'lecture.create', 'lecture', l.id, null, { title: l.title, published: l.published });
      return l;
    });
    res.status(201).json({ lecture });
  }));

  async function announceLecture(q: Queryable, l: any) {
    const c = await q.one(`SELECT c.code, c.title_en, c.title_ar FROM sections s JOIN courses c ON c.id = s.course_id WHERE s.id = $1`, [l.section_id]);
    await notifyUsers(q, await sectionStudents(q, l.section_id), {
      kind: 'lecture_published', dedupeKey: `lecture-published:${l.id}`, link: `/student/courses/${l.section_id}/lectures/${l.id}`,
      title_en: `New lecture in ${c.code}: ${l.title}`, title_ar: `محاضرة جديدة في ${c.code}: ${l.title}`,
      body_en: `${c.title_en}`, body_ar: `${c.title_ar}`,
    });
  }

  r.patch('/lectures/:id', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    const before = await ownLecture(user.id, user.role, id);
    const b = parse(lectureBody.partial(), req.body);
    const lecture = await ctx.db.tx(async (q) => {
      const l = await q.one(`UPDATE lectures SET title = COALESCE($2, title), body = COALESCE($3, body), week = COALESCE($4, week),
        ai_source = COALESCE($5, ai_source), published = COALESCE($6, published),
        published_at = CASE WHEN COALESCE($6, published) AND published_at IS NULL THEN now() ELSE published_at END
        WHERE id = $1 RETURNING *`, [id, b.title ?? null, b.body ?? null, b.week ?? null, b.aiSource ?? null, b.publish ?? null]);
      await indexLecture(q, id);
      if (!before.published && l.published) await announceLecture(q, l);
      await audit(q, user.id, 'lecture.update', 'lecture', id, { title: before.title, published: before.published }, { title: l.title, published: l.published });
      return l;
    });
    res.json({ lecture });
  }));

  r.post('/lectures/:id/attachments', upload.array('files', 5), asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    const files = (req.files as Express.Multer.File[]) ?? [];
    try { await ownLecture(user.id, user.role, id); } catch (e) { files.forEach((f) => fs.rmSync(f.path, { force: true })); throw e; }
    if (!files.length) throw new AppError(400, 'VALIDATION_ERROR', 'No file uploaded');
    const saved = [];
    for (const f of files) {
      saved.push(await ctx.db.one(`INSERT INTO attachments (lecture_id, filename, mime, size_bytes, storage_key) VALUES ($1,$2,$3,$4,$5)
        RETURNING id, filename, mime, size_bytes`, [id, Buffer.from(f.originalname, 'latin1').toString('utf8'), f.mimetype, f.size, path.basename(f.path)]));
    }
    await audit(ctx.db, user.id, 'attachment.upload', 'lecture', id, null, { files: saved.map((s: any) => s.filename) });
    res.status(201).json({ attachments: saved });
  }));

  r.post('/lectures/:id/exercises', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    await ownLecture(user.id, user.role, id);
    const b = parse(z.object({
      question: z.string().trim().min(3), choices: z.array(z.string().min(1)).max(6).default([]),
      correctIndex: z.number().int().min(0).nullable().optional(), modelAnswer: z.string().default(''), feedback: z.string().default(''),
    }).refine((x) => x.correctIndex == null || x.correctIndex < x.choices.length, 'correctIndex out of range'), req.body);
    const x = await ctx.db.one(`INSERT INTO exercises (lecture_id, question, choices, correct_index, model_answer, feedback)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [id, b.question, JSON.stringify(b.choices), b.correctIndex ?? null, b.modelAnswer, b.feedback]);
    res.status(201).json({ exercise: x });
  }));

  // WF16: faculty propose; administration approves and publishes.
  const slotBody = z.object({
    day: z.number().int().min(0).max(6), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/),
    locationId: z.number().int().positive().nullable(), reason: z.string().trim().min(5).max(500),
  }).refine((s) => s.end > s.start, 'end must be after start');

  r.post('/sections/:id/conflicts', asyncH(async (req, res) => {
    const user = me(req); const sectionId = idParam(req);
    await ownSection(user.id, user.role, sectionId);
    const b = parse(slotBody, { reason: 'preview', ...req.body });
    res.json({ conflicts: await findConflicts(ctx.db, sectionId, b) });
  }));

  r.post('/sections/:id/change-requests', asyncH(async (req, res) => {
    const user = me(req); const sectionId = idParam(req);
    await ownSection(user.id, user.role, sectionId);
    const b = parse(slotBody, req.body);
    const conflicts = await findConflicts(ctx.db, sectionId, b);
    if (conflicts.length) throw new AppError(409, 'SCHEDULE_CONFLICT', 'The proposed time conflicts with another lecture', conflicts);
    const pending = await ctx.db.one(`SELECT id FROM change_requests WHERE section_id = $1 AND status = 'pending'`, [sectionId]);
    if (pending) throw new AppError(409, 'REQUEST_PENDING', 'A change request for this section is already waiting for approval');
    const cr = await ctx.db.one(`INSERT INTO change_requests (section_id, requested_by, new_day, new_start, new_end, new_location_id, reason, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`, [sectionId, user.id, b.day, b.start, b.end, b.locationId, b.reason]);
    await audit(ctx.db, user.id, 'change_request.create', 'change_request', cr.id, null, b);
    res.status(201).json({ changeRequest: cr, message: 'Sent to administration for approval. Students are notified only after approval.' });
  }));

  r.get('/change-requests', asyncH(async (req, res) => {
    const user = me(req);
    res.json({ changeRequests: await ctx.db.query(`SELECT cr.*, to_char(cr.new_start,'HH24:MI') AS new_start, to_char(cr.new_end,'HH24:MI') AS new_end,
      c.code, s.label FROM change_requests cr JOIN sections s ON s.id = cr.section_id JOIN courses c ON c.id = s.course_id
      WHERE ($1::text = 'admin' OR cr.requested_by = $2) ORDER BY cr.created_at DESC`, [user.role, user.id]) });
  }));

  return r;
}
