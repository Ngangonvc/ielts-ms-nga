/**
 * Automated Test: IELTS Ms Nga - Verify ZIP & Excel Export for AUTO-SUBMITTED and SUBMITTED
 * Verifies that:
 * 1. Both manually submitted (SUBMITTED) and auto-submitted (AUTO-SUBMITTED) essays are packaged in ZIP.
 * 2. Essays below minimum word count (e.g. 50 words) are NOT discarded when submitted or auto-submitted.
 * 3. ClassId and AssignmentId filters are properly respected.
 * 4. Excel export includes both SUBMITTED and AUTO-SUBMITTED essays with correct statuses.
 * 5. Custom header X-Export-Count is set and matches the actual count of essays packaged.
 */

const http = require('http');
const JSZip = require('jszip');
const xlsx = require('xlsx');

const PORT = 5000;

function request(options, body = null, returnRawBuffer = false) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let parsed = null;
        if (!returnRawBuffer) {
          const text = buffer.toString('utf8');
          try {
            parsed = JSON.parse(text);
          } catch (_) {
            parsed = text;
          }
        } else {
          parsed = buffer;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed
        });
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
  console.log('=== TEST: ZIP & EXCEL EXPORT FOR AUTO-SUBMITTED & SUBMITTED ESSAYS ===\n');
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
    // 1. Teacher login
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
    assert(loginRes.status === 200 && token, 'Teacher authenticated successfully');

    const authHeaders = { Authorization: `Bearer ${token}` };

    // Get classes
    const classRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/classes',
      method: 'GET',
      headers: authHeaders
    });
    const classId = classRes.data?.classes?.[0]?.id || 'c-12a1';
    const className = classRes.data?.classes?.[0]?.name || 'Lớp 12A1';

    // 2. Create test exam
    console.log('\n2. Creating Test Exam...');
    const createExamRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: '/api/assignments',
        method: 'POST',
        headers: authHeaders
      },
      {
        title: 'Export Verification Exam - Task 1',
        taskType: 'TASK_1',
        taskCategory: 'BAR_CHART',
        classId: classId,
        instructions: 'Test instructions'
      }
    );
    const examId = createExamRes.data?.assignment?.id;
    assert(createExamRes.status === 200 && examId, `Created exam with ID: ${examId}`);

    // Publish exam
    await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/assignments/${examId}/status`,
        method: 'POST',
        headers: authHeaders
      },
      { status: 'PUBLISHED' }
    );

    // 3. Student A: manual SUBMITTED attempt (180 words)
    console.log('\n3. Creating Student A Attempt (SUBMITTED, 180 words)...');
    const startARes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/exam/${examId}/start-direct`,
        method: 'POST'
      },
      { fullName: 'Nguyễn Văn A (Manual Submit)', className }
    );
    const attemptAId = startARes.data?.attempt?.id;
    const tokenA = startARes.data?.token;
    assert(startARes.status === 200 && attemptAId, 'Student A started exam');

    const essayA = Array(180).fill('word').join(' ');
    const submitARes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/student/attempts/${attemptAId}/submit`,
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` }
      },
      { content: essayA }
    );
    assert(submitARes.status === 200 && submitARes.data?.status === 'SUBMITTED', 'Student A submitted successfully (status = SUBMITTED)');

    // 4. Student B: AUTO-SUBMITTED attempt with SHORT essay (only 35 words - below minimum 150 words!)
    console.log('\n4. Creating Student B Attempt (AUTO-SUBMITTED, 35 words - below minimum)...');
    const startBRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/exam/${examId}/start-direct`,
        method: 'POST'
      },
      { fullName: 'Trần Thị B (Auto Submit)', className }
    );
    const attemptBId = startBRes.data?.attempt?.id;
    const tokenB = startBRes.data?.token;
    assert(startBRes.status === 200 && attemptBId, 'Student B started exam');

    const shortEssayB = 'The chart shows the consumption of three types of fast food in the UK from 1970 to 1990. Overall, hamburgers and fish and chips increased dramatically over the twenty year period shown.';
    
    // Simulate auto-submit at 00:00 with isAutoSubmit: true
    const autoSubmitBRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/student/attempts/${attemptBId}/submit`,
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` }
      },
      { content: shortEssayB, isAutoSubmit: true }
    );
    assert(
      autoSubmitBRes.status === 200 && autoSubmitBRes.data?.status === 'AUTO-SUBMITTED',
      'Student B auto-submitted successfully at 00:00 (status = AUTO-SUBMITTED)'
    );

    // 5. Verify submitted_count in GET /api/assignments
    console.log('\n5. Verifying submitted_count on Exam Card...');
    const assignListRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: '/api/assignments',
      method: 'GET',
      headers: authHeaders
    });
    const foundExam = assignListRes.data?.assignments?.find((a) => a.id === examId);
    assert(
      foundExam && foundExam.submitted_count === 2,
      `submitted_count on exam card correctly counts BOTH SUBMITTED and AUTO-SUBMITTED: ${foundExam?.submitted_count} / 2`
    );

    // 6. Test GET /api/teacher/export/zip for this exam
    console.log('\n6. Testing GET /api/teacher/export/zip...');
    const zipRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/teacher/export/zip?assignmentId=${examId}`,
        method: 'GET',
        headers: authHeaders
      },
      null,
      true // returnRawBuffer
    );
    assert(zipRes.status === 200, `ZIP request returned status 200 OK`);
    assert(zipRes.headers['x-export-count'] === '2', `X-Export-Count header is 2: ${zipRes.headers['x-export-count']}`);

    // Inspect files inside the ZIP buffer
    const jszip = await JSZip.loadAsync(zipRes.data);
    const fileNames = Object.keys(jszip.files);
    console.log('Files in ZIP:', fileNames);

    const hasStudentA = fileNames.some((f) => f.includes('Nguyen_Van_A') || f.includes('Manual'));
    const hasStudentB = fileNames.some((f) => f.includes('Tran_Thi_B') || f.includes('Auto'));

    assert(hasStudentA, 'ZIP contains Student A docx (manually submitted)');
    assert(hasStudentB, 'ZIP contains Student B docx (AUTO-SUBMITTED, 35 words below threshold)');
    assert(fileNames.length === 2, `ZIP contains exactly 2 documents (actual: ${fileNames.length})`);

    // 7. Test GET /api/teacher/export/zip?status=SUBMITTED
    console.log('\n7. Testing GET /api/teacher/export/zip?status=SUBMITTED (must include AUTO-SUBMITTED)...');
    const zipSubmittedFilterRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/teacher/export/zip?assignmentId=${examId}&status=SUBMITTED`,
        method: 'GET',
        headers: authHeaders
      },
      null,
      true
    );
    assert(zipSubmittedFilterRes.status === 200, 'ZIP with status=SUBMITTED returned 200 OK');
    const jszipFilter = await JSZip.loadAsync(zipSubmittedFilterRes.data);
    const filterFiles = Object.keys(jszipFilter.files);
    assert(
      filterFiles.length === 2,
      `status=SUBMITTED filter correctly includes both manual and auto submissions (found: ${filterFiles.length})`
    );

    // 8. Test GET /api/teacher/export/excel
    console.log('\n8. Testing GET /api/teacher/export/excel...');
    const excelRes = await request(
      {
        hostname: 'localhost',
        port: PORT,
        path: `/api/teacher/export/excel?assignmentId=${examId}`,
        method: 'GET',
        headers: authHeaders
      },
      null,
      true
    );
    assert(excelRes.status === 200, 'Excel export returned 200 OK');
    assert(excelRes.headers['x-export-count'] === '2', `X-Export-Count header on Excel is 2: ${excelRes.headers['x-export-count']}`);

    // Parse Excel workbook
    const workbook = xlsx.read(excelRes.data, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const excelRows = xlsx.utils.sheet_to_json(sheet);
    console.log('Excel rows exported:', excelRows.map((r) => ({ name: r['Họ và Tên'], status: r['Trạng Thái'], words: r['Số Từ'] })));

    assert(excelRows.length === 2, `Excel sheet contains 2 student rows (actual: ${excelRows.length})`);
    const studentBRow = excelRows.find((r) => String(r['Họ và Tên']).includes('Trần Thị B'));
    assert(
      studentBRow && String(studentBRow['Trạng Thái']).includes('AUTO-SUBMITTED'),
      `Student B row in Excel has AUTO-SUBMITTED status: "${studentBRow?.['Trạng Thái']}"`
    );

    // 9. Cleanup test exam
    console.log('\n9. Cleaning up test exam...');
    const delRes = await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/assignments/${examId}`,
      method: 'DELETE',
      headers: authHeaders
    });
    assert(delRes.status === 200, 'Test exam cleaned up successfully');

    console.log(`\n========================================`);
    console.log(`RESULTS: ${passed}/${total} TESTS PASSED`);
    console.log(`========================================`);
  } catch (err) {
    console.error('Test execution failed:', err);
  }
}

runTests();
