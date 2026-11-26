import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, download } from '../api';
import { useI18n } from '../i18n';
import { Badge, ErrorNote, Modal, PageHead, StateView, useApi } from '../components/ui';

const statusTone: Record<string, any> = { available: 'good', registered: 'info', passed: 'neutral', full: 'bad', prerequisite_missing: 'warn' };

/** WF02 */
export function Overview() {
  const { t, L, fmtDate } = useI18n();
  const [termId, setTermId] = useState<number | null>(null);
  const { data, error, loading, reload } = useApi<any>(`/student/overview${termId ? `?termId=${termId}` : ''}`, [termId]);
  return (
    <>
      <PageHead title={t.overview} subtitle={data && <>{t.lastUpdated}: {fmtDate(data.lastUpdated)}</>} actions={data && (
        <select value={data.term?.id ?? ''} onChange={(e) => setTermId(Number(e.target.value))} aria-label={t.term}>
          {data.terms.map((x: any) => <option key={x.id} value={x.id}>{L(x, 'name')}</option>)}
        </select>)} />
      <StateView loading={loading && !data} error={error} onRetry={reload}>
        {data && <>
          {data.dataSource === 'demo' && <div className="note note-info">{t.demoBanner}</div>}
          <div className="stats">
            <div className="stat"><span>{t.cgpa}</span><b>{data.cgpa?.toFixed(2) ?? '—'}</b></div>
            <div className="stat"><span>{t.earned}</span><b>{data.earnedCredits}</b></div>
            <div className="stat"><span>{t.termGpa}</span><b>{data.termGpa?.toFixed(2) ?? '—'}</b></div>
            <div className="stat"><span>{t.creditHours}</span><b>{data.courses.reduce((a: number, c: any) => a + c.credit_hours, 0)}</b></div>
          </div>
          <div className="card profile">
            <div><span className="muted">{t.universityId}</span><b>{data.profile.university_id}</b></div>
            <div><span className="muted">{t.major}</span><b>{L(data.profile, 'major')}</b></div>
            <div><span className="muted">{t.year}</span><b>{data.profile.study_year}</b></div>
            <div><span className="muted">{t.term}</span><b>{L(data.term, 'name')}</b></div>
          </div>
          {!data.resultsPublished && <div className="note note-warn">{t.resultsHidden}</div>}
          <div className="card">
            <h2>{t.schedule}</h2>
            <StateView empty={!data.courses.length}>
              <div className="table-wrap"><table>
                <thead><tr><th>{t.course}</th><th>{t.day}</th><th>{t.time}</th><th>{t.location}</th><th>{t.instructor}</th><th>{t.creditHours}</th><th>{t.grade}</th></tr></thead>
                <tbody>{data.courses.map((c: any) => (
                  <tr key={c.enrollment_id}>
                    <td><b>{c.code}</b> {L(c, 'title')}</td><td>{t.days[c.day]}</td><td dir="ltr">{c.start}–{c.end}</td>
                    <td>{c.location_id ? <Link to={`/student/guide?loc=${c.location_id}`}>📍 {L(c, 'location')}</Link> : '—'}</td>
                    <td>{L(c, 'faculty')}</td><td>{c.credit_hours}</td><td>{c.grade ?? '—'}</td>
                  </tr>))}</tbody>
              </table></div>
            </StateView>
          </div>
        </>}
      </StateView>
    </>);
}

