/**
 * Notification service (WF07).
 * - One notification per (user, dedupe_key): repeated events never duplicate.
 * - Called inside the same transaction as the official change, so a
 *   notification only exists if the change was committed.
 * - Email is queued in an outbox and delivered after commit; a delivery
 *   failure is recorded on the outbox row and never rolls back the change.
 */
import type { Queryable, Database } from '../db.js';
import type { Mailer } from './mailer.js';

export interface NotificationInput {
  kind: 'schedule_change' | 'lecture_published' | 'registration' | 'tuition' | 'team' | 'general';
  title_en: string; title_ar: string; body_en?: string; body_ar?: string; link?: string;
  dedupeKey: string; email?: boolean;
}

export async function notifyUsers(q: Queryable, userIds: number[], n: NotificationInput): Promise<number> {
  let created = 0;
  for (const uid of [...new Set(userIds)]) {
    const row = await q.one<{ id: number; email: string }>(
      `WITH ins AS (
         INSERT INTO notifications (user_id, kind, title_en, title_ar, body_en, body_ar, link, dedupe_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING id, user_id)
       SELECT ins.id, u.email FROM ins JOIN users u ON u.id = ins.user_id`,
      [uid, n.kind, n.title_en, n.title_ar, n.body_en ?? '', n.body_ar ?? '', n.link ?? null, n.dedupeKey]);
    if (!row) continue;
    created++;
    if (n.email) {
      await q.query('INSERT INTO email_outbox (notification_id, to_email, subject) VALUES ($1,$2,$3)',
        [row.id, row.email, `GAM3EY: ${n.title_en} | ${n.title_ar}`]);
    }
  }
  return created;
}

export async function deliverOutbox(db: Database, mailer: Mailer, maxAttempts = 3): Promise<{ sent: number; failed: number }> {
  const pending = await db.query<{ id: number; to_email: string; subject: string; body_en: string; body_ar: string; attempts: number }>(
    `SELECT o.id, o.to_email, o.subject, o.attempts, n.body_en, n.body_ar FROM email_outbox o
     JOIN notifications n ON n.id = o.notification_id
     WHERE o.status = 'pending' OR (o.status = 'failed' AND o.attempts < $1) ORDER BY o.id LIMIT 100`, [maxAttempts]);
  let sent = 0, failed = 0;
  for (const m of pending) {
    try {
      await mailer.send({ to: m.to_email, subject: m.subject, text: `${m.body_en}\n\n${m.body_ar}` });
      await db.query(`UPDATE email_outbox SET status='sent', attempts=attempts+1, sent_at=now(), last_error=NULL WHERE id=$1`, [m.id]);
      sent++;
    } catch (e: any) {
      await db.query(`UPDATE email_outbox SET status='failed', attempts=attempts+1, last_error=$2 WHERE id=$1`, [m.id, String(e?.message ?? e)]);
      failed++;
    }
  }
  return { sent, failed };
}

/** Students currently registered in a section. */
export async function sectionStudents(q: Queryable, sectionId: number): Promise<number[]> {
  const rows = await q.query<{ student_id: number }>(
    `SELECT student_id FROM enrollments WHERE section_id = $1 AND status = 'registered'`, [sectionId]);
  return rows.map((r) => r.student_id);
}
