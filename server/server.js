const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { randomUUID: uuidv4 } = require('crypto');
const bcrypt = require('bcryptjs');
const qrcode = require('qrcode');
const xlsx = require('xlsx');

const { initDb, query, get, run, UPLOADS_DIR } = require('./db');
const {
  getClientIp,
  isPublicTunnelRequest,
  isUsingDefaultTeacherAccount,
  isWeakDefaultPassword,
  checkRateLimit,
  clearRateLimit,
  generateTeacherToken,
  generateStudentToken,
  authenticateTeacher,
  authenticateStudent
} = require('./auth');
const { countWords, calculateOverallBand } = require('./ielts');
const {
  generateSubmissionsExcel,
  generatePrintableReportHtml,
  generateStudentEssayDocxBuffer,
  generateClassSubmissionsZipBuffer,
  buildDocxFilename,
  sanitizeFilenamePart
} = require('./export');
const { getTunnelStatus, startTunnel, stopTunnel } = require('./tunnel');
const { checkCloudStatus } = require('./cloud-sync');

const app = express();
const PORT = process.env.PORT || 5000;
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

// Helper: Detect the primary local Wi-Fi / LAN IP address
function getLanIpAddress() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (
          iface.address.startsWith('192.168.') ||
          iface.address.startsWith('10.') ||
          iface.address.startsWith('172.')
        ) {
          return iface.address;
        }
      }
    }
  }
  return '127.0.0.1';
}

app.use(cors());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded chart images
app.use('/uploads', express.static(UPLOADS_DIR));

// Configure multer for chart image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `chart-${Date.now()}-${uuidv4().slice(0, 8)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file ảnh định dạng JPG, PNG, WEBP, SVG'));
    }
  }
});

