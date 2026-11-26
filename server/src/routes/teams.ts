/**
 * WF11-WF14 - Project teams.
 * Rules: the owner counts toward the team size; a student may own one open
 * team at a time; one pending request per student per team; acceptance is
 * done under a row lock on the team so concurrent accepts can never exceed
 * the target size.
 */
import { Router } from 'express';
import { AppContext, AppError, asyncH, parse, authenticate, requireRole, me, z, idParam, audit, getSetting } from '../core.js';
import type { Queryable } from '../db.js';
import { normalize } from '../services/text.js';
import { notifyUsers } from '../services/notify.js';

const TEAM_SELECT = `SELECT t.*, u.name_en AS owner_en, u.name_ar AS owner_ar,
  (SELECT count(*)::int FROM team_members m WHERE m.team_id = t.id) AS member_count FROM teams t JOIN users u ON u.id = t.owner_id`;

export function teamRoutes(ctx: AppContext) {
  const r = Router();
  r.use(authenticate(ctx), requireRole('student'));

  const teamBody = z.object({
    title: z.string().trim().min(3).max(120), description: z.string().trim().min(10).max(2000),
    targetSize: z.number().int().min(2).max(10),
    roles: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
    skills: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    ownerRole: z.string().trim().min(1).max(60).default('Team lead'),
  });

  async function ownedTeam(q: Queryable, userId: number, teamId: number, lock = false) {
    const t = await q.one(`SELECT * FROM teams WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [teamId]);
    if (!t) throw new AppError(404, 'NOT_FOUND', 'Team not found');
    if (t.owner_id !== userId) throw new AppError(403, 'NOT_TEAM_OWNER', 'Only the team owner can do this');
    return t;
  }

  r.get('/', asyncH(async (req, res) => {
    const q = typeof req.query.q === 'string' ? normalize(req.query.q) : '';
    const skill = typeof req.query.skill === 'string' ? normalize(req.query.skill) : '';
    const status = req.query.status === 'all' ? null : 'open';
    let rows = await ctx.db.query(`${TEAM_SELECT} ${status ? "WHERE t.status = 'open'" : ''} ORDER BY t.created_at DESC`);
    if (q) rows = rows.filter((t: any) => normalize(`${t.title} ${t.description} ${t.roles.join(' ')}`).includes(q));
    if (skill) rows = rows.filter((t: any) => t.skills.some((s: string) => normalize(s).includes(skill)));
    const mine = await ctx.db.query(`SELECT team_id, status FROM join_requests WHERE applicant_id = $1 AND status = 'pending'`, [me(req).id]);
    res.json({ teams: rows.map((t: any) => ({ ...t, full: t.member_count >= t.target_size, myRequest: mine.find((m: any) => m.team_id === t.id)?.status ?? null })) });
  }));

  r.get('/mine', asyncH(async (req, res) => {
    const user = me(req);
    const owned = await ctx.db.query(`${TEAM_SELECT} WHERE t.owner_id = $1 ORDER BY t.created_at DESC`, [user.id]);
    const memberOf = await ctx.db.query(`${TEAM_SELECT} JOIN team_members m ON m.team_id = t.id WHERE m.user_id = $1 AND t.owner_id <> $1`, [user.id]);
    const requests = await ctx.db.query(`SELECT jr.*, t.title FROM join_requests jr JOIN teams t ON t.id = jr.team_id
      WHERE jr.applicant_id = $1 ORDER BY jr.created_at DESC`, [user.id]);
    res.json({ owned, memberOf, requests });
  }));

  r.get('/:id', asyncH(async (req, res) => {
    const id = idParam(req);
    const t = await ctx.db.one(`${TEAM_SELECT} WHERE t.id = $1`, [id]);
    if (!t) throw new AppError(404, 'NOT_FOUND', 'Team not found');
    const members = await ctx.db.query(`SELECT m.user_id, m.role, m.joined_at, u.name_en, u.name_ar FROM team_members m
      JOIN users u ON u.id = m.user_id WHERE m.team_id = $1 ORDER BY m.joined_at`, [id]);
    res.json({ team: { ...t, full: t.member_count >= t.target_size }, members, isOwner: t.owner_id === me(req).id });
  }));

  // WF11: create and publish (preview happens client-side before this call)
  r.post('/', asyncH(async (req, res) => {
    const user = me(req);
    const b = parse(teamBody, req.body);
    const maxSize = await getSetting(ctx.db, 'max_team_size', 6);
    if (b.targetSize > maxSize) throw new AppError(400, 'TEAM_TOO_LARGE', `Team size cannot exceed ${maxSize}`);
    const team = await ctx.db.tx(async (q) => {
      const existing = await q.one(`SELECT id FROM teams WHERE owner_id = $1 AND status = 'open' FOR UPDATE`, [user.id]);
      if (existing) throw new AppError(409, 'ALREADY_OWNS_OPEN_TEAM', 'You already own an open team. Close it before creating another.');
      const t = await q.one(`INSERT INTO teams (owner_id, title, description, target_size, roles, skills, status)
        VALUES ($1,$2,$3,$4,$5,$6,'open') RETURNING *`, [user.id, b.title, b.description, b.targetSize, JSON.stringify(b.roles), JSON.stringify(b.skills)]);
      await q.query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1,$2,$3)', [t.id, user.id, b.ownerRole]);
      await audit(q, user.id, 'team.create', 'team', t.id, null, { title: t.title, targetSize: t.target_size });
      return t;
    });
    res.status(201).json({ team });
  }));

  // WF14: owner settings
  r.patch('/:id', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    const b = parse(teamBody.omit({ ownerRole: true }).partial().extend({ status: z.enum(['open', 'closed']).optional() }), req.body);
    const team = await ctx.db.tx(async (q) => {
      const t = await ownedTeam(q, user.id, id, true);
      const count = (await q.one('SELECT count(*)::int AS n FROM team_members WHERE team_id = $1', [id])).n;
      if (b.targetSize != null && b.targetSize < count) throw new AppError(409, 'SIZE_BELOW_MEMBERS', `The team already has ${count} members`);
      const maxSize = await getSetting(q, 'max_team_size', 6);
      if (b.targetSize != null && b.targetSize > maxSize) throw new AppError(400, 'TEAM_TOO_LARGE', `Team size cannot exceed ${maxSize}`);
      if (b.status === 'open' && t.status !== 'open') {
        const other = await q.one(`SELECT id FROM teams WHERE owner_id = $1 AND status = 'open' AND id <> $2`, [user.id, id]);
        if (other) throw new AppError(409, 'ALREADY_OWNS_OPEN_TEAM', 'You already own another open team');
        if (count >= (b.targetSize ?? t.target_size)) throw new AppError(409, 'TEAM_FULL', 'Increase the team size before reopening recruitment');
      }
      const u = await q.one(`UPDATE teams SET title = COALESCE($2,title), description = COALESCE($3,description), target_size = COALESCE($4,target_size),
        roles = COALESCE($5,roles), skills = COALESCE($6,skills), status = COALESCE($7,status), updated_at = now() WHERE id = $1 RETURNING *`,
        [id, b.title ?? null, b.description ?? null, b.targetSize ?? null, b.roles ? JSON.stringify(b.roles) : null, b.skills ? JSON.stringify(b.skills) : null, b.status ?? null]);
      await audit(q, user.id, 'team.update', 'team', id, { status: t.status, target_size: t.target_size }, { status: u.status, target_size: u.target_size });
      return u;
    });
    res.json({ team });
  }));

  // WF12: request to join
  r.post('/:id/requests', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    const b = parse(z.object({ role: z.string().trim().min(1).max(60), message: z.string().trim().max(1000).default('') }), req.body);
    const jr = await ctx.db.tx(async (q) => {
      const t = await q.one(`${TEAM_SELECT} WHERE t.id = $1`, [id]);
      if (!t) throw new AppError(404, 'NOT_FOUND', 'Team not found');
      if (t.owner_id === user.id) throw new AppError(409, 'OWN_TEAM', 'You own this team');
      if (t.status !== 'open') throw new AppError(409, 'TEAM_CLOSED', 'This team is not recruiting');
      if (t.member_count >= t.target_size) throw new AppError(409, 'TEAM_FULL', 'This team is full');
      if (await q.one('SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2', [id, user.id])) throw new AppError(409, 'ALREADY_MEMBER', 'You are already a member');
      if (await q.one(`SELECT 1 FROM join_requests WHERE team_id = $1 AND applicant_id = $2 AND status = 'pending'`, [id, user.id])) {
        throw new AppError(409, 'DUPLICATE_REQUEST', 'You already have a pending request for this team');
      }
      const row = await q.one(`INSERT INTO join_requests (team_id, applicant_id, role, message, status) VALUES ($1,$2,$3,$4,'pending') RETURNING *`,
        [id, user.id, b.role, b.message]);
      await notifyUsers(q, [t.owner_id], { kind: 'team', dedupeKey: `join-request:${row.id}`, link: `/student/teams/mine`,
        title_en: `${user.name_en} asked to join "${t.title}"`, title_ar: `${user.name_ar} طلب الانضمام إلى «${t.title}»`, body_en: `Role: ${b.role}`, body_ar: `الدور: ${b.role}` });
      return row;
    });
    res.status(201).json({ request: jr });
  }));

  r.post('/requests/:id/cancel', asyncH(async (req, res) => {
    const row = await ctx.db.one(`UPDATE join_requests SET status = 'cancelled', decided_at = now() WHERE id = $1 AND applicant_id = $2 AND status = 'pending' RETURNING id`,
      [idParam(req), me(req).id]);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'No pending request to cancel');
    res.json({ ok: true });
  }));

  // WF13: owner reviews requests
  r.get('/:id/requests', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    await ownedTeam(ctx.db, user.id, id);
    res.json({ requests: await ctx.db.query(`SELECT jr.*, u.name_en, u.name_ar, u.university_id FROM join_requests jr JOIN users u ON u.id = jr.applicant_id
      WHERE jr.team_id = $1 ORDER BY (jr.status = 'pending') DESC, jr.created_at`, [id]) });
  }));

  r.post('/requests/:id/decision', asyncH(async (req, res) => {
    const user = me(req); const requestId = idParam(req);
    const { decision } = parse(z.object({ decision: z.enum(['accept', 'reject']) }), req.body);
    const out = await ctx.db.tx(async (q) => {
      const jr = await q.one('SELECT * FROM join_requests WHERE id = $1', [requestId]);
      if (!jr) throw new AppError(404, 'NOT_FOUND', 'Request not found');
      // Lock the team row: concurrent decisions on the same team are serialised here.
      const t = await ownedTeam(q, user.id, jr.team_id, true);
      const fresh = await q.one('SELECT * FROM join_requests WHERE id = $1 FOR UPDATE', [requestId]);
      if (fresh.status !== 'pending') throw new AppError(409, 'ALREADY_DECIDED', `This request was already ${fresh.status}`);
      if (decision === 'accept') {
        const count = (await q.one('SELECT count(*)::int AS n FROM team_members WHERE team_id = $1', [t.id])).n;
        if (count >= t.target_size) throw new AppError(409, 'TEAM_FULL', 'The team is already full');
        await q.query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1,$2,$3)', [t.id, jr.applicant_id, jr.role]);
        if (count + 1 >= t.target_size) await q.query(`UPDATE teams SET status = 'closed', updated_at = now() WHERE id = $1`, [t.id]);
      }
      await q.query(`UPDATE join_requests SET status = $2, decided_at = now() WHERE id = $1`, [requestId, decision === 'accept' ? 'accepted' : 'rejected']);
      await notifyUsers(q, [jr.applicant_id], { kind: 'team', dedupeKey: `join-decision:${requestId}`, link: '/student/teams/mine',
        title_en: decision === 'accept' ? `You joined "${t.title}"` : `Your request to join "${t.title}" was declined`,
        title_ar: decision === 'accept' ? `تم قبولك في فريق «${t.title}»` : `تم رفض طلب انضمامك إلى «${t.title}»` });
      await audit(q, user.id, `team.request.${decision}`, 'join_request', requestId, { status: 'pending' }, { status: decision });
      return { status: decision === 'accept' ? 'accepted' : 'rejected' };
    });
    res.json(out);
  }));

  r.post('/:id/leave', asyncH(async (req, res) => {
    const user = me(req); const id = idParam(req);
    const t = await ctx.db.one('SELECT owner_id FROM teams WHERE id = $1', [id]);
    if (!t) throw new AppError(404, 'NOT_FOUND', 'Team not found');
    if (t.owner_id === user.id) throw new AppError(409, 'OWNER_CANNOT_LEAVE', 'The owner cannot leave; close the team instead');
    const row = await ctx.db.one('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2 RETURNING user_id', [id, user.id]);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'You are not a member of this team');
    await audit(ctx.db, user.id, 'team.leave', 'team', id, null, null);
    res.json({ ok: true });
  }));

  return r;
}
