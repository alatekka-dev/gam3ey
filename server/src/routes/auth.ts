/** WF01 - Sign-in and account recovery. */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { AppContext, AppError, asyncH, parse, signToken, authenticate, me, z, audit } from '../core.js';

const MAX_FAILURES = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

export function authRoutes(ctx: AppContext) {
  const r = Router();
  const failures = new Map<string, { count: number; first: number }>();
  const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

  r.post('/login', asyncH(async (req, res) => {
    const body = parse(z.object({ identifier: z.string().trim().min(1), password: z.string().min(1) }), req.body);
    const key = body.identifier.toLowerCase();
    const f = failures.get(key);
    if (f && f.count >= MAX_FAILURES && Date.now() - f.first < LOCK_WINDOW_MS) {
      throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Try again in 15 minutes.');
    }
    const user = await ctx.db.one(
      `SELECT id, role, email, name_en, name_ar, password_hash, active FROM users
       WHERE lower(email) = $1 OR lower(university_id) = $1`, [key]);
    const ok = user ? await bcrypt.compare(body.password, user.password_hash) : false;
    if (!ok) {
      const cur = f && Date.now() - f.first < LOCK_WINDOW_MS ? f : { count: 0, first: Date.now() };
      failures.set(key, { count: cur.count + 1, first: cur.first });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'University ID/email or password is incorrect');
    }
    if (!user.active) throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is not active. Contact Student Affairs.');
    failures.delete(key);
    const authUser = { id: user.id, role: user.role, email: user.email, name_en: user.name_en, name_ar: user.name_ar };
    res.json({ token: signToken(ctx, authUser), user: authUser, home: `/${user.role}` });
  }));

  r.get('/me', authenticate(ctx), asyncH(async (req, res) => {
    res.json({ user: me(req) });
  }));

  // Always answers the same way so the response never reveals whether an account exists.
  r.post('/forgot', asyncH(async (req, res) => {
    const body = parse(z.object({ identifier: z.string().trim().min(1) }), req.body);
    const user = await ctx.db.one(
      `SELECT id, email, active FROM users WHERE lower(email) = $1 OR lower(university_id) = $1`, [body.identifier.toLowerCase()]);
    if (user?.active) {
      const token = crypto.randomBytes(32).toString('hex');
      await ctx.db.query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
        [user.id, sha(token), String(ctx.config.resetTtlMinutes)]);
      ctx.mailer.send({
        to: user.email,
        subject: 'GAM3EY password reset | استعادة كلمة المرور',
        text: `${ctx.config.appUrl}/reset?token=${token}\nThis link expires in ${ctx.config.resetTtlMinutes} minutes.`,
      }).catch((e) => console.error('reset mail failed', e));
    }
    res.json({ message: 'If an account matches, a reset link has been sent to its university email.' });
  }));

  r.post('/reset', asyncH(async (req, res) => {
    const body = parse(z.object({
      token: z.string().min(10),
      password: z.string().min(8).regex(/[A-Za-z]/, 'letter required').regex(/\d/, 'digit required'),
    }), req.body);
    await ctx.db.tx(async (q) => {
      const row = await q.one(
        `SELECT id, user_id FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
        [sha(body.token)]);
      if (!row) throw new AppError(400, 'RESET_LINK_INVALID', 'This reset link is invalid or has expired. Request a new one.');
      await q.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(body.password, 10), row.user_id]);
      await q.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [row.user_id]);
      await audit(q, row.user_id, 'password.reset', 'user', row.user_id, null, null);
    });
    res.json({ message: 'Password updated. You can sign in now.' });
  }));

  return r;
}
