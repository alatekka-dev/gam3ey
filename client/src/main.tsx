import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from './i18n';
import { SessionProvider } from './components/ui';
import { PublicLayout, AppLayout } from './components/Layout';
import { Home, About, Services, Login, Forgot, Reset, Guide, NotFound } from './pages/public';
import { Overview, Registration, Courses, CoursePage, Notifications, Careers } from './pages/student';
import { TeamsBrowse, TeamCreate, MyTeams } from './pages/teams';
import { FacultyHome, FacultySection, FacultyChanges } from './pages/faculty';
import { AdminHome, AdminChanges, AdminTerms, AdminRecords, AdminKb, AdminLocations, AdminAnnounce, AdminOutbox, AdminAudit } from './pages/admin';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <SessionProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route index element={<Home />} />
              <Route path="about" element={<About />} />
              <Route path="services" element={<Services />} />
              <Route path="guide" element={<Guide />} />
              <Route path="login" element={<Login />} />
              <Route path="forgot" element={<Forgot />} />
              <Route path="reset" element={<Reset />} />
            </Route>
            <Route path="student" element={<AppLayout role="student" />}>
              <Route index element={<Overview />} />
              <Route path="registration" element={<Registration />} />
              <Route path="courses" element={<Courses />} />
              <Route path="courses/:sectionId" element={<CoursePage />} />
              <Route path="courses/:sectionId/lectures/:lectureId" element={<CoursePage />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="teams" element={<TeamsBrowse />} />
              <Route path="teams/new" element={<TeamCreate />} />
              <Route path="teams/mine" element={<MyTeams />} />
              <Route path="careers" element={<Careers />} />
              <Route path="guide" element={<Guide embedded />} />
            </Route>
            <Route path="faculty" element={<AppLayout role="faculty" />}>
              <Route index element={<FacultyHome />} />
              <Route path="sections/:sectionId" element={<FacultySection />} />
              <Route path="changes" element={<FacultyChanges />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="guide" element={<Guide embedded />} />
            </Route>
            <Route path="admin" element={<AppLayout role="admin" />}>
              <Route index element={<AdminHome />} />
              <Route path="changes" element={<AdminChanges />} />
              <Route path="terms" element={<AdminTerms />} />
              <Route path="records" element={<AdminRecords />} />
              <Route path="kb" element={<AdminKb />} />
              <Route path="locations" element={<AdminLocations />} />
              <Route path="announce" element={<AdminAnnounce />} />
              <Route path="outbox" element={<AdminOutbox />} />
              <Route path="audit" element={<AdminAudit />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </SessionProvider>
    </I18nProvider>
  </StrictMode>,
);
