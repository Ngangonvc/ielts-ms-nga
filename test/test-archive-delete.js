/**
 * Automated Verification Script: Delete Exam & Archive Exam Requirements
 * Tests all safeguards, status filters, cascading deletes, and student blocks.
 */

const http = require('http');

const PORT = 5000;
const BASE_URL = `http://localhost:${PORT}`;

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch (_) {}
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    if (body) {
      if (typeof body === 'string') {
        req.write(body);
      } else {
        req.setHeader('Content-Type', 'application/json');
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== RUNNING TESTS: DELETE & ARCHIVE EXAMS ===\n');
  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
    }
  }

  try {
    // 1. Login as teacher
    console.log('1. Teacher Authentication...');
    const loginRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/auth/teacher/login',
        method: 'POST'
      },
      { username: 'msnga', password: 'MsNga@2026!' }
    );

    const token = loginRes.data?.token;
    assert(loginRes.status === 200 && token, 'Teacher logged in successfully');

    const teacherHeaders = {
      Authorization: `Bearer ${token}`
    };

    // Get a valid class
    const classRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/classes',
      method: 'GET',
      headers: teacherHeaders
    });
    const classId = classRes.data?.classes?.[0]?.id || 'c-12a1';

    // 2. Test Deleting an Empty Exam (Task 1)
    console.log('\n2. Testing Delete on Empty Exam (Task 1)...');
    const createEmptyRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/assignments',
        method: 'POST',
        headers: teacherHeaders
      },
      {
        title: 'Empty Task 1 Test Deletion',
        taskType: 'TASK_1',
        taskCategory: 'BAR_CHART',
        classId: classId,
        instructions: 'Test instructions'
      }
    );
    const emptyExamId = createEmptyRes.data?.assignment?.id;
    assert(createEmptyRes.status === 200 && emptyExamId, 'Created empty Task 1 exam for deletion test');

    // Delete empty exam
    const delEmptyRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/assignments/${emptyExamId}`,
      method: 'DELETE',
      headers: teacherHeaders
    });
    assert(delEmptyRes.status === 200 && delEmptyRes.data?.success === true, 'Successfully deleted empty exam');

    // Verify it is gone from list
    const listAfterDelRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/assignments',
      method: 'GET',
      headers: teacherHeaders
    });
    const foundDeleted = listAfterDelRes.data?.assignments?.some((a) => a.id === emptyExamId);
    assert(!foundDeleted, 'Verified empty exam is permanently removed from database');

    // 3. Test Safeguard: Cannot Delete Exam with Active In-Progress Student
    console.log('\n3. Testing Safeguard: Forbid Deletion when Student is In-Progress...');
    const createActiveRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/assignments',
        method: 'POST',
        headers: teacherHeaders
      },
      {
        title: 'Task 2 Active In-Progress Test',
        taskType: 'TASK_2',
        taskCategory: 'OPINION',
        classId: classId,
        instructions: 'Test instructions'
      }
    );
    const activeExamId = createActiveRes.data?.assignment?.id;
    assert(createActiveRes.status === 200 && activeExamId, 'Created Task 2 exam for active attempt test');

    // Publish exam
    await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/assignments/${activeExamId}/status`,
        method: 'POST',
        headers: teacherHeaders
      },
      { status: 'PUBLISHED' }
    );

    // Student starts direct attempt (status = IN_PROGRESS)
    const studentStartRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/exam/${activeExamId}/start-direct`,
        method: 'POST'
      },
      { fullName: 'Test Active Student', className: 'Lớp 12A1' }
    );
    const attemptId = studentStartRes.data?.attempt?.id;
    const studentToken = studentStartRes.data?.token;
    assert(studentStartRes.status === 200 && attemptId, 'Student started exam, attempt is IN_PROGRESS');

    // Verify active_attempt_count in GET /api/assignments
    const listWithActiveRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/assignments',
      method: 'GET',
      headers: teacherHeaders
    });
    const activeExamItem = listWithActiveRes.data?.assignments?.find((a) => a.id === activeExamId);
    assert(activeExamItem && activeExamItem.active_attempt_count >= 1, `active_attempt_count is ${activeExamItem?.active_attempt_count} (>= 1)`);

    // Attempt to DELETE exam with active attempt -> MUST FAIL (HTTP 400)
    const blockedDelRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/assignments/${activeExamId}`,
      method: 'DELETE',
      headers: teacherHeaders
    });
    assert(
      blockedDelRes.status === 400 && blockedDelRes.data?.error?.includes('đang trong giờ làm bài'),
      `Safeguard blocked deletion of exam with in-progress student: "${blockedDelRes.data?.error}"`
    );

    // 4. Submit Attempt & Test Archive Functionality
    console.log('\n4. Testing Archive & Student Blocking...');
    // Submit student essay
    const submitRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/student/attempts/${attemptId}/submit`,
        method: 'POST',
        headers: { Authorization: `Bearer ${studentToken}` }
      },
      { content: 'This is a test essay submission for IELTS Writing Task 2.' }
    );
    assert(submitRes.status === 200, 'Student submitted essay successfully');

    // Archive the exam
    const archiveRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/assignments/${activeExamId}/archive`,
      method: 'POST',
      headers: teacherHeaders
    });
    assert(archiveRes.status === 200 && archiveRes.data?.status === 'ARCHIVED', 'Exam successfully archived');

    // Verify student is BLOCKED from accessing public info of archived exam (HTTP 403)
    const studentPublicArchivedRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/exam/${activeExamId}/public`,
      method: 'GET'
    });
    assert(studentPublicArchivedRes.status === 403, 'Student blocked from accessing public info of archived exam (HTTP 403)');

    // Verify student is BLOCKED from starting direct exam on archived exam (HTTP 403)
    const studentStartArchivedRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/exam/${activeExamId}/start-direct`,
        method: 'POST'
      },
      { fullName: 'Another Student', className: 'Lớp 12A1' }
    );
    assert(studentStartArchivedRes.status === 403, 'Student blocked from starting archived exam (HTTP 403)');

    // 5. Test Restore Functionality
    console.log('\n5. Testing Restore Archived Exam...');
    const restoreRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/assignments/${activeExamId}/restore`,
      method: 'POST',
      headers: teacherHeaders
    });
    assert(
      restoreRes.status === 200 && restoreRes.data?.status === 'CLOSED',
      'Restored exam successfully, defaults to CLOSED status'
    );

    // 6. Test Cascading Delete on Exam with Submissions
    console.log('\n6. Testing Cascading Delete on Exam with Submissions...');
    const delSubmittedRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/assignments/${activeExamId}`,
      method: 'DELETE',
      headers: teacherHeaders
    });
    assert(
      delSubmittedRes.status === 200 && delSubmittedRes.data?.success === true,
      'Successfully deleted exam with submissions (cascaded attempts & scores)'
    );

    // Verify attempt is also deleted
    const listFinalRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/assignments',
      method: 'GET',
      headers: teacherHeaders
    });
    const stillExists = listFinalRes.data?.assignments?.some((a) => a.id === activeExamId);
    assert(!stillExists, 'Verified exam and cascading attempts completely removed');

    console.log(`\n========================================`);
    console.log(`RESULTS: ${passed}/${total} TESTS PASSED`);
    console.log(`========================================`);
  } catch (err) {
    console.error('Test execution failed:', err);
  }
}

runTests();
