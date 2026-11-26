import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { ErrorNote, Field, PageHead, StateView, useApi, useSession, Badge } from '../components/ui';
import { CampusMap, MapLocation } from '../components/CampusMap';
import { AnimatedLogo } from '../components/Logo';

const SERVICES = [
  ['svcAcademic', 'svcAcademicD', '▦', 1], ['svcReg', 'svcRegD', '✚', 1], ['svcLearn', 'svcLearnD', '📘', 1], ['svcNotif', 'svcNotifD', '🔔', 1],
  ['svcGuide', 'svcGuideD', '🧭', 1], ['svcTeams', 'svcTeamsD', '👥', 1], ['svcCareer', 'svcCareerD', '💼', 2],
] as const;

export function Home() {
  const { t } = useI18n();
  return (
    <>
      <div className="hero-photo" style={{ backgroundImage: 'url(/brand/campus-1.jpg)' }}>
        <section className="hero">
          <div className="hero-text">
            <div className="hero-uni"><span>{t.university} · {t.uniSince}</span></div>
            <Badge tone="info">{t.tagline}</Badge>
            <h1>{t.heroTitle}</h1>
            <p>{t.heroText}</p>
            <div className="row gap wrap">
              <Link to="/login" className="btn btn-primary btn-lg">{t.getStarted}</Link>
              <Link to="/guide" className="btn btn-ghost btn-lg">{t.exploreGuide}</Link>
            </div>
          </div>
          <div className="hero-logo"><AnimatedLogo /></div>
        </section>
      </div>
      <div className="container">
        <div className="values">
          <div className="value"><b>7</b><span className="muted">{t.v1}</span></div>
          <div className="value"><b>18</b><span className="muted">{t.v2}</span></div>
          <div className="value"><b>3</b><span className="muted">{t.v3}</span></div>
          <div className="value"><b>AR · EN</b><span className="muted">{t.v4}</span></div>
        </div>
      </div>
      <section className="container two-col">
        <div className="card"><h2>{t.problemTitle}</h2><p>{t.problemText}</p></div>
        <div className="card"><h2>{t.solutionTitle}</h2><p>{t.solutionText}</p></div>
      </section>
      <section className="container"><h2>{t.services}</h2><ServiceGrid /></section>
      <section className="container campus-strip">
        <img src="/brand/campus-2.jpg" alt={t.university} loading="lazy" />
        <div className="card"><h2>{t.campusTitle}</h2><p>{t.campusText}</p><Link to="/about" className="btn btn-ghost">{t.about}</Link></div>
      </section>
    </>);
}

function ServiceGrid() {
  const { t } = useI18n();
  return (
    <div className="grid-cards">
      {SERVICES.map(([title, desc, icon, phase]) => (
        <article key={title} className="card service">
          <span className="service-icon" aria-hidden>{icon}</span>
          <h3>{t[title]}</h3><p className="muted">{t[desc]}</p>
          <Badge tone={phase === 1 ? 'good' : 'warn'}>{phase === 1 ? t.phase1 : t.phaseTwo}</Badge>
        </article>))}
    </div>);
}

export function About() {
  const { t } = useI18n();
  return (
    <div className="container narrow">
      <PageHead title={t.about} />
      <div className="card row gap wrap">
        <AnimatedLogo />
        <div className="grow"><h2>{t.university}</h2><p className="muted">{t.uniSince}</p><p>{t.aboutText}</p></div>
      </div>
      <div className="two-col">
        <div className="card"><h3>{t.problemTitle}</h3><p>{t.problemText}</p></div>
        <div className="card"><h3>{t.solutionTitle}</h3><p>{t.solutionText}</p></div>
      </div>
      <div className="two-col">
        <div className="card"><h3>{t.facts}</h3>
          <ul className="plain stack">{[t.fact1, t.fact2, t.fact3, t.fact4].map((f) => <li key={f}>✦ {f}</li>)}</ul></div>
        <div className="card"><h3>{t.officialLinks}</h3>
          <ul className="plain stack">
            <li><a href="https://ninu.edu.eg/" target="_blank" rel="noopener noreferrer">{t.officialSite} ↗</a></li>
            <li><a href="https://es-mis.suez.edu.eg/mis_service/ninu_main.aspx" target="_blank" rel="noopener noreferrer">{t.eServices} ↗</a></li>
            <li><a href="https://ninu.edu.eg/contact-us/" target="_blank" rel="noopener noreferrer">{t.complaints} ↗</a></li>
            <li><a href="https://cnu.mohesr.gov.eg/new-ismailia" target="_blank" rel="noopener noreferrer">{t.cnu} ↗</a></li>
          </ul>
          <p className="small muted">{t.officialNote}</p></div>
      </div>
      <img src="/brand/campus-1.jpg" alt={t.university} style={{ width: '100%', borderRadius: 12 }} loading="lazy" />
    </div>);
}

