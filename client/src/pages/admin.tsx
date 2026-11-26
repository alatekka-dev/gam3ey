/** Administration: approvals, terms, records, knowledge base, locations, announcements, outbox, audit. */
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { Badge, ErrorNote, Field, Modal, PageHead, StateView, useApi } from '../components/ui';
import { CampusMap } from '../components/CampusMap';

export function AdminHome() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useApi<any>('/admin/dashboard');
  const tiles: [string, string, string][] = [['students', t.students, '/admin/records'], ['courses', t.allCourses, '/admin/terms'], ['registrations', t.registrations, '/admin/terms'],
    ['pending_changes', t.pendingChanges, '/admin/changes'], ['failed_emails', t.failedEmails, '/admin/outbox'], ['unanswered_questions', t.unanswered, '/admin/kb']];
  return (
    <>
      <PageHead title={t.adminHome} />
      <StateView loading={loading} error={error} onRetry={reload}>
        <div className="stats">{tiles.map(([k, label, to]) => (
          <Link key={k} to={to} className={`stat link-card ${(k === 'pending_changes' || k === 'failed_emails') && data?.[k] > 0 ? 'stat-warn' : ''}`}><span>{label}</span><b>{data?.[k]}</b></Link>))}</div>
      </StateView>
    </>);
}

export function AdminChanges() {
  const { t, L, fmtDate } = useI18n();
  const { data, error, loading, reload } = useApi<any>('/admin/change-requests');
  const [err, setErr] = useState<ApiError | null>(null); const [ok, setOk] = useState('');
  const decide = async (id: number, decision: 'approve' | 'reject') => {
    setErr(null); setOk('');
    try { const r = await api(`/admin/change-requests/${id}/decision`, { body: { decision } }); setOk(`${t[r.status as keyof typeof t] ?? r.status} · ${t.recipients}: ${r.notified}`); reload(); }
    catch (e: any) { setErr(e); }
  };
  return (
    <>
      <PageHead title={t.changeRequests} subtitle={t.approvalNote} />
      <ErrorNote error={err} />{ok && <div className="note note-good">{ok}</div>}
      <StateView loading={loading && !data} error={error} empty={!data?.changeRequests.length} onRetry={reload}>
        <div className="table-wrap card"><table>
          <thead><tr><th>{t.course}</th><th>{t.current}</th><th>{t.proposed}</th><th>{t.reason}</th><th>{t.requestedBy}</th><th>{t.status}</th><th></th></tr></thead>
          <tbody>{data?.changeRequests.map((c: any) => (
            <tr key={c.id}><td><b>{c.code}-{c.label}</b></td>
              <td>{t.days[c.old_day]} <span dir="ltr">{c.old_start}–{c.old_end}</span><br /><span className="small muted">{L(c, 'old_location')}</span></td>
              <td>{t.days[c.new_day]} <span dir="ltr">{c.new_start}–{c.new_end}</span><br /><span className="small muted">{L(c, 'new_location')}</span></td>
              <td>{c.reason}</td><td>{L(c, 'requested_by')}<br /><span className="small muted">{fmtDate(c.created_at)}</span></td>
              <td><Badge tone={c.status === 'pending' ? 'info' : c.status === 'approved' ? 'good' : 'bad'}>{t[c.status as keyof typeof t] as string ?? c.status}</Badge></td>
              <td>{c.status === 'pending' && <span className="row gap"><button className="btn btn-primary btn-sm" onClick={() => decide(c.id, 'approve')}>{t.approve}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => decide(c.id, 'reject')}>{t.reject}</button></span>}</td></tr>))}</tbody>
        </table></div>
      </StateView>
    </>);
}

const toLocalInput = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

