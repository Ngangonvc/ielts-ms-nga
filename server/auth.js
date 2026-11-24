const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { get } = require('./db');

function loadOrCreateJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 16) {
    return process.env.JWT_SECRET.trim();
  }
  const envPath = path.join(__dirname, '..', '.env');
  const generatedSecret = crypto.randomBytes(48).toString('hex');
  try {
    let existing = '';
    if (fs.existsSync(envPath)) {
      existing = fs.readFileSync(envPath, 'utf8');
    }
    if (!/^JWT_SECRET=/m.test(existing)) {
      const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
      fs.writeFileSync(envPath, `${existing}${prefix}JWT_SECRET=${generatedSecret}\n`, 'utf8');
    }
    process.env.JWT_SECRET = generatedSecret;
    return generatedSecret;
  } catch (err) {
    console.warn('Could not persist .env JWT_SECRET, using runtime secret:', err.message);
    return generatedSecret;
  }
}

const JWT_SECRET = loadOrCreateJwtSecret();

function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp) return cfIp.toString().trim();
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.toString().split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function isPublicTunnelRequest(req) {
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  return Boolean(
    req.headers['cf-connecting-ip'] ||
    req.headers['cf-ray'] ||
    host.includes('trycloudflare.com')
  );
}

function isUsingDefaultTeacherAccount(teacher) {
  if (!teacher) return false;
  const isDefaultUsername = (teacher.username || '').trim().toLowerCase() === 'teacher';
  const isDefaultPassword = teacher.password_hash
    ? bcrypt.compareSync('teacher123', teacher.password_hash)
    : false;
  return isDefaultUsername || isDefaultPassword;
}

function isWeakDefaultPassword(password) {
  const normalized = (password || '').trim().toLowerCase();
  return ['teacher123', 'teacher', '123456', '12345678', 'password', 'admin', 'admin123'].includes(normalized);
}

// In-memory rate limiter for login attempts (IP / identifier based)
const loginAttempts = new Map();

function checkRateLimit(key, maxAttempts = 5, windowMs = 60000) {
  const now = Date.now();
  const record = loginAttempts.get(key) || { count: 0, resetTime: now + windowMs };
  if (now > record.resetTime) {
    record.count = 0;
    record.resetTime = now + windowMs;
  }
  record.count += 1;
  loginAttempts.set(key, record);
  return record.count <= maxAttempts;
}

function clearRateLimit(key) {
  loginAttempts.delete(key);
}

function generateTeacherToken(teacher) {
  return jwt.sign(
    {
      id: teacher.id,
      username: teacher.username,
      fullName: teacher.full_name,
      role: 'TEACHER'
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function generateStudentToken(student, sessionToken = null) {
  return jwt.sign(
    {
      id: student.id,
      studentCode: student.student_code,
      fullName: student.full_name,
      classId: student.class_id,
      sessionToken: sessionToken,
      role: 'STUDENT'
    },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function authenticateTeacher(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Vui lòng đăng nhập tài khoản giáo viên' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'TEACHER') {
      return res.status(403).json({ error: 'Không có quyền truy cập dành cho giáo viên' });
    }
    const teacher = get('SELECT id, username, full_name, password_hash FROM teachers WHERE id = ?', [decoded.id]);
    if (!teacher) {
      return res.status(401).json({ error: 'Tài khoản giáo viên không tồn tại hoặc đã bị thay đổi' });
    }
    if (isPublicTunnelRequest(req) && isUsingDefaultTeacherAccount(teacher)) {
      return res.status(403).json({
        error: 'Từ chối truy cập từ Internet: Bạn vẫn đang dùng tài khoản mặc định (teacher / teacher123). Vui lòng đổi tên đăng nhập và mật khẩu trên máy tính trước khi mở Internet.'
      });
    }
    req.user = {
      id: teacher.id,
      username: teacher.username,
      fullName: teacher.full_name,
      requiresAccountSetup: isUsingDefaultTeacherAccount(teacher),
      role: 'TEACHER'
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ' });
  }
}

function authenticateStudent(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Vui lòng đăng nhập tài khoản học sinh' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'STUDENT') {
      return res.status(403).json({ error: 'Tài khoản không phải học sinh' });
    }

    // Verify student exists, is active, and sync current class_id from DB
    const student = get('SELECT id, student_code, full_name, class_id, status FROM students WHERE id = ?', [decoded.id]);
    if (!student || student.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Tài khoản học sinh đã bị vô hiệu hóa hoặc không tồn tại' });
    }

    req.user = {
      ...decoded,
      studentCode: student.student_code,
      fullName: student.full_name,
      classId: student.class_id,
      role: 'STUDENT'
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Phiên đăng nhập học sinh không hợp lệ' });
  }
}

module.exports = {
  JWT_SECRET,
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
};
