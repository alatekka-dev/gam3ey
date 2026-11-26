/** Express application factory: wires middleware and route modules. */
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { AppContext, errorHandler, AppError } from './core.js';
import { authRoutes } from './routes/auth.js';
import { studentRoutes } from './routes/student.js';
import { learningRoutes } from './routes/learning.js';
import { facultyRoutes } from './routes/faculty.js';
import { notificationRoutes } from './routes/notifications.js';
import { guideRoutes } from './routes/guide.js';
import { teamRoutes } from './routes/teams.js';
import { adminRoutes } from './routes/admin.js';

export function createApp(ctx: AppContext, opts: { staticDir?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));
  app.use(express.json({ limit: '1mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'gam3ey', aiMode: ctx.llm ? 'llm' : 'extractive' }));
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api', guideRoutes(ctx));
  app.use('/api/student', studentRoutes(ctx));
  app.use('/api/learning', learningRoutes(ctx));
  app.use('/api/faculty', facultyRoutes(ctx));
  app.use('/api/notifications', notificationRoutes(ctx));
  app.use('/api/teams', teamRoutes(ctx));
  app.use('/api/admin', adminRoutes(ctx));
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint not found')));

  // Production: serve the built React client from the same origin.
  if (opts.staticDir && fs.existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
    app.get('*', (_req, res) => res.sendFile(path.join(opts.staticDir!, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
