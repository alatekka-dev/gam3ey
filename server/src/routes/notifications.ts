/** WF07 - In-app notifications. Read state is separate from email delivery state. */
import { Router } from 'express';
import { AppContext, AppError, asyncH, authenticate, me, idParam } from '../core.js';

export function notificationRoutes(ctx: AppContext) {
  const r = Router();
  r.use(authenticate(ctx));

  r.get('/', asyncH(async (req, res) => {
    const user = me(req);
    const items = await ctx.db.query(`SELECT n.id, n.kind, n.title_en, n.title_ar, n.body_en, n.body_ar, n.link, n.read_at, n.created_at,
      (SELECT o.status FROM email_outbox o WHERE o.notification_id = n.id ORDER BY o.id DESC LIMIT 1) AS email_status
      FROM notifications n WHERE n.user_id = $1 ORDER BY n.created_at DESC, n.id DESC LIMIT 100`, [user.id]);
    const unread = items.filter((i: any) => !i.read_at).length;
    res.json({ items, unread });
  }));

  r.get('/unread-count', asyncH(async (req, res) => {
    const row = await ctx.db.one('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [me(req).id]);
    res.json({ unread: row.n });
  }));

  r.post('/:id/read', asyncH(async (req, res) => {
    const row = await ctx.db.one('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING id',
      [idParam(req), me(req).id]);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Notification not found');
    res.json({ ok: true });
  }));

  r.post('/read-all', asyncH(async (req, res) => {
    await ctx.db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [me(req).id]);
    res.json({ ok: true });
  }));
  return r;
}