/** WF03 + WF04 */
export function Registration() {
  const { t, L, fmtDate } = useI18n();
  const { data, error, loading, reload } = useApi<any>('/student/registration');
  const [picked, setPicked] = useState<number[]>([]);
  const [check, setCheck] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [ok, setOk] = useState('');
  const [drop, setDrop] = useState<any>(null);
  const toggle = (id: number) => { setCheck(null); setOk(''); setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]); };
  const validate = async () => { setErr(null); try { setCheck(await api('/student/registration/validate', { body: { sectionIds: picked } })); } catch (e: any) { setErr(e); } };
  const confirm = async () => {
    setBusy(true); setErr(null);
    try { const r = await api('/student/registration/confirm', { body: { sectionIds: picked } }); setOk(`${r.message} – ${r.totalCredits} ${t.credits}`); setPicked([]); setCheck(null); reload(); }
    catch (e: any) { setErr(e); } finally { setBusy(false); }
  };
  const openDrop = async (enrollmentId: number) => {
    setErr(null);
    try { setDrop(await api('/student/drop/preview', { body: { enrollmentId } })); } catch (e: any) { setErr(e); }
  };
  const doDrop = async () => {
    setBusy(true);
    try { const r = await api('/student/drop', { body: { enrollmentId: drop.enrollment.id, confirm: true } }); setOk(r.message); setDrop(null); reload(); }
    catch (e: any) { setErr(e); setDrop(null); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHead title={t.registration} />
      <StateView loading={loading && !data} error={error} onRetry={reload}>
        {data && <>
          <div className="stats">
            <div className="stat"><span>{t.regWindow}</span><b><Badge tone={data.term.regOpen ? 'good' : 'bad'}>{data.term.regOpen ? t.regOpen : t.regClosed}</Badge></b><small>{t.until} {fmtDate(data.term.reg_closes_at)}</small></div>
            <div className="stat"><span>{t.dropDeadline}</span><b><Badge tone={data.term.dropOpen ? 'good' : 'bad'}>{data.term.dropOpen ? t.regOpen : t.regClosed}</Badge></b><small>{fmtDate(data.term.drop_deadline)}</small></div>
            <div className="stat"><span>{t.creditHours}</span><b>{data.registeredCredits}</b><small>{t.limits}: {data.minCredits}–{data.maxCredits}</small></div>
          </div>
          {ok && <div className="note note-good" role="status">{ok}</div>}
          <ErrorNote error={err} />
          <div className="card">
            <h2>{t.currentlyRegistered}</h2>
            <StateView empty={!data.registered.length}>
              <ul className="list">{data.registered.map((s: any) => (
                <li key={s.enrollment_id}><span><b>{s.code}</b> {L(s, 'title')} · {t.days[s.day]} <span dir="ltr">{s.start}–{s.end}</span> · {s.credit_hours} {t.credits}</span>
                  <button className="btn btn-danger btn-sm" disabled={!data.term.dropOpen} onClick={() => openDrop(s.enrollment_id)}>{t.drop}</button></li>))}</ul>
            </StateView>
          </div>
          <div className="card">
            <h2>{t.available}</h2>
            <div className="table-wrap"><table>
              <thead><tr><th></th><th>{t.course}</th><th>{t.day}</th><th>{t.time}</th><th>{t.location}</th><th>{t.creditHours}</th><th>{t.status}</th></tr></thead>
              <tbody>{data.offerings.map((s: any) => {
                const can = s.status === 'available' && data.term.regOpen;
                return (
                  <tr key={s.id} className={picked.includes(s.id) ? 'row-picked' : ''}>
                    <td><input type="checkbox" checked={picked.includes(s.id)} disabled={!can} onChange={() => toggle(s.id)} aria-label={`${t.select} ${s.code}-${s.label}`} /></td>
                    <td><b>{s.code}-{s.label}</b> {L(s, 'title')}{s.missingPrereqs.length > 0 && <div className="small muted">⟵ {s.missingPrereqs.join(', ')}</div>}</td>
                    <td>{t.days[s.day]}</td><td dir="ltr">{s.start}–{s.end}</td><td>{L(s, 'location')}</td><td>{s.credit_hours}</td>
                    <td><Badge tone={statusTone[s.status]}>{t[s.status as keyof typeof t] as string}</Badge> {s.status === 'available' && <span className="small muted">{s.seatsLeft} {t.seatsLeft}</span>}</td>
                  </tr>);
              })}</tbody>
            </table></div>
            <div className="sticky-actions">
              <span>{t.selected}: {picked.length}</span>
              <button className="btn btn-ghost" disabled={!picked.length} onClick={validate}>{t.checkSelection}</button>
              <button className="btn btn-primary" disabled={!check?.ok || busy} onClick={confirm}>{t.confirmRegistration}</button>
            </div>
            {check && (check.ok
              ? <div className="note note-good">{t.selectionOk} {t.totalAfter}: <b>{check.totalCredits}</b></div>
              : <div className="note note-error"><ul>{check.errors.map((e: any, i: number) => <li key={i}>{e.message}</li>)}</ul></div>)}
          </div>
        </>}
      </StateView>
      {drop && (
        <Modal title={t.dropTitle} onClose={() => setDrop(null)}>
          <p><b>{drop.enrollment.code}</b> · {drop.enrollment.credit_hours} {t.credits}</p>
          <p>{t.dropImpact}: <b>{drop.creditsBefore} → {drop.creditsAfter}</b> {drop.belowMinimum && <Badge tone="bad">{t.belowMin} ({drop.minCredits})</Badge>}</p>
          <div className="row gap end">
            <button className="btn btn-ghost" onClick={() => setDrop(null)}>{t.cancel}</button>
            <button className="btn btn-danger" disabled={busy || drop.belowMinimum} onClick={doDrop}>{t.dropConfirm}</button>
          </div>
        </Modal>)}
    </>);
}

