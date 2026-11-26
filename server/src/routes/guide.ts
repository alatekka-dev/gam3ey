/**
 * WF08 campus guide, WF09 map and locations, WF10 career opportunities.
 * The guide is public and answers only from published knowledge-base
 * articles and locations: it has no access to any personal record.
 */
import { Router } from 'express';
import { AppContext, AppError, asyncH, parse, z, idParam } from '../core.js';
import { bestSentences, normalize, terms, tsQuery } from '../services/text.js';

export function guideRoutes(ctx: AppContext) {
  const r = Router();

  r.post('/guide/ask', asyncH(async (req, res) => {
    const { question, lang } = parse(z.object({ question: z.string().trim().min(1).max(500), lang: z.enum(['ar', 'en']).default('ar') }), req.body);
    const ar = lang === 'ar';
    const log = (outcome: string, sources: unknown[] = []) => ctx.db.query(
      `INSERT INTO assistant_log (user_id, scope, question, outcome, sources) VALUES (NULL,'campus',$1,$2,$3)`, [question, outcome, JSON.stringify(sources)]);
    if (!terms(question).length) {
      await log('clarify');
      return res.json({ status: 'clarify', message: ar ? 'ممكن توضح سؤالك؟ مثلًا: «فين مبنى المعامل؟» أو «إزاي أطلب إفادة قيد؟»'
        : 'Could you be more specific? For example: "Where is the labs building?" or "How do I request an enrollment letter?"' });
    }
    const tq = tsQuery(question)!;
    const articles = await ctx.db.query(`SELECT id, category, title_en, title_ar, body_en, body_ar, source, contact, reviewed_on,
      ts_rank(tsv, to_tsquery('simple', $1)) AS rank FROM kb_articles
      WHERE published AND NOT archived AND tsv @@ to_tsquery('simple', $1) ORDER BY rank DESC LIMIT 3`, [tq]);
    const qn = terms(question);
    const locations = (await ctx.db.query(`SELECT id, code, name_en, name_ar, kind, building, floor, map_x, map_y, directions_en, directions_ar FROM locations WHERE published`))
      .filter((l: any) => { const hay = normalize(`${l.code} ${l.name_en} ${l.name_ar} ${l.building}`); return qn.some((t) => t.length > 2 && hay.includes(t)); })
      .slice(0, 5);
    if (!articles.length && !locations.length) {
      await log('insufficient_evidence');
      return res.json({ status: 'insufficient_evidence', message: ar
        ? 'مش لاقي إجابة معتمدة لسؤالك في دليل الجامعة. تواصل مع شؤون الطلاب للحصول على المعلومة الرسمية.'
        : 'No approved answer was found in the university guide. Please contact Student Affairs for the official information.',
        contact: ar ? 'شؤون الطلاب – المبنى الإداري، الدور الأرضي' : 'Student Affairs – Administration Building, ground floor' });
    }
    const top = articles[0];
    const answer = top ? bestSentences(question, [ar ? top.body_ar : top.body_en], 3).join(' ') || (ar ? top.body_ar : top.body_en) : null;
    const sources = articles.map((a: any) => ({ id: a.id, title: ar ? a.title_ar : a.title_en, source: a.source, reviewedOn: a.reviewed_on, contact: a.contact }));
    await log('answered', sources);
    res.json({ status: 'answered', answer, sources, locations });
  }));

  r.get('/locations', asyncH(async (req, res) => {
    const q = typeof req.query.q === 'string' ? normalize(req.query.q) : '';
    const kind = typeof req.query.kind === 'string' ? req.query.kind : '';
    let rows = await ctx.db.query(`SELECT id, code, name_en, name_ar, kind, building, floor, map_x, map_y, directions_en, directions_ar
      FROM locations WHERE published ORDER BY building, floor NULLS FIRST, code`);
    if (kind) rows = rows.filter((l: any) => l.kind === kind);
    if (q) rows = rows.filter((l: any) => normalize(`${l.code} ${l.name_en} ${l.name_ar} ${l.building}`).includes(q));
    res.json({ locations: rows });
  }));

  r.get('/locations/:id', asyncH(async (req, res) => {
    const l = await ctx.db.one('SELECT * FROM locations WHERE id = $1 AND published', [idParam(req)]);
    if (!l) throw new AppError(404, 'NOT_FOUND', 'Location not found');
    res.json({ location: l });
  }));

  // WF10 (phase two): listing only; applications happen on the provider's official site.
  r.get('/opportunities', asyncH(async (req, res) => {
    const q = typeof req.query.q === 'string' ? normalize(req.query.q) : '';
    const field = typeof req.query.field === 'string' ? req.query.field : '';
    const rows = (await ctx.db.query(`SELECT *, CASE WHEN current_date < opens_on THEN 'upcoming' WHEN current_date > closes_on THEN 'closed' ELSE 'open' END AS state
      FROM opportunities WHERE published ORDER BY (current_date > closes_on), closes_on`))
      .filter((o: any) => (!field || o.field === field) && (!q || normalize(`${o.title} ${o.provider} ${o.field} ${(o.skills ?? []).join(' ')}`).includes(q)));
    const fields = [...new Set(rows.map((o: any) => o.field))];
    res.json({ opportunities: rows, fields });
  }));

  r.get('/public/summary', asyncH(async (_req, res) => {
    const c = await ctx.db.one(`SELECT (SELECT count(*)::int FROM courses) AS courses, (SELECT count(*)::int FROM locations WHERE published) AS locations,
      (SELECT count(*)::int FROM kb_articles WHERE published AND NOT archived) AS articles, (SELECT count(*)::int FROM teams WHERE status='open') AS open_teams`);
    res.json(c);
  }));

  return r;
}
