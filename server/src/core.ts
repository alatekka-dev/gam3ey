/** Shared building blocks: errors, validation, auth middleware, audit, grading. */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { z, ZodTypeAny } from 'zod';
import type { Database, Queryable } from './db.js';
import type { Mailer } from './services/mailer.js';
import type { LlmClient } from './services/llm.js';

export type Role = 'student' | 'faculty' | 'admin';
export interface AuthUser { id: number; role: Role; email: string; name_en: string; name_ar: string }

export interface AppContext {
  db: Database;
  mailer: Mailer;
  llm: LlmClient | null;
  config: {
    jwtSecret: string;
    tokenTtl: string;
    resetTtlMinutes: number;
    uploadDir: string;
    maxUploadBytes: number;
    appUrl: string;
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser } }
}

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const asyncH = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid input', r.error.flatten());
  return r.data;
}

export const idParam = (req: Request, name = 'id') => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(400, 'VALIDATION_ERROR', `Invalid ${name}`);
  return n;
};

export function signToken(ctx: AppContext, user: AuthUser) {
  return jwt.sign({ sub: user.id, role: user.role }, ctx.config.jwtSecret, { expiresIn: ctx.config.tokenTtl as any });
}

// asyncH never calls next() on success; wrap so middleware continues.
export function middleware(fn: (req: Request) => Promise<void> | void): RequestHandler {
  return (req, _res, next) => { Promise.resolve(fn(req)).then(() => next(), next); };
}

export function authenticate(ctx: AppContext): RequestHandler {
  return middleware(async (req) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
    let payload: { sub: number };
    try { payload = jwt.verify(h.slice(7), ctx.config.jwtSecret) as unknown as { sub: number }; }
    catch { throw new AppError(401, 'UNAUTHENTICATED', 'Session expired, sign in again'); }
    const u = await ctx.db.one<AuthUser & { active: boolean }>(
      'SELECT id, role, email, name_en, name_ar, active FROM users WHERE id = $1', [payload.sub]);
    if (!u || !u.active) throw new AppError(401, 'UNAUTHENTICATED', 'Account is not active');
    req.user = { id: u.id, role: u.role, email: u.email, name_en: u.name_en, name_ar: u.name_ar };
  });
}

export function authOptional(ctx: AppContext): RequestHandler {
  return middleware(async (req) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return;
    try {
      const payload = jwt.verify(h.slice(7), ctx.config.jwtSecret) as unknown as { sub: number };
      const u = await ctx.db.one<AuthUser & { active: boolean }>(
        'SELECT id, role, email, name_en, name_ar, active FROM users WHERE id = $1', [payload.sub]);
      if (u?.active) req.user = { id: u.id, role: u.role, email: u.email, name_en: u.name_en, name_ar: u.name_ar };
    } catch { /* anonymous */ }
  });
}

export const requireRole = (...roles: Role[]): RequestHandler => (req, _res, next) => {
  if (!req.user) return next(new AppError(401, 'UNAUTHENTICATED', 'Sign in required'));
  if (!roles.includes(req.user.role)) return next(new AppError(403, 'FORBIDDEN', 'You do not have permission for this action'));
  next();
};

export const me = (req: Request): AuthUser => {
  if (!req.user) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
  return req.user;
};

export async function audit(q: Queryable, actorId: number | null, action: string, entity: string, entityId: string | number | null,
  before: unknown, after: unknown, reason?: string) {
  await q.query(
    'INSERT INTO audit_log (actor_id, action, entity, entity_id, before_data, after_data, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [actorId, action, entity, entityId == null ? null : String(entityId),
      before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), reason ?? null]);
}

export const GRADE_POINTS: Record<string, number> = {
  'A': 4.0, 'A-': 3.7, 'B+': 3.3, 'B': 3.0, 'B-': 2.7, 'C+': 2.3, 'C': 2.0, 'C-': 1.7, 'D+': 1.3, 'D': 1.0, 'F': 0,
};
export const PASSING_MIN_POINTS = 1.0;

export async function getSetting(q: Queryable, key: string, fallback: number): Promise<number> {
  const r = await q.one<{ value: string }>('SELECT value FROM settings WHERE key = $1', [key]);
  return r ? Number(r.value) : fallback;
}

export const timeToMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const overlaps = (a: { day: number; start: string; end: string }, b: { day: number; start: string; end: string }) =>
  a.day === b.day && timeToMin(a.start) < timeToMin(b.end) && timeToMin(b.start) < timeToMin(a.end);

export { z };

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'File exceeds the size limit' } });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON' } });
  // Unique-violation from a racing duplicate request.
  if (err?.code === '23505') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'This record already exists' } });
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Unexpected server error' } });
}