export function Courses({ base = '/student/courses' }: { base?: string }) {
  const { t, L } = useI18n();
  const { data, error, loading, reload } = useApi<any>('/learning/courses');
  return (
    <>
      <PageHead title={t.courses} />
      <StateView loading={loading} error={error} empty={!data?.courses.length} onRetry={reload}>
        <div className="grid-cards">{data?.courses.map((c: any) => (
          <Link key={c.section_id} to={`${base}/${c.section_id}`} className="card course-card">
            <Badge tone="info">{c.code}</Badge><h3>{L(c, 'title')}</h3>
            <span className="muted">{c.lecture_count} {t.lectures} · {c.credit_hours} {t.credits}</span>
          </Link>))}</div>
      </StateView>
    </>);
}

/** WF05 + WF06: course page with lectures and the study assistant. */
export function CoursePage() {
  const { t, L, lang } = useI18n();
  const { sectionId } = useParams();
  const { data, error, loading, reload } = useApi<any>(`/learning/sections/${sectionId}/lectures`);
  const [openId, setOpenId] = useState<number | null>(null);
  const [q, setQ] = useState(''); const [chat, setChat] = useState<{ q: string; r: any }[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState<ApiError | null>(null);
  const ask = async (e: FormEvent) => {
    e.preventDefault(); const question = q.trim(); if (!question) return;
    setBusy(true); setErr(null);
    try { const r = await api(`/learning/sections/${sectionId}/assistant`, { body: { question, lang } }); setChat((c) => [...c, { q: question, r }]); setQ(''); }
    catch (e: any) { setErr(e); } finally { setBusy(false); } // the typed question is kept on failure
  };
  return (
    <StateView loading={loading} error={error} onRetry={reload}>
      {data && <>
        <PageHead title={`${data.course.code} · ${L(data.course, 'title')}`} subtitle={data.course.description} actions={<Link to="/student/courses" className="btn btn-ghost">{t.back}</Link>} />
        <div className="two-col wide-first">
          <section className="card">
            <h2>{t.lectures}</h2>
            <StateView empty={!data.lectures.length}>
              <ul className="list">{data.lectures.map((l: any) => (
                <li key={l.id}>
                  <button className="link grow start" onClick={() => setOpenId(openId === l.id ? null : l.id)} aria-expanded={openId === l.id}>
                    {l.week && <Badge>{t.week} {l.week}</Badge>} <b>{l.title}</b>
                    <span className="muted small"> · {l.attachment_count} {t.attachments} · {l.exercise_count} {t.exercises}</span>
                  </button>
                  {openId === l.id && <LectureView id={l.id} />}
                </li>))}</ul>
            </StateView>
          </section>
          <section className="card assistant">
            <h2>🤖 {t.assistant}</h2>
            <p className="muted small">{t.assistantHint}</p>
            <div className="chat" aria-live="polite">
              {chat.map((m, i) => (
                <div key={i}>
                  <div className="bubble me" dir="auto">{m.q}</div>
                  <div className={`bubble bot ${m.r.status}`} dir="auto">
                    {m.r.status === 'answered' ? <>
                      <p>{m.r.answer}</p>
                      <details><summary>{t.sources} ({m.r.sources.length}) · <span className="muted">{m.r.mode === 'llm' ? t.modeLlm : t.modeExtractive}</span></summary>
                        <ol>{m.r.sources.map((s: any) => <li key={s.chunkId}><b>{s.title}</b>: {s.excerpt}</li>)}</ol></details>
                    </> : <><Badge tone="warn">{m.r.status === 'clarify' ? t.clarify : t.insufficient}</Badge> <p>{m.r.message}</p></>}
                  </div>
                </div>))}
            </div>
            <ErrorNote error={err} />
            <form onSubmit={ask} className="row gap">
              <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.askPlaceholder} aria-label={t.askPlaceholder} maxLength={1000} />
              <button className="btn btn-primary" disabled={busy || !q.trim()}>{busy ? '…' : t.send}</button>
            </form>
          </section>
        </div>
      </>}
    </StateView>);
}

