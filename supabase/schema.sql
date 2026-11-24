-- ========================================================================
-- IELTS Ms Nga - Supabase PostgreSQL Database Schema & Migration Script
-- Professional IELTS Academic Writing Task 1 Examination Application
-- ========================================================================

-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TEACHERS TABLE
CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. CLASSES TABLE
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. STUDENTS TABLE
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  student_code TEXT,
  full_name TEXT NOT NULL,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  status TEXT DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_class_id ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_students_full_name ON students(full_name);

-- 4. ASSIGNMENTS / EXAMINATIONS TABLE
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  type TEXT DEFAULT 'TASK_1',
  task_category TEXT NOT NULL, -- LINE_GRAPH, BAR_CHART, PIE_CHART, TABLE, PROCESS, MAP, MIXED
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  prompt_question TEXT NOT NULL,
  image_urls TEXT, -- JSON array of image URLs
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  duration_minutes INTEGER DEFAULT 20,
  status TEXT DEFAULT 'DRAFT', -- DRAFT, PUBLISHED, CLOSED
  start_time TEXT,
  end_time TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignments_class_id ON assignments(class_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status);

-- 5. ATTEMPTS TABLE (Exam Writing Sessions)
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  start_time BIGINT, -- Server millisecond epoch
  deadline_time BIGINT, -- Exact 20-minute deadline epoch
  submitted_at BIGINT, -- Submission epoch
  content TEXT DEFAULT '', -- Saved essay draft
  word_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'IN_PROGRESS', -- IN_PROGRESS, SUBMITTED, AUTO-SUBMITTED, INVALIDATED, TECHNICAL_ISSUE
  last_saved_at BIGINT,
  session_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_student_assignment UNIQUE(assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_attempts_assignment ON attempts(assignment_id);
CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status);
CREATE INDEX IF NOT EXISTS idx_attempts_deadline ON attempts(deadline_time);

-- 6. VIOLATION LOGS TABLE (Anti-cheating audit trail)
CREATE TABLE IF NOT EXISTS violation_logs (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- TAB_SWITCH, PAGE_HIDDEN, FULLSCREEN_EXIT, APP_SWITCH, PAGE_EXIT, PASTE_ATTEMPT
  details TEXT,
  timestamp BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_violation_attempt_id ON violation_logs(attempt_id);

-- 7. TEACHER OVERRIDES TABLE (Authorizations to reset or reopen attempts)
CREATE TABLE IF NOT EXISTS teacher_overrides (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- ALLOW_NEW_ATTEMPT, REOPEN_AND_EXTEND, ACCEPT_CANCELLED
  reason TEXT NOT NULL,
  timestamp BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_overrides_attempt_id ON teacher_overrides(attempt_id);

-- 8. SCORES & FEEDBACK TABLE (IELTS 4 Criteria Evaluation)
CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,
  attempt_id TEXT UNIQUE NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  task_achievement REAL DEFAULT 0,
  coherence_cohesion REAL DEFAULT 0,
  lexical_resource REAL DEFAULT 0,
  grammatical_accuracy REAL DEFAULT 0,
  overall_band REAL DEFAULT 0,
  feedback_ta TEXT DEFAULT '',
  feedback_cc TEXT DEFAULT '',
  feedback_lr TEXT DEFAULT '',
  feedback_gra TEXT DEFAULT '',
  general_feedback TEXT DEFAULT '',
  is_published INTEGER DEFAULT 0,
  updated_at BIGINT NOT NULL
);

-- ========================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ========================================================================
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE violation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;

-- Note: In this application architecture, API operations are processed through
-- the secure Node.js backend using authenticated JWT tokens, with database
-- credentials kept strictly on the server (never exposed to browser clients).
-- If connecting directly with Supabase Client, configure policies based on auth.uid().

-- ========================================================================
-- SEED DATA (Default Teacher & Sample IELTS Task 1 Examination)
-- ========================================================================
-- Teacher credentials: username 'teacher', password 'teacher123' (bcrypt hash)
INSERT INTO teachers (id, username, password_hash, full_name, created_at)
VALUES (
  't-msnga',
  'teacher',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- Default password hash
  'Ms. Nga Ngo (Giáo Viên IELTS)',
  NOW()
) ON CONFLICT (username) DO NOTHING;

-- Default Class
INSERT INTO classes (id, name, description, created_at)
VALUES (
  'c-12a1',
  'Lớp 12A1',
  'Lớp luyện thi IELTS Academic Writing Task 1',
  NOW()
) ON CONFLICT (id) DO NOTHING;