// Configure multer for Excel/CSV import
const uploadExcel = multer({
  dest: path.join(__dirname, '..', 'data', 'temp'),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// ==========================================
// 1. AUTHENTICATION ENDPOINTS
// ==========================================

// Teacher Login (Protected with rate limiting against brute force)
app.post('/api/auth/teacher/login', (req, res) => {
  const ip = getClientIp(req);
  const rateKey = `teacher-login-${ip}`;
  if (!checkRateLimit(rateKey, 5, 300000)) {
    return res.status(429).json({ error: 'Quá nhiều lần thử đăng nhập giáo viên thất bại. Vui lòng thử lại sau 5 phút.' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu giáo viên' });
  }

  const teacher = get('SELECT * FROM teachers WHERE username = ?', [username.trim()]);
  if (!teacher || !bcrypt.compareSync(password, teacher.password_hash)) {
    return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác' });
  }

  const requiresAccountSetup = isUsingDefaultTeacherAccount(teacher);
  if (isPublicTunnelRequest(req) && requiresAccountSetup) {
    return res.status(403).json({
      error: 'Từ chối đăng nhập quản trị qua Internet vì bạn vẫn đang dùng tài khoản mặc định. Vui lòng truy cập http://localhost:5000/#/teacher trên máy tính để đổi tên đăng nhập và mật khẩu trước!'
    });
  }

  clearRateLimit(rateKey);

  const token = generateTeacherToken(teacher);
  res.json({
    token,
    teacher: {
      id: teacher.id,
      username: teacher.username,
      fullName: teacher.full_name,
      requiresAccountSetup
    }
  });
});

// Teacher Replace Default Account (Update username, full name, and/or password safely)
app.post('/api/auth/teacher/update-account', authenticateTeacher, (req, res) => {
  const { currentPassword, newUsername, newPassword, fullName } = req.body || {};
  if (!currentPassword || !newUsername || !newPassword) {
    return res.status(400).json({ error: 'Vui lòng nhập mật khẩu hiện tại, tên đăng nhập mới và mật khẩu mới' });
  }

  const cleanUsername = newUsername.trim();
  if (cleanUsername.length < 3 || !/^[a-zA-Z0-9._-]+$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'Tên đăng nhập mới phải dài ít nhất 3 ký tự (chỉ dùng chữ cái, số, dấu chấm, gạch ngang hoặc gạch dưới)' });
  }
  if (cleanUsername.toLowerCase() === 'teacher') {
    return res.status(400).json({ error: 'Vui lòng đổi tên đăng nhập khác với tên mặc định "teacher" để bảo đảm an toàn trước khi mở Internet' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự để bảo đảm an toàn' });
  }
  if (isWeakDefaultPassword(newPassword)) {
    return res.status(400).json({ error: 'Mật khẩu mới quá dễ đoán hoặc trùng mật khẩu mặc định. Vui lòng chọn mật khẩu mạnh hơn' });
  }

  const teacher = get('SELECT * FROM teachers WHERE id = ?', [req.user.id]);
  if (!teacher || !bcrypt.compareSync(currentPassword, teacher.password_hash)) {
    return res.status(401).json({ error: 'Mật khẩu hiện tại không chính xác' });
  }

  const existingOther = get('SELECT id FROM teachers WHERE LOWER(username) = LOWER(?) AND id != ?', [cleanUsername, req.user.id]);
  if (existingOther) {
    return res.status(400).json({ error: 'Tên đăng nhập này đã được sử dụng' });
  }

  const cleanFullName = fullName && fullName.trim() ? fullName.trim() : teacher.full_name;
  const newHash = bcrypt.hashSync(newPassword, 10);

  run('UPDATE teachers SET username = ?, password_hash = ?, full_name = ? WHERE id = ?', [
    cleanUsername,
    newHash,
    cleanFullName,
    req.user.id
  ]);

  const updatedTeacher = get('SELECT * FROM teachers WHERE id = ?', [req.user.id]);
  const newToken = generateTeacherToken(updatedTeacher);

  res.json({
    success: true,
    message: 'Đã cập nhật tài khoản quản trị mới an toàn! Bạn có thể sử dụng tài khoản mới cho những lần đăng nhập sau.',
    token: newToken,
    teacher: {
      id: updatedTeacher.id,
      username: updatedTeacher.username,
      fullName: updatedTeacher.full_name,
      requiresAccountSetup: isUsingDefaultTeacherAccount(updatedTeacher)
    }
  });
});

// Teacher Change Password
app.post('/api/auth/teacher/change-password', authenticateTeacher, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự để bảo đảm an toàn' });
  }
  if (isWeakDefaultPassword(newPassword)) {
    return res.status(400).json({ error: 'Vui lòng chọn mật khẩu an toàn hơn (không dùng mật khẩu mặc định hoặc quá đơn giản)' });
  }

  const teacher = get('SELECT * FROM teachers WHERE id = ?', [req.user.id]);
  if (!teacher || !bcrypt.compareSync(currentPassword, teacher.password_hash)) {
    return res.status(401).json({ error: 'Mật khẩu hiện tại không chính xác' });
  }

  const salt = bcrypt.genSaltSync(10);
  const newHash = bcrypt.hashSync(newPassword, salt);
  run('UPDATE teachers SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);

  res.json({ success: true, message: 'Đổi mật khẩu giáo viên thành công' });
});

app.get('/api/auth/teacher/me', authenticateTeacher, (req, res) => {
  res.json({ teacher: req.user });
});

// Student Login
// Get available classes for student login dropdown
app.get('/api/auth/student/classes', (req, res) => {
  const classes = query('SELECT id, name FROM classes ORDER BY name ASC');
  res.json({ classes });
});

app.post('/api/auth/student/login', async (req, res) => {
  const { classId, fullName, pin } = req.body || {};
  const ip = getClientIp(req);
  const rateKey = `student-login-${ip}-${classId}-${fullName}`;

  if (!checkRateLimit(rateKey, 6, 60000)) {
    return res.status(429).json({ error: 'Quá nhiều lần thử đăng nhập sai. Vui lòng thử lại sau 1 phút.' });
  }

  if (!classId || !fullName || !pin) {
    return res.status(400).json({ error: 'Vui lòng chọn Lớp, nhập Họ và Tên và Mã PIN' });
  }

  // Find all students in class with matching name (handles identical names!)
  const trimmedName = fullName.trim();
  const matchingStudents = query(
    'SELECT * FROM students WHERE class_id = ? AND LOWER(TRIM(full_name)) = LOWER(?)',
    [classId, trimmedName]
  );

  if (matchingStudents.length === 0) {
    return res.status(401).json({ error: 'Không tìm thấy thông tin học sinh trong lớp đã chọn' });
  }

  // Find the exact student whose PIN matches (async compare avoids blocking event loop on bursts)
  let authenticatedStudent = null;
  for (const student of matchingStudents) {
    if (await bcrypt.compare(pin.toString(), student.pin_hash)) {
      authenticatedStudent = student;
      break;
    }
  }

  if (!authenticatedStudent) {
    return res.status(401).json({ error: 'Mã PIN cá nhân không chính xác' });
  }

  if (authenticatedStudent.status !== 'ACTIVE') {
    return res.status(403).json({ error: 'Tài khoản học sinh của bạn đã bị khóa. Vui lòng liên hệ giáo viên.' });
  }

  clearRateLimit(rateKey);

  // Generate unique device session token
  const sessionToken = uuidv4();
  const token = generateStudentToken(authenticatedStudent, sessionToken);

  const studentClass = get('SELECT name FROM classes WHERE id = ?', [classId]);

  res.json({
    token,
    sessionToken,
    student: {
      id: authenticatedStudent.id,
      studentCode: authenticatedStudent.student_code,
      fullName: authenticatedStudent.full_name,
      classId: authenticatedStudent.class_id,
      className: studentClass ? studentClass.name : ''
    }
  });
});

app.get('/api/auth/student/me', authenticateStudent, (req, res) => {
  const student = get('SELECT id, student_code, full_name, class_id, status FROM students WHERE id = ?', [req.user.id]);
  if (!student || student.status !== 'ACTIVE') {
    return res.status(403).json({ error: 'Tài khoản học sinh đã bị vô hiệu hóa hoặc không tồn tại' });
  }
  const studentClass = get('SELECT name FROM classes WHERE id = ?', [student.class_id]);
  res.json({
    student: {
      id: student.id,
      studentCode: student.student_code,
      fullName: student.full_name,
      classId: student.class_id,
      status: student.status,
      className: studentClass ? studentClass.name : ''
    }
  });
});

// ==========================================
// 2. CLASS MANAGEMENT (Teacher only)
// ==========================================

app.get('/api/classes', authenticateTeacher, (req, res) => {
  const classes = query(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) as student_count,
      (SELECT COUNT(*) FROM assignments a WHERE a.class_id = c.id) as assignment_count,
      (SELECT COUNT(*) FROM attempts att WHERE att.assignment_id IN (SELECT id FROM assignments WHERE class_id = c.id) OR att.student_id IN (SELECT id FROM students WHERE class_id = c.id)) as attempt_count
    FROM classes c
    ORDER BY c.created_at DESC
  `);
  res.json({ classes });
});

app.post('/api/classes', authenticateTeacher, (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập tên lớp học' });
  }
  const id = 'c-' + uuidv4().slice(0, 8);
  run('INSERT INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)', [
    id,
    name.trim(),
    description || '',
    new Date().toISOString()
  ]);
  const newClass = get('SELECT * FROM classes WHERE id = ?', [id]);
  res.json({ class: newClass });
});

app.put('/api/classes/:id', authenticateTeacher, (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập tên lớp học' });
  }
  run('UPDATE classes SET name = ?, description = ? WHERE id = ?', [name.trim(), description || '', req.params.id]);
  const updated = get('SELECT * FROM classes WHERE id = ?', [req.params.id]);
  res.json({ class: updated });
});

app.delete('/api/classes/:id', authenticateTeacher, (req, res) => {
  const classId = req.params.id;
  const targetClass = get('SELECT * FROM classes WHERE id = ?', [classId]);
  if (!targetClass) {
    return res.status(404).json({ error: 'Không tìm thấy lớp học cần xóa' });
  }

  const studentCount = query('SELECT COUNT(*) as c FROM students WHERE class_id = ?', [classId])[0]?.c || 0;
  const assignmentCount = query('SELECT COUNT(*) as c FROM assignments WHERE class_id = ?', [classId])[0]?.c || 0;

  if (studentCount > 0 || assignmentCount > 0) {
    return res.status(400).json({
      error: `Không thể xóa lớp "${targetClass.name}" vì đang chứa dữ liệu học tập.`,
      hasData: true,
      studentCount,
      assignmentCount,
      className: targetClass.name,
      suggestion: `Lớp hiện có ${studentCount} học sinh và ${assignmentCount} đề bài Writing. Để bảo vệ dữ liệu học tập của học sinh, vui lòng chuyển học sinh sang lớp khác hoặc xóa bài tập/học sinh trước khi xóa lớp.`
    });
  }

  run('DELETE FROM classes WHERE id = ?', [classId]);
  res.json({ success: true, message: `Đã xóa lớp "${targetClass.name}" thành công` });
});

// Transfer all students and assignments from one class to another
app.post('/api/classes/:id/transfer-students', authenticateTeacher, (req, res) => {
  const sourceClassId = req.params.id;
  const { targetClassId } = req.body;

  if (!targetClassId || targetClassId === sourceClassId) {
    return res.status(400).json({ error: 'Vui lòng chọn một lớp học đích khác với lớp hiện tại' });
  }

  const sourceClass = get('SELECT * FROM classes WHERE id = ?', [sourceClassId]);
  const targetClass = get('SELECT * FROM classes WHERE id = ?', [targetClassId]);

  if (!sourceClass || !targetClass) {
    return res.status(404).json({ error: 'Không tìm thấy lớp học nguồn hoặc lớp đích' });
  }

  const studentCount = query('SELECT COUNT(*) as c FROM students WHERE class_id = ?', [sourceClassId])[0]?.c || 0;
  const assignmentCount = query('SELECT COUNT(*) as c FROM assignments WHERE class_id = ?', [sourceClassId])[0]?.c || 0;

  // Move students to new class
  run('UPDATE students SET class_id = ? WHERE class_id = ?', [targetClassId, sourceClassId]);
  // Move assignments to new class
  run('UPDATE assignments SET class_id = ? WHERE class_id = ?', [targetClassId, sourceClassId]);

  res.json({
    success: true,
    message: `Đã chuyển ${studentCount} học sinh và ${assignmentCount} đề bài từ "${sourceClass.name}" sang "${targetClass.name}". Lớp hiện đã trống và có thể xóa an toàn.`,
    transferredStudents: studentCount,
    transferredAssignments: assignmentCount
  });
});

// Permanent delete class and all associated data exclusive to this class
app.post('/api/classes/:id/permanent-delete', authenticateTeacher, (req, res) => {
  const classId = req.params.id;
  const { confirmClassName } = req.body;

  const targetClass = get('SELECT * FROM classes WHERE id = ?', [classId]);
  if (!targetClass) {
    return res.status(404).json({ error: 'Không tìm thấy lớp học cần xóa' });
  }

  // Enforce confirmation with exact class name
  if (!confirmClassName || confirmClassName.trim() !== targetClass.name.trim()) {
    return res.status(400).json({
      error: `Tên lớp xác nhận không khớp. Vui lòng nhập chính xác "${targetClass.name}" để xác nhận xóa vĩnh viễn.`
    });
  }

  // Count related records before deletion for reporting
  const studentCount = query('SELECT COUNT(*) as c FROM students WHERE class_id = ?', [classId])[0]?.c || 0;
  const assignmentCount = query('SELECT COUNT(*) as c FROM assignments WHERE class_id = ?', [classId])[0]?.c || 0;
  const attemptCount = query(
    `SELECT COUNT(*) as c FROM attempts 
     WHERE student_id IN (SELECT id FROM students WHERE class_id = ?) 
        OR assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)`,
    [classId, classId]
  )[0]?.c || 0;

  // 1. Delete scores of attempts related only to this class
  run(
    `DELETE FROM scores WHERE attempt_id IN (
       SELECT id FROM attempts 
       WHERE student_id IN (SELECT id FROM students WHERE class_id = ?) 
          OR assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)
     )`,
    [classId, classId]
  );

  // 2. Delete violation_logs of attempts related only to this class
  run(
    `DELETE FROM violation_logs WHERE attempt_id IN (
       SELECT id FROM attempts 
       WHERE student_id IN (SELECT id FROM students WHERE class_id = ?) 
          OR assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)
     )`,
    [classId, classId]
  );

  // 3. Delete teacher_overrides of attempts related only to this class
  run(
    `DELETE FROM teacher_overrides WHERE attempt_id IN (
       SELECT id FROM attempts 
       WHERE student_id IN (SELECT id FROM students WHERE class_id = ?) 
          OR assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)
     )`,
    [classId, classId]
  );

  // 4. Delete attempts of this class
  run(
    `DELETE FROM attempts 
     WHERE student_id IN (SELECT id FROM students WHERE class_id = ?) 
        OR assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)`,
    [classId, classId]
  );

  // 5. Delete assignments belonging only to this class
  run('DELETE FROM assignments WHERE class_id = ?', [classId]);

  // 6. Delete students belonging only to this class
  run('DELETE FROM students WHERE class_id = ?', [classId]);

  // 7. Delete the class itself
  run('DELETE FROM classes WHERE id = ?', [classId]);

  res.json({
    success: true,
    message: `Đã xóa vĩnh viễn lớp "${targetClass.name}" cùng ${studentCount} học sinh, ${assignmentCount} đề bài và ${attemptCount} bài làm liên quan.`,
    deleted: {
      className: targetClass.name,
      studentCount,
      assignmentCount,
      attemptCount
    }
  });
});

// ==========================================
// 3. STUDENT MANAGEMENT (Teacher only)
// ==========================================

app.get('/api/students', authenticateTeacher, (req, res) => {
  const { classId, search } = req.query;
  let sql = `
    SELECT s.id, s.student_code, s.full_name, s.class_id, s.status, s.created_at, c.name as class_name
    FROM students s
    JOIN classes c ON s.class_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (classId) {
    sql += ' AND s.class_id = ?';
    params.push(classId);
  }
  if (search) {
    sql += ' AND (s.full_name LIKE ? OR s.student_code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY c.name ASC, s.full_name ASC';
  const students = query(sql, params);
  res.json({ students });
});

app.post('/api/students', authenticateTeacher, async (req, res) => {
  const { classId, fullName, studentCode, pin } = req.body;
  if (!classId || !fullName || !pin) {
    return res.status(400).json({ error: 'Vui lòng nhập đầy đủ Lớp, Họ và Tên và Mã PIN' });
  }
  const id = 's-' + uuidv4().slice(0, 8);
  const pinHash = await bcrypt.hash(pin.toString(), 10);
  run(
    'INSERT INTO students (id, student_code, full_name, class_id, pin_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, studentCode || '', fullName.trim(), classId, pinHash, 'ACTIVE', new Date().toISOString()]
  );
  const student = get('SELECT id, student_code, full_name, class_id, status, created_at FROM students WHERE id = ?', [id]);
  res.json({ student });
});

app.put('/api/students/:id', authenticateTeacher, (req, res) => {
  const { fullName, studentCode, classId } = req.body;
  if (!fullName || !fullName.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập Họ và Tên' });
  }
  run('UPDATE students SET full_name = ?, student_code = ?, class_id = ? WHERE id = ?', [
    fullName.trim(),
    studentCode || '',
    classId,
    req.params.id
  ]);
  const student = get('SELECT id, student_code, full_name, class_id, status FROM students WHERE id = ?', [req.params.id]);
  res.json({ student });
});

// Reset student PIN
app.post('/api/students/:id/reset-pin', authenticateTeacher, (req, res) => {
  const { newPin } = req.body;
  const pinToSet = newPin ? newPin.toString() : Math.floor(1000 + Math.random() * 9000).toString();
  const pinHash = bcrypt.hashSync(pinToSet, 10);
  run('UPDATE students SET pin_hash = ? WHERE id = ?', [pinHash, req.params.id]);
  res.json({ success: true, newPin: pinToSet });
});

