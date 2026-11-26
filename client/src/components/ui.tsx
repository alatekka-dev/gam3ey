/** Shared UI: session, data loading with explicit states, and small components. */
import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { api, ApiError, tokenStore } from '../api';
import { useI18n } from '../i18n';

export interface User { id: number; role: 'student' | 'faculty' | 'admin'; email: string; name_en: string; name_ar: string }
interface Session { user: User | null; ready: boolean; signIn: (token: string, user: User) => void; signOut: () => void }
const SessionCtx = createContext<Session>(null as any);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!tokenStore.get()) { setReady(true); return; }
    api<{ user: User }>('/auth/me').then((r) => setUser(r.user)).catch(() => tokenStore.set(null)).finally(() => setReady(true));
    const onLogout = () => setUser(null);
    window.addEventListener('gam3ey:logout', onLogout);
    return () => window.removeEventListener('gam3ey:logout', onLogout);
  }, []);
  const signIn = (token: string, u: User) => { tokenStore.set(token); setUser(u); };
  const signOut = () => { tokenStore.set(null); setUser(null); };
  return <SessionCtx.Provider value={{ user, ready, signIn, signOut }}>{children}</SessionCtx.Provider>;
}
export const useSession = () => useContext(SessionCtx);

/** Loads data and exposes loading / ready / empty / error states. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const reload = useCallback(() => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true); setError(null);
    api<T>(path).then((d) => { if (n === seq.current) setData(d); })
      .catch((e) => { if (n === seq.current) setError(e); })
      .finally(() => { if (n === seq.current) setLoading(false); });
  }, [path]);
  useEffect(reload, [reload, ...deps]);
  return { data, error, loading, reload, setData };
}

export function StateView({ loading, error, empty, onRetry, children }: { loading?: boolean; error?: ApiError | null; empty?: boolean; onRetry?: () => void; children?: ReactNode }) {
  const { t } = useI18n();
  if (loading) return <div className="state" role="status" aria-live="polite"><span className="spinner" aria-hidden /> {t.loading}</div>;
  if (error) return (
    <div className="state state-error" role="alert">
      <strong>{t.error}</strong>
      <span>{error.status === 403 ? t.forbidden : error.message}</span>
      {onRetry && <button className="btn btn-ghost" onClick={onRetry}>{t.retry}</button>}
    </div>);
  if (empty) return <div className="state state-empty">{t.empty}</div>;
  return <>{children}</>;
}

export function ErrorNote({ error }: { error: ApiError | string | null }) {
  if (!error) return null;
  const e = typeof error === 'string' ? { message: error, details: null } : error;
  return (
    <div className="note note-error" role="alert">
      <div>{e.message}</div>
      {Array.isArray(e.details) && <ul>{e.details.map((d: any, i: number) => <li key={i}>{d.message ?? `${d.type}: ${d.code}`}</li>)}</ul>}
    </div>);
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label={t.close}>✕</button></div>
        {children}
      </div>
    </div>);
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>);
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

export const splitList = (s: string) => s.split(/[,،\n]/).map((x) => x.trim()).filter(Boolean);