function LectureView({ id }: { id: number }) {
  const { t } = useI18n();
  const { data, error, loading } = useApi<any>(`/learning/lectures/${id}`);
  const [summary, setSummary] = useState<any>(null);
  return (
    <div className="lecture">
      <StateView loading={loading} error={error}>
        {data && <>
          <div className="lecture-body">{data.lecture.body.split(/\n\s*\n/).map((p: string, i: number) => <p key={i}>{p}</p>)}</div>
          <div className="row gap">
            <button className="btn btn-ghost btn-sm" onClick={async () => setSummary(await api(`/learning/lectures/${id}/summary`, { body: {} }))}>✎ {t.summary}</button>
          </div>
          {summary && <div className="note note-info"><b>{t.summary}</b><ul>{summary.points.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul><span className="small muted">{t.sources}: {summary.source.title}</span></div>}
          {data.attachments.length > 0 && <><h4>{t.attachments}</h4><ul className="plain">{data.attachments.map((a: any) => (
            <li key={a.id}><button className="link" onClick={() => download(`/learning/attachments/${a.id}/download`, a.filename)}>⬇ {a.filename}</button> <span className="muted small">{Math.ceil(a.size_bytes / 1024)} KB</span></li>))}</ul></>}
          {data.exercises.length > 0 && <><h4>{t.exercises}</h4><p className="small muted">{t.notGraded}</p>{data.exercises.map((x: any) => <Exercise key={x.id} x={x} />)}</>}
        </>}
      </StateView>
    </div>);
}

function Exercise({ x }: { x: any }) {
  const { t } = useI18n();
  const [choice, setChoice] = useState<number | null>(null); const [r, setR] = useState<any>(null);
  return (
    <fieldset className="exercise">
      <legend>{x.question}</legend>
      {x.choices.map((c: string, i: number) => (
        <label key={i} className="radio"><input type="radio" name={`x${x.id}`} checked={choice === i} onChange={() => { setChoice(i); setR(null); }} /> {c}</label>))}
      <button className="btn btn-ghost btn-sm" disabled={choice == null} onClick={async () => setR(await api(`/learning/exercises/${x.id}/attempt`, { body: { choiceIndex: choice } }))}>{t.checkAnswer}</button>
      {r && <div className={`note ${r.correct ? 'note-good' : 'note-warn'}`}><b>{r.correct ? t.correct : t.wrong}</b><div>{t.modelAnswer}: {r.modelAnswer}</div>{r.feedback && <div className="small">{r.feedback}</div>}</div>}
    </fieldset>);
}

/** WF07 */
export function Notifications() {
  const { t, L, fmtDate } = useI18n();
  const { data, error, loading, reload } = useApi<any>('/notifications');
  const read = async (id: number) => { await api(`/notifications/${id}/read`, { body: {} }); reload(); };
  const tone: Record<string, any> = { schedule_change: 'warn', lecture_published: 'info', registration: 'good', tuition: 'bad', team: 'info', general: 'neutral' };
  return (
    <>
      <PageHead title={t.notifications} actions={data?.unread > 0 && <button className="btn btn-ghost" onClick={async () => { await api('/notifications/read-all', { body: {} }); reload(); }}>{t.markAllRead}</button>} />
      <StateView loading={loading && !data} error={error} empty={!data?.items.length} onRetry={reload}>
        <ul className="notes">{data?.items.map((n: any) => (
          <li key={n.id} className={n.read_at ? '' : 'unread'}>
            <div className="grow">
              <div className="row gap"><Badge tone={tone[n.kind]}>{n.kind.replace('_', ' ')}</Badge>{!n.read_at && <Badge tone="info">{t.unread}</Badge>}
                {n.email_status && <span className="small muted">✉ {t.emailStatus}: {n.email_status}</span>}</div>
              <b>{L(n, 'title')}</b>{L(n, 'body') && <p className="muted">{L(n, 'body')}</p>}
              <span className="small muted">{fmtDate(n.created_at)}</span>
            </div>
            {!n.read_at && <button className="btn btn-ghost btn-sm" onClick={() => read(n.id)}>✓</button>}
          </li>))}</ul>
      </StateView>
    </>);
}

/** WF10 (phase two) */
export function Careers() {
  const { t, fmtDate } = useI18n();
  const [q, setQ] = useState(''); const [field, setField] = useState('');
  const { data, error, loading, reload } = useApi<any>(`/opportunities?q=${encodeURIComponent(q)}&field=${encodeURIComponent(field)}`, [q, field]);
  const st: Record<string, [any, string]> = { open: ['good', t.openState], upcoming: ['info', t.upcoming], closed: ['neutral', t.closedState] };
  return (
    <>
      <PageHead title={t.careers} subtitle={<Badge tone="warn">{t.phaseTwo}</Badge>} />
      <div className="row gap filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} />
        <select value={field} onChange={(e) => setField(e.target.value)} aria-label={t.allFields}><option value="">{t.allFields}</option>{data?.fields.map((f: string) => <option key={f}>{f}</option>)}</select>
      </div>
      <StateView loading={loading && !data} error={error} empty={!data?.opportunities.length} onRetry={reload}>
        <div className="grid-cards">{data?.opportunities.map((o: any) => (
          <article key={o.id} className={`card ${o.state === 'closed' ? 'dim' : ''}`}>
            <div className="row gap"><Badge tone={st[o.state][0]}>{st[o.state][1]}</Badge><Badge>{o.kind}</Badge></div>
            <h3>{o.title}</h3><p className="muted">{t.provider}: {o.provider} · {o.field}</p>
            <p className="small">{t.eligibility}: {o.eligibility}</p>
            <p className="small">{t.applyPeriod}: {fmtDate(o.opens_on).split(',')[0]} – {fmtDate(o.closes_on).split(',')[0]}</p>
            <div className="chips">{o.skills.map((s: string) => <span key={s} className="chip">{s}</span>)}</div>
            {o.state !== 'closed' && <a className="btn btn-ghost btn-sm" href={o.url} target="_blank" rel="noopener noreferrer">{t.applyOfficial} ↗</a>}
          </article>))}</div>
      </StateView>
    </>);
}
