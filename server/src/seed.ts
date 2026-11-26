/**
 * Demo data (Demo Fixtures). Every person, course, record and article here is
 * fictional and flagged as demo; nothing is taken from a real university system.
 * Run `npm run seed` to reset the local database to this state.
 *
 * Demo accounts (password for all: Demo@2026):
 *   admin   admin@gam3ey.demo     / 90000001
 *   faculty sara.hassan@gam3ey.demo / 80000001,  omar.nabil@gam3ey.demo / 80000002
 *   student ahmed.ali@gam3ey.demo / 20230001  (main demo student, year 3)
 *   student mona.samir@gam3ey.demo / 20230002, youssef.adel@gam3ey.demo / 20230003,
 *           nour.khaled@gam3ey.demo / 20230004, kareem.fathy@gam3ey.demo / 20230005
 */
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Database } from './db.js';
import { createDatabase } from './db.js';
import { config } from './config.js';
import { GRADE_POINTS } from './core.js';
import { indexText } from './services/text.js';
import { indexLecture } from './routes/faculty.js';

export const DEMO_PASSWORD = 'Demo@2026';
const DAY = 24 * 3600 * 1000;

export async function seedDemo(db: Database, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const iso = (offsetDays: number) => new Date(now.getTime() + offsetDays * DAY).toISOString();
  const hash = await bcrypt.hash(DEMO_PASSWORD, 8);

  await db.tx(async (q) => {
    for (const [k, v] of [['min_credits', '12'], ['max_credits', '18'], ['max_team_size', '6']]) {
      await q.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [k, v]);
    }
    const majors: Record<string, number> = {};
    // Programs offered at New Ismailia National University (source: ninu.edu.eg, read 2026-11-26).
    for (const [code, en, ar] of [
      ['AIE', 'Electrical Engineering – Artificial Intelligence Engineering (Faculty of Engineering)', 'الهندسة الكهربية – هندسة الذكاء الاصطناعي (كلية الهندسة)'],
      ['CEPM', 'Civil Engineering – Construction Engineering and Project Management', 'الهندسة المدنية – هندسة التشييد وإدارة المشروعات'],
      ['HIM', 'Healthcare Services Management and Informatics (Applied Health Sciences Technology)', 'إدارة خدمات الرعاية الصحية والمعلوماتية (تكنولوجيا العلوم الصحية التطبيقية)'],
      ['DMEB', 'Digital Marketing and E-Business (International Trade and Languages)', 'التسويق الرقمي والأعمال الإلكترونية (التجارة الدولية واللغات)'],
    ]) {
      majors[code] = (await q.one('INSERT INTO majors (code, name_en, name_ar) VALUES ($1,$2,$3) RETURNING id', [code, en, ar])).id;
    }
    const user = async (uid: string, email: string, role: string, en: string, ar: string) =>
      (await q.one(`INSERT INTO users (university_id, email, password_hash, role, name_en, name_ar, is_demo) VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING id`,
        [uid, email, hash, role, en, ar])).id as number;

    const admin = await user('90000001', 'admin@gam3ey.demo', 'admin', 'Registrar Office (Demo)', 'مكتب شؤون التسجيل (تجريبي)');
    const sara = await user('80000001', 'sara.hassan@gam3ey.demo', 'faculty', 'Dr. Sara Hassan', 'د. سارة حسن');
    const omar = await user('80000002', 'omar.nabil@gam3ey.demo', 'faculty', 'Dr. Omar Nabil', 'د. عمر نبيل');
    const students: Record<string, number> = {};
    for (const [uid, email, en, ar, major, year] of [
      ['20230001', 'ahmed.ali@gam3ey.demo', 'Ahmed Ali', 'أحمد علي', 'AIE', 3],
      ['20230002', 'mona.samir@gam3ey.demo', 'Mona Samir', 'منى سمير', 'AIE', 3],
      ['20230003', 'youssef.adel@gam3ey.demo', 'Youssef Adel', 'يوسف عادل', 'HIM', 3],
      ['20230004', 'nour.khaled@gam3ey.demo', 'Nour Khaled', 'نور خالد', 'AIE', 3],
      ['20230005', 'kareem.fathy@gam3ey.demo', 'Kareem Fathy', 'كريم فتحي', 'DMEB', 2],
    ] as const) {
      students[uid] = await user(uid, email, 'student', en, ar);
      await q.query('INSERT INTO students (user_id, major_id, study_year) VALUES ($1,$2,$3)', [students[uid], majors[major], year]);
    }
    const inactive = await user('20230009', 'inactive.student@gam3ey.demo', 'student', 'Inactive Student', 'طالب غير نشط');
    await q.query('INSERT INTO students (user_id, major_id, study_year) VALUES ($1,$2,1)', [inactive, majors.AIE]);
    await q.query('UPDATE users SET active = FALSE WHERE id = $1', [inactive]);

    // ---- Campus locations (demo layout on a 100x100 map grid) ----
    const loc: Record<string, number> = {};
    for (const [code, en, ar, kind, building, floor, x, y, den, dar] of [
      ['GATE', 'Main Gate', 'البوابة الرئيسية', 'service', 'Gate', null, 50, 95, 'Entrance from the main road.', 'المدخل من الطريق الرئيسي.'],
      ['ADM', 'Administration Building', 'المبنى الإداري', 'building', 'ADM', null, 25, 70, 'From the main gate walk straight, it is the first building on the left.', 'من البوابة الرئيسية امشِ للأمام، أول مبنى على الشمال.'],
      ['SA', 'Student Affairs Office', 'مكتب شؤون الطلاب', 'office', 'ADM', 0, 22, 72, 'Administration Building, ground floor, room G05 next to the entrance.', 'المبنى الإداري، الدور الأرضي، غرفة G05 بجوار المدخل.'],
      ['FIN', 'Finance and Tuition Office', 'مكتب الحسابات والمصروفات', 'office', 'ADM', 1, 28, 68, 'Administration Building, first floor, room 104.', 'المبنى الإداري، الدور الأول، غرفة 104.'],
      ['A', 'Building A – Lecture Halls', 'مبنى A – المدرجات', 'building', 'A', null, 50, 45, 'Walk straight from the gate past the fountain; Building A is in front of you.', 'امشِ من البوابة مباشرة بعد النافورة، مبنى A أمامك.'],
      ['A101', 'Hall A101', 'مدرج A101', 'hall', 'A', 1, 46, 47, 'Building A, first floor, right corridor.', 'مبنى A، الدور الأول، الممر اليمين.'],
      ['A102', 'Hall A102', 'مدرج A102', 'hall', 'A', 1, 54, 47, 'Building A, first floor, left corridor.', 'مبنى A، الدور الأول، الممر الشمال.'],
      ['A201', 'Hall A201', 'مدرج A201', 'hall', 'A', 2, 50, 42, 'Building A, second floor, take the main stairs.', 'مبنى A، الدور الثاني، من السلم الرئيسي.'],
      ['B', 'Building B – Computer Labs', 'مبنى B – معامل الحاسب', 'building', 'B', null, 75, 40, 'Behind Building A on the right side.', 'خلف مبنى A على الجهة اليمين.'],
      ['LAB1', 'Computer Lab 1', 'معمل حاسب 1', 'lab', 'B', 0, 72, 42, 'Building B, ground floor, first door.', 'مبنى B، الدور الأرضي، أول باب.'],
      ['LAB2', 'Computer Lab 2', 'معمل حاسب 2', 'lab', 'B', 1, 78, 38, 'Building B, first floor.', 'مبنى B، الدور الأول.'],
      ['LIB', 'Central Library', 'المكتبة المركزية', 'building', 'LIB', null, 25, 30, 'Left of Building A, across the garden.', 'على شمال مبنى A، بعد الحديقة.'],
      ['CAF', 'Student Cafeteria', 'كافتيريا الطلاب', 'service', 'CAF', 0, 75, 75, 'Right of the main gate.', 'على يمين البوابة الرئيسية.'],
    ] as const) {
      loc[code] = (await q.one(`INSERT INTO locations (code, name_en, name_ar, kind, building, floor, map_x, map_y, directions_en, directions_ar)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [code, en, ar, kind, building, floor, x, y, den, dar])).id;
    }

    // ---- Courses and prerequisites ----
    const course: Record<string, number> = {};
    const courses: [string, string, string, number, string, string[]][] = [
      ['CS101', 'Introduction to Programming', 'مقدمة في البرمجة', 3, 'Variables, control flow, functions.', []],
      ['MA101', 'Calculus I', 'التفاضل والتكامل 1', 3, 'Limits, derivatives, integrals.', []],
      ['HU101', 'Technical English', 'اللغة الإنجليزية التقنية', 2, 'Reading and writing technical texts.', []],
      ['CS102', 'Data Structures', 'هياكل البيانات', 3, 'Lists, stacks, queues, trees, hashing.', ['CS101']],
      ['CS201', 'Object-Oriented Programming', 'البرمجة الشيئية', 3, 'Classes, inheritance, polymorphism.', ['CS101']],
      ['MA201', 'Discrete Mathematics', 'الرياضيات المتقطعة', 3, 'Logic, sets, graphs, combinatorics.', ['MA101']],
      ['CS301', 'Database Systems', 'نظم قواعد البيانات', 3, 'Relational model, SQL, normalisation, transactions.', ['CS102']],
      ['CS302', 'Software Engineering', 'هندسة البرمجيات', 3, 'Process models, requirements, design, testing.', ['CS201']],
      ['CS303', 'Operating Systems', 'نظم التشغيل', 3, 'Processes, scheduling, memory, files.', ['CS102']],
      ['CS304', 'Computer Networks', 'شبكات الحاسب', 3, 'Layers, TCP/IP, routing.', ['CS102']],
      ['AI301', 'Introduction to Artificial Intelligence', 'مقدمة في الذكاء الاصطناعي', 3, 'Search, knowledge, learning.', ['CS102', 'MA201']],
      ['CS305', 'Web Development', 'تطوير الويب', 3, 'HTML, CSS, JavaScript, web APIs.', ['CS201']],
      ['CS401', 'Graduation Project I', 'مشروع التخرج 1', 3, 'Team project: analysis and design.', ['CS302']],
    ];
    for (const [code, en, ar, ch, desc] of courses) {
      course[code] = (await q.one('INSERT INTO courses (code, title_en, title_ar, credit_hours, description) VALUES ($1,$2,$3,$4,$5) RETURNING id', [code, en, ar, ch, desc])).id;
    }
    for (const [code, , , , , pre] of courses) for (const p of pre) await q.query('INSERT INTO course_prereqs VALUES ($1,$2)', [course[code], course[p]]);

    // ---- Terms: two completed, one current with an open registration window ----
    const y = now.getUTCFullYear();
    const past1 = (await q.one(`INSERT INTO terms (code, name_en, name_ar, starts_on, ends_on, reg_opens_at, reg_closes_at, drop_deadline, results_published)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING id`, [`F${y - 1}`, `Fall ${y - 1}`, `الفصل الأول ${y - 1}`, iso(-430), iso(-320), iso(-445), iso(-425), iso(-400)])).id;
    const past2 = (await q.one(`INSERT INTO terms (code, name_en, name_ar, starts_on, ends_on, reg_opens_at, reg_closes_at, drop_deadline, results_published)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING id`, [`S${y}`, `Spring ${y}`, `الفصل الثاني ${y}`, iso(-300), iso(-190), iso(-315), iso(-295), iso(-270)])).id;
    const cur = (await q.one(`INSERT INTO terms (code, name_en, name_ar, starts_on, ends_on, reg_opens_at, reg_closes_at, drop_deadline, is_current)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING id`, [`F${y}`, `Fall ${y}`, `الفصل الأول ${y}`, iso(-20), iso(70), iso(-7), iso(14), iso(21)])).id;

    const section = async (code: string, term: number, fac: number | null, label: string, cap: number, day: number, start: string, end: string, l: string) =>
      (await q.one(`INSERT INTO sections (course_id, term_id, faculty_id, label, capacity, day_of_week, start_time, end_time, location_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [course[code], term, fac, label, cap, day, start, end, loc[l]])).id as number;

    // Completed history for the main demo student
    const history: [number, string, string][] = [
      [past1, 'CS101', 'A'], [past1, 'MA101', 'B+'], [past1, 'HU101', 'A-'],
      [past2, 'CS102', 'B'], [past2, 'CS201', 'A-'], [past2, 'MA201', 'B'],
    ];
    for (const [t, code, g] of history) {
      const s = await section(code, t, sara, 'A', 60, 0, '09:00', '10:30', 'A101');
      for (const sid of Object.values(students)) {
        const grade = sid === students['20230001'] ? g : (sid === students['20230005'] && t === past2 ? 'C+' : 'B');
        if (sid === students['20230005'] && code !== 'CS101' && code !== 'MA101' && code !== 'HU101') continue;
        await q.query(`INSERT INTO enrollments (student_id, section_id, status, grade, grade_points) VALUES ($1,$2,'completed',$3,$4)`, [sid, s, grade, GRADE_POINTS[grade]]);
      }
    }

    // Current-term timetable (day 0 = Sunday)
    const S: Record<string, number> = {};
    S.CS301 = await section('CS301', cur, sara, 'A', 50, 0, '09:00', '10:30', 'A101');
    S.CS302 = await section('CS302', cur, omar, 'A', 50, 1, '11:00', '12:30', 'A102');
    S.CS303 = await section('CS303', cur, omar, 'A', 50, 2, '09:00', '10:30', 'A201');
    S.CS304 = await section('CS304', cur, sara, 'A', 45, 3, '11:00', '12:30', 'LAB1');
    S.AI301 = await section('AI301', cur, sara, 'A', 40, 2, '12:00', '13:30', 'LAB2');
    S.CS305 = await section('CS305', cur, omar, 'A', 3, 0, '10:00', '11:30', 'LAB1'); // overlaps CS301 and is nearly full
    S.CS305B = await section('CS305', cur, omar, 'B', 40, 4, '09:00', '10:30', 'LAB1');
    S.CS401 = await section('CS401', cur, omar, 'A', 30, 4, '12:00', '13:30', 'A201');
    S.CS102 = await section('CS102', cur, sara, 'A', 60, 1, '09:00', '10:30', 'A101');

    const reg = async (sid: number, ...codes: string[]) => {
      for (const c of codes) await q.query(`INSERT INTO enrollments (student_id, section_id, status) VALUES ($1,$2,'registered')`, [sid, S[c]]);
    };
    await reg(students['20230001'], 'CS301', 'CS302', 'CS303', 'CS304');
    await reg(students['20230002'], 'CS301', 'CS302', 'CS305');
    await reg(students['20230003'], 'CS301', 'CS305');
    await reg(students['20230004'], 'CS301', 'AI301');
    await reg(students['20230005'], 'CS102');

    // ---- Lectures (bilingual demo content used by the study assistant) ----
    const lectures: [string, number, number, string, string, boolean][] = [
      ['CS301', sara, 1, 'The Relational Model', `A relational database stores data in tables called relations. Each table has rows (tuples) and columns (attributes). Every column has a domain that defines the allowed values.

A primary key is a column, or a set of columns, whose value uniquely identifies each row in a table. A primary key cannot be NULL and cannot repeat.

A foreign key is a column in one table that refers to the primary key of another table. Foreign keys enforce referential integrity: a row cannot point to a record that does not exist.

قاعدة البيانات العلائقية تخزن البيانات في جداول تسمى علاقات. كل جدول يتكون من صفوف وأعمدة، ولكل عمود نطاق يحدد القيم المسموح بها.

المفتاح الأساسي هو عمود أو مجموعة أعمدة تحدد كل صف في الجدول بشكل فريد، ولا يمكن أن يكون فارغًا أو مكررًا.

المفتاح الأجنبي هو عمود في جدول يشير إلى المفتاح الأساسي في جدول آخر، ويضمن التكامل المرجعي فلا يشير صف إلى سجل غير موجود.`, true],
      ['CS301', sara, 2, 'SQL Basics', `SQL is the standard language for relational databases. SELECT retrieves rows, INSERT adds rows, UPDATE changes rows and DELETE removes rows.

The WHERE clause filters rows. JOIN combines rows from two tables using a related column, usually a foreign key. GROUP BY groups rows so aggregate functions such as COUNT, SUM and AVG can be applied to each group.

لغة SQL هي اللغة القياسية لقواعد البيانات العلائقية. الأمر SELECT لاسترجاع الصفوف، وINSERT للإضافة، وUPDATE للتعديل، وDELETE للحذف.

جملة WHERE تستخدم لتصفية الصفوف، وJOIN تربط بين جدولين باستخدام عمود مشترك غالبًا ما يكون مفتاحًا أجنبيًا، وGROUP BY تجمع الصفوف لتطبيق دوال التجميع مثل COUNT وSUM وAVG.`, true],
      ['CS301', sara, 3, 'Normalisation', `Normalisation organises tables to reduce redundancy and avoid update anomalies.

First normal form (1NF) requires atomic values: each cell holds a single value. Second normal form (2NF) requires 1NF and that every non-key attribute depends on the whole primary key. Third normal form (3NF) requires 2NF and no transitive dependency: non-key attributes depend only on the key.

التطبيع هو تنظيم الجداول لتقليل التكرار وتجنب مشاكل التحديث.

الصيغة الطبيعية الأولى تشترط أن تكون القيم ذرية أي قيمة واحدة في كل خلية. الصيغة الثانية تشترط الأولى وأن تعتمد كل الصفات غير المفتاحية على المفتاح الأساسي بالكامل. الصيغة الثالثة تشترط الثانية وعدم وجود اعتماد متعدٍ.`, true],
      ['CS301', sara, 4, 'Transactions (draft)', `ACID: atomicity, consistency, isolation, durability. This lecture is still a draft.`, false],
      ['CS302', omar, 1, 'Software Process Models', `A software process model describes the phases of building software. The Waterfall model runs requirements, design, implementation, testing and maintenance in sequence; each phase finishes before the next starts.

Agile methods such as Scrum deliver software in short iterations called sprints, usually two to four weeks long. Each sprint produces a working increment that stakeholders can review.

نموذج عملية البرمجيات يصف مراحل بناء البرنامج. نموذج الشلال ينفذ المتطلبات ثم التصميم ثم التنفيذ ثم الاختبار ثم الصيانة بالتتابع.

المنهجيات الرشيقة مثل Scrum تسلم البرنامج على دورات قصيرة تسمى Sprints مدتها غالبًا من أسبوعين إلى أربعة أسابيع، وكل دورة تنتج جزءًا يعمل يمكن مراجعته.`, true],
      ['CS302', omar, 2, 'Requirements Engineering', `Functional requirements describe what the system must do, for example "a student can register for a course". Non-functional requirements describe qualities such as performance, security, usability and availability.

Requirements are gathered with interviews, questionnaires, observation and analysis of existing systems. A user story has the form: As a [user], I want [function] so that [value].

المتطلبات الوظيفية تصف ما يجب أن يفعله النظام مثل «يستطيع الطالب تسجيل مقرر». أما المتطلبات غير الوظيفية فتصف جودة النظام مثل الأداء والأمان وسهولة الاستخدام والتوافر.

تُجمع المتطلبات بالمقابلات والاستبيانات والملاحظة وتحليل الأنظمة الحالية. وقصة المستخدم صيغتها: بصفتي [مستخدم] أريد [وظيفة] حتى أتمكن من [قيمة].`, true],
    ];
    const lectureIds: number[] = [];
    for (const [code, by, week, title, body, published] of lectures) {
      const l = await q.one(`INSERT INTO lectures (section_id, title, body, week, published, ai_source, created_by, published_at)
        VALUES ($1,$2,$3,$4,$5,TRUE,$6, CASE WHEN $5 THEN now() END) RETURNING id`, [S[code], title, body, week, published, by]);
      lectureIds.push(l.id);
      await indexLecture(q, l.id);
    }
    await q.query(`INSERT INTO exercises (lecture_id, question, choices, correct_index, model_answer, feedback) VALUES
      ($1, 'Which key uniquely identifies each row in a table? | أي مفتاح يحدد كل صف بشكل فريد؟', $2, 0, 'The primary key. | المفتاح الأساسي.', 'A foreign key refers to another table; it does not have to be unique. | المفتاح الأجنبي يشير لجدول آخر ولا يشترط أن يكون فريدًا.'),
      ($3, 'Which normal form forbids transitive dependencies? | أي صيغة طبيعية تمنع الاعتماد المتعدي؟', $4, 2, 'Third normal form (3NF). | الصيغة الطبيعية الثالثة.', 'Check: does a non-key column depend on another non-key column? | اسأل نفسك: هل يعتمد عمود غير مفتاحي على عمود غير مفتاحي آخر؟'),
      ($5, 'How long is a typical Scrum sprint? | ما المدة المعتادة لدورة Scrum؟', $6, 1, 'Two to four weeks. | من أسبوعين إلى أربعة أسابيع.', 'Sprints are short so the team gets feedback often. | الدورات قصيرة ليحصل الفريق على ملاحظات باستمرار.')`,
      [lectureIds[0], JSON.stringify(['Primary key | المفتاح الأساسي', 'Foreign key | المفتاح الأجنبي', 'Domain | النطاق']),
       lectureIds[2], JSON.stringify(['1NF', '2NF', '3NF']),
       lectureIds[4], JSON.stringify(['One day | يوم واحد', '2–4 weeks | 2–4 أسابيع', 'Six months | ستة أشهر'])]);

    // ---- Knowledge base for the campus guide (demo content) ----
    const src = 'Demo content – replace with the official university regulation';
    const kb: [string, string, string, string, string, string][] = [
      ['procedures', 'Requesting an enrollment letter', 'طلب إفادة قيد',
        'To request an enrollment letter, visit the Student Affairs Office in the Administration Building, ground floor, with your university ID card. The letter is usually ready within two working days.',
        'لطلب إفادة قيد توجه إلى مكتب شؤون الطلاب في المبنى الإداري بالدور الأرضي ومعك الكارنيه الجامعي. تكون الإفادة جاهزة عادة خلال يومي عمل.', 'Student Affairs Office'],
      ['registration', 'Course registration rules', 'قواعد تسجيل المقررات',
        'Students register during the registration window announced each term. The normal load is between 12 and 18 credit hours. A course can be registered only after its prerequisites are passed, and two courses cannot be registered at overlapping times.',
        'يسجل الطالب المقررات خلال فترة التسجيل المعلنة كل فصل. العبء المعتاد بين 12 و18 ساعة معتمدة. لا يُسجل المقرر إلا بعد اجتياز متطلباته السابقة، ولا يجوز تسجيل مقررين في مواعيد متعارضة.', 'Registrar Office'],
      ['registration', 'Dropping a course', 'حذف مقرر',
        'A course can be dropped online before the drop deadline of the term. After the deadline the course stays on the record. Dropping must not leave you below the minimum load of 12 credit hours.',
        'يمكن حذف المقرر إلكترونيًا قبل الموعد النهائي للحذف في الفصل. بعد الموعد يبقى المقرر في السجل. ولا يجوز أن يقل العبء بعد الحذف عن الحد الأدنى 12 ساعة معتمدة.', 'Registrar Office'],
      ['finance', 'Tuition fees and payment dates', 'المصروفات الدراسية ومواعيد السداد',
        'Tuition is paid at the Finance and Tuition Office, Administration Building, first floor, room 104. Payment dates are announced at the start of each term and reminders are sent through GAM3EY notifications. Online payment is not available in the platform.',
        'تُسدد المصروفات في مكتب الحسابات بالمبنى الإداري، الدور الأول، غرفة 104. تُعلن مواعيد السداد في بداية كل فصل وتصل تذكيرات عبر إشعارات جامعي. الدفع الإلكتروني غير متاح داخل المنصة.', 'Finance Office'],
      ['facilities', 'Library opening hours', 'مواعيد المكتبة',
        'The Central Library is open Sunday to Thursday from 9:00 to 16:00. Borrowing requires a valid university ID card.',
        'المكتبة المركزية مفتوحة من الأحد إلى الخميس من الساعة 9 صباحًا حتى 4 عصرًا. الاستعارة تتطلب كارنيه جامعي ساري.', 'Central Library'],
      ['procedures', 'Replacing a lost university ID card', 'استخراج بدل فاقد للكارنيه',
        'Report a lost ID card at the Student Affairs Office, fill the replacement form and bring one personal photo. A replacement card takes about one week.',
        'أبلغ عن فقد الكارنيه في مكتب شؤون الطلاب واملأ استمارة بدل فاقد ومعك صورة شخصية. يستغرق استخراج الكارنيه الجديد حوالي أسبوع.', 'Student Affairs Office'],
      ['exams', 'Exam rules', 'قواعد الامتحانات',
        'Students must bring their university ID card to every exam. Mobile phones are not allowed inside exam halls. Exam timetables are published on GAM3EY and on the faculty notice board.',
        'يجب إحضار الكارنيه الجامعي في كل امتحان، ويمنع دخول الهاتف المحمول إلى قاعات الامتحان. تُنشر جداول الامتحانات على جامعي وعلى لوحة إعلانات الكلية.', 'Exams Control Office'],
      ['facilities', 'Computer labs', 'معامل الحاسب',
        'Computer labs are in Building B. Lab 1 is on the ground floor and Lab 2 is on the first floor. Labs are open for practice outside scheduled sessions from 9:00 to 15:00.',
        'معامل الحاسب في مبنى B. معمل 1 في الدور الأرضي ومعمل 2 في الدور الأول. المعامل متاحة للتدريب خارج المحاضرات من 9 صباحًا حتى 3 عصرًا.', 'Faculty IT Unit'],
    ];
    for (const [cat, ten, tar, ben, bar, contact] of kb) {
      await q.query(`INSERT INTO kb_articles (category, title_en, title_ar, body_en, body_ar, source, contact, reviewed_on, published, tsv)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE, to_tsvector('simple', $9))`,
        [cat, ten, tar, ben, bar, src, contact, iso(-30).slice(0, 10), indexText(`${ten} ${tar} ${ben} ${bar}`)]);
    }

    // ---- Verified public facts about NINU (official sources, read 2026-11-26) ----
    const official: [string, string, string, string, string, string, string][] = [
      ['about', 'About New Ismailia National University', 'نبذة عن جامعة الإسماعيلية الجديدة الأهلية',
        'New Ismailia National University (NINU) is a national university established by Presidential Decree No. 427 of 2022. It is located in New Ismailia City on the east bank of the Suez Canal, on a campus of 29 feddans, and emerged from Suez Canal University. Study started in October 2022 under the credit-hour system.',
        'جامعة الإسماعيلية الجديدة الأهلية جامعة أهلية أُنشئت بالقرار الجمهوري رقم 427 لسنة 2022، وتقع في مدينة الإسماعيلية الجديدة شرق قناة السويس على مساحة 29 فدانًا، وهي منبثقة من جامعة قناة السويس. بدأت الدراسة بها في أكتوبر 2022 بنظام الساعات المعتمدة.',
        'cnu.mohesr.gov.eg/new-ismailia ; ninu.edu.eg', 'President\'s office: president@ninu.edu.eg'],
      ['about', 'Faculties and programs', 'الكليات والبرامج',
        'The university has eight faculties: Medicine, Dentistry, Pharmacy (Pharm D), Nursing, Physical Therapy, Engineering (Artificial Intelligence Engineering; Construction Engineering and Project Management), International Trade and Languages (Digital Marketing and E-Business; Markets and Financial Institutions; specialised translation), and Applied Health Sciences Technology (Healthcare Services Management and Informatics; Medical Laboratory Technology).',
        'تضم الجامعة ثماني كليات: الطب، طب الأسنان، الصيدلة (فارم دي)، التمريض، العلاج الطبيعي، الهندسة (هندسة الذكاء الاصطناعي، هندسة التشييد وإدارة المشروعات)، التجارة الدولية واللغات (التسويق الرقمي والأعمال الإلكترونية، الأسواق والمنشآت المالية، الترجمة التخصصية)، وتكنولوجيا العلوم الصحية التطبيقية (إدارة خدمات الرعاية الصحية والمعلوماتية، تكنولوجيا المختبرات الطبية).',
        'ninu.edu.eg', ''],
      ['admission', 'Admission and coordination', 'القبول والتنسيق',
        'Admission is through the Egyptian universities coordination office in a special phase for national universities that follows the first coordination phase. Final acceptance depends on the student\'s score and passing a personal interview. International students apply through the General Administration for Expatriate Students.',
        'يتم القبول عن طريق مكتب تنسيق الجامعات في مرحلة خاصة بالجامعات الأهلية تلي المرحلة الأولى من التنسيق، ويعتمد القبول النهائي على المجموع واجتياز المقابلة الشخصية. ويتقدم الطلاب الوافدون عن طريق الإدارة العامة للوافدين.',
        'ninu.edu.eg', ''],
      ['finance', 'Tuition fees (official announcement)', 'المصروفات الدراسية (الإعلان الرسمي)',
        'Tuition differs by program and is approved each year by the Board of Trustees, usually paid in two instalments. Fee figures published by news sites differ, so always rely on the official announcement on ninu.edu.eg or the Finance Office.',
        'تختلف المصروفات حسب البرنامج ويعتمدها مجلس الأمناء سنويًا وتُسدد عادة على قسطين. الأرقام المنشورة في المواقع الإخبارية متضاربة، لذلك يُرجى الاعتماد فقط على الإعلان الرسمي في موقع الجامعة أو مكتب الحسابات.',
        'ninu.edu.eg', 'Finance Office'],
      ['services', 'Official electronic services', 'الخدمات الإلكترونية الرسمية',
        'The university\'s electronic services (results, registration, medical examination, academic email) are currently provided through the electronic services portal hosted by Suez Canal University, linked from the "الخدمات الإلكترونية" menu on ninu.edu.eg. GAM3EY is a prototype that proposes bringing these services together in one place.',
        'تُقدَّم الخدمات الإلكترونية للجامعة (النتائج، التسجيل، الكشف الطبي، البريد الأكاديمي) حاليًا من خلال بوابة الخدمات الإلكترونية المستضافة لدى جامعة قناة السويس، ويمكن الوصول إليها من قائمة «الخدمات الإلكترونية» في موقع الجامعة. ومنصة جامعي نموذج أولي يقترح جمع هذه الخدمات في مكان واحد.',
        'ninu.edu.eg', 'Electronic portal team'],
      ['contact', 'Contacting the university', 'التواصل مع الجامعة',
        'University phone: +20 64 3200125. Inquiries and complaints can be submitted through the contact page on ninu.edu.eg.',
        'هاتف الجامعة: 3200125 064 20+. ويمكن تقديم الاستفسارات والشكاوى من صفحة «الإستفسارات والشكاوى» على موقع الجامعة.',
        'ninu.edu.eg/contact-us', '+20 64 3200125'],
    ];
    for (const [cat, ten, tar, ben, bar, source, contact] of official) {
      await q.query(`INSERT INTO kb_articles (category, title_en, title_ar, body_en, body_ar, source, contact, reviewed_on, published, tsv)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'2026-11-26',TRUE, to_tsvector('simple', $8))`,
        [cat, ten, tar, ben, bar, `Official: ${source}`, contact, indexText(`${ten} ${tar} ${ben} ${bar}`)]);
    }

    // ---- Teams ----
    const team = async (owner: number, title: string, desc: string, size: number, roles: string[], skills: string[], ownerRole: string) => {
      const t = (await q.one(`INSERT INTO teams (owner_id, title, description, target_size, roles, skills, status) VALUES ($1,$2,$3,$4,$5,$6,'open') RETURNING id`,
        [owner, title, desc, size, JSON.stringify(roles), JSON.stringify(skills)])).id;
      await q.query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1,$2,$3)', [t, owner, ownerRole]);
      return t;
    };
    const t1 = await team(students['20230002'], 'Smart Attendance with Face Recognition', 'Graduation project that records lecture attendance using a camera and a face-recognition model. Looking for a backend developer and an ML engineer.',
      4, ['Backend developer', 'ML engineer', 'UI designer'], ['Python', 'Machine learning', 'REST APIs', 'Figma'], 'Team lead');
    await team(students['20230004'], 'Arabic Chatbot for Student Services', 'A retrieval-based Arabic chatbot that answers student questions from official documents.',
      3, ['NLP engineer', 'Frontend developer'], ['NLP', 'React', 'Arabic'], 'Team lead');
    await q.query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1,$2,$3)', [t1, students['20230003'], 'UI designer']);

    // ---- Opportunities (phase two) ----
    for (const [title, provider, field, kind, skills, elig, o, c] of [
      ['Summer Software Internship', 'Demo Tech Company', 'Software', 'internship', ['JavaScript', 'Git'], 'Year 3 students, GPA 2.5 or higher', -10, 25],
      ['Data Analysis Training', 'Demo Training Center', 'Data', 'training', ['Python', 'SQL'], 'All students', -5, 40],
      ['Junior Network Engineer', 'Demo Telecom', 'Networks', 'job', ['Networking', 'Linux'], 'Final-year students and graduates', 10, 60],
      ['Cloud Fundamentals Course', 'Demo Academy', 'Cloud', 'course', ['Cloud', 'DevOps'], 'All students', -60, -5],
    ] as const) {
      await q.query(`INSERT INTO opportunities (title, provider, field, kind, skills, eligibility, opens_on, closes_on, url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [title, provider, field, kind, JSON.stringify(skills), elig, iso(o).slice(0, 10), iso(c).slice(0, 10), `https://example.com/demo-opportunity/${encodeURIComponent(title.toLowerCase().replace(/\s+/g, '-'))}`]);
    }

    // ---- A few notifications for the main demo student ----
    const ahmed = students['20230001'];
    await q.query(`INSERT INTO notifications (user_id, kind, title_en, title_ar, body_en, body_ar, link, dedupe_key) VALUES
      ($1, 'registration', 'Registration window is open', 'فترة التسجيل مفتوحة', 'You can add courses until the registration deadline.', 'يمكنك إضافة مقررات حتى نهاية فترة التسجيل.', '/student/registration', 'seed-reg'),
      ($1, 'tuition', 'Tuition payment reminder', 'تذكير بموعد سداد المصروفات', 'Pay at the Finance Office, Administration Building, room 104.', 'السداد في مكتب الحسابات، المبنى الإداري، غرفة 104.', '/guide', 'seed-tuition'),
      ($1, 'lecture_published', 'New lecture in CS301: Normalisation', 'محاضرة جديدة في CS301: التطبيع', 'Database Systems', 'نظم قواعد البيانات', '/student/courses', 'seed-lecture')`, [ahmed]);
    await q.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, after_data, reason) VALUES ($1,'seed.load','system',NULL,$2,'Demo fixtures loaded')`,
      [admin, JSON.stringify({ demo: true })]);
  });
}

// CLI: `npm run seed` resets the embedded database to the demo state.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!config.databaseUrl) fs.rmSync(config.dataDir, { recursive: true, force: true });
  const db = await createDatabase({ url: config.databaseUrl, dataDir: config.dataDir });
  await seedDemo(db);
  await db.close();
  console.log('Demo data loaded. Password for all demo accounts:', DEMO_PASSWORD);
}