export function Services() {
  const { t } = useI18n();
  return <div className="container"><PageHead title={t.services} /><ServiceGrid /></div>;
}

export function Login() {
  const { t } = useI18n();
  const { signIn } = useSession();
  const nav = useNavigate();
  const loc = useLocation() as any;
  const [identifier, setId] = useState(''); const [password, setPw] = useState('');
  const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<ApiError | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await api('/auth/login', { body: { identifier, password } });
      signIn(r.token, r.user);
      nav(loc.state?.from?.startsWith(`/${r.user.role}`) ? loc.state.from : r.home, { replace: true });
    } catch (e: any) { setErr(e); } finally { setBusy(false); }
  };
  const demo = [['20230001', t.student], ['sara.hassan@gam3ey.demo', t.faculty], ['admin@gam3ey.demo', t.admin]];
  return (
    <div className="auth-shell">
      <div className="auth-photo" style={{ backgroundImage: 'url(/brand/campus-3.jpg)' }}>
        <div><AnimatedLogo /><h2>{t.welcomeBack}</h2><p>{t.university}</p></div>
      </div>
      <div className="auth-side">
      <form className="card auth-card" onSubmit={submit} noValidate>
        <h1>{t.login}</h1>
        <p className="muted small">{t.loginSub}</p>
        <Field label={t.identifier}><input value={identifier} onChange={(e) => setId(e.target.value)} autoComplete="username" required /></Field>
        <Field label={t.password}>
          <div className="input-group">
            <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShow(!show)} aria-pressed={show}>{show ? t.hidePassword : t.showPassword}</button>
          </div>
        </Field>
        <ErrorNote error={err} />
        <button className="btn btn-primary btn-block" disabled={busy || !identifier || !password}>{busy ? t.loading : t.login}</button>
        <Link to="/forgot" className="small">{t.forgot}</Link>
      </form>
      <aside className="card demo-card">
        <h2>{t.demoAccounts}</h2>
        <ul className="plain">
          {demo.map(([id, role]) => <li key={id}><button className="link" onClick={() => { setId(id); setPw('Demo@2026'); }}>{role}: <code>{id}</code></button></li>)}
        </ul>
        <p className="small muted">{t.demoPassword}: <code>Demo@2026</code></p>
      </aside>
      </div>
    </div>);
}

export function Forgot() {
  const { t } = useI18n();
  const [identifier, setId] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState<ApiError | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { setMsg((await api('/auth/forgot', { body: { identifier } })).message); } catch (e: any) { setErr(e); }
  };
  return (
    <div className="container auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h1>{t.forgotTitle}</h1>
        <Field label={t.identifier}><input value={identifier} onChange={(e) => setId(e.target.value)} required /></Field>
        {msg && <div className="note note-good" role="status">{msg}</div>}
        <ErrorNote error={err} />
        <button className="btn btn-primary btn-block" disabled={!identifier}>{t.sendLink}</button>
        <Link to="/login" className="small">{t.back}</Link>
      </form>
    </div>);
}

export function Reset() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [password, setPw] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState<ApiError | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { setMsg((await api('/auth/reset', { body: { token: params.get('token') ?? '', password } })).message); } catch (e: any) { setErr(e); }
  };
  return (
    <div className="container auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h1>{t.resetTitle}</h1>
        <Field label={t.newPassword} hint={t.passwordRule}><input type="password" value={password} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
        {msg && <div className="note note-good" role="status">{msg} <Link to="/login">{t.login}</Link></div>}
        <ErrorNote error={err} />
        <button className="btn btn-primary btn-block" disabled={password.length < 8}>{t.save}</button>
      </form>
    </div>);
}

