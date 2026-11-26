/** PostgreSQL schema for GAM3EY. Idempotent: safe to run on every start. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  university_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','faculty','admin')),
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  is_demo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_resets (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS majors (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  major_id INT NOT NULL REFERENCES majors(id),
  study_year INT NOT NULL CHECK (study_year BETWEEN 1 AND 6)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS terms (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  reg_opens_at TIMESTAMPTZ NOT NULL,
  reg_closes_at TIMESTAMPTZ NOT NULL,
  drop_deadline TIMESTAMPTZ NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  results_published BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title_en TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  credit_hours INT NOT NULL CHECK (credit_hours BETWEEN 1 AND 6),
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS course_prereqs (
  course_id INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  prereq_id INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, prereq_id),
  CHECK (course_id <> prereq_id)
);

CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('building','hall','lab','office','service')),
  building TEXT NOT NULL,
  floor INT,
  map_x DOUBLE PRECISION CHECK (map_x BETWEEN 0 AND 100),
  map_y DOUBLE PRECISION CHECK (map_y BETWEEN 0 AND 100),
  directions_en TEXT NOT NULL DEFAULT '',
  directions_ar TEXT NOT NULL DEFAULT '',
  published BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sections (
  id SERIAL PRIMARY KEY,
  course_id INT NOT NULL REFERENCES courses(id),
  term_id INT NOT NULL REFERENCES terms(id),
  faculty_id INT REFERENCES users(id),
  label TEXT NOT NULL DEFAULT 'A',
  capacity INT NOT NULL CHECK (capacity > 0),
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  location_id INT REFERENCES locations(id),
  CHECK (end_time > start_time),
  UNIQUE (course_id, term_id, label)
);

CREATE TABLE IF NOT EXISTS enrollments (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES users(id),
  section_id INT NOT NULL REFERENCES sections(id),
  status TEXT NOT NULL CHECK (status IN ('registered','dropped','completed')),
  grade TEXT,
  grade_points NUMERIC(3,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dropped_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS enrollments_active_uq ON enrollments(student_id, section_id) WHERE status <> 'dropped';

CREATE TABLE IF NOT EXISTS lectures (
  id SERIAL PRIMARY KEY,
  section_id INT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  week INT,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  ai_source BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  lecture_id INT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exercises (
  id SERIAL PRIMARY KEY,
  lecture_id INT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  choices JSONB NOT NULL DEFAULT '[]',
  correct_index INT,
  model_answer TEXT NOT NULL DEFAULT '',
  feedback TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS content_chunks (
  id SERIAL PRIMARY KEY,
  lecture_id INT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  course_id INT NOT NULL REFERENCES courses(id),
  ordinal INT NOT NULL,
  text TEXT NOT NULL,
  tsv TSVECTOR NOT NULL
);
CREATE INDEX IF NOT EXISTS content_chunks_tsv_idx ON content_chunks USING GIN (tsv);

CREATE TABLE IF NOT EXISTS kb_articles (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  title_en TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  body_en TEXT NOT NULL,
  body_ar TEXT NOT NULL,
  source TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  reviewed_on DATE NOT NULL,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  tsv TSVECTOR
);
CREATE INDEX IF NOT EXISTS kb_tsv_idx ON kb_articles USING GIN (tsv);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title_en TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  body_en TEXT NOT NULL DEFAULT '',
  body_ar TEXT NOT NULL DEFAULT '',
  link TEXT,
  dedupe_key TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id SERIAL PRIMARY KEY,
  notification_id INT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  owner_id INT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  target_size INT NOT NULL CHECK (target_size BETWEEN 2 AND 10),
  roles JSONB NOT NULL DEFAULT '[]',
  skills JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('open','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS join_requests (
  id SERIAL PRIMARY KEY,
  team_id INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  applicant_id INT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS join_requests_pending_uq ON join_requests(team_id, applicant_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS change_requests (
  id SERIAL PRIMARY KEY,
  section_id INT NOT NULL REFERENCES sections(id),
  requested_by INT NOT NULL REFERENCES users(id),
  new_day INT NOT NULL CHECK (new_day BETWEEN 0 AND 6),
  new_start TIME NOT NULL,
  new_end TIME NOT NULL,
  new_location_id INT REFERENCES locations(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  decided_by INT REFERENCES users(id),
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS opportunities (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  provider TEXT NOT NULL,
  field TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('internship','training','job','course')),
  skills JSONB NOT NULL DEFAULT '[]',
  eligibility TEXT NOT NULL,
  opens_on DATE NOT NULL,
  closes_on DATE NOT NULL,
  url TEXT NOT NULL,
  published BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS assistant_log (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  scope TEXT NOT NULL,
  course_id INT,
  question TEXT NOT NULL,
  outcome TEXT NOT NULL,
  sources JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  actor_id INT REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before_data JSONB,
  after_data JSONB,
  reason TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
