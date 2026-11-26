# GAM3EY (جامعي) – Smart Unified University Portal

Graduation project prototype: one responsive web platform that brings academic records, course registration, lectures with a course-scoped study assistant, smart notifications, a campus guide with a map, project teams and career opportunities together, with dashboards for students, faculty and administration.

> **Demo data only.** Every person, course and record in this prototype is fictional and labelled as demo. The platform is not connected to any real university system.

---

## Quick start (local, nothing to install except Node.js)

Requirements: **Node.js 20 or newer**. No database server, email account or API key is needed: the database is PostgreSQL embedded in the project (PGlite) and stored in `server/data/`.

```bash
npm install          # install dependencies (once)
npm run build        # build the web interface
npm start            # start on http://localhost:4000
```

The first start loads the demo data automatically. Open <http://localhost:4000>.

| Role | Sign in with | Password |
|---|---|---|
| Student (main demo) | `20230001` or `ahmed.ali@gam3ey.demo` | `Demo@2026` |
| Faculty | `sara.hassan@gam3ey.demo` / `omar.nabil@gam3ey.demo` | `Demo@2026` |
| Administration | `admin@gam3ey.demo` | `Demo@2026` |

Other demo students: `20230002` … `20230005`. Account `20230009` is deliberately inactive.

### Other commands

| Command | What it does |
|---|---|
| `npm run dev` | Development mode with hot reload (API on :4000, interface on :5173) |
| `npm test` | Runs the 54 automated acceptance tests |
| `npm run seed` | Resets the local database to the demo state |
| `npm run typecheck` | Type-checks server and client |

## Free online deployment (optional)

The project ships with a `Dockerfile` and a `render.yaml` blueprint for the **free plan of Render**. It uses no paid service and no personal system:

1. Put the `gam3ey` folder in a new GitHub repository (a team or project account).
2. On <https://render.com> choose **New + → Blueprint** and select the repository.
3. Render builds the container and gives a public `https://…onrender.com` link.

On the free plan the service sleeps when idle (the first visit takes ~1 minute) and its disk is temporary, so the demo data is re-created on each start. Any Docker host works the same way: `docker build -t gam3ey . && docker run -p 4000:4000 gam3ey`.

## Project structure

```
gam3ey/
├── server/                 Node.js + TypeScript REST API
│   ├── src/
│   │   ├── schema.ts       PostgreSQL schema (25 tables)
│   │   ├── db.ts           Database layer (PGlite or PostgreSQL server)
│   │   ├── core.ts         Auth, validation, audit log, shared rules
│   │   ├── seed.ts         Demo fixtures
│   │   ├── routes/         auth, student, learning, faculty, notifications, guide, teams, admin
│   │   └── services/       text retrieval, notifications/outbox, mailer, optional LLM
│   └── test/api.test.ts    Acceptance tests mapped to WF01–WF18
├── client/                 React + TypeScript interface (Arabic RTL / English LTR)
│   └── src/pages/          public, student, teams, faculty, admin
├── Dockerfile, render.yaml Free deployment
└── README.md
```

## Workflows implemented

| Code | Workflow | Where |
|---|---|---|
| WF01 | Sign-in and account recovery | `routes/auth.ts` |
| WF02 | Academic overview and timetable | `routes/student.ts` |
| WF03 / WF04 | Course registration / drop | `routes/student.ts` |
| WF05 / WF06 | Lectures, files, exercises / study assistant | `routes/learning.ts` |
| WF07 | Notifications and email outbox | `services/notify.ts`, `routes/notifications.ts` |
| WF08 / WF09 | Campus guide / map and locations | `routes/guide.ts` |
| WF10 | Career opportunities (phase two, listing only) | `routes/guide.ts` |
| WF11–WF14 | Project teams | `routes/teams.ts` |
| WF15 / WF16 | Publish lectures / propose schedule change | `routes/faculty.ts` |
| WF16 (approval), WF17, WF18 | Administration | `routes/admin.ts` |

## Study assistant

The assistant answers **only** from published lectures of the course the student is enrolled in, cites the passages it used, asks for clarification when a question is empty, and says the evidence is insufficient instead of guessing. By default it works fully offline (retrieval with PostgreSQL full-text search, then extractive answers). If `ANTHROPIC_API_KEY` is set, a language model rephrases the answer from the same retrieved passages; student records are never sent.

---

## تشغيل المشروع (بالعربي)

المطلوب فقط **Node.js إصدار 20 أو أحدث**. لا يحتاج المشروع إلى قاعدة بيانات خارجية أو بريد أو مفاتيح؛ قاعدة البيانات PostgreSQL مدمجة داخل مجلد المشروع.

```bash
npm install
npm run build
npm start
```

ثم افتح <http://localhost:4000> وادخل بأحد الحسابات التجريبية في الجدول أعلاه (كلمة المرور `Demo@2026`).

- `npm test` لتشغيل 54 اختبارًا آليًا.
- `npm run seed` لإعادة البيانات التجريبية لحالتها الأولى.
- للنشر المجاني على الإنترنت: ارفع مجلد `gam3ey` على مستودع GitHub خاص بالفريق، ثم من موقع Render اختر **New + → Blueprint**. الخطة المجانية لا تحتاج أي دفع.

**ملاحظة:** كل البيانات تجريبية وموسومة، والمنصة غير مربوطة بأي نظام جامعي حقيقي.

---

## License / الحقوق

© 2026 TechFury-commits. **All rights reserved** – see [LICENSE](LICENSE). The repository is published for viewing and academic evaluation only.  
The New Ismailia National University name, logo and photos belong to the university and are not covered by this licence.

© 2026 TechFury-commits. **جميع الحقوق محفوظة** – راجع ملف [LICENSE](LICENSE).
