/**
 * Text utilities for retrieval: Arabic/English normalisation, tokenising,
 * chunking and building PostgreSQL full-text queries.
 */
const AR_DIACRITICS = /[ً-ٰٟـ]/g;
const STOP = new Set([
  'the','a','an','of','to','in','on','for','and','or','is','are','was','what','how','why','where','when','which','who','do','does','can','i','me','my','it','this','that','with','about','explain','please','tell',
  'في','من','على','الى','إلى','عن','ما','ماذا','هو','هي','هل','كيف','لماذا','اين','أين','متى','التي','الذي','ده','دي','اللي','ايه','إيه','يعني','عايز','ممكن','اشرح','لو','و','او','أو',
]);

export function normalize(s: string): string {
  return s.toLowerCase()
    .replace(AR_DIACRITICS, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Arabic definite article and common attached prefixes, stripped for matching. */
function stem(t: string) {
  if (/^[؀-ۿ]/.test(t)) {
    for (const p of ['وال', 'بال', 'كال', 'فال', 'لل', 'ال']) if (t.startsWith(p) && t.length - p.length >= 3) return t.slice(p.length);
  }
  return t;
}

export function terms(s: string): string[] {
  return [...new Set(normalize(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t)).map(stem))];
}

/** Indexed form: normalised text plus stemmed tokens so both match. */
export function indexText(s: string): string {
  const n = normalize(s);
  return `${n} ${n.split(' ').map(stem).join(' ')}`;
}

/** OR-query of stemmed prefixes: matches any term, ts_rank orders by coverage. */
export function tsQuery(question: string): string | null {
  const ts = terms(question).map((t) => t.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  return ts.length ? ts.map((t) => `${t}:*`).join(' | ') : null;
}

export function chunk(body: string, max = 700): string[] {
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of paras) {
    if (p.length <= max) { out.push(p); continue; }
    let cur = '';
    for (const s of splitSentences(p)) {
      if ((cur + ' ' + s).length > max && cur) { out.push(cur.trim()); cur = ''; }
      cur += ' ' + s;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

export function splitSentences(s: string): string[] {
  return s.split(/(?<=[.!?؟。])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
}

/** Picks the sentences that cover the most question terms (extractive answer). */
export function bestSentences(question: string, texts: string[], n = 3): string[] {
  const q = terms(question);
  const scored: { s: string; score: number; order: number }[] = [];
  let order = 0;
  for (const t of texts) for (const s of splitSentences(t)) {
    const st = new Set(terms(s));
    // Exact term matches weigh double; prefix matches (inflected forms) count once.
    let score = q.reduce((sum, x) => sum + (st.has(x) ? 2 : [...st].some((y) => y.startsWith(x) || x.startsWith(y)) ? 1 : 0), 0);
    // Definition bonus: the sentence opens with the asked-about terms ("A primary key is…").
    const lead = terms(s).slice(0, Math.min(2, q.length));
    if (score > 0 && lead.length && lead.every((x) => q.includes(x))) score += 2;
    scored.push({ s, score, order: order++ });
  }
  // Prefer sentences written in the same script as the question (Arabic vs Latin).
  const isAr = (s: string) => /[؀-ۿ]/.test(s.replace(/[A-Za-z0-9]/g, '')) && (s.match(/[؀-ۿ]/g)?.length ?? 0) > (s.match(/[A-Za-z]/g)?.length ?? 0);
  const sameScript = scored.filter((x) => x.score > 0 && isAr(x.s) === isAr(question));
  const pool = sameScript.length ? sameScript : scored.filter((x) => x.score > 0);
  if (!pool.length) return [];
  // Keep only sentences close to the best match, so answers stay focused.
  const best = Math.max(...pool.map((x) => x.score));
  return pool.filter((x) => x.score >= Math.max(1, best - (best >= 3 ? 1 : 0)))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, n).sort((a, b) => a.order - b.order).map((x) => x.s);
}
