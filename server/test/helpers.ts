import request from 'supertest';
import { createDatabase, Database } from '../src/db.js';
import { createApp } from '../src/app.js';
import { DevMailer } from '../src/services/mailer.js';
import { seedDemo, DEMO_PASSWORD } from '../src/seed.js';
import type { AppContext } from '../src/core.js';
import os from 'node:os';
import path from 'node:path';

export interface TestEnv { db: Database; mailer: DevMailer; app: ReturnType<typeof createApp>; ctx: AppContext }

export async function setup(): Promise<TestEnv> {
  const db = await createDatabase({ memory: true });
  await seedDemo(db);
  const mailer = new DevMailer(false);
  const ctx: AppContext = {
    db, mailer, llm: null,
    config: { jwtSecret: 'test-secret', tokenTtl: '1h', resetTtlMinutes: 30, uploadDir: path.join(os.tmpdir(), 'gam3ey-test-uploads'),
      maxUploadBytes: 1024 * 1024, appUrl: 'http://localhost:5173' },
  };
  return { db, mailer, ctx, app: createApp(ctx) };
}

export async function login(env: TestEnv, identifier: string, password = DEMO_PASSWORD): Promise<string> {
  const res = await request(env.app).post('/api/auth/login').send({ identifier, password });
  if (res.status !== 200) throw new Error(`login failed for ${identifier}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
export async function sectionId(env: TestEnv, code: string, label = 'A') {
  return (await env.db.one(`SELECT s.id FROM sections s JOIN courses c ON c.id = s.course_id JOIN terms t ON t.id = s.term_id
    WHERE c.code = $1 AND s.label = $2 AND t.is_current`, [code, label])).id as number;
}
export { request };
