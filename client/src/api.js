const API_BASE = '/api';

export const TEACHER_TOKEN_KEY = 'ielts_teacher_token';
export const STUDENT_TOKEN_KEY = 'ielts_student_token';

export function getTeacherToken() {
  return localStorage.getItem(TEACHER_TOKEN_KEY);
}

export function setTeacherToken(token) {
  if (token) localStorage.setItem(TEACHER_TOKEN_KEY, token);
  else localStorage.removeItem(TEACHER_TOKEN_KEY);
}

export function getStudentToken() {
  return localStorage.getItem(STUDENT_TOKEN_KEY);
}

export function setStudentToken(token) {
  if (token) localStorage.setItem(STUDENT_TOKEN_KEY, token);
  else localStorage.removeItem(STUDENT_TOKEN_KEY);
}

/**
 * Determine strictly which auth domain an API endpoint belongs to.
 * Strips query strings so e.g. `/students?classId=...` never collides with `/student/...`.
 */
export function getEndpointAuthDomain(endpoint) {
  const path = (endpoint || '').split('?')[0];

  if (
    path === '/auth/teacher/login' ||
    path === '/auth/student/login' ||
    path === '/auth/student/classes' ||
    path === '/time' ||
    path.startsWith('/exam/')
  ) {
    return 'PUBLIC';
  }

  if (
    path === '/auth/student/me' ||
    path === '/student' ||
    path.startsWith('/student/')
  ) {
    return 'STUDENT';
  }

  if (
    path === '/auth/teacher/me' ||
    path === '/auth/teacher/change-password' ||
    path === '/auth/teacher/update-account' ||
    path === '/classes' ||
    path.startsWith('/classes/') ||
    path === '/students' ||
    path.startsWith('/students/') ||
    path === '/assignments' ||
    path.startsWith('/assignments/') ||
    path === '/teacher' ||
    path.startsWith('/teacher/')
  ) {
    return 'TEACHER';
  }

  return 'UNKNOWN';
}

export async function apiRequest(endpoint, method = 'GET', data = null, isFormData = false) {
  const domain = getEndpointAuthDomain(endpoint);
  const headers = {};

  if (domain === 'STUDENT') {
    const studentToken = getStudentToken();
    if (studentToken) {
      headers['Authorization'] = `Bearer ${studentToken}`;
    }
  } else if (domain === 'TEACHER') {
    const teacherToken = getTeacherToken();
    if (teacherToken) {
      headers['Authorization'] = `Bearer ${teacherToken}`;
    }
  }

  const options = { method, headers };

  if (data) {
    if (isFormData) {
      options.body = data;
    } else {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(data);
    }
  }

  const res = await fetch(`${API_BASE}${endpoint}`, options);

  if (res.status === 204) return null;

  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    const json = await res.json();
    if (!res.ok) {
      handleAuthErrorResponse(domain, res.status, json.error);
      throw new Error(json.error || `Yêu cầu thất bại (${res.status})`);
    }
    return json;
  }

  if (!res.ok) {
    const text = await res.text();
    handleAuthErrorResponse(domain, res.status, text);
    throw new Error(text || `Yêu cầu thất bại (${res.status})`);
  }

  return res;
}

function handleAuthErrorResponse(domain, status, errorMessage) {
  if (typeof window === 'undefined') return;
  const msg = errorMessage || '';

  if (domain === 'TEACHER') {
    if (status === 401 || (status === 403 && msg.includes('Không có quyền truy cập dành cho giáo viên'))) {
      setTeacherToken(null);
      window.dispatchEvent(new CustomEvent('ielts-auth-invalid', { detail: { role: 'TEACHER', message: msg } }));
    }
  } else if (domain === 'STUDENT') {
    if (
      status === 401 ||
      (status === 403 && (msg.includes('không phải học sinh') || msg.includes('vô hiệu hóa')))
    ) {
      setStudentToken(null);
      window.dispatchEvent(new CustomEvent('ielts-auth-invalid', { detail: { role: 'STUDENT', message: msg } }));
    }
  }
}

export async function downloadTeacherFile(endpoint, fallbackFilename = 'download') {
  const teacherToken = getTeacherToken();
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'GET',
    headers: teacherToken ? { Authorization: `Bearer ${teacherToken}` } : {}
  });

  if (!res.ok) {
    let errMsg = `Tải tệp thất bại (${res.status})`;
    try {
      const json = await res.json();
      if (json.error) errMsg = json.error;
    } catch (_) {}
    handleAuthErrorResponse('TEACHER', res.status, errMsg);
    throw new Error(errMsg);
  }

  const contentType = res.headers.get('content-type') || '';
  const contentDisp = res.headers.get('content-disposition') || '';
  let resolvedFilename = fallbackFilename;
  const utf8Match = contentDisp.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = contentDisp.match(/filename="([^"]+)"/i);
  if (utf8Match && utf8Match[1]) {
    try {
      resolvedFilename = decodeURIComponent(utf8Match[1].trim());
    } catch (_) {}
  } else if (plainMatch && plainMatch[1]) {
    resolvedFilename = plainMatch[1].trim();
  }

  const blob = await res.blob();
  const blobUrl = window.URL.createObjectURL(blob);

  if (contentType.includes('text/html')) {
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
    setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000);
    return;
  }

  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = resolvedFilename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(blobUrl), 10000);
}

// Client word counter strictly matching backend IELTS standard
export function countWordsClient(text) {
  if (!text || typeof text !== 'string') return 0;
  const sanitized = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .trim();
  if (!sanitized) return 0;
  const tokens = sanitized.split(/\s+/);
  const valid = tokens.filter(t => /[a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9]/.test(t));
  return valid.length;
}

// IELTS Task 1 Category Vietnamese Labels
export const TASK_1_CATEGORIES = {
  LINE_GRAPH: 'Biểu đồ đường (Line Graph)',
  BAR_CHART: 'Biểu đồ cột (Bar Chart)',
  PIE_CHART: 'Biểu đồ tròn (Pie Chart)',
  TABLE: 'Bảng số liệu (Table)',
  MAP: 'Bản đồ (Map)',
  PROCESS: 'Quy trình (Process Diagram)',
  MIXED: 'Biểu đồ kết hợp (Mixed / Multiple Charts)'
};

// IELTS Task 2 Category Labels
export const TASK_2_CATEGORIES = {
  OPINION: 'Opinion Essay (Agree/Disagree)',
  DISCUSSION: 'Discussion Essay (Discuss Both Views)',
  ADVANTAGES_DISADVANTAGES: 'Advantages and Disadvantages',
  PROBLEM_SOLUTION: 'Problems and Solutions',
  TWO_PART: 'Two-part Questions'
};

export const TASK_TYPES = {
  TASK_1: 'IELTS Academic Writing Task 1',
  TASK_2: 'IELTS Academic Writing Task 2'
};

export function getCategoryLabelClient(taskType, category) {
  if (taskType === 'TASK_2') {
    return TASK_2_CATEGORIES[category] || category || 'Bài luận Task 2';
  }
  return TASK_1_CATEGORIES[category] || category || 'Biểu đồ Task 1';
}