/** WF08 + WF09: public campus guide with map. Used both publicly and inside dashboards. */
export function Guide({ embedded = false }: { embedded?: boolean }) {
  const { t, L, lang } = useI18n();
  const [question, setQ] = useState(''); const [answer, setAnswer] = useState<any>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<ApiError | null>(null);
  const [params] = useSearchParams();
  const [search, setSearch] = useState(''); const [selected, setSelected] = useState<number | null>(params.get('loc') ? Number(params.get('loc')) : null);
  const locs = useApi<{ locations: MapLocation[] }>('/locations');
  const ask = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await api('/guide/ask', { body: { question, lang } }); setAnswer(r); if (r.locations?.[0]) setSelected(r.locations[0].id); }
    catch (e: any) { setErr(e); } finally { setBusy(false); }
  };
  const list = (locs.data?.locations ?? []).filter((l) => !search || `${l.code} ${l.name_en} ${l.name_ar}`.toLowerCase().includes(search.toLowerCase()));
  const sel = locs.data?.locations.find((l) => l.id === selected);
  return (
    <div className={embedded ? '' : 'container'}>
      <PageHead title={t.guide} subtitle={t.svcGuideD} />
      <div className="two-col">
        <section className="card">
          <h2>{t.guideAsk}</h2>
          <form onSubmit={ask} className="row gap">
            <input className="grow" value={question} onChange={(e) => setQ(e.target.value)} placeholder={t.guidePlaceholder} aria-label={t.guideAsk} />
            <button className="btn btn-primary" disabled={busy || !question.trim()}>{busy ? '…' : t.send}</button>
          </form>
          <ErrorNote error={err} />
          {answer && (
            <div className={`answer ${answer.status}`} aria-live="polite">
              {answer.status === 'answered' ? <>
                {answer.answer && <p>{answer.answer}</p>}
                {answer.sources?.length > 0 && <div className="sources"><b>{t.sources}:</b>
                  <ul>{answer.sources.map((s: any) => <li key={s.id}>{s.title} — {s.source} · {t.reviewedOn}: {s.reviewedOn?.slice(0, 10)}{s.contact && ` · ${t.contact}: ${s.contact}`}</li>)}</ul></div>}
                {answer.locations?.length > 0 && <div className="chips">{answer.locations.map((l: any) => <button key={l.id} className="chip" onClick={() => setSelected(l.id)}>📍 {L(l, 'name')}</button>)}</div>}
              </> : <><Badge tone="warn">{answer.status === 'clarify' ? t.clarify : t.insufficient}</Badge><p>{answer.message}</p>{answer.contact && <p className="muted">{answer.contact}</p>}</>}
            </div>)}
        </section>
        <section className="card">
          <h2>{t.locations}</h2>
          <StateView loading={locs.loading} error={locs.error} onRetry={locs.reload}>
            <CampusMap locations={locs.data?.locations ?? []} selected={selected} onSelect={setSelected} />
            {sel && <div className="note note-info" aria-live="polite"><b>{L(sel, 'name')}</b> · {t.building} {sel.building}{sel.floor != null && ` · ${t.floor} ${sel.floor}`}<br />{t.directions}: {L(sel, 'directions')}</div>}
          </StateView>
        </section>
      </div>
      <section className="card">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.findPlace} aria-label={t.findPlace} />
        <ul className="loc-list">
          {list.map((l) => (
            <li key={l.id}><button className={`loc ${selected === l.id ? 'active' : ''}`} onClick={() => setSelected(l.id)}>
              <b>{L(l, 'name')}</b> <span className="muted small">{l.code} · {t.building} {l.building}{l.floor != null && ` · ${t.floor} ${l.floor}`}</span>
              <span className="small">{L(l, 'directions')}</span></button></li>))}
        </ul>
      </section>
    </div>);
}

export function NotFound() {
  const { t } = useI18n();
  return <div className="container narrow"><PageHead title={t.notFound} /><Link to="/" className="btn btn-primary">{t.home}</Link></div>;
}
