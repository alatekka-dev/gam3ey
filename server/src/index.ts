/** Starts the GAM3EY API server. Seeds demo data on first run. */
import { createDatabase } from './db.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { DevMailer } from './services/mailer.js';
import { createLlm } from './services/llm.js';
import { deliverOutbox } from './services/notify.js';
import { seedDemo } from './seed.js';

const db = await createDatabase({ url: config.databaseUrl, dataDir: config.dataDir });
const seeded = await db.one('SELECT count(*)::int AS n FROM users');
if (seeded.n === 0) { await seedDemo(db); console.log('Demo data loaded (all records are marked as demo).'); }

const mailer = new DevMailer(true);
const llm = createLlm();
const ctx = { db, mailer, llm, config };
const app = createApp(ctx, { staticDir: config.clientDist });
setInterval(() => deliverOutbox(db, mailer).catch((e) => console.error(e)), 30_000).unref();

app.listen(config.port, () => {
  console.log(`GAM3EY API on http://localhost:${config.port}  (database: ${config.databaseUrl ? 'PostgreSQL server' : 'embedded PostgreSQL (PGlite)'}, assistant: ${llm ? 'LLM' : 'extractive'})`);
});
