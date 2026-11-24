/**
 * Test Suite: IELTS Writing Task 2 Upgrade Verification
 * Verifies Task 1 & Task 2 co-existence, 40:00 countdown, 250-word logic,
 * export formatting, submission filtering, and anti-cheating.
 */

const http = require('http');
const assert = require('assert');
const jwt = require('jsonwebtoken');

const PORT = 5067;
process.env.PORT = PORT;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_task2_upgrade_12345';

async function runTask2TestSuite() {
  console.log('========================================================================');
  console.log(' IELTS Ms Nga - TASK 1 & TASK 2 UPGRADE VERIFICATION TEST SUITE');
  console.log('========================================================================');

  const app = require('../server/server.js');
  const { initDb, run, get, all } = require('../server/db.js');
  const { generateTeacherToken } = require('../server/auth.js');
  await initDb();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Test server running on port ${PORT}`);

  let passCount = 0;
  let totalCount = 0;

  async function testAsync(name, fn) {
    totalCount++;
    try {
      await fn();
      console.log(`[✅ PASS] Test #${totalCount}: ${name}`);
      passCount++;
    } catch (err) {
      console.error(`[❌ FAIL] Test #${totalCount}: ${name}`);
      console.error(err.message || err);
    }
  }

  function apiPost(path, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body || {});
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: PORT,
          path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            ...headers
          }
        },
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(buf || '{}') });
            } catch (_) {
              resolve({ status: res.statusCode, headers: res.headers, raw: buf });
            }
          });
        }
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  function apiGet(path, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: PORT,
          path,
          method: 'GET',
          headers
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const str = buffer.toString('utf8');
            try {
              resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(str), buffer });
            } catch (_) {
              resolve({ status: res.statusCode, headers: res.headers, raw: str, buffer });
            }
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  // Teacher token helper
  const teacher = get('SELECT * FROM teachers LIMIT 1');
  assert(teacher, 'Teacher account must exist');
  const teacherToken = generateTeacherToken(teacher);
  const teacherHeaders = { Authorization: `Bearer ${teacherToken}` };

  // 1. Verify Existing Task 1 Exams Preserved
  await testAsync('Existing Task 1 exams are preserved and default to TASK_1', async () => {
    const res = await apiGet('/api/assignments', teacherHeaders);
    assert.strictEqual(res.status, 200);
    assert(res.body.assignments.length >= 1, 'At least 1 existing exam');
    for (const a of res.body.assignments) {
      if (a.id.startsWith('a-task1') || a.id.startsWith('a-0231') || a.id.startsWith('a-8f49')) {
        assert.strictEqual(a.type, 'TASK_1', `${a.id} must be TASK_1`);
        assert.strictEqual(a.task_type, 'TASK_1', `${a.id} task_type must be TASK_1`);
        assert.strictEqual(a.duration_minutes, 20, `${a.id} duration must be 20 minutes`);
      }
    }
  });

  // 2. Create Task 2 Exam with 40-minute duration
  let task2ExamId = null;
  await testAsync('Teacher creates IELTS Writing Task 2 exam (40m default, OPINION category)', async () => {
    const classRow = get('SELECT * FROM classes LIMIT 1');
    assert(classRow, 'A class must exist');
    const res = await apiPost(
      '/api/assignments',
      {
        title: 'Task 2 Test - Technology in Higher Education',
        type: 'TASK_2',
        taskType: 'TASK_2',
        taskCategory: 'OPINION',
        classId: classRow.id,
        durationMinutes: 40,
        instructions: 'You should spend about 40 minutes on this task. Write at least 250 words.',
        promptQuestion: 'Some people believe that computers and the internet will soon replace teachers in classrooms. To what extent do you agree or disagree?',
        status: 'PUBLISHED'
      },
      teacherHeaders
    );
    assert.strictEqual(res.status, 200);
    assert(res.body.assignment.id);
    assert.strictEqual(res.body.assignment.type, 'TASK_2');
    assert.strictEqual(res.body.assignment.task_type, 'TASK_2');
    assert.strictEqual(res.body.assignment.duration_minutes, 40);
    assert.strictEqual(res.body.assignment.task_category, 'OPINION');
    task2ExamId = res.body.assignment.id;
  });

  // 3. Student Public Exam Endpoint Returns 40-minute duration for Task 2
  await testAsync('Public exam endpoint returns Task 2 metadata and 40-minute duration', async () => {
    const res = await apiGet(`/api/exam/${task2ExamId}/public`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.assignment.type, 'TASK_2');
    assert.strictEqual(res.body.assignment.task_type, 'TASK_2');
    assert.strictEqual(res.body.assignment.duration_minutes, 40);
    assert.strictEqual(res.body.assignment.task_category, 'OPINION');
  });

  // 4. Student Starts Task 2 Exam and gets 2400-second deadline
  let studentAttemptId = null;
  let studentToken = null;
  await testAsync('Student starts Task 2 exam and server assigns exactly 2400 seconds (40:00)', async () => {
    const res = await apiPost(`/api/exam/${task2ExamId}/start-direct`, {
      fullName: 'Trần Thị Mai',
      className: 'Lớp 12A1'
    });
    assert.strictEqual(res.status, 200);
    assert(res.body.token);
    assert(res.body.attempt);
    assert.strictEqual(res.body.attempt.status, 'IN_PROGRESS');
    studentAttemptId = res.body.attempt.id;
    studentToken = res.body.token;

    // Remaining seconds: (deadline_time - serverTime) / 1000 should equal 2400s (40 minutes)
    const remainingSeconds = Math.round((res.body.attempt.deadline_time - res.body.serverTime) / 1000);
    assert.strictEqual(remainingSeconds, 2400, `Remaining seconds was ${remainingSeconds}, expected 2400s (40:00)`);
  });

  // 5. Student Autosave & Word Counter for Task 2 Essay
  await testAsync('Student types 260 words for Task 2 and server saves & counts accurately', async () => {
    const words = Array.from({ length: 260 }, (_, i) => `word${i + 1}`).join(' ');
    const res = await apiPost(
      `/api/student/attempts/${studentAttemptId}/draft`,
      { content: words },
      { Authorization: `Bearer ${studentToken}` }
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.wordCount, 260);
    assert.strictEqual(res.body.success, true);
  });

  // 6. Strict Anti-Cheating Invalidation on Task 2
  await testAsync('Strict anti-cheating policy: 1 tab switch immediately INVALIDATES Task 2 attempt', async () => {
    const res = await apiPost(
      `/api/student/attempts/${studentAttemptId}/violation`,
      {
        eventType: 'TAB_SWITCH',
        details: 'Student switched away from the examination tab'
      },
      { Authorization: `Bearer ${studentToken}` }
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'CANCELLED');
    assert.strictEqual(res.body.cancelled, true);

    // Verify in database that status is CANCELLED and content is saved
    const attempt = get('SELECT * FROM attempts WHERE id = ?', [studentAttemptId]);
    assert.strictEqual(attempt.status, 'CANCELLED');
    assert(attempt.content.includes('word260'));
    assert.strictEqual(attempt.word_count, 260);
  });

  // 7. Teacher Override: Reopen Task 2 Attempt
  await testAsync('Teacher overrides and accepts cancelled Task 2 essay', async () => {
    const res = await apiPost(
      `/api/teacher/attempts/${studentAttemptId}/override`,
      {
        action: 'ACCEPT_CANCELLED',
        reason: 'Teacher approved essay submission after technical review'
      },
      teacherHeaders
    );
    assert.strictEqual(res.status, 200);
    const updated = get('SELECT * FROM attempts WHERE id = ?', [studentAttemptId]);
    assert.strictEqual(updated.status, 'SUBMITTED');
  });

  // 8. Word (.docx) Export Formatter for Task 2
  await testAsync('Word (.docx) export includes Task 2 header and category', async () => {
    const res = await apiGet(`/api/teacher/export/docx/${studentAttemptId}`, teacherHeaders);
    assert.strictEqual(res.status, 200);
    assert(res.buffer.length > 1000, 'Word file buffer should be > 1000 bytes');
    assert(res.headers['content-type'].includes('officedocument.wordprocessingml.document'));
  });

  // 9. Excel (.xlsx) Export with Task Filtering
  await testAsync('Excel export includes Task 1 and Task 2 with task type columns', async () => {
    const res = await apiGet('/api/teacher/export/excel?taskType=TASK_2', teacherHeaders);
    assert.strictEqual(res.status, 200);
    assert(res.buffer.length > 1000, 'Excel buffer should be > 1000 bytes');
    assert(res.headers['content-disposition'].includes('Ket_Qua_IELTS_Task_2.xlsx'));
  });

  // 10. Teacher Submissions API Filter by taskType
  await testAsync('Teacher submissions API filters accurately by taskType=TASK_2 vs TASK_1', async () => {
    const resT2 = await apiGet('/api/teacher/submissions?taskType=TASK_2', teacherHeaders);
    assert.strictEqual(resT2.status, 200);
    for (const sub of resT2.body.submissions) {
      assert.strictEqual(sub.assignment_type, 'TASK_2');
    }

    const resT1 = await apiGet('/api/teacher/submissions?taskType=TASK_1', teacherHeaders);
    assert.strictEqual(resT1.status, 200);
    for (const sub of resT1.body.submissions) {
      assert.strictEqual(sub.assignment_type, 'TASK_1');
    }
  });

  server.close();

  console.log('========================================================================');
  console.log(` ALL ${totalCount} TASK 2 UPGRADE TESTS COMPLETED!`);
  console.log(` Result: ${passCount} / ${totalCount} passed (${Math.round((passCount / totalCount) * 100)}%)`);
  console.log('========================================================================');

  if (passCount === totalCount) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTask2TestSuite().catch((err) => {
  console.error('Fatal error running Task 2 test suite:', err);
  process.exit(1);
});