export function AdminTerms() {
  const { t, L } = useI18n();
  const terms = useApi<any>('/admin/terms'); const settings = useApi<any>('/admin/settings'); const sections = useApi<any>('/admin/sections');
  const [err, setErr] = useState<ApiError | null>(null); const [ok, setOk] = useState('');
  const saveSettings = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setErr(null); setOk('');
    const fd = new FormData(e.currentTarget);
    try { await api('/admin/settings', { method: 'PATCH', body: { min_credits: Number(fd.get('min')), max_credits: Number(fd.get('max')), max_team_size: Number(fd.get('team')) } }); setOk('✓'); settings.reload(); }
    catch (e: any) { setErr(e); }
  };
  const saveTerm = async (id: number, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setErr(null); setOk('');
    const fd = new FormData(e.currentTarget);
    try {
      await api(`/admin/terms/${id}`, { method: 'PATCH', body: { reg_opens_at: new Date(String(fd.get('opens'))).toISOString(), reg_closes_at: new Date(String(fd.get('closes'))).toISOString(),
        drop_deadline: new Date(String(fd.get('drop'))).toISOString(), results_published: fd.get('results') === 'on' } });
      setOk('✓'); terms.reload();
    } catch (e: any) { setErr(e); }
  };
  const s = settings.data?.settings;
  return (
    <>
      <PageHead title={t.terms} />
      <ErrorNote error={err} />{ok && <div className="note note-good">{ok}</div>}
      {s && <form className="card row gap wrap align-end" onSubmit={saveSettings}>
        <Field label={t.minCredits}><input name="min" type="number" defaultValue={s.min_credits} /></Field>
        <Field label={t.maxCredits}><input name="max" type="number" defaultValue={s.max_credits} /></Field>
        <Field label={t.maxTeam}><input name="team" type="number" defaultValue={s.max_team_size} /></Field>
        <button className="btn btn-primary">{t.save}</button>
      </form>}
      <StateView loading={terms.loading && !terms.data} error={terms.error}>
        {terms.data?.terms.map((x: any) => (
          <form key={x.id} className="card row gap wrap align-end" onSubmit={(e) => saveTerm(x.id, e)}>
            <div className="grow"><h3>{L(x, 'name')} {x.is_current && <Badge tone="good">{t.current}</Badge>}</h3></div>
            <Field label={t.opensAt}><input name="opens" type="datetime-local" defaultValue={toLocalInput(x.reg_opens_at)} /></Field>
            <Field label={t.closesAt}><input name="closes" type="datetime-local" defaultValue={toLocalInput(x.reg_closes_at)} /></Field>
            <Field label={t.dropDeadline}><input name="drop" type="datetime-local" defaultValue={toLocalInput(x.drop_deadline)} /></Field>
            <label className="check"><input name="results" type="checkbox" defaultChecked={x.results_published} /> {t.resultsPublished}</label>
            <button className="btn btn-ghost">{t.save}</button>
          </form>))}
      </StateView>
      <div className="card">
        <h2>{t.schedule}</h2>
        <StateView loading={sections.loading && !sections.data} error={sections.error}>
          <div className="table-wrap"><table><thead><tr><th>{t.course}</th><th>{t.day}</th><th>{t.time}</th><th>{t.location}</th><th>{t.instructor}</th><th>{t.enrolled}</th></tr></thead>
            <tbody>{sections.data?.sections.map((x: any) => <tr key={x.id}><td><b>{x.code}-{x.label}</b> {L(x, 'title')}</td><td>{t.days[x.day]}</td><td dir="ltr">{x.start}–{x.end}</td>
              <td>{L(x, 'location')}</td><td>{L(x, 'faculty')}</td><td>{x.enrolled}/{x.capacity}</td></tr>)}</tbody></table></div>
        </StateView>
      </div>
    </>);
}

export function AdminRecords() {
  const { t, L } = useI18n();
  const [q, setQ] = useState('');
  const { data, error, loading } = useApi<any>(`/admin/students?q=${encodeURIComponent(q)}`, [q]);
  const [student, setStudent] = useState<any>(null);
  return (
    <>
      <PageHead title={t.records} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.searchStudents} aria-label={t.searchStudents} />
      <StateView loading={loading && !data} error={error} empty={!data?.students.length}>
        <div className="table-wrap card"><table><thead><tr><th>{t.universityId}</th><th>{t.student}</th><th>{t.major}</th><th>{t.year}</th><th>{t.status}</th><th></th></tr></thead>
          <tbody>{data?.students.map((s: any) => <tr key={s.id}><td>{s.university_id}</td><td>{L(s, 'name')} {s.is_demo && <Badge>demo</Badge>}</td><td>{s.major}</td><td>{s.study_year}</td>
            <td><Badge tone={s.active ? 'good' : 'bad'}>{s.active ? '✓' : '✕'}</Badge></td><td><button className="btn btn-ghost btn-sm" onClick={() => setStudent(s)}>{t.record}</button></td></tr>)}</tbody></table></div>
      </StateView>
      {student && <RecordModal student={student} onClose={() => setStudent(null)} />}
    </>);
}

