/** WF15 publish lectures and exercises; WF16 propose schedule changes. */
import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { Badge, ErrorNote, Field, PageHead, StateView, useApi } from '../components/ui';

export function FacultyHome() {
  const { t, L } = useI18n();
  const { data, error, loading, reload } = useApi<any>('/faculty/sections');
  return (
    <>
      <PageHead title={t.facultyHome} />
      <StateView loading={loading} error={error} empty={!data?.sections.length} onRetry={reload}>
        <div className="table-wrap card"><table>
          <thead><tr><th>{t.course}</th><th>{t.day}</th><th>{t.time}</th><th>{t.location}</th><th>{t.enrolled}</th><th>{t.lectures}</th><th></th></tr></thead>
          <tbody>{data?.sections.map((s: any) => (
            <tr key={s.id}><td><b>{s.code}-{s.label}</b> {L(s, 'title')}</td><td>{t.days[s.day]}</td><td dir="ltr">{s.start}–{s.end}</td><td>{L(s, 'location')}</td>
              <td>{s.enrolled}/{s.capacity}</td><td>{s.lectures}</td><td><Link className="btn btn-ghost btn-sm" to={`/faculty/sections/${s.id}`}>{t.open}</Link></td></tr>))}</tbody>
        </table></div>
      </StateView>
    </>);
}

export function FacultySection() {
  const { t, L } = useI18n();
  const { sectionId } = useParams();
  const { data, error, loading, reload } = useApi<any>(`/learning/sections/${sectionId}/lectures`);
  const [f, setF] = useState({ title: '', body: '', week: '', aiSource: true, publish: false });
  const [err, setErr] = useState<ApiError | null>(null); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setOk('');
    try {
      await api(`/faculty/sections/${sectionId}/lectures`, { body: { title: f.title, body: f.body, week: f.week ? Number(f.week) : null, aiSource: f.aiSource, publish: f.publish } });
      setF({ title: '', body: '', week: '', aiSource: true, publish: false }); setOk('✓'); reload();
    } catch (e: any) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <StateView loading={loading && !data} error={error} onRetry={reload}>
      {data && <>
        <PageHead title={`${data.course.code} · ${L(data.course, 'title')}`} actions={<Link className="btn btn-ghost" to="/faculty">{t.back}</Link>} />
        <div className="two-col">
          <section className="card">
            <h2>{t.lectures}</h2>
            <StateView empty={!data.lectures.length}>
              <ul className="list">{data.lectures.map((l: any) => <LectureAdmin key={l.id} l={l} onChange={reload} />)}</ul>
            </StateView>
          </section>
          <form className="card stack" onSubmit={create}>
            <h2>{t.newLecture}</h2>
            <Field label={t.lectureTitle}><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={3} /></Field>
            <Field label={t.week}><input type="number" min={1} max={16} value={f.week} onChange={(e) => setF({ ...f, week: e.target.value })} /></Field>
            <Field label={t.lectureBody}><textarea rows={8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
            <label className="check"><input type="checkbox" checked={f.aiSource} onChange={(e) => setF({ ...f, aiSource: e.target.checked })} /> {t.aiSource}</label>
            <label className="check"><input type="checkbox" checked={f.publish} onChange={(e) => setF({ ...f, publish: e.target.checked })} /> {t.publishNow}</label>
            <ErrorNote error={err} />{ok && <div className="note note-good">{ok}</div>}
            <button className="btn btn-primary" disabled={busy || f.title.length < 3}>{t.save}</button>
          </form>
        </div>
      </>}
    </StateView>);
}

function LectureAdmin({ l, onChange }: { l: any; onChange: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false); const [err, setErr] = useState<ApiError | null>(null);
  const [x, setX] = useState({ question: '', choices: '', correct: '', modelAnswer: '', feedback: '' });
  const togglePublish = async () => { try { await api(`/faculty/lectures/${l.id}`, { method: 'PATCH', body: { publish: !l.published } }); onChange(); } catch (e: any) { setErr(e); } };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return; setErr(null);
    const form = new FormData(); [...files].forEach((f) => form.append('files', f));
    try { await api(`/faculty/lectures/${l.id}/attachments`, { form }); onChange(); } catch (e: any) { setErr(e); }
  };
  const addExercise = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const choices = x.choices.split('\n').map((c) => c.trim()).filter(Boolean);
    try {
      await api(`/faculty/lectures/${l.id}/exercises`, { body: { question: x.question, choices, correctIndex: x.correct ? Number(x.correct) - 1 : null, modelAnswer: x.modelAnswer, feedback: x.feedback } });
      setX({ question: '', choices: '', correct: '', modelAnswer: '', feedback: '' }); onChange();
    } catch (e: any) { setErr(e); }
  };
  return (
    <li className="stack">
      <div className="row gap between">
        <button className="link start" onClick={() => setOpen(!open)} aria-expanded={open}>{l.week && <Badge>{t.week} {l.week}</Badge>} <b>{l.title}</b></button>
        <span className="row gap"><Badge tone={l.published ? 'good' : 'warn'}>{l.published ? t.published : t.draft}</Badge>{l.ai_source && <Badge tone="info">AI</Badge>}
          <button className="btn btn-ghost btn-sm" onClick={togglePublish}>{l.published ? t.draft : t.publish}</button></span>
      </div>
      <span className="small muted">{l.attachment_count} {t.attachments} · {l.exercise_count} {t.exercises}</span>
      {open && <div className="stack">
        <Field label={t.uploadFiles} hint={t.allowedFiles}><input type="file" multiple onChange={(e) => upload(e.target.files)} /></Field>
        <form className="stack sub-card" onSubmit={addExercise}>
          <b>{t.addExercise}</b>
          <Field label={t.question}><input value={x.question} onChange={(e) => setX({ ...x, question: e.target.value })} required /></Field>
          <Field label={t.choices}><textarea rows={3} value={x.choices} onChange={(e) => setX({ ...x, choices: e.target.value })} /></Field>
          <Field label={t.correctIndex}><input type="number" min={1} value={x.correct} onChange={(e) => setX({ ...x, correct: e.target.value })} /></Field>
          <Field label={t.modelAnswer}><input value={x.modelAnswer} onChange={(e) => setX({ ...x, modelAnswer: e.target.value })} /></Field>
          <Field label={t.feedback}><input value={x.feedback} onChange={(e) => setX({ ...x, feedback: e.target.value })} /></Field>
          <button className="btn btn-ghost btn-sm" disabled={x.question.length < 3}>{t.save}</button>
        </form>
      </div>}
      <ErrorNote error={err} />
    </li>);
}

