/**
 * Email delivery. The platform treats email as optional and best-effort:
 * notifications are always stored in-app first; email goes through an outbox.
 * DevMailer keeps messages in memory and logs them (no external service needed).
 * Replace with an SMTP/API mailer in production by implementing `Mailer`.
 */
export interface Mail { to: string; subject: string; text: string }
export interface Mailer { send(mail: Mail): Promise<void>; sent: Mail[] }

export class DevMailer implements Mailer {
  sent: Mail[] = [];
  failNext = 0;
  constructor(private log = false) {}
  async send(mail: Mail) {
    if (this.failNext > 0) { this.failNext--; throw new Error('Simulated mail provider outage'); }
    this.sent.push(mail);
    if (this.log) console.log(`[mail] to=${mail.to} subject="${mail.subject}"`);
  }
}
