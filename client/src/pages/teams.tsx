/** WF11-WF14 project teams. */
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { Badge, ErrorNote, Field, Modal, PageHead, StateView, splitList, useApi } from '../components/ui';

export function TeamsBrowse() {
  const { t, L } = useI18n();
  const [q, setQ] = useState(''); const [skill, setSkill] = useState('');
  const { data, error, loading, reload } = useApi<any>(`/teams?q=${encodeURIComponent(q)}&skill=${encodeURIComponent(skill)}`, [q, skill]);
  const [joining, setJoining] = useState<any>(null);
  return (
    <>
      <PageHead title={t.teams} actions={<Link to="/student/teams/new" className="btn btn-primary">+ {t.newTeam}</Link>} />
      <div className="row gap filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} />
        <input value={skill} onChange={(e) => setSkill(e.target.value)} placeholder={t.skills} aria-label={t.skills} />
      </div>
      <StateView loading={loading && !data} error={error} empty={!data?.teams.length} onRetry={reload}>
        <div className="grid-cards">{data?.teams.map((tm: any) => (
          <article key={tm.id} className="card">
            <div className="row gap"><Badge tone={tm.full ? 'bad' : 'good'}>{tm.member_count}/{tm.target_size}</Badge>{tm.myRequest && <Badge tone="info">{t.pending}</Badge>}</div>
            <h3>{tm.title}</h3><p className="muted">{tm.description}</p>
            <p className="small">{t.owner}: {L(tm, 'owner')}</p>
            {tm.roles.length > 0 && <div className="chips">{tm.roles.map((r: string) => <span key={r} className="chip chip-accent">{r}</span>)}</div>}
            <div className="chips">{tm.skills.map((s: string) => <span key={s} className="chip">{s}</span>)}</div>
            <button className="btn btn-ghost btn-sm" disabled={tm.full || !!tm.myRequest} onClick={() => setJoining(tm)}>{t.requestJoin}</button>
          </article>))}</div>
      </StateView>
      {joining && <JoinModal team={joining} onClose={() => setJoining(null)} onDone={() => { setJoining(null); reload(); }} />}
    </>);
}