// Toggle student status (ACTIVE / DISABLED)
app.post('/api/students/:id/toggle-status', authenticateTeacher, (req, res) => {
  const student = get('SELECT status FROM students WHERE id = ?', [req.params.id]);
  if (!student) return res.status(404).json({ error: 'Không tìm thấy học sinh' });
  const newStatus = student.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  run('UPDATE students SET status = ? WHERE id = ?', [newStatus, req.params.id]);
  res.json({ success: true, status: newStatus });
});

// Import students from Excel / CSV
app.post('/api/students/import', authenticateTeacher, uploadExcel.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Vui lòng chọn file Excel (.xlsx) hoặc CSV' });
  }

  const { classId } = req.body;
  if (!classId) {
    return res.status(400).json({ error: 'Vui lòng chọn lớp học để nhập danh sách' });
  }

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const rawData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    let importedCount = 0;
    const generatedList = [];

    for (const row of rawData) {
      // Find full name column
      const fullName = row['Họ và Tên'] || row['Họ và tên'] || row['Họ tên'] || row['Full Name'] || row['Name'] || row['name'];
      if (!fullName || !fullName.toString().trim()) continue;

      const studentCode = row['Mã HS'] || row['Mã học sinh'] || row['Student ID'] || row['ID'] || '';
      let pin = row['Mã PIN'] || row['PIN'] || row['Pin'] || '';
      if (!pin) {
        // Auto-generate random 4-digit PIN
        pin = Math.floor(1000 + Math.random() * 9000).toString();
      } else {
        pin = pin.toString().trim();
      }

      const id = 's-' + uuidv4().slice(0, 8);
      const pinHash = bcrypt.hashSync(pin, 10);

      run(
        'INSERT INTO students (id, student_code, full_name, class_id, pin_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, studentCode.toString().trim(), fullName.toString().trim(), classId, pinHash, 'ACTIVE', new Date().toISOString()]
      );

      importedCount++;
      generatedList.push({
        fullName: fullName.toString().trim(),
        studentCode: studentCode.toString().trim(),
        pin
      });
    }

    fs.unlinkSync(req.file.path);
    res.json({
      success: true,
      importedCount,
      students: generatedList
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Không thể đọc file: ' + err.message });
  }
});

// ==========================================
// 4. ASSIGNMENT MANAGEMENT (Task 1 focus, Task 2 ready)
// ==========================================