function RecordModal({ student, onClose }: { student: any; onClose: () => void }) {
  const { t, L } = useI18n();
  const { data, reload } = useApi<any>(`/admin/students/${student.id}/record`);
  const [edit, setEdit] = useState<any>(null); const [grade, setGrade] = useState('A'); const [reason, setReason] = useState(''); const [err, setErr] = useState<ApiError | null>(null);
  const save = async () => {
    setErr(null);
    try { await api(`/admin/enrollments/${edit.id}/grade`, { method: 'PATCH', body: { grade, reason } }); setEdit(null); setReason(''); reload(); } catch (e: any) { setErr(e); }
  };
  return (
    <Modal title={`${t.record}: ${L(student, 'name')}`} onClose={onClose}>
      <div className="table-wrap"><table><thead><tr><th>{t.term}</th><th>{t.course}</th><th>{t.status}</th><th>{t.grade}</th><th></th></tr></thead>
        <tbody>{data?.record.map((r: any) => <tr key={r.id}><td>{r.term}</td><td>{r.code}</td><td>{r.status}</td><td>{r.grade ?? '—'}</td>
          <td>{r.status !== 'dropped' && <button className="btn btn-ghost btn-sm" onClick={() => { setEdit(r); setGrade(r.grade ?? 'A'); }}>{t.changeGrade}</button>}</td></tr>)}</tbody></table></div>
      {edit && <div className="stack sub-card">
        <b>{edit.code} · {edit.term}</b>
        <Field label={t.grade}><select value={grade} onChange={(e) => setGrade(e.target.value)}>{['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F'].map((g) => <option key={g}>{g}</option>)}</select></Field>
        <Field label={t.reasonRequired}><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <ErrorNote error={err} />
        <button className="btn btn-primary" disabled={reason.trim().length < 5} onClick={save}>{t.save}</button>
      </div>}
    </Modal>);
}

export function AdminKb() {
  const { t, L } = useI18n();
  const { data, error, loading, reload } = useApi<any>('/admin/kb');
  const log = useApi<any>('/admin/assistant-log');
  const [f, setF] = useState({ category: 'procedures', title_en: '', title_ar: '', body_en: '', body_ar: '', source: '', contact: '', reviewed_on: new Date().toISOString().slice(0, 10), published: true });
  const [err, setErr] = useState<ApiError | null>(null);
  const create = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await api('/admin/kb', { body: f }); setF({ ...f, title_en: '', title_ar: '', body_en: '', body_ar: '' }); reload(); } catch (e: any) { setErr(e); }
  };
  const patch = async (id: number, body: any) => { try { await api(`/admin/kb/${id}`, { method: 'PATCH', body }); reload(); } catch (e: any) { setErr(e); } };
  const unanswered = (log.data?.entries ?? []).filter((x: any) => x.outcome === 'insufficient_evidence' && x.scope === 'campus');
  return (
    <>
      <PageHead title={t.kb} />
      <ErrorNote error={err} />
      <div className="two-col">
        <section className="card">
          <StateView loading={loading && !data} error={error} empty={!data?.articles.length}>
            <ul className="list">{data?.articles.map((a: any) => (
              <li key={a.id}><span><Badge>{a.category}</Badge> <b>{L(a, 'title')}</b> <span className="small muted">· {a.source} · {a.reviewed_on?.slice(0, 10)}</span>
                {' '}{a.archived ? <Badge tone="neutral">{t.archive}</Badge> : a.published ? <Badge tone="good">{t.published}</Badge> : <Badge tone="warn">{t.draft}</Badge>}</span>
                <span className="row gap">
                  {!a.archived && <button className="btn btn-ghost btn-sm" onClick={() => patch(a.id, { published: !a.published })}>{a.published ? t.draft : t.publish}</button>}
                  <button className="btn btn-ghost btn-sm" onClick={() => patch(a.id, { archived: !a.archived })}>{a.archived ? t.unarchive : t.archive}</button></span></li>))}</ul>
          </StateView>
          {unanswered.length > 0 && <><h3>{t.unanswered}</h3><ul className="plain small">{unanswered.slice(0, 10).map((x: any) => <li key={x.id}>“{x.question}”</li>)}</ul></>}
        </section>
        <form className="card stack" onSubmit={create}>
          <Field label={t.category}><input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
          <Field label="Title (EN)"><input value={f.title_en} onChange={(e) => setF({ ...f, title_en: e.target.value })} required /></Field>
          <Field label="العنوان (AR)"><input dir="rtl" value={f.title_ar} onChange={(e) => setF({ ...f, title_ar: e.target.value })} required /></Field>
          <Field label="Body (EN)"><textarea rows={3} value={f.body_en} onChange={(e) => setF({ ...f, body_en: e.target.value })} required /></Field>
          <Field label="المحتوى (AR)"><textarea dir="rtl" rows={3} value={f.body_ar} onChange={(e) => setF({ ...f, body_ar: e.target.value })} required /></Field>
          <Field label={t.source}><input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} required /></Field>
          <Field label={t.contact}><input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} /></Field>
          <Field label={t.reviewedOn}><input type="date" value={f.reviewed_on} onChange={(e) => setF({ ...f, reviewed_on: e.target.value })} /></Field>
          <label className="check"><input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} /> {t.publish}</label>
          <button className="btn btn-primary">{t.save}</button>
        </form>
      </div>
    </>);
}

