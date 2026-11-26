import { NavLink, Link, Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { useSession, User } from './ui';
import { api } from '../api';
import { AnimatedLogo, Splash } from './Logo';

function LangSwitch() {
  const { lang, setLang } = useI18n();
  return <button className="btn btn-ghost btn-sm" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} aria-label="Switch language">{lang === 'ar' ? 'English' : 'العربية'}</button>;
}

export function Brand() {
  const { t } = useI18n();
  return (
    <Link to="/" className="brand" aria-label={`${t.brand} – ${t.university}`}>
      <AnimatedLogo size="sm" />
      <span><b>{t.brand}</b><small>GAM3EY</small></span>
      <span className="brand-sep" aria-hidden />
      <span className="uni">{t.university}</span>
    </Link>);
}

export function PublicLayout() {
  const { t, L } = useI18n();
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="public">
      <div className="brand-stripe" aria-hidden />
      <a href="#main" className="skip">Skip to content</a>
      <header className="topbar">
        <Brand />
        <button className="icon-btn menu-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>☰</button>
        <nav className={`topnav ${open ? 'open' : ''}`} aria-label="Main">
          <NavLink to="/" end>{t.home}</NavLink>
          <NavLink to="/about">{t.about}</NavLink>
          <NavLink to="/services">{t.services}</NavLink>
          <NavLink to="/guide">{t.guide}</NavLink>
          <LangSwitch />
          {user ? <Link className="btn btn-primary btn-sm" to={`/${user.role}`}>{L(user, 'name')}</Link>
            : <Link className="btn btn-primary btn-sm" to="/login">{t.login}</Link>}
        </nav>
      </header>
      <main id="main"><Outlet /></main>
      <footer className="footer"><span className="footer-uni"><img src="/brand/ninu-logo-192.png" alt="" /> {t.university} · {t.brand} – {t.tagline}</span><span className="muted">© 2026 على تكّة (Alatekka) · {t.rights} · {t.demoBanner}</span></footer>
    </div>);
}

const NAV: Record<User['role'], [string, keyof ReturnType<typeof useI18n>['t'], string][]> = {
  student: [['/student', 'overview', '▦'], ['/student/registration', 'registration', '✚'], ['/student/courses', 'courses', '📘'],
    ['/student/notifications', 'notifications', '🔔'], ['/student/teams', 'teams', '👥'], ['/student/teams/mine', 'myTeams', '★'],
    ['/student/careers', 'careers', '💼'], ['/student/guide', 'guide', '🧭']],
  faculty: [['/faculty', 'facultyHome', '📘'], ['/faculty/changes', 'changeRequests', '⇄'], ['/faculty/notifications', 'notifications', '🔔'], ['/faculty/guide', 'guide', '🧭']],
  admin: [['/admin', 'adminHome', '▦'], ['/admin/changes', 'changeRequests', '⇄'], ['/admin/terms', 'terms', '⚙'], ['/admin/records', 'records', '🗂'],
    ['/admin/kb', 'kb', '📚'], ['/admin/locations', 'locations', '📍'], ['/admin/announce', 'announce', '📣'], ['/admin/outbox', 'outbox', '✉'], ['/admin/audit', 'audit', '🛡']],
};

export function AppLayout({ role }: { role: User['role'] }) {
  const { t, L } = useI18n();
  const { user, ready, signOut } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [unread, setUnread] = useState(0);
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    if (!user) return;
    const load = () => api<{ unread: number }>('/notifications/unread-count').then((r) => setUnread(r.unread)).catch(() => {});
    load(); const id = setInterval(load, 30000); return () => clearInterval(id);
  }, [user, loc.pathname]);
  if (!ready) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (user.role !== role) return <Navigate to={`/${user.role}`} replace />;
  return (
    <div className="app">
      <a href="#main" className="skip">Skip to content</a>
      <aside className={`sidebar ${menu ? 'open' : ''}`} aria-label="Sections">
        <Brand />
        <div className="who"><b>{L(user, 'name')}</b><span className="muted">{t[role]}</span></div>
        <nav>
          {NAV[role].map(([to, key, icon]) => (
            <NavLink key={to} to={to} end={to.split('/').length === 2}>
              <span aria-hidden className="nav-icon">{icon}</span>{t[key] as string}
              {key === 'notifications' && unread > 0 && <span className="count" aria-label={`${unread} ${t.unread}`}>{unread}</span>}
            </NavLink>))}
        </nav>
      </aside>
      <div className="app-main">
        <div className="brand-stripe" aria-hidden />
        <header className="appbar">
          <button className="icon-btn menu-btn" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button>
          <div className="demo-pill" title={t.demoBanner}>DEMO</div>
          <div className="spacer" />
          <LangSwitch />
          <button className="btn btn-ghost btn-sm" onClick={() => { signOut(); nav('/login'); }}>{t.logout}</button>
        </header>
        <main id="main" className="content"><Outlet /></main>
      </div>
    </div>);
}