export function FacultyChanges() {
  const { t, L, fmtDate } = useI18n();
  const sections = useApi<any>('/faculty/sections');
  const locs = useApi<any>('/locations');
  const list = useApi<any>('/faculty/change-requests');
  const [f, setF] = useState({ sectionId: '', day: '0', start: '09:00', end: '10:30', locationId: '', reason: '' });
  const [conflicts, setConflicts] = useState<any[] | null>(null); const [err, setErr] = useState<ApiError | null>(null); const [ok, setOk] = useState('');
  const body = () => ({ day: Number(f.day), start: f.start, end: f.end, locationId: f.locationId ? Number(f.locationId) : null, reason: f.reason });
  const check = async () => {
    setErr(null);
    try { setConflicts((await api(`/faculty/sections/${f.sectionId}/conflicts`, { body: { ...body(), reason: f.reason || 'preview' } })).conflicts); } catch (e: any) { setErr(e); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setOk('');
    try { const r = await api(`/faculty/sections/${f.sectionId}/change-requests`, { body: body() }); setOk(r.message); setConflicts(null); list.reload(); } catch (e: any) { setErr(e); }
  };
  const rooms = (locs.data?.locations ?? []).filter((l: any) => l.kind === 'hall' || l.kind === 'lab');
  const tone: Record<string, any> = { pending: 'info', approved: 'good', rejected: 'bad' };
  return (
    <>
      <PageHead title={t.changeRequests} subtitle={t.approvalNote} />
      <div className="two-col">
        <form className="card stack" onSubmit={submit}>
          <h2>{t.proposeChange}</h2>
          <Field label={t.courses}><select value={f.sectionId} onChange={(e) => { setF({ ...f, sectionId: e.target.value }); setConflicts(null); }} required>
            <option value="">—</option>{sections.data?.sections.map((s: any) => <option key={s.id} value={s.id}>{s.code}-{s.label} ({t.days[s.day]} {s.start})</option>)}</select></Field>
          <div className="row gap">
            <Field label={t.newDay}><select value={f.day} onChange={(e) => { setF({ ...f, day: e.target.value }); setConflicts(null); }}>{t.days.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></Field>
            <Field label={t.start}><input type="time" value={f.start} onChange={(e) => { setF({ ...f, start: e.target.value }); setConflicts(null); }} /></Field>
            <Field label={t.end}><input type="time" value={f.end} onChange={(e) => { setF({ ...f, end: e.target.value }); setConflicts(null); }} /></Field>
          </div>
          <Field label={t.newRoom}><select value={f.locationId} onChange={(e) => { setF({ ...f, locationId: e.target.value }); setConflicts(null); }}>
            <option value="">—</option>{rooms.map((l: any) => <option key={l.id} value={l.id}>{L(l, 'name')}</option>)}</select></Field>
          <Field label={t.reason}><textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={5} /></Field>
          {conflicts && (conflicts.length ? <div className="note note-error">{t.conflicts}: {conflicts.map((c) => `${c.code} (${c.type})`).join('، ')}</div> : <div className="note note-good">{t.noConflicts}</div>)}
          <ErrorNote error={err} />{ok && <div className="note note-good">{ok}</div>}
          <div className="row gap"><button type="button" className="btn btn-ghost" disabled={!f.sectionId} onClick={check}>{t.checkConflicts}</button>
            <button className="btn btn-primary" disabled={!f.sectionId || f.reason.length < 5}>{t.submitRequest}</button></div>
        </form>
        <section className="card">
          <h2>{t.status}</h2>
          <StateView loading={list.loading && !list.data} error={list.error} empty={!list.data?.changeRequests.length}>
            <ul className="list">{list.data?.changeRequests.map((c: any) => (
              <li key={c.id}><span><b>{c.code}-{c.label}</b> → {t.days[c.new_day]} <span dir="ltr">{c.new_start}–{c.new_end}</span> · <span className="muted">{c.reason}</span>
                <br /><span className="small muted">{fmtDate(c.created_at)}</span></span><Badge tone={tone[c.status]}>{t[c.status as keyof typeof t] as string ?? c.status}</Badge></li>))}</ul>
          </StateView>
        </section>
      </div>
    </>);
}