export function AdminLocations() {
  const { t, L } = useI18n();
  const { data, error, loading, reload } = useApi<any>('/locations');
  const [sel, setSel] = useState<any>(null); const [err, setErr] = useState<ApiError | null>(null);
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setErr(null);
    const fd = new FormData(e.currentTarget);
    try {
      await api(`/admin/locations/${sel.id}`, { method: 'PATCH', body: { directions_en: fd.get('den'), directions_ar: fd.get('dar'), map_x: Number(fd.get('x')), map_y: Number(fd.get('y')) } });
      setSel(null); reload();
    } catch (e: any) { setErr(e); }
  };
  return (
    <>
      <PageHead title={t.locations} />
      <StateView loading={loading && !data} error={error} onRetry={reload}>
        <div className="two-col">
          <div className="card"><CampusMap locations={data?.locations ?? []} selected={sel?.id} onSelect={(id) => setSel(data.locations.find((l: any) => l.id === id))} /></div>
          <div className="card">
            {sel ? <form className="stack" onSubmit={save} key={sel.id}>
              <h3>{L(sel, 'name')} <span className="muted small">{sel.code}</span></h3>
              <div className="row gap"><Field label="X"><input name="x" type="number" min={0} max={100} defaultValue={sel.map_x} /></Field><Field label="Y"><input name="y" type="number" min={0} max={100} defaultValue={sel.map_y} /></Field></div>
              <Field label={`${t.directions} (EN)`}><textarea name="den" rows={2} defaultValue={sel.directions_en} /></Field>
              <Field label={`${t.directions} (AR)`}><textarea name="dar" dir="rtl" rows={2} defaultValue={sel.directions_ar} /></Field>
              <ErrorNote error={err} />
              <div className="row gap"><button className="btn btn-primary">{t.save}</button><button type="button" className="btn btn-ghost" onClick={() => setSel(null)}>{t.cancel}</button></div>
            </form> : <ul className="list">{data?.locations.map((l: any) => <li key={l.id}><button className="link start" onClick={() => setSel(l)}><b>{L(l, 'name')}</b> <span className="muted small">{l.code}</span></button></li>)}</ul>}
          </div>
        </div>
      </StateView>
    </>);
}

