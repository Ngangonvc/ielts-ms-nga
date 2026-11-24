const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pullFromCloud, scheduleCloudSync } = require('./cloud-sync');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'classroom.db');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(path.dirname(DB_FILE))) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

let dbInstance = null;

function saveDatabase() {
  if (!dbInstance) return;
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, buffer);
    try {
      fs.renameSync(tmpFile, DB_FILE);
    } catch (renameErr) {
      // Fallback on Windows if target is momentarily locked by reader/AV
      fs.writeFileSync(DB_FILE, buffer);
      try {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      } catch (_) {}
    }
    // Schedule asynchronous cloud backup to Supabase
    scheduleCloudSync(DB_FILE, UPLOADS_DIR);
  } catch (err) {
    console.error('Failed to persist database to disk:', err);
  }
}

// Auto-save on process exit
process.on('exit', () => saveDatabase());
process.on('SIGINT', () => {
  saveDatabase();
  process.exit(0);
});

async function initDb() {
  if (dbInstance) return dbInstance;

  // Restore latest cloud snapshot on startup if available
  try {
    await pullFromCloud(DB_FILE, UPLOADS_DIR);
  } catch (err) {
    console.warn('[CloudSync] Bỏ qua phục hồi đám mây lúc khởi động:', err.message);
  }

  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    try {
      const filebuffer = fs.readFileSync(DB_FILE);
      dbInstance = new SQL.Database(filebuffer);
    } catch (e) {
      console.warn('Could not read existing DB, creating a fresh one:', e.message);
      dbInstance = new SQL.Database();
    }
  } else {
    dbInstance = new SQL.Database();
  }

  // Schema creation
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS teachers (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      student_code TEXT,
      full_name TEXT NOT NULL,
      class_id TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      status TEXT DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      FOREIGN KEY(class_id) REFERENCES classes(id)
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      type TEXT DEFAULT 'TASK_1',
      task_category TEXT NOT NULL,
      title TEXT NOT NULL,
      instructions TEXT NOT NULL,
      prompt_question TEXT NOT NULL,
      image_urls TEXT,
      class_id TEXT NOT NULL,
      duration_minutes INTEGER DEFAULT 20,
      status TEXT DEFAULT 'DRAFT',
      start_time TEXT,
      end_time TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(class_id) REFERENCES classes(id)
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      start_time INTEGER,
      deadline_time INTEGER,
      submitted_at INTEGER,
      content TEXT DEFAULT '',
      word_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'NOT_STARTED',
      last_saved_at INTEGER,
      session_token TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(assignment_id) REFERENCES assignments(id),
      FOREIGN KEY(student_id) REFERENCES students(id)
    );

    CREATE TABLE IF NOT EXISTS violation_logs (
      id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      details TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(attempt_id) REFERENCES attempts(id)
    );

    CREATE TABLE IF NOT EXISTS teacher_overrides (
      id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(attempt_id) REFERENCES attempts(id)
    );

    CREATE TABLE IF NOT EXISTS scores (
      id TEXT PRIMARY KEY,
      attempt_id TEXT UNIQUE NOT NULL,
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
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(attempt_id) REFERENCES attempts(id)
    );
  `);

  // Safe migrations for Task 1 & Task 2 support
  try {
    dbInstance.run("ALTER TABLE assignments ADD COLUMN task_type TEXT DEFAULT 'TASK_1'");
  } catch (_) {
    // Column already exists
  }
  try {
    dbInstance.run("UPDATE assignments SET task_type = COALESCE(type, 'TASK_1') WHERE task_type IS NULL OR task_type = ''");
    dbInstance.run("UPDATE assignments SET type = COALESCE(task_type, 'TASK_1') WHERE type IS NULL OR type = ''");
    // Ensure all Task 2 assignments are configured with 40 minutes, 250 words, and no chart requirements
    dbInstance.run(`
      UPDATE assignments
      SET duration_minutes = 40
      WHERE (type = 'TASK_2' OR task_type = 'TASK_2') AND (duration_minutes IS NULL OR duration_minutes <= 20)
    `);
    dbInstance.run(`
      UPDATE assignments
      SET image_urls = '[]'
      WHERE (type = 'TASK_2' OR task_type = 'TASK_2') AND (image_urls IS NULL OR image_urls = '' OR image_urls LIKE '%sample-life-expectancy%')
    `);
    dbInstance.run(`
      UPDATE assignments
      SET instructions = 'You should spend about 40 minutes on this task. Write at least 250 words.'
      WHERE (type = 'TASK_2' OR task_type = 'TASK_2') AND (instructions LIKE '%20 minutes%' OR instructions LIKE '%150 words%' OR instructions IS NULL OR instructions = '')
    `);
  } catch (_) {}

  // Seed default teacher if not present
  const teachersCount = query('SELECT COUNT(*) as count FROM teachers')[0]?.count || 0;
  if (teachersCount === 0) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('teacher123', salt);
    run(
      `INSERT INTO teachers (id, username, password_hash, full_name, created_at) VALUES (?, ?, ?, ?, ?)`,
      ['t-1', 'teacher', hash, 'Giáo Viên Tiếng Anh', new Date().toISOString()]
    );
  }

  // Seed default sample class and students if empty
  const classesCount = query('SELECT COUNT(*) as count FROM classes')[0]?.count || 0;
  if (classesCount === 0) {
    const classId1 = 'c-12a1';
    run(`INSERT INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)`, [
      classId1,
      'Lớp 12A1',
      'Lớp luyện thi IELTS Academic',
      new Date().toISOString()
    ]);

    const salt = bcrypt.genSaltSync(10);
    // Student 1
    run(
      `INSERT INTO students (id, student_code, full_name, class_id, pin_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['s-1', 'HS001', 'Nguyễn Văn An', classId1, bcrypt.hashSync('1234', salt), 'ACTIVE', new Date().toISOString()]
    );
    // Student 2 (different student, distinct PIN)
    run(
      `INSERT INTO students (id, student_code, full_name, class_id, pin_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['s-2', 'HS002', 'Trần Thị Bình', classId1, bcrypt.hashSync('5678', salt), 'ACTIVE', new Date().toISOString()]
    );
    // Student 3 (Identical name to Student 1 to test scenario #3!)
    run(
      `INSERT INTO students (id, student_code, full_name, class_id, pin_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['s-3', 'HS003', 'Nguyễn Văn An', classId1, bcrypt.hashSync('9999', salt), 'ACTIVE', new Date().toISOString()]
    );

    // Seed a standard IELTS Academic Task 1 assignment
    const assignId = 'a-task1-demo';
    const sampleImageSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="100%" height="100%">
        <rect width="800" height="450" fill="#f8fafc"/>
        <text x="400" y="35" font-family="Arial, sans-serif" font-size="20" font-weight="bold" text-anchor="middle" fill="#1e293b">Life Expectancy at Birth (1950 - 2020)</text>
        <line x1="80" y1="380" x2="740" y2="380" stroke="#94a3b8" stroke-width="2"/>
        <line x1="80" y1="70" x2="80" y2="380" stroke="#94a3b8" stroke-width="2"/>
        <!-- Y-axis labels -->
        <text x="70" y="385" font-size="12" text-anchor="end" fill="#64748b">40</text>
        <text x="70" y="310" font-size="12" text-anchor="end" fill="#64748b">50</text>
        <text x="70" y="235" font-size="12" text-anchor="end" fill="#64748b">60</text>
        <text x="70" y="160" font-size="12" text-anchor="end" fill="#64748b">70</text>
        <text x="70" y="85" font-size="12" text-anchor="end" fill="#64748b">80 years</text>
        <!-- Grid lines -->
        <line x1="80" y1="305" x2="740" y2="305" stroke="#e2e8f0" stroke-dasharray="4"/>
        <line x1="80" y1="230" x2="740" y2="230" stroke="#e2e8f0" stroke-dasharray="4"/>
        <line x1="80" y1="155" x2="740" y2="155" stroke="#e2e8f0" stroke-dasharray="4"/>
        <line x1="80" y1="80" x2="740" y2="80" stroke="#e2e8f0" stroke-dasharray="4"/>
        <!-- X-axis labels -->
        <text x="130" y="405" font-size="12" text-anchor="middle" fill="#64748b">1950</text>
        <text x="250" y="405" font-size="12" text-anchor="middle" fill="#64748b">1970</text>
        <text x="370" y="405" font-size="12" text-anchor="middle" fill="#64748b">1990</text>
        <text x="490" y="405" font-size="12" text-anchor="middle" fill="#64748b">2005</text>
        <text x="610" y="405" font-size="12" text-anchor="middle" fill="#64748b">2020</text>
        <!-- Lines: Region A (Europe), Region B (Americas), Region C (Asia), Region D (Africa) -->
        <!-- Europe: 65 -> 78 -->
        <polyline fill="none" stroke="#2563eb" stroke-width="3" points="130,195 250,165 370,135 490,110 610,95"/>
        <!-- Americas: 60 -> 76 -->
        <polyline fill="none" stroke="#16a34a" stroke-width="3" points="130,230 250,200 370,165 490,130 610,110"/>
        <!-- Asia: 43 -> 73 -->
        <polyline fill="none" stroke="#d97706" stroke-width="3" points="130,358 250,290 370,220 490,165 610,132"/>
        <!-- Africa: 38 -> 63 -->
        <polyline fill="none" stroke="#dc2626" stroke-width="3" points="130,375 250,335 370,295 490,260 610,210"/>
        <!-- Legend -->
        <rect x="200" y="420" width="12" height="12" fill="#2563eb"/>
        <text x="220" y="431" font-size="12" fill="#1e293b">Europe</text>
        <rect x="310" y="420" width="12" height="12" fill="#16a34a"/>
        <text x="330" y="431" font-size="12" fill="#1e293b">Americas</text>
        <rect x="430" y="420" width="12" height="12" fill="#d97706"/>
        <text x="450" y="431" font-size="12" fill="#1e293b">Asia</text>
        <rect x="530" y="420" width="12" height="12" fill="#dc2626"/>
        <text x="550" y="431" font-size="12" fill="#1e293b">Africa</text>
      </svg>
    `;
    const sampleImgPath = path.join(UPLOADS_DIR, 'sample-life-expectancy.svg');
    fs.writeFileSync(sampleImgPath, sampleImageSvg.trim());

    run(
      `INSERT INTO assignments (id, type, task_category, title, instructions, prompt_question, image_urls, class_id, duration_minutes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        assignId,
        'TASK_1',
        'LINE_GRAPH',
        'Life Expectancy at Birth (1950 - 2020)',
        'You should spend about 20 minutes on this task. Write at least 150 words.',
        'The line graph below shows the life expectancy at birth in four different world regions from 1950 to 2020.\n\nSummarise the information by selecting and reporting the main features, and make comparisons where relevant.',
        JSON.stringify(['/uploads/sample-life-expectancy.svg']),
        classId1,
        20,
        'PUBLISHED',
        new Date().toISOString()
      ]
    );
  }

  saveDatabase();
  return dbInstance;
}

function query(sql, params = []) {
  if (!dbInstance) throw new Error('Database not initialized');
  const stmt = dbInstance.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  const rows = query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function run(sql, params = []) {
  if (!dbInstance) throw new Error('Database not initialized');
  dbInstance.run(sql, params);
  saveDatabase();
}

module.exports = {
  initDb,
  query,
  get,
  run,
  saveDatabase,
  DATA_DIR,
  UPLOADS_DIR
};