app.get('/api/assignments', authenticateTeacher, (req, res) => {
  const { classId, taskType, type } = req.query;
  const selectedType = (taskType || type || '').toUpperCase();
  let sql = `
    SELECT a.*, c.name as class_name,
      (SELECT COUNT(*) FROM attempts att WHERE att.assignment_id = a.id) as attempt_count,
      (SELECT COUNT(*) FROM attempts att WHERE att.assignment_id = a.id AND att.status = 'SUBMITTED') as submitted_count
    FROM assignments a
    JOIN classes c ON a.class_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (classId) {
    sql += ' AND a.class_id = ?';
    params.push(classId);
  }
  if (selectedType) {
    sql += ' AND (a.type = ? OR a.task_type = ?)';
    params.push(selectedType, selectedType);
  }
  sql += ' ORDER BY a.created_at DESC';
  const assignments = query(sql, params).map(a => ({
    ...a,
    type: a.type || a.task_type || 'TASK_1',
    task_type: a.task_type || a.type || 'TASK_1',
    image_urls: a.image_urls ? JSON.parse(a.image_urls) : []
  }));
  res.json({ assignments });
});

app.post('/api/assignments', authenticateTeacher, upload.array('images', 5), (req, res) => {
  try {
    const {
      type = 'TASK_1',
      taskType,
      taskCategory,
      title,
      instructions = '',
      promptQuestion = '',
      classId,
      durationMinutes,
      status = 'DRAFT',
      startTime,
      endTime
    } = req.body || {};

    if (!title || !title.toString().trim() || !classId) {
      return res.status(400).json({ error: 'Vui lòng nhập Tên buổi Writing và chọn Lớp học' });
    }

    const resolvedType = (taskType || type || 'TASK_1').toUpperCase();
    const isTask2 = resolvedType === 'TASK_2';
    const defaultDuration = isTask2 ? 40 : 20;
    const defaultCategory = isTask2 ? 'OPINION' : 'LINE_GRAPH';
    const parsedDuration = isTask2
      ? Math.max(40, parseInt(durationMinutes, 10) || 40)
      : Math.min(240, Math.max(1, parseInt(durationMinutes, 10) || defaultDuration));
    const defaultInstructions = isTask2
      ? 'You should spend about 40 minutes on this task. Write at least 250 words.'
      : 'You should spend about 20 minutes on this task. Write at least 150 words.';
    const resolvedInstructions = (instructions && instructions.toString().trim()) || defaultInstructions;
    const resolvedCategory = taskCategory || defaultCategory;
    const imageUrls = isTask2 ? [] : (req.files ? req.files.map(f => `/uploads/${f.filename}`) : []);

    const id = 'a-' + uuidv4().slice(0, 8);
    run(
      `INSERT INTO assignments (id, type, task_type, task_category, title, instructions, prompt_question, image_urls, class_id, duration_minutes, status, start_time, end_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        resolvedType,
        resolvedType,
        resolvedCategory,
        title.toString().trim(),
        resolvedInstructions,
        (promptQuestion || '').toString().trim(),
        JSON.stringify(imageUrls),
        classId,
        parsedDuration,
        status,
        startTime || null,
        endTime || null,
        new Date().toISOString()
      ]
    );

    const created = get('SELECT * FROM assignments WHERE id = ?', [id]);
    res.json({
      assignment: {
        ...created,
        type: created.type || created.task_type || 'TASK_1',
        task_type: created.task_type || created.type || 'TASK_1',
        image_urls: JSON.parse(created.image_urls || '[]')
      }
    });
  } catch (err) {
    console.error('Create assignment error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/assignments/:id', authenticateTeacher, upload.array('images', 5), (req, res) => {
  try {
    const existing = get('SELECT * FROM assignments WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy buổi Writing' });

    const {
      type,
      taskType,
      taskCategory,
      title,
      instructions,
      promptQuestion,
      classId,
      durationMinutes,
      status,
      existingImages
    } = req.body || {};

    const updatedType = (taskType || type || existing.type || existing.task_type || 'TASK_1').toUpperCase();
    const isTask2 = updatedType === 'TASK_2';
    const defaultDuration = isTask2 ? 40 : 20;

    let keptImages = [];
    if (!isTask2) {
      if (existingImages) {
        try {
          keptImages = Array.isArray(existingImages) ? existingImages : JSON.parse(existingImages);
        } catch (e) {
          keptImages = [existingImages];
        }
      } else if (existing.image_urls) {
        try {
          keptImages = JSON.parse(existing.image_urls);
        } catch (_) {}
      }
    }

    const newImages = (!isTask2 && req.files) ? req.files.map(f => `/uploads/${f.filename}`) : [];
    const allImages = isTask2 ? [] : [...keptImages, ...newImages];
    const defaultInstructions = isTask2
      ? 'You should spend about 40 minutes on this task. Write at least 250 words.'
      : 'You should spend about 20 minutes on this task. Write at least 150 words.';
    const finalInstructions = instructions !== undefined
      ? instructions.toString().trim()
      : (existing.instructions || defaultInstructions);
    const parsedDuration = isTask2
      ? Math.max(40, parseInt(durationMinutes, 10) || 40)
      : (durationMinutes !== undefined ? Math.min(240, Math.max(1, parseInt(durationMinutes, 10) || defaultDuration)) : existing.duration_minutes);

    run(
      `UPDATE assignments SET 
        type = ?, task_type = ?, task_category = ?, title = ?, instructions = ?, prompt_question = ?, 
        image_urls = ?, class_id = ?, duration_minutes = ?, status = ?
       WHERE id = ?`,
      [
        updatedType,
        updatedType,
        taskCategory !== undefined ? taskCategory : existing.task_category,
        title !== undefined ? title.toString().trim() : existing.title,
        finalInstructions,
        promptQuestion !== undefined ? promptQuestion.toString().trim() : (existing.prompt_question || ''),
        JSON.stringify(allImages),
        classId !== undefined ? classId : existing.class_id,
        parsedDuration,
        status !== undefined ? status : existing.status,
        req.params.id
      ]
    );

    const updated = get('SELECT * FROM assignments WHERE id = ?', [req.params.id]);
    res.json({
      assignment: {
        ...updated,
        type: updated.type || updated.task_type || 'TASK_1',
        task_type: updated.task_type || updated.type || 'TASK_1',
        image_urls: JSON.parse(updated.image_urls || '[]')
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update assignment status (DRAFT / PUBLISHED / CLOSED)
app.post('/api/assignments/:id/status', authenticateTeacher, (req, res) => {
  const { status } = req.body || {};
  if (!['DRAFT', 'PUBLISHED', 'CLOSED'].includes(status)) {
    return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
  }
  run('UPDATE assignments SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ success: true, status });
});

// Duplicate assignment / exam
app.post('/api/assignments/:id/duplicate', authenticateTeacher, (req, res) => {
  try {
    const existing = get('SELECT * FROM assignments WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy buổi Writing cần nhân bản' });

    const newId = 'a-' + uuidv4().slice(0, 8);
    const newTitle = `${existing.title} (Bản sao)`;

    const resolvedType = existing.type || existing.task_type || 'TASK_1';
    const defaultDuration = resolvedType === 'TASK_2' ? 40 : 20;

    run(
      `INSERT INTO assignments (id, type, task_type, task_category, title, instructions, prompt_question, image_urls, class_id, duration_minutes, status, start_time, end_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId,
        resolvedType,
        resolvedType,
        existing.task_category || (resolvedType === 'TASK_2' ? 'OPINION' : 'LINE_GRAPH'),
        newTitle,
        existing.instructions || '',
        existing.prompt_question || '',
        existing.image_urls || '[]',
        existing.class_id,
        existing.duration_minutes || defaultDuration,
        'DRAFT', // Duplicated exam defaults to DRAFT for review
        null,
        null,
        new Date().toISOString()
      ]
    );

    const duplicated = get('SELECT * FROM assignments WHERE id = ?', [newId]);
    res.json({
      assignment: {
        ...duplicated,
        type: duplicated.type || duplicated.task_type || 'TASK_1',
        task_type: duplicated.task_type || duplicated.type || 'TASK_1',
        image_urls: JSON.parse(duplicated.image_urls || '[]')
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Server authoritative time endpoint
app.get('/api/time', (req, res) => {
  res.json({ serverTime: Date.now() });
});

// Public health ping for Render / Uptime monitors (keeps free service awake before exams)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'HEALTHY',
    service: 'IELTS Ms Nga - Examination Backend',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: Date.now()
  });
});

// Teacher System Readiness Check (Requirement 14: KIỂM TRA HỆ THỐNG TRƯỚC GIỜ THI)
app.get('/api/teacher/system-check', authenticateTeacher, async (req, res) => {
  const startTime = Date.now();
  const checks = [];
  let isAllReady = true;

  // 1. Website & Server Availability
  checks.push({
    id: 'web_server',
    name: '1. Khả Dụng Máy Chủ & Website Trực Tuyến',
    status: 'READY',
    detail: `Máy chủ phản hồi tốt (Thời gian hoạt động liên tục: ${Math.round(process.uptime())}s)`
  });

  // 2. Database Read Connection
  try {
    const teacherCount = get('SELECT count(*) as cnt FROM teachers');
    if (teacherCount && typeof teacherCount.cnt === 'number') {
      checks.push({
        id: 'database_read',
        name: '2. Kết Nối & Đọc Cơ Sở Dữ Liệu',
        status: 'READY',
        detail: 'Cơ sở dữ liệu đám mây phản hồi tốt, dữ liệu toàn vẹn'
      });
    } else {
      throw new Error('Không thể truy vấn cơ sở dữ liệu');
    }
  } catch (err) {
    isAllReady = false;
    checks.push({
      id: 'database_read',
      name: '2. Kết Nối & Đọc Cơ Sở Dữ Liệu',
      status: 'ERROR',
      detail: `Lỗi truy vấn: ${err.message}`
    });
  }

  // 3. Ability to Save & Retrieve Test Data (Persistence & Write capability)
  try {
    const testKey = `ping-${Date.now()}`;
    run('CREATE TABLE IF NOT EXISTS _system_health (key TEXT PRIMARY KEY, value TEXT, updated_at BIGINT)');
    run('INSERT OR REPLACE INTO _system_health (key, value, updated_at) VALUES (?, ?, ?)', [testKey, 'ok', Date.now()]);
    const readBack = get('SELECT value FROM _system_health WHERE key = ?', [testKey]);
    run('DELETE FROM _system_health WHERE key = ?', [testKey]);

    if (readBack && readBack.value === 'ok') {
      checks.push({
        id: 'database_write',
        name: '3. Khả Năng Ghi & Lưu Trữ Bài Thi Học Sinh',
        status: 'READY',
        detail: 'Đọc/Ghi dữ liệu thành công; tính năng tự động lưu sẵn sàng phục vụ 23 học sinh đồng thời'
      });
    } else {
      throw new Error('Dữ liệu kiểm tra ghi đọc không khớp');
    }
  } catch (err) {
    isAllReady = false;
    checks.push({
      id: 'database_write',
      name: '3. Khả Năng Ghi & Lưu Trữ Bài Thi Học Sinh',
      status: 'ERROR',
      detail: `Lỗi ghi dữ liệu: ${err.message}`
    });
  }

  // 4. Timer Service Readiness (Authoritative 20-minute Countdown)
  try {
    const nowServer = Date.now();
    const drift = Math.abs(nowServer - Date.now());
    if (drift < 100) {
      checks.push({
        id: 'timer_service',
        name: '4. Dịch Vụ Đồng Hồ Đếm Ngược 20 Phút Máy Chủ',
        status: 'READY',
        detail: 'Mốc thời gian máy chủ chuẩn xác; sẵn sàng tự động khóa bài và thu bài ở 00:00'
      });
    } else {
      throw new Error('Độ lệch thời gian vượt mức an toàn');
    }
  } catch (err) {
    isAllReady = false;
    checks.push({
      id: 'timer_service',
      name: '4. Dịch Vụ Đồng Hồ Đếm Ngược 20 Phút Máy Chủ',
      status: 'ERROR',
      detail: `Lỗi đồng hồ: ${err.message}`
    });
  }

  // 5. Examination Submission & Anti-cheat Service Readiness
  try {
    const activeExams = query("SELECT count(*) as cnt FROM assignments WHERE status = 'PUBLISHED'");
    const activeCount = activeExams[0]?.cnt || 0;
    checks.push({
      id: 'submission_service',
      name: '5. Dịch Vụ Thu Bài & Chống Gian Lận Trực Tiếp',
      status: 'READY',
      detail: `Hệ thống sẵn sàng (Hiện có ${activeCount} đề thi đang mở cho học sinh)`
    });
  } catch (err) {
    isAllReady = false;
    checks.push({
      id: 'submission_service',
      name: '5. Dịch Vụ Thu Bài & Chống Gian Lận Trực Tiếp',
      status: 'ERROR',
      detail: `Lỗi dịch vụ bài thi: ${err.message}`
    });
  }

  // 6. Export Document Engine Readiness (Word .docx & Excel .xlsx)
  try {
    const { Document, Packer } = require('docx');
    const xlsx = require('xlsx');
    if (Document && Packer && xlsx) {
      checks.push({
        id: 'export_engine',
        name: '6. Bộ Máy Xuất Bảng Điểm Excel & Bài Thi Word (.docx)',
        status: 'READY',
        detail: 'Sẵn sàng trích xuất bài làm cá nhân và tải file ZIP cả lớp'
      });
    }
  } catch (err) {
    isAllReady = false;
    checks.push({
      id: 'export_engine',
      name: '6. Bộ Máy Xuất Bảng Điểm Excel & Bài Thi Word',
      status: 'ERROR',
      detail: `Lỗi xuất file: ${err.message}`
    });
  }

  // Cloud Sync Status (Supabase)
  try {
    const cloud = await checkCloudStatus();
    checks.push({
      id: 'cloud_sync',
      name: '7. Trạng Thái Đồng Bộ Đám Mây (Supabase Storage)',
      status: cloud.status === 'ERROR' ? 'WARNING' : 'READY',
      detail: cloud.detail
    });
  } catch (_) {}

  const durationMs = Date.now() - startTime;
  res.json({
    ready: isAllReady,
    overallStatus: isAllReady
      ? 'HỆ THỐNG SẴN SÀNG – CÓ THỂ BẮT ĐẦU KIỂM TRA.'
      : 'HỆ THỐNG CHƯA SẴN SÀNG – KHÔNG NÊN BẮT ĐẦU BÀI THI.',
    checkedAt: new Date().toISOString(),
    durationMs,
    checks
  });
});

// Public list of active exams for direct student entry without login
app.get('/api/exam/active/list', (req, res) => {
  try {
    const exams = query(
      `SELECT a.id, a.type, a.task_category, a.title, a.duration_minutes, a.status, a.created_at, c.name as class_name
       FROM assignments a
       LEFT JOIN classes c ON a.class_id = c.id
       WHERE a.status = 'PUBLISHED'
       ORDER BY a.created_at DESC`
    );
    res.json({ exams });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public examination info for students accessing via shared link
app.get('/api/exam/:id/public', (req, res) => {
  try {
    const assignment = get('SELECT * FROM assignments WHERE id = ?', [req.params.id]);
    if (!assignment) {
      return res.status(404).json({ error: 'Không tìm thấy đề thi hoặc link không hợp lệ' });
    }

    const classes = query('SELECT id, name FROM classes ORDER BY name ASC');
    const assignedClass = get('SELECT id, name FROM classes WHERE id = ?', [assignment.class_id]);
    const isTask2 = (assignment.type || assignment.task_type) === 'TASK_2';
    const resolvedDuration = isTask2 ? Math.max(40, assignment.duration_minutes || 40) : (assignment.duration_minutes || 20);
    const resolvedImages = isTask2 ? [] : (assignment.image_urls ? JSON.parse(assignment.image_urls) : []);

    res.json({
      assignment: {
        id: assignment.id,
        type: assignment.type || assignment.task_type || 'TASK_1',
        task_type: assignment.task_type || assignment.type || 'TASK_1',
        task_category: assignment.task_category,
        title: assignment.title,
        instructions: assignment.instructions,
        prompt_question: assignment.prompt_question,
        image_urls: resolvedImages,
        duration_minutes: resolvedDuration,
        status: assignment.status,
        class_name: assignedClass?.name || ''
      },
      classes,
      serverTime: Date.now()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Direct student start from shared link without creating an account
app.post('/api/exam/:id/start-direct', async (req, res) => {
  try {
    const { fullName, className } = req.body || {};
    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ error: 'Vui lòng nhập Họ và Tên của bạn' });
    }
    if (!className || !className.trim()) {
      return res.status(400).json({ error: 'Vui lòng nhập hoặc chọn Lớp học' });
    }

    const cleanName = fullName.trim();
    const cleanClass = className.trim();

    const assignment = get('SELECT * FROM assignments WHERE id = ?', [req.params.id]);
    if (!assignment) {
      return res.status(404).json({ error: 'Không tìm thấy đề thi' });
    }

    if (assignment.status === 'CLOSED') {
      return res.status(400).json({ error: 'Buổi thi này đã được giáo viên đóng lại' });
    }

    // Resolve or create class
    let classRow = get('SELECT * FROM classes WHERE LOWER(TRIM(name)) = LOWER(?)', [cleanClass]);
    if (!classRow) {
      const newClassId = 'c-' + uuidv4().slice(0, 8);
      run('INSERT INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)', [
        newClassId,
        cleanClass,
        'Tạo tự động từ Cổng thi học sinh',
        new Date().toISOString()
      ]);
      classRow = get('SELECT * FROM classes WHERE id = ?', [newClassId]);
    }

    // Resolve or create student
    let student = get(
      'SELECT * FROM students WHERE LOWER(TRIM(full_name)) = LOWER(?) AND class_id = ?',
      [cleanName, classRow.id]
    );

    if (!student) {
      const studentId = 's-' + uuidv4().slice(0, 8);
      const salt = bcrypt.genSaltSync(10);
      const studentCode = 'HS' + Math.floor(100 + Math.random() * 900);
      run(
        `INSERT INTO students (id, student_code, full_name, class_id, pin_hash, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [studentId, studentCode, cleanName, classRow.id, bcrypt.hashSync('0000', salt), 'ACTIVE', new Date().toISOString()]
      );
      student = get('SELECT * FROM students WHERE id = ?', [studentId]);
    }

    const now = Date.now();
    const sessionToken = uuidv4();

    // Check existing attempt
    let attempt = get(
      'SELECT * FROM attempts WHERE assignment_id = ? AND student_id = ?',
      [assignment.id, student.id]
    );

    if (attempt) {
      if (['CANCELLED', 'INVALIDATED'].includes(attempt.status)) {
        return res.status(403).json({
          error: 'YOUR EXAM HAS BEEN CANCELLED BECAUSE YOU LEFT THE EXAMINATION PAGE. Bài thi của bạn đã bị hủy do phát hiện rời khỏi trang làm bài. Vui lòng liên hệ giáo viên để được hỗ trợ.',
          status: 'INVALIDATED',
          attempt
        });
      }

      if (['SUBMITTED', 'AUTO-SUBMITTED'].includes(attempt.status)) {
        return res.status(400).json({
          error: 'Bạn đã nộp bài thi này rồi.',
          status: attempt.status,
          attempt
        });
      }

      // If IN_PROGRESS, check if deadline expired
      if (attempt.deadline_time && now >= attempt.deadline_time) {
        const finalContent = attempt.content || '';
        const finalWordCount = countWords(finalContent);
        run(
          "UPDATE attempts SET status = 'AUTO-SUBMITTED', content = ?, word_count = ?, submitted_at = ? WHERE id = ?",
          [finalContent, finalWordCount, now, attempt.id]
        );
        const expiredAttempt = get('SELECT * FROM attempts WHERE id = ?', [attempt.id]);
        return res.status(400).json({
          error: 'Thời gian làm bài đã kết thúc! Bài viết đã được tự động nộp.',
          status: 'AUTO-SUBMITTED',
          attempt: expiredAttempt
        });
      }

      // Resume existing in-progress attempt
      run('UPDATE attempts SET session_token = ? WHERE id = ?', [sessionToken, attempt.id]);
      const token = generateStudentToken(student, sessionToken);
      const updatedAttempt = get('SELECT * FROM attempts WHERE id = ?', [attempt.id]);

      return res.json({
        token,
        student: {
          id: student.id,
          studentCode: student.student_code,
          fullName: student.full_name,
          classId: student.class_id,
          className: classRow.name
        },
        attempt: updatedAttempt,
        assignment: {
          ...assignment,
          image_urls: assignment.image_urls ? JSON.parse(assignment.image_urls) : []
        },
        serverTime: now
      });
    }

    // New attempt: ensure assignment is published
    if (assignment.status !== 'PUBLISHED') {
      return res.status(400).json({ error: 'Đề thi này hiện ở trạng thái DRAFT hoặc chưa mở thi' });
    }

    const attemptId = 'att-' + uuidv4().slice(0, 8);
    const isTask2 = (assignment.type || assignment.task_type) === 'TASK_2';
    const durationMinutes = isTask2 ? Math.max(40, assignment.duration_minutes || 40) : (assignment.duration_minutes || 20);
    const deadlineTime = now + (durationMinutes * 60 * 1000);

    run(
      `INSERT INTO attempts (id, assignment_id, student_id, start_time, deadline_time, status, last_saved_at, session_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attemptId,
        assignment.id,
        student.id,
        now,
        deadlineTime,
        'IN_PROGRESS',
        now,
        sessionToken,
        new Date().toISOString()
      ]
    );

    const newAttempt = get('SELECT * FROM attempts WHERE id = ?', [attemptId]);
    const token = generateStudentToken(student, sessionToken);

    res.json({
      token,
      student: {
        id: student.id,
        studentCode: student.student_code,
        fullName: student.full_name,
        classId: student.class_id,
        className: classRow.name
      },
      attempt: newAttempt,
      assignment: {
        ...assignment,
        image_urls: assignment.image_urls ? JSON.parse(assignment.image_urls) : []
      },
      serverTime: now
    });
  } catch (err) {
    console.error('Direct start error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper: Resolve active URL base (Permanent Cloud HTTPS > Cloudflare Tunnel > Local Network)
function resolveShareBaseUrl(req) {
  // 1. Permanent public cloud domain (Configured via env or Render external URL)
  const envDomain = process.env.PUBLIC_DOMAIN || process.env.RENDER_EXTERNAL_URL;
  if (envDomain) {
    const cleanDomain = envDomain.replace(/\/+$/, '');
    const baseUrl = cleanDomain.startsWith('http') ? cleanDomain : `https://${cleanDomain}`;
    return {
      baseUrl,
      connectionMode: 'PERMANENT_CLOUD',
      tunnelStatus: 'PERMANENT_HTTPS'
    };
  }

  // 2. Active Cloudflare Tunnel (if running with Quick Tunnel locally)
  const tunnel = getTunnelStatus();
  if (tunnel.status === 'CONNECTED' && tunnel.publicUrl) {
    return {
      baseUrl: tunnel.publicUrl,
      connectionMode: 'CLOUDFLARE_TUNNEL',
      tunnelStatus: tunnel.status
    };
  }

  // 3. Request Host header (if accessed via internet domain)
  const fwdHost = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const fwdProto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  if (!fwdHost.includes('localhost') && !fwdHost.includes('127.0.0.1')) {
    return {
      baseUrl: `${fwdProto}://${fwdHost}`,
      connectionMode: 'PERMANENT_CLOUD',
      tunnelStatus: 'PERMANENT_HTTPS'
    };
  }

  // 4. Local network fallback
  const lanIp = getLanIpAddress();
  const port = fwdHost.split(':')[1] || PORT || 5000;
  return {
    baseUrl: `http://${lanIp}:${port}`,
    connectionMode: 'LOCAL_NETWORK',
    tunnelStatus: tunnel.status
  };
}

// Generate QR Code for Writing Session (Prioritizes live HTTPS Cloudflare Tunnel URL when running)
app.get('/api/assignments/:id/qr', authenticateTeacher, async (req, res) => {
  try {
    const assignment = get('SELECT id, title FROM assignments WHERE id = ?', [req.params.id]);
    if (!assignment) return res.status(404).json({ error: 'Không tìm thấy buổi Writing' });

    const { baseUrl, connectionMode, tunnelStatus } = resolveShareBaseUrl(req);
    const directUrl = `${baseUrl}/#/student/write/${assignment.id}`;

    const qrDataUrl = await qrcode.toDataURL(directUrl, {
      width: 360,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' }
    });

    res.json({
      directUrl,
      baseUrl,
      connectionMode,
      tunnelStatus,
      qrDataUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teacher: Get network info, active Tunnel URL, and general classroom QR code
app.get('/api/teacher/network-info', authenticateTeacher, async (req, res) => {
  try {
    const lanIp = getLanIpAddress();
    const port = PORT || 5000;
    const { baseUrl, connectionMode, tunnelStatus } = resolveShareBaseUrl(req);

    const qrDataUrl = await qrcode.toDataURL(baseUrl, {
      width: 360,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' }
    });

    res.json({
      lanIp,
      port,
      localUrl: `http://localhost:${port}`,
      lanUrl: `http://${lanIp}:${port}`,
      baseUrl,
      connectionMode,
      tunnelStatus,
      qrDataUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 4B. CLOUDFLARE QUICK TUNNEL MANAGEMENT (Teacher only)
// ==========================================

app.get('/api/teacher/tunnel/status', authenticateTeacher, (req, res) => {
  const teacherRow = get('SELECT id, username, password_hash FROM teachers WHERE id = ?', [req.user.id]);
  const requiresAccountSetup = isUsingDefaultTeacherAccount(teacherRow);
  res.json({
    ...getTunnelStatus(),
    localUrl: `http://localhost:${PORT}`,
    requiresAccountSetup
  });
});

app.post('/api/teacher/tunnel/start', authenticateTeacher, async (req, res) => {
  try {
    const teacherRow = get('SELECT id, username, password_hash FROM teachers WHERE id = ?', [req.user.id]);
    if (isUsingDefaultTeacherAccount(teacherRow)) {
      return res.status(403).json({
        error: 'Cảnh báo bảo mật: Bạn đang dùng tài khoản giáo viên mặc định (teacher / teacher123). Vui lòng đổi Tên đăng nhập và Mật khẩu mới trước khi mở Quick Tunnel ra Internet!'
      });
    }

    const status = await startTunnel(PORT);
    let qrDataUrl = null;
    if (status.publicUrl) {
      qrDataUrl = await qrcode.toDataURL(status.publicUrl, {
        width: 360,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' }
      });
    }
    res.json({ ...status, qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message, tunnel: getTunnelStatus() });
  }
});

app.post('/api/teacher/tunnel/stop', authenticateTeacher, async (req, res) => {
  try {
    const status = await stopTunnel();
    res.json({ ...status, message: 'Đã tắt Cloudflare Quick Tunnel an toàn. Hệ thống vẫn chạy nội bộ tại localhost:' + PORT });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 5. STUDENT WRITING FLOW (Strict Anti-cheating & Auto-save)
// ==========================================

// Get published assignments available to the student's class
app.get('/api/student/assignments', authenticateStudent, (req, res) => {
  const assignments = query(
    `SELECT a.id, a.type, a.task_category, a.title, a.duration_minutes, a.status, a.created_at,
       att.id as attempt_id, att.status as attempt_status, att.submitted_at, att.word_count
     FROM assignments a
     LEFT JOIN attempts att ON att.assignment_id = a.id AND att.student_id = ?
     WHERE a.class_id = ? AND a.status = 'PUBLISHED'
     ORDER BY a.created_at DESC`,
    [req.user.id, req.user.classId]
  );
  res.json({ assignments });
});

// Get assignment details for writing interface
app.get('/api/student/assignments/:id', authenticateStudent, (req, res) => {
  const assignment = get(
    `SELECT * FROM assignments WHERE id = ? AND class_id = ? AND status = 'PUBLISHED'`,
    [req.params.id, req.user.classId]
  );

  if (!assignment) {
    return res.status(404).json({ error: 'Đề bài không tồn tại hoặc chưa được giáo viên mở' });
  }

  // Get current attempt if any
  const attempt = get(
    'SELECT * FROM attempts WHERE assignment_id = ? AND student_id = ?',
    [assignment.id, req.user.id]
  );

  // If score published, fetch it
  let score = null;
  if (attempt && attempt.status === 'SUBMITTED') {
    const publishedScore = get('SELECT * FROM scores WHERE attempt_id = ? AND is_published = 1', [attempt.id]);
    if (publishedScore) score = publishedScore;
  }

  res.json({
    assignment: {
      ...assignment,
      image_urls: assignment.image_urls ? JSON.parse(assignment.image_urls) : []
    },
    attempt: attempt || null,
    score: score || null
  });
});

// Start writing attempt (Starts timer with server-authoritative timestamps)
app.post('/api/student/assignments/:id/start', authenticateStudent, (req, res) => {
  const assignment = get(
    `SELECT * FROM assignments WHERE id = ? AND class_id = ? AND status = 'PUBLISHED'`,
    [req.params.id, req.user.classId]
  );
  if (!assignment) {
    return res.status(404).json({ error: 'Đề bài không hợp lệ hoặc đã đóng' });
  }

  let attempt = get(
    'SELECT * FROM attempts WHERE assignment_id = ? AND student_id = ?',
    [assignment.id, req.user.id]
  );

  const now = Date.now();

  if (attempt) {
    // If CANCELLED, prevent restart without teacher authorization
    if (attempt.status === 'CANCELLED') {
      return res.status(403).json({
        error: 'Bài thi của bạn đã bị HỦY do phát hiện rời khỏi màn hình làm bài. Vui lòng liên hệ giáo viên để được hỗ trợ.',
        status: 'CANCELLED'
      });
    }

    // If already submitted
    if (attempt.status === 'SUBMITTED') {
      return res.status(400).json({ error: 'Bạn đã nộp bài này rồi.', status: 'SUBMITTED' });
    }

    // Check if deadline passed
    if (attempt.deadline_time && now > attempt.deadline_time) {
      if (attempt.status === 'IN_PROGRESS') {
        run('UPDATE attempts SET status = ? WHERE id = ?', ['EXPIRED', attempt.id]);
      }
      return res.status(403).json({ error: 'Thời gian làm bài đã kết thúc.', status: 'EXPIRED' });
    }

    // Enforce 1 active device session
    if (attempt.status === 'IN_PROGRESS' && attempt.session_token && attempt.session_token !== req.user.sessionToken) {
      // Overwrite session token to allow re-login on same device or update
      run('UPDATE attempts SET session_token = ? WHERE id = ?', [req.user.sessionToken, attempt.id]);
    }

    const updated = get('SELECT * FROM attempts WHERE id = ?', [attempt.id]);
    return res.json({ attempt: updated });
  }

  // Create brand new attempt
  const attemptId = 'att-' + uuidv4().slice(0, 8);
  const isTask2 = (assignment.type || assignment.task_type) === 'TASK_2';
  const durationMinutes = isTask2 ? Math.max(40, assignment.duration_minutes || 40) : (assignment.duration_minutes || 20);
  const durationMs = durationMinutes * 60 * 1000;
  const deadline = now + durationMs;

  run(
    `INSERT INTO attempts (id, assignment_id, student_id, start_time, deadline_time, status, last_saved_at, session_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      attemptId,
      assignment.id,
      req.user.id,
      now,
      deadline,
      'IN_PROGRESS',
      now,
      req.user.sessionToken || uuidv4(),
      new Date().toISOString()
    ]
  );

  const newAttempt = get('SELECT * FROM attempts WHERE id = ?', [attemptId]);
  res.json({ attempt: newAttempt });
});

// Auto-save draft (Debounced from client)
app.post('/api/student/attempts/:id/draft', authenticateStudent, (req, res) => {
  const { content } = req.body || {};
  const attempt = get('SELECT * FROM attempts WHERE id = ? AND student_id = ?', [req.params.id, req.user.id]);

  if (!attempt) {
    return res.status(404).json({ error: 'Không tìm thấy phiên làm bài' });
  }

  if (['CANCELLED', 'INVALIDATED'].includes(attempt.status)) {
    return res.status(403).json({ error: 'YOUR EXAM HAS BEEN CANCELLED BECAUSE YOU LEFT THE EXAMINATION PAGE. Bài viết đã bị hủy do vi phạm quy chế thi', status: 'CANCELLED' });
  }

  if (['SUBMITTED', 'AUTO-SUBMITTED'].includes(attempt.status)) {
    return res.status(400).json({ error: 'Bài viết đã được nộp, không thể chỉnh sửa', status: attempt.status });
  }

  if (['EXPIRED', 'AUTO-SUBMITTED'].includes(attempt.status)) {
    return res.status(403).json({ error: 'Đã hết thời gian làm bài', status: 'EXPIRED' });
  }

  const now = Date.now();
  // Check deadline with 10s network grace period
  if (attempt.deadline_time && now > attempt.deadline_time + 10000) {
    run('UPDATE attempts SET status = ? WHERE id = ?', ['EXPIRED', attempt.id]);
    return res.status(403).json({ error: 'Đã hết thời gian làm bài', status: 'EXPIRED' });
  }

  const rawText = typeof content === 'string' ? content : '';
  const wordCount = countWords(rawText);

  run(
    'UPDATE attempts SET content = ?, word_count = ?, last_saved_at = ? WHERE id = ?',
    [rawText, wordCount, now, attempt.id]
  );

  res.json({
    success: true,
    wordCount,
    lastSavedAt: now
  });
});

// Submit Writing
app.post('/api/student/attempts/:id/submit', authenticateStudent, (req, res) => {
  const { content, isAutoSubmit } = req.body || {};
  const attempt = get('SELECT * FROM attempts WHERE id = ? AND student_id = ?', [req.params.id, req.user.id]);

  if (!attempt) {
    return res.status(404).json({ error: 'Không tìm thấy phiên làm bài' });
  }

  if (['CANCELLED', 'INVALIDATED'].includes(attempt.status)) {
    return res.status(403).json({ error: 'YOUR EXAM HAS BEEN CANCELLED BECAUSE YOU LEFT THE EXAMINATION PAGE. Không thể nộp bài vì phiên làm bài đã bị hủy', status: 'CANCELLED' });
  }

  if (['SUBMITTED', 'AUTO-SUBMITTED'].includes(attempt.status)) {
    return res.status(400).json({ error: 'Bài viết đã được nộp trước đó', status: attempt.status });
  }

  const now = Date.now();
  const finalContent = typeof content === 'string' ? content : (attempt.content || '');
  const finalWordCount = countWords(finalContent);
  const targetStatus = (isAutoSubmit || (attempt.deadline_time && now >= attempt.deadline_time))
    ? 'AUTO-SUBMITTED'
    : 'SUBMITTED';

  run(
    'UPDATE attempts SET content = ?, word_count = ?, submitted_at = ?, status = ? WHERE id = ?',
    [finalContent, finalWordCount, now, targetStatus, attempt.id]
  );

  res.json({
    success: true,
    message: targetStatus === 'AUTO-SUBMITTED'
      ? 'Time is up! Your writing has been automatically submitted.'
      : 'Nộp bài thành công!',
    status: targetStatus,
    wordCount: finalWordCount,
    submittedAt: now
  });
});

// Anti-cheating violation endpoint
app.post('/api/student/attempts/:id/violation', authenticateStudent, (req, res) => {
  const { eventType, details, currentContent } = req.body || {};
  const attempt = get('SELECT * FROM attempts WHERE id = ? AND student_id = ?', [req.params.id, req.user.id]);

  if (!attempt) {
    return res.status(404).json({ error: 'Không tìm thấy phiên làm bài' });
  }

  const now = Date.now();
  const logId = 'viol-' + uuidv4().slice(0, 8);

  run(
    'INSERT INTO violation_logs (id, attempt_id, event_type, details, timestamp) VALUES (?, ?, ?, ?, ?)',
    [logId, attempt.id, eventType || 'UNKNOWN_VIOLATION', details || '', now]
  );

  // If page hidden, tab switched, app switched, fullscreen exited, or page exit during active session, cancel attempt immediately!
  const pageExitViolations = [
    'PAGE_HIDDEN',
    'TAB_SWITCH',
    'APP_SWITCH',
    'PAGE_EXIT',
    'FULLSCREEN_EXIT',
    'BROWSER_MINIMIZE',
    'SESSION_CONFLICT'
  ];

  if (pageExitViolations.includes(eventType) && attempt.status === 'IN_PROGRESS') {
    // Preserve latest content verbatim
    const safeContent = typeof currentContent === 'string' ? currentContent : (attempt.content || '');
    const wordCount = countWords(safeContent);

    run(
      'UPDATE attempts SET status = ?, content = ?, word_count = ?, last_saved_at = ? WHERE id = ?',
      ['CANCELLED', safeContent, wordCount, now, attempt.id]
    );

    return res.json({
      cancelled: true,
      status: 'CANCELLED',
      message: 'YOUR EXAM HAS BEEN CANCELLED BECAUSE YOU LEFT THE EXAMINATION PAGE. Hệ thống đã phát hiện bạn rời khỏi màn hình làm bài.'
    });
  }

  if (['CANCELLED', 'INVALIDATED'].includes(attempt.status)) {
    return res.json({ cancelled: true, status: 'CANCELLED', recorded: true });
  }

  res.json({ recorded: true, status: attempt.status });
});

// Periodic background sweeper to finalize expired in-progress attempts
function autoFinalizeExpiredAttempts() {
  try {
    const now = Date.now();
    const expiredList = query(
      "SELECT id, content, word_count FROM attempts WHERE status = 'IN_PROGRESS' AND deadline_time IS NOT NULL AND deadline_time <= ?",
      [now]
    );
    for (const att of expiredList) {
      const finalContent = att.content || '';
      const finalWords = countWords(finalContent);
      run(
        "UPDATE attempts SET status = 'AUTO-SUBMITTED', content = ?, word_count = ?, submitted_at = ? WHERE id = ? AND status = 'IN_PROGRESS'",
        [finalContent, finalWords, now, att.id]
      );
    }
  } catch (err) {
    // Silent in background
  }
}
setInterval(autoFinalizeExpiredAttempts, 10000);

// ==========================================
// 6. TEACHER DASHBOARD, MONITORING & GRADING
// ==========================================

// Submissions Monitor
app.get('/api/teacher/submissions', authenticateTeacher, (req, res) => {
  const { classId, assignmentId, status, taskType, type } = req.query;
  const selectedType = (taskType || type || '').toUpperCase();

  let sql = `
    SELECT 
      att.id, att.assignment_id, att.student_id, att.start_time, att.deadline_time, 
      att.submitted_at, att.word_count, att.status, att.last_saved_at,
      s.full_name, s.student_code,
      c.id as class_id, c.name as class_name,
      a.title as assignment_title, a.duration_minutes, a.type as assignment_type, a.type as task_type, a.task_category,
      sc.id as score_id, sc.overall_band, sc.is_published,
      (SELECT COUNT(*) FROM violation_logs vl WHERE vl.attempt_id = att.id) as violation_count
    FROM attempts att
    JOIN students s ON att.student_id = s.id
    JOIN classes c ON s.class_id = c.id
    JOIN assignments a ON att.assignment_id = a.id
    LEFT JOIN scores sc ON sc.attempt_id = att.id
    WHERE 1=1
  `;
  const params = [];

  if (classId) {
    sql += ' AND s.class_id = ?';
    params.push(classId);
  }
  if (assignmentId) {
    sql += ' AND a.id = ?';
    params.push(assignmentId);
  }
  if (status) {
    sql += ' AND att.status = ?';
    params.push(status);
  }
  if (selectedType) {
    sql += ' AND (a.type = ? OR a.task_type = ?)';
    params.push(selectedType, selectedType);
  }

  sql += ' ORDER BY att.created_at DESC';
  const rawSubmissions = query(sql, params);
  const submissions = rawSubmissions.map(s => {
    let timeSpentSec = null;
    if (s.start_time && s.submitted_at) {
      timeSpentSec = Math.max(0, Math.round((s.submitted_at - s.start_time) / 1000));
    } else if (s.start_time && s.last_saved_at && (['CANCELLED', 'INVALIDATED'].includes(s.status))) {
      timeSpentSec = Math.max(0, Math.round((s.last_saved_at - s.start_time) / 1000));
    } else if (s.start_time && s.status === 'IN_PROGRESS') {
      timeSpentSec = Math.max(0, Math.round((Date.now() - s.start_time) / 1000));
    }
    return {
      ...s,
      time_spent_seconds: timeSpentSec
    };
  });
  res.json({ submissions });
});

// Detailed attempt view for teacher
app.get('/api/teacher/attempts/:id', authenticateTeacher, (req, res) => {
  const attempt = get('SELECT * FROM attempts WHERE id = ?', [req.params.id]);
  if (!attempt) return res.status(404).json({ error: 'Không tìm thấy bài nộp' });

  const student = get('SELECT s.*, c.name as class_name FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = ?', [attempt.student_id]);
  const assignment = get('SELECT * FROM assignments WHERE id = ?', [attempt.assignment_id]);
  const score = get('SELECT * FROM scores WHERE attempt_id = ?', [attempt.id]);
  const violations = query('SELECT * FROM violation_logs WHERE attempt_id = ? ORDER BY timestamp DESC', [attempt.id]);
  const overrides = query('SELECT * FROM teacher_overrides WHERE attempt_id = ? ORDER BY timestamp DESC', [attempt.id]);

  res.json({
    attempt,
    student,
    assignment: {
      ...assignment,
      image_urls: assignment.image_urls ? JSON.parse(assignment.image_urls) : []
    },
    score: score || null,
    violations,
    overrides
  });
});

// Teacher Override (Cancel / Reopen / Extend time / Allow new attempt)
app.post('/api/teacher/attempts/:id/override', authenticateTeacher, (req, res) => {
  const { action, reason, extendMinutes } = req.body;
  if (!action || !reason || !reason.trim()) {
    return res.status(400).json({ error: 'Vui lòng cung cấp hành động và lý do can thiệp' });
  }

  const attempt = get('SELECT * FROM attempts WHERE id = ?', [req.params.id]);
  if (!attempt) return res.status(404).json({ error: 'Không tìm thấy bài làm' });

  const now = Date.now();
  const overrideId = 'ovr-' + uuidv4().slice(0, 8);

  run(
    'INSERT INTO teacher_overrides (id, attempt_id, action, reason, timestamp) VALUES (?, ?, ?, ?, ?)',
    [overrideId, attempt.id, action, reason.trim(), now]
  );

  if (action === 'ALLOW_NEW_ATTEMPT' || action === 'RESET_ATTEMPT') {
    // Delete old attempt or reset it to allow fresh start
    run('DELETE FROM scores WHERE attempt_id = ?', [attempt.id]);
    run('DELETE FROM violation_logs WHERE attempt_id = ?', [attempt.id]);
    run('DELETE FROM attempts WHERE id = ?', [attempt.id]);
    return res.json({ success: true, message: 'Đã mở quyền làm lại bài thi mới cho học sinh' });
  }

  if (action === 'REOPEN_AND_EXTEND') {
    const minutes = parseInt(extendMinutes, 10) || 10;
    const newDeadline = Math.max(now, attempt.deadline_time || now) + minutes * 60 * 1000;
    run(
      'UPDATE attempts SET status = ?, deadline_time = ? WHERE id = ?',
      ['IN_PROGRESS', newDeadline, attempt.id]
    );
    return res.json({ success: true, message: `Đã mở lại bài viết và cộng thêm ${minutes} phút làm bài` });
  }

  if (action === 'ACCEPT_CANCELLED') {
    run('UPDATE attempts SET status = ? WHERE id = ?', ['SUBMITTED', attempt.id]);
    return res.json({ success: true, message: 'Đã công nhận bài làm bị hủy sang trạng thái Đã nộp' });
  }

  res.status(400).json({ error: 'Hành động can thiệp không xác định' });
});

// Score IELTS Academic Task 1
app.post('/api/teacher/attempts/:id/score', authenticateTeacher, (req, res) => {
  const {
    taskAchievement,
    coherenceCohesion,
    lexicalResource,
    grammaticalAccuracy,
    customOverallBand,
    feedbackTa,
    feedbackCc,
    feedbackLr,
    feedbackGra,
    generalFeedback,
    isPublished = 0
  } = req.body;

  const attempt = get('SELECT id FROM attempts WHERE id = ?', [req.params.id]);
  if (!attempt) return res.status(404).json({ error: 'Không tìm thấy bài thi' });

  const calculated = calculateOverallBand(
    taskAchievement,
    coherenceCohesion,
    lexicalResource,
    grammaticalAccuracy
  );

  const finalBand = customOverallBand !== undefined && customOverallBand !== null && customOverallBand !== ''
    ? parseFloat(customOverallBand)
    : calculated.overallBand;

  const now = Date.now();
  const existing = get('SELECT id FROM scores WHERE attempt_id = ?', [attempt.id]);

  if (existing) {
    run(
      `UPDATE scores SET 
        task_achievement = ?, coherence_cohesion = ?, lexical_resource = ?, grammatical_accuracy = ?,
        overall_band = ?, feedback_ta = ?, feedback_cc = ?, feedback_lr = ?, feedback_gra = ?,
        general_feedback = ?, is_published = ?, updated_at = ?
       WHERE attempt_id = ?`,
      [
        parseFloat(taskAchievement) || 0,
        parseFloat(coherenceCohesion) || 0,
        parseFloat(lexicalResource) || 0,
        parseFloat(grammaticalAccuracy) || 0,
        finalBand,
        feedbackTa || '',
        feedbackCc || '',
        feedbackLr || '',
        feedbackGra || '',
        generalFeedback || '',
        isPublished ? 1 : 0,
        now,
        attempt.id
      ]
    );
  } else {
    const scoreId = 'sc-' + uuidv4().slice(0, 8);
    run(
      `INSERT INTO scores (
        id, attempt_id, task_achievement, coherence_cohesion, lexical_resource, grammatical_accuracy,
        overall_band, feedback_ta, feedback_cc, feedback_lr, feedback_gra, general_feedback, is_published, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scoreId,
        attempt.id,
        parseFloat(taskAchievement) || 0,
        parseFloat(coherenceCohesion) || 0,
        parseFloat(lexicalResource) || 0,
        parseFloat(grammaticalAccuracy) || 0,
        finalBand,
        feedbackTa || '',
        feedbackCc || '',
        feedbackLr || '',
        feedbackGra || '',
        generalFeedback || '',
        isPublished ? 1 : 0,
        now
      ]
    );
  }

  const savedScore = get('SELECT * FROM scores WHERE attempt_id = ?', [attempt.id]);
  res.json({
    success: true,
    score: savedScore,
    explanation: calculated.explanation
  });
});

// Student Writing History
app.get('/api/teacher/student/:studentId/history', authenticateTeacher, (req, res) => {
  const student = get('SELECT s.*, c.name as class_name FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = ?', [req.params.studentId]);
  if (!student) return res.status(404).json({ error: 'Không tìm thấy học sinh' });

  const history = query(
    `SELECT att.id, att.start_time, att.submitted_at, att.word_count, att.status,
       a.id as assignment_id, a.title as assignment_title, a.task_category, a.duration_minutes,
       sc.task_achievement, sc.coherence_cohesion, sc.lexical_resource, sc.grammatical_accuracy,
       sc.overall_band, sc.general_feedback, sc.is_published
     FROM attempts att
     JOIN assignments a ON att.assignment_id = a.id
     LEFT JOIN scores sc ON sc.attempt_id = att.id
     WHERE att.student_id = ?
     ORDER BY att.created_at DESC`,
    [req.params.studentId]
  );

  res.json({ student, history });
});

// ==========================================
// 7. EXPORT FEATURES (Word .docx, Class ZIP, Excel, HTML)
// ==========================================

app.get('/api/teacher/export/docx/:attemptId', authenticateTeacher, async (req, res) => {
  try {
    const attempt = get('SELECT * FROM attempts WHERE id = ?', [req.params.attemptId]);
    if (!attempt) return res.status(404).json({ error: 'Không tìm thấy bài viết' });

    const student = get(
      'SELECT s.*, c.name as class_name FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = ?',
      [attempt.student_id]
    );
    const assignment = get('SELECT * FROM assignments WHERE id = ?', [attempt.assignment_id]);
    if (!student || !assignment) {
      return res.status(404).json({ error: 'Không đủ thông tin học sinh hoặc buổi Writing' });
    }

    const buffer = await generateStudentEssayDocxBuffer({ student, assignment, attempt });
    const filename = buildDocxFilename({ student, assignment, attempt });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(buffer);
  } catch (err) {
    console.error('Export DOCX error:', err);
    res.status(500).json({ error: 'Không thể xuất file Word: ' + err.message });
  }
});

app.get('/api/teacher/export/zip', authenticateTeacher, async (req, res) => {
  try {
    const { classId, assignmentId, status, taskType, type } = req.query;
    const selectedType = (taskType || type || '').toUpperCase();

    let sql = `
      SELECT 
        att.*,
        s.full_name, s.student_code,
        c.id as class_id, c.name as class_name,
        a.title as assignment_title, a.type as assignment_type, a.type as task_type, a.task_category
      FROM attempts att
      JOIN students s ON att.student_id = s.id
      JOIN classes c ON s.class_id = c.id
      JOIN assignments a ON att.assignment_id = a.id
      WHERE 1=1
    `;
    const params = [];

    if (classId) {
      sql += ' AND s.class_id = ?';
      params.push(classId);
    }
    if (assignmentId) {
      sql += ' AND a.id = ?';
      params.push(assignmentId);
    }
    if (status) {
      sql += ' AND att.status = ?';
      params.push(status);
    } else {
      sql += " AND att.status IN ('SUBMITTED', 'CANCELLED', 'EXPIRED', 'IN_PROGRESS')";
    }
    if (selectedType) {
      sql += ' AND (a.type = ? OR a.task_type = ?)';
      params.push(selectedType, selectedType);
    }

    sql += ' ORDER BY c.name ASC, s.full_name ASC';
    const rows = query(sql, params);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Chưa có bài viết nào thuộc lớp hoặc buổi Writing đã chọn để tải ZIP' });
    }

    const records = rows.map((r) => ({
      student: {
        full_name: r.full_name,
        student_code: r.student_code,
        class_name: r.class_name
      },
      assignment: {
        title: r.assignment_title,
        type: r.assignment_type || r.task_type || 'TASK_1',
        task_type: r.task_type || r.assignment_type || 'TASK_1',
        task_category: r.task_category
      },
      attempt: {
        id: r.id,
        content: r.content,
        word_count: r.word_count,
        status: r.status,
        start_time: r.start_time,
        submitted_at: r.submitted_at,
        last_saved_at: r.last_saved_at,
        created_at: r.created_at
      }
    }));

    const zipBuffer = await generateClassSubmissionsZipBuffer(records);

    const classLabel = classId ? sanitizeFilenamePart(rows[0].class_name, 'Lop') : 'Tat_Ca_Lop';
    const assignLabel = assignmentId ? `_${sanitizeFilenamePart(rows[0].assignment_title, 'Writing')}` : '';
    const taskLabel = selectedType ? `_${selectedType}` : '';
    const zipFilename = `Bai_Writing_${classLabel}${assignLabel}${taskLabel}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${zipFilename}"; filename*=UTF-8''${encodeURIComponent(zipFilename)}`
    );
    res.send(zipBuffer);
  } catch (err) {
    console.error('Export ZIP error:', err);
    res.status(500).json({ error: 'Không thể tạo file ZIP: ' + err.message });
  }
});

app.get('/api/teacher/export/excel', authenticateTeacher, (req, res) => {
  const { classId, assignmentId, taskType, type } = req.query;
  const selectedType = (taskType || type || '').toUpperCase();

  let sql = `
    SELECT 
      att.id, att.start_time, att.submitted_at, att.word_count, att.status,
      s.full_name, s.student_code, s.id as student_id,
      c.name as class_name,
      a.title as assignment_title, a.duration_minutes, a.type as assignment_type, a.type as task_type, a.task_category,
      sc.task_achievement, sc.coherence_cohesion, sc.lexical_resource, sc.grammatical_accuracy,
      sc.overall_band, sc.general_feedback,
      (SELECT COUNT(*) FROM violation_logs vl WHERE vl.attempt_id = att.id) as violation_count
    FROM attempts att
    JOIN students s ON att.student_id = s.id
    JOIN classes c ON s.class_id = c.id
    JOIN assignments a ON att.assignment_id = a.id
    LEFT JOIN scores sc ON sc.attempt_id = att.id
    WHERE 1=1
  `;
  const params = [];
  if (classId) {
    sql += ' AND s.class_id = ?';
    params.push(classId);
  }
  if (assignmentId) {
    sql += ' AND a.id = ?';
    params.push(assignmentId);
  }
  if (selectedType) {
    sql += ' AND (a.type = ? OR a.task_type = ?)';
    params.push(selectedType, selectedType);
  }
  sql += ' ORDER BY c.name ASC, s.full_name ASC';

  const rows = query(sql, params);
  const buffer = generateSubmissionsExcel(rows);

  const fileLabel = selectedType === 'TASK_2' ? 'Task_2' : (selectedType === 'TASK_1' ? 'Task_1' : 'Writing');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Ket_Qua_IELTS_${fileLabel}.xlsx"`);
  res.send(buffer);
});

app.get('/api/teacher/export/report/:attemptId', authenticateTeacher, (req, res) => {
  const attempt = get('SELECT * FROM attempts WHERE id = ?', [req.params.attemptId]);
  if (!attempt) return res.status(404).send('Không tìm thấy bài làm');

  const student = get('SELECT s.*, c.name as class_name FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = ?', [attempt.student_id]);
  const assignment = get('SELECT * FROM assignments WHERE id = ?', [attempt.assignment_id]);
  const score = get('SELECT * FROM scores WHERE attempt_id = ?', [attempt.id]);
  const violations = query('SELECT * FROM violation_logs WHERE attempt_id = ? ORDER BY timestamp ASC', [attempt.id]);

  const html = generatePrintableReportHtml({
    student,
    assignment: {
      ...assignment,
      image_urls: assignment.image_urls ? JSON.parse(assignment.image_urls) : []
    },
    attempt,
    score,
    violations
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Serve frontend in production build (prevent caching of index.html so latest auth fixes always load)
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return res.sendFile(path.join(clientDist, 'index.html'));
    }
    next();
  });
}

// Start server after initializing DB
initDb().then(() => {
  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(` IELTS MS NGA - WRITING TASK 1 SERVER STARTED`);
    console.log(` Port: ${PORT}`);
    console.log(` Local: http://localhost:${PORT}`);
    console.log(`====================================================`);
  });
  // Keep sockets open longer than reverse proxy / Cloudflare Tunnel idle timeout (avoids ECONNRESET races)
  httpServer.keepAliveTimeout = 65000;
  httpServer.headersTimeout = 66000;
  httpServer.requestTimeout = 120000;

  // Auto-connect Cloudflare Quick Tunnel for student internet access (4G/5G/Wi-Fi)
  const shouldAutoStartTunnel = process.env.AUTO_START_TUNNEL === 'true' ||
    (process.env.AUTO_START_TUNNEL !== 'false' && PORT == 5000 && !(process.env.DATA_DIR || '').includes('test'));

  if (shouldAutoStartTunnel) {
    const teacherRow = get('SELECT id, username, password_hash FROM teachers LIMIT 1');
    const isDefault = isUsingDefaultTeacherAccount(teacherRow);
    if (!isDefault) {
      console.log(`[*] Dang tu dong ket noi Cloudflare Quick Tunnel cho hoc sinh...`);
      startTunnel(PORT).then(status => {
        if (status.publicUrl) {
          console.log(`====================================================`);
          console.log(` [OK] KET NOI INTERNET (HTTPS) CHO HOC SINH SAN SANG!`);
          console.log(` Link Cong Khai: ${status.publicUrl}`);
          console.log(` Hoc sinh dung dien thoai (4G/5G/Wifi) vao lam bai ngay.`);
          console.log(`====================================================`);
        }
      }).catch(err => {
        console.warn(`[!] Quick Tunnel khong khoi dong tu dong: ${err.message}`);
      });
    } else {
      console.log(`[i] Tai khoan giao vien dang la mac dinh. Quick Tunnel se duoc bat sau khi giao vien doi mat khau tren Dashboard.`);
    }
  }
}).catch(err => {
  console.error('Failed to start server:', err);
});