export function AdminAnnounce() {
  const { t } = useI18n();
  const [f, setF] = useState({ audience: 'students', kind: 'tuition', title_en: '', title_ar: '', body_en: '', body_ar: '', email: false, dedupeKey: '' });
  const [err, setErr] = useState<ApiError | null>(null); const [ok, setOk] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setOk('');
    try { const r = await api('/admin/announcements', { body: f }); setOk(r.message ?? `${t.recipients}: ${r.recipients}`); } catch (e: any) { setErr(e); }
  };
  return (
    <>
      <PageHead title={t.announce} />
      <form className="card stack narrow-form" onSubmit={submit}>
        <div className="row gap">
          <Field label={t.audience}><select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="students">{t.students}</option><option value="faculty">{t.faculty}</option><option value="all">{t.all}</option></select></Field>
          <Field label={t.kind}><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="tuition">tuition</option><option value="registration">registration</option><option value="general">general</option></select></Field>
        </div>
        <Field label="Title (EN)"><input value={f.title_en} onChange={(e) => setF({ ...f, title_en: e.target.value })} required /></Field>
        <Field label="العنوان (AR)"><input dir="rtl" value={f.title_ar} onChange={(e) => setF({ ...f, title_ar: e.target.value })} required /></Field>
        <Field label="Body (EN)"><textarea rows={2} value={f.body_en} onChange={(e) => setF({ ...f, body_en: e.target.value })} /></Field>
        <Field label="المحتوى (AR)"><textarea dir="rtl" rows={2} value={f.body_ar} onChange={(e) => setF({ ...f, body_ar: e.target.value })} /></Field>
        <Field label={t.dedupe} hint="e.g. tuition-fall-2026"><input value={f.dedupeKey} onChange={(e) => setF({ ...f, dedupeKey: e.target.value })} required minLength={3} /></Field>
        <label className="check"><input type="checkbox" checked={f.email} onChange={(e) => setF({ ...f, email: e.target.checked })} /> {t.alsoEmail}</label>
        <ErrorNote error={err} />{ok && <div className="note note-good">{ok}</div>}
        <button className="btn btn-primary">{t.send}</button>
      </form>
    </>);
}

export function AdminOutbox() {
  const { t, fmtDate } = useI18n();
  const { data, error, loading, reload } = useApi<any>('/admin/outbox');
  const [ok, setOk] = useState('');
  return (
    <>
      <PageHead title={t.outbox} actions={<button className="btn btn-ghost" onClick={async () => { const r = await api('/admin/outbox/retry', { body: {} }); setOk(`sent ${r.sent} · failed ${r.failed}`); reload(); }}>{t.retryFailed}</button>} />
      {ok && <div className="note note-info">{ok}</div>}
      <StateView loading={loading && !data} error={error} empty={!data?.outbox.length}>
        <div className="table-wrap card"><table><thead><tr><th>#</th><th>To</th><th>Subject</th><th>{t.status}</th><th>Attempts</th><th>{t.when}</th></tr></thead>
          <tbody>{data?.outbox.map((o: any) => <tr key={o.id}><td>{o.id}</td><td>{o.to_email}</td><td>{o.subject}</td>
            <td><Badge tone={o.status === 'sent' ? 'good' : o.status === 'failed' ? 'bad' : 'info'}>{o.status}</Badge>{o.last_error && <div className="small muted">{o.last_error}</div>}</td>
            <td>{o.attempts}</td><td>{fmtDate(o.sent_at ?? o.created_at)}</td></tr>)}</tbody></table></div>
      </StateView>
    </>);
}

export function AdminAudit() {
  const { t, L, fmtDate } = useI18n();
  const [entity, setEntity] = useState('');
  const { data, error, loading } = useApi<any>(`/admin/audit${entity ? `?entity=${entity}` : ''}`, [entity]);
  const [detail, setDetail] = useState<any>(null);
  return (
    <>
      <PageHead title={t.audit} actions={<select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label={t.entity}>
        <option value="">{t.all}</option>{['enrollment', 'section', 'term', 'lecture', 'team', 'join_request', 'change_request', 'kb_article', 'location', 'user', 'setting', 'announcement'].map((x) => <option key={x}>{x}</option>)}</select>} />
      <StateView loading={loading && !data} error={error} empty={!data?.entries.length}>
        <div className="table-wrap card"><table><thead><tr><th>{t.when}</th><th>{t.actor}</th><th>{t.action}</th><th>{t.entity}</th><th>{t.reason}</th><th></th></tr></thead>
          <tbody>{data?.entries.map((a: any) => <tr key={a.id}><td>{fmtDate(a.at)}</td><td>{L(a, 'actor') || '—'}</td><td><code>{a.action}</code></td><td>{a.entity} #{a.entity_id ?? ''}</td><td>{a.reason ?? ''}</td>
            <td>{(a.before_data || a.after_data) && <button className="btn btn-ghost btn-sm" onClick={() => setDetail(a)}>{t.preview}</button>}</td></tr>)}</tbody></table></div>
      </StateView>
      {detail && <Modal title={detail.action} onClose={() => setDetail(null)}><div className="two-col"><pre>{JSON.stringify(detail.before_data, null, 2)}</pre><pre>{JSON.stringify(detail.after_data, null, 2)}</pre></div></Modal>}
    </>);
}