function JoinModal({ team, onClose, onDone }: { team: any; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [role, setRole] = useState(team.roles[0] ?? ''); const [message, setMessage] = useState(''); const [err, setErr] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api(`/teams/${team.id}/requests`, { body: { role, message } }); onDone(); } catch (e: any) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${t.requestJoin}: ${team.title}`} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Field label={t.yourRole}>{team.roles.length ? <select value={role} onChange={(e) => setRole(e.target.value)}>{team.roles.map((r: string) => <option key={r}>{r}</option>)}</select>
          : <input value={role} onChange={(e) => setRole(e.target.value)} required />}</Field>
        <Field label={t.message}><textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} /></Field>
        <ErrorNote error={err} />
        <div className="row gap end"><button type="button" className="btn btn-ghost" onClick={onClose}>{t.cancel}</button><button className="btn btn-primary" disabled={busy || !role}>{t.send}</button></div>
      </form>
    </Modal>);
}

export function TeamCreate() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [f, setF] = useState({ title: '', description: '', targetSize: 4, roles: '', skills: '', ownerRole: '' });
  const [previewing, setPreviewing] = useState(false); const [err, setErr] = useState<ApiError | null>(null); const [busy, setBusy] = useState(false);
  const body = { title: f.title, description: f.description, targetSize: f.targetSize, roles: splitList(f.roles), skills: splitList(f.skills), ownerRole: f.ownerRole || 'Team lead' };
  const publish = async () => {
    setBusy(true); setErr(null);
    try { await api('/teams', { body }); nav('/student/teams/mine'); } catch (e: any) { setErr(e); setPreviewing(false); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: k === 'targetSize' ? Number(e.target.value) : e.target.value });
  return (
    <>
      <PageHead title={t.newTeam} />
      <form className="card stack narrow-form" onSubmit={(e) => { e.preventDefault(); setPreviewing(true); }}>
        <Field label={t.teamTitle}><input value={f.title} onChange={set('title')} required minLength={3} maxLength={120} /></Field>
        <Field label={t.description}><textarea rows={4} value={f.description} onChange={set('description')} required minLength={10} /></Field>
        <Field label={t.targetSize}><input type="number" min={2} max={10} value={f.targetSize} onChange={set('targetSize')} /></Field>
        <Field label={t.ownerRole}><input value={f.ownerRole} onChange={set('ownerRole')} placeholder="Team lead" /></Field>
        <Field label={t.roles} hint={t.commaHint}><input value={f.roles} onChange={set('roles')} /></Field>
        <Field label={t.skills} hint={t.commaHint}><input value={f.skills} onChange={set('skills')} /></Field>
        <ErrorNote error={err} />
        <button className="btn btn-primary" disabled={f.title.length < 3 || f.description.length < 10}>{t.preview}</button>
      </form>
      {previewing && (
        <Modal title={t.preview} onClose={() => setPreviewing(false)}>
          <h3>{body.title}</h3><p>{body.description}</p>
          <p>{t.targetSize}: <b>{body.targetSize}</b> · {t.ownerRole}: {body.ownerRole}</p>
          <div className="chips">{body.roles.map((r) => <span key={r} className="chip chip-accent">{r}</span>)}{body.skills.map((s) => <span key={s} className="chip">{s}</span>)}</div>
          <div className="row gap end"><button className="btn btn-ghost" onClick={() => setPreviewing(false)}>{t.edit}</button><button className="btn btn-primary" disabled={busy} onClick={publish}>{t.publish}</button></div>
        </Modal>)}
    </>);
}

export function MyTeams() {
  const { t, L, fmtDate } = useI18n();
  const { data, error, loading, reload } = useApi<any>('/teams/mine');
  const [err, setErr] = useState<ApiError | null>(null);
  const act = async (fn: () => Promise<any>) => { setErr(null); try { await fn(); reload(); } catch (e: any) { setErr(e); } };
  return (
    <>
      <PageHead title={t.myTeams} />
      <ErrorNote error={err} />
      <StateView loading={loading && !data} error={error} onRetry={reload}>
        {data && <>
          <h2>{t.ownedTeams}</h2>
          <StateView empty={!data.owned.length}>{data.owned.map((tm: any) => <OwnedTeam key={tm.id} team={tm} onChange={reload} onError={setErr} />)}</StateView>
          <h2>{t.memberOf}</h2>
          <StateView empty={!data.memberOf.length}>
            <ul className="list">{data.memberOf.map((tm: any) => (
              <li key={tm.id}><span><b>{tm.title}</b> · {t.owner}: {L(tm, 'owner')} · {tm.member_count}/{tm.target_size}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => act(() => api(`/teams/${tm.id}/leave`, { body: {} }))}>{t.leave}</button></li>))}</ul>
          </StateView>
          <h2>{t.myRequests}</h2>
          <StateView empty={!data.requests.length}>
            <ul className="list">{data.requests.map((r: any) => (
              <li key={r.id}><span><b>{r.title}</b> · {r.role} · <Badge tone={r.status === 'accepted' ? 'good' : r.status === 'pending' ? 'info' : 'neutral'}>{t[r.status as keyof typeof t] as string}</Badge> <span className="small muted">{fmtDate(r.created_at)}</span></span>
                {r.status === 'pending' && <button className="btn btn-ghost btn-sm" onClick={() => act(() => api(`/teams/requests/${r.id}/cancel`, { body: {} }))}>{t.cancel}</button>}</li>))}</ul>
          </StateView>
        </>}
      </StateView>
    </>);
}

function OwnedTeam({ team, onChange, onError }: { team: any; onChange: () => void; onError: (e: any) => void }) {
  const { t, L } = useI18n();
  const reqs = useApi<any>(`/teams/${team.id}/requests`);
  const detail = useApi<any>(`/teams/${team.id}`);
  const decide = async (id: number, decision: 'accept' | 'reject') => {
    try { await api(`/teams/requests/${id}/decision`, { body: { decision } }); reqs.reload(); detail.reload(); onChange(); } catch (e) { onError(e); }
  };
  const toggle = async () => {
    try { await api(`/teams/${team.id}`, { method: 'PATCH', body: { status: team.status === 'open' ? 'closed' : 'open' } }); onChange(); } catch (e) { onError(e); }
  };
  return (
    <div className="card">
      <div className="row gap between">
        <div><h3>{team.title}</h3><Badge tone={team.status === 'open' ? 'good' : 'neutral'}>{team.status === 'open' ? t.recruiting : t.closed}</Badge> <span className="muted">{team.member_count}/{team.target_size}</span></div>
        <button className="btn btn-ghost btn-sm" onClick={toggle}>{team.status === 'open' ? t.closeRecruiting : t.openRecruiting}</button>
      </div>
      <h4>{t.members}</h4>
      <ul className="plain">{detail.data?.members.map((m: any) => <li key={m.user_id}>{L(m, 'name')} · <span className="muted">{m.role}</span></li>)}</ul>
      <h4>{t.requests}</h4>
      <StateView loading={reqs.loading && !reqs.data} error={reqs.error} empty={!reqs.data?.requests.length}>
        <ul className="list">{reqs.data?.requests.map((r: any) => (
          <li key={r.id}>
            <span><b>{L(r, 'name')}</b> ({r.university_id}) · {r.role}{r.message && <span className="muted"> – {r.message}</span>} <Badge tone={r.status === 'pending' ? 'info' : r.status === 'accepted' ? 'good' : 'neutral'}>{t[r.status as keyof typeof t] as string}</Badge></span>
            {r.status === 'pending' && <span className="row gap"><button className="btn btn-primary btn-sm" onClick={() => decide(r.id, 'accept')}>{t.accept}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => decide(r.id, 'reject')}>{t.reject}</button></span>}
          </li>))}</ul>
      </StateView>
    </div>);
}
