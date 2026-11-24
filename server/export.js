const xlsx = require('xlsx');
const JSZip = require('jszip');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ShadingType
} = require('docx');
const { countWords, getCategoryLabel } = require('./ielts');

function sanitizeFilenamePart(str, fallback = 'Bai_viet') {
  if (!str || typeof str !== 'string') return fallback;
  const ascii = str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return ascii || fallback;
}

function formatVietnameseDateTime(ts) {
  if (!ts) return 'Chưa xác định';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('vi-VN');
}

function makeInfoRow(label, value) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
  const borders = { top: border, bottom: border, left: border, right: border };
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 32, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, fill: 'F8FAFC' },
        borders,
        children: [
          new Paragraph({
            spacing: { before: 80, after: 80 },
            children: [
              new TextRun({ text: label, bold: true, font: 'Calibri', size: 22, color: '334155' })
            ]
          })
        ]
      }),
      new TableCell({
        width: { size: 68, type: WidthType.PERCENTAGE },
        borders,
        children: [
          new Paragraph({
            spacing: { before: 80, after: 80 },
            children: [
              new TextRun({ text: value !== undefined && value !== null ? String(value) : '', font: 'Calibri', size: 22, color: '0F172A' })
            ]
          })
        ]
      })
    ]
  });
}

/**
 * Generates an exact .docx Word document preserving the student's writing verbatim
 * with zero spelling/grammar modifications.
 */
async function generateStudentEssayDocxBuffer({ student, assignment, attempt }) {
  const rawEssay = typeof attempt.content === 'string' ? attempt.content : '';
  const wordCount = attempt.word_count !== null && attempt.word_count !== undefined
    ? attempt.word_count
    : countWords(rawEssay);
  const examTimestamp = attempt.submitted_at || attempt.start_time || attempt.last_saved_at || attempt.created_at;
  const dateStr = formatVietnameseDateTime(examTimestamp);

  const studentDisplayName = student.student_code
    ? `${student.full_name} (${student.student_code})`
    : (student.full_name || '');

  const essayLines = rawEssay.length > 0 ? rawEssay.split(/\r?\n/) : ['(Học sinh chưa gõ nội dung)'];
  const essayParagraphs = essayLines.map((line) =>
    new Paragraph({
      spacing: { after: 140, line: 340 },
      children: [
        new TextRun({
          text: line,
          font: 'Calibri',
          size: 24,
          color: rawEssay.length > 0 ? '0F172A' : '64748B',
          italics: rawEssay.length === 0
        })
      ]
    })
  );

  const taskType = assignment.type || assignment.task_type || 'TASK_1';
  const taskLabel = taskType === 'TASK_2' ? 'IELTS Academic Writing Task 2 (40 phút)' : 'IELTS Academic Writing Task 1 (20 phút)';
  const categoryLabel = getCategoryLabel(taskType, assignment.task_category);

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } // 20mm
          }
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
            children: [
              new TextRun({
                text: 'BÀI LÀM WRITING CỦA HỌC SINH',
                bold: true,
                font: 'Calibri',
                size: 32,
                color: '0F172A'
              })
            ]
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              makeInfoRow('Họ và tên học sinh', studentDisplayName),
              makeInfoRow('Lớp', student.class_name || ''),
              makeInfoRow('Tên buổi Writing', assignment.title || ''),
              makeInfoRow('Phần thi', taskLabel),
              makeInfoRow('Dạng bài', categoryLabel),
              makeInfoRow('Ngày làm bài', dateStr),
              makeInfoRow('Tổng số từ', `${wordCount} từ`),
              makeInfoRow('Trạng thái bài làm', translateStatus(attempt.status))
            ]
          }),
          new Paragraph({
            spacing: { before: 320, after: 160 },
            children: [
              new TextRun({
                text: 'NỘI DUNG BÀI VIẾT NGUYÊN VĂN:',
                bold: true,
                font: 'Calibri',
                size: 26,
                color: '1E3A8A'
              })
            ]
          }),
          ...essayParagraphs
        ]
      }
    ]
  });

  return await Packer.toBuffer(doc);
}

function buildDocxFilename(record) {
  const namePart = sanitizeFilenamePart(record.student?.full_name, 'Hoc_Sinh');
  const codePart = record.student?.student_code ? `_${sanitizeFilenamePart(record.student.student_code, '')}` : '';
  const classPart = sanitizeFilenamePart(record.student?.class_name, 'Lop');
  const titlePart = sanitizeFilenamePart(record.assignment?.title, 'Writing');
  return `${classPart}_${namePart}${codePart}_${titlePart}.docx`;
}

/**
 * Packages multiple individual student Word (.docx) files into a single ZIP buffer.
 */
async function generateClassSubmissionsZipBuffer(records) {
  const zip = new JSZip();
  const usedNames = new Map();

  for (const record of records) {
    const buffer = await generateStudentEssayDocxBuffer(record);
    let baseFilename = buildDocxFilename(record);
    const count = usedNames.get(baseFilename) || 0;
    usedNames.set(baseFilename, count + 1);
    if (count > 0) {
      baseFilename = baseFilename.replace(/\.docx$/i, `_${count + 1}.docx`);
    }
    zip.file(baseFilename, buffer);
  }

  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
}

function formatTimeSpent(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} giây`;
  return `${m} phút ${s > 0 ? s + ' giây' : ''}`.trim();
}

/**
 * Builds an Excel workbook for assignment or class submissions.
 */
function generateSubmissionsExcel(submissions, title = 'Danh_sach_bai_nop') {
  const data = submissions.map((s, idx) => {
    let timeSpentSec = s.time_spent_seconds;
    if (timeSpentSec === undefined || timeSpentSec === null) {
      if (s.start_time && s.submitted_at) {
        timeSpentSec = Math.max(0, Math.round((s.submitted_at - s.start_time) / 1000));
      } else if (s.start_time && s.last_saved_at && (s.status === 'INVALIDATED' || s.status === 'CANCELLED')) {
        timeSpentSec = Math.max(0, Math.round((s.last_saved_at - s.start_time) / 1000));
      }
    }

    const taskType = s.assignment_type || s.task_type || (s.duration_minutes === 40 ? 'TASK_2' : 'TASK_1');
    const taskLabel = taskType === 'TASK_2' ? 'Task 2' : 'Task 1';
    const categoryLabel = getCategoryLabel(taskType, s.task_category);

    return {
      'STT': idx + 1,
      'Phần Thi': taskLabel,
      'Dạng Bài': categoryLabel,
      'Lớp': s.class_name || '',
      'Mã Học Sinh': s.student_code || s.student_id || '',
      'Họ và Tên': s.full_name || '',
      'Đề Bài': s.assignment_title || '',
      'Số Từ': s.word_count || 0,
      'Trạng Thái': translateStatus(s.status),
      'Thời Gian Bắt Đầu': s.start_time ? new Date(s.start_time).toLocaleString('vi-VN') : '',
      'Thời Gian Nộp': s.submitted_at ? new Date(s.submitted_at).toLocaleString('vi-VN') : '',
      'Thời Gian Làm Bài': formatTimeSpent(timeSpentSec),
      'Task Achievement / Response (TA/TR)': s.task_achievement !== null && s.task_achievement !== undefined ? s.task_achievement : '-',
      'Coherence & Cohesion (CC)': s.coherence_cohesion !== null && s.coherence_cohesion !== undefined ? s.coherence_cohesion : '-',
      'Lexical Resource (LR)': s.lexical_resource !== null && s.lexical_resource !== undefined ? s.lexical_resource : '-',
      'Grammatical Accuracy (GRA)': s.grammatical_accuracy !== null && s.grammatical_accuracy !== undefined ? s.grammatical_accuracy : '-',
      'Overall Band': s.overall_band !== null && s.overall_band !== undefined ? s.overall_band : '-',
      'Nhận Xét Của Giáo Viên': s.general_feedback || '',
      'Vi Phạm Ghi Nhận': s.violation_count || 0
    };
  });

  const worksheet = xlsx.utils.json_to_sheet(data);
  // Auto-fit column widths
  const colWidths = [
    { wch: 6 },  // STT
    { wch: 10 }, // Phần Thi
    { wch: 28 }, // Dạng Bài
    { wch: 12 }, // Lớp
    { wch: 14 }, // Mã HS
    { wch: 25 }, // Họ Tên
    { wch: 30 }, // Đề Bài
    { wch: 10 }, // Số Từ
    { wch: 22 }, // Trạng Thái
    { wch: 22 }, // TG Bắt Đầu
    { wch: 22 }, // TG Nộp
    { wch: 18 }, // Thời Gian Làm Bài
    { wch: 12 }, // TA/TR
    { wch: 10 }, // CC
    { wch: 10 }, // LR
    { wch: 10 }, // GRA
    { wch: 14 }, // Band
    { wch: 40 }, // Nhận xét
    { wch: 15 }  // Vi phạm
  ];
  worksheet['!cols'] = colWidths;

  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Kết quả IELTS Writing');

  const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
}

/**
 * Builds an official printable HTML/Word report for a single submission.
 */
function generatePrintableReportHtml(data) {
  const { student, assignment, attempt, score, violations } = data;
  const statusStr = translateStatus(attempt.status);
  const submittedDate = attempt.submitted_at 
    ? new Date(attempt.submitted_at).toLocaleString('vi-VN') 
    : (attempt.last_saved_at ? new Date(attempt.last_saved_at).toLocaleString('vi-VN') + ' (Bản nháp gần nhất)' : 'Chưa nộp');

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Phiếu Chấm IELTS Writing Task 1 - ${student.full_name}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #1e293b;
      margin: 0;
      padding: 20px;
    }
    .header {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 {
      margin: 0;
      font-size: 20px;
      color: #0f172a;
      text-transform: uppercase;
    }
    .header .sub {
      font-size: 13px;
      color: #64748b;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      background: #f8fafc;
      padding: 14px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
    }
    .meta-item strong { color: #334155; }
    .section-title {
      font-size: 15px;
      font-weight: bold;
      color: #1e293b;
      border-left: 4px solid #2563eb;
      padding-left: 8px;
      margin: 20px 0 10px 0;
      text-transform: uppercase;
    }
    .prompt-box {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      padding: 14px;
      border-radius: 8px;
      font-size: 14px;
      white-space: pre-line;
      margin-bottom: 20px;
    }
    .essay-box {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      padding: 18px;
      border-radius: 8px;
      font-size: 15px;
      white-space: pre-wrap;
      min-height: 200px;
      line-height: 1.8;
      box-shadow: inset 0 1px 2px rgba(0,0,0,0.03);
    }
    .scores-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
      font-size: 14px;
    }
    .scores-table th, .scores-table td {
      border: 1px solid #cbd5e1;
      padding: 10px;
      text-align: left;
    }
    .scores-table th {
      background: #f1f5f9;
      font-weight: 600;
    }
    .band-highlight {
      font-size: 24px;
      font-weight: bold;
      color: #2563eb;
      text-align: center;
      background: #eff6ff;
    }
    .feedback-box {
      background: #f8fafc;
      border: 1px dashed #94a3b8;
      padding: 14px;
      border-radius: 8px;
      margin-top: 10px;
      font-size: 14px;
      white-space: pre-line;
    }
    .signature-row {
      margin-top: 40px;
      display: flex;
      justify-content: flex-end;
      text-align: center;
    }
    .signature-block {
      width: 200px;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>IELTS Writing Classroom - Phiếu Đánh Giá Bài Viết</h1>
      <div class="sub">Academic Writing Task 1 Assessment Report</div>
    </div>
    <div>
      <button class="no-print" onclick="window.print()" style="padding: 8px 16px; background: #2563eb; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">In phiếu (Print / Save PDF)</button>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-item"><strong>Học sinh:</strong> ${student.full_name} (${student.student_code || 'Chưa có mã'})</div>
    <div class="meta-item"><strong>Lớp:</strong> ${student.class_name || ''}</div>
    <div class="meta-item"><strong>Đề bài:</strong> ${assignment.title}</div>
    <div class="meta-item"><strong>Thời gian làm bài:</strong> ${assignment.duration_minutes} phút</div>
    <div class="meta-item"><strong>Số từ viết:</strong> <strong>${attempt.word_count || 0} từ</strong></div>
    <div class="meta-item"><strong>Trạng thái nộp:</strong> ${statusStr} (${submittedDate})</div>
  </div>

  <div class="section-title">1. Đề Bài (Task 1 Question)</div>
  <div class="prompt-box">
    <strong>${assignment.instructions}</strong>\n\n${assignment.prompt_question}
  </div>

  <div class="section-title">2. Bài Làm Của Học Sinh (Student Essay)</div>
  <div class="essay-box">${attempt.content ? escapeHtml(attempt.content) : '(Bài viết trống)'}</div>

  <div class="section-title">3. Kết Quả Đánh Giá & Điểm Số (IELTS Band Score)</div>
  ${score ? `
  <table class="scores-table">
    <thead>
      <tr>
        <th>Tiêu chí đánh giá</th>
        <th style="width: 100px; text-align: center;">Điểm Band</th>
        <th>Nhận xét chi tiết theo tiêu chí</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>1. Task Achievement (TA)</strong></td>
        <td style="text-align: center; font-weight: bold;">${score.task_achievement.toFixed(1)}</td>
        <td>${escapeHtml(score.feedback_ta || '-')}</td>
      </tr>
      <tr>
        <td><strong>2. Coherence and Cohesion (CC)</strong></td>
        <td style="text-align: center; font-weight: bold;">${score.coherence_cohesion.toFixed(1)}</td>
        <td>${escapeHtml(score.feedback_cc || '-')}</td>
      </tr>
      <tr>
        <td><strong>3. Lexical Resource (LR)</strong></td>
        <td style="text-align: center; font-weight: bold;">${score.lexical_resource.toFixed(1)}</td>
        <td>${escapeHtml(score.feedback_lr || '-')}</td>
      </tr>
      <tr>
        <td><strong>4. Grammatical Range and Accuracy (GRA)</strong></td>
        <td style="text-align: center; font-weight: bold;">${score.grammatical_accuracy.toFixed(1)}</td>
        <td>${escapeHtml(score.feedback_gra || '-')}</td>
      </tr>
      <tr>
        <td style="text-align: right; font-weight: bold;">TỔNG KẾT (OVERALL BAND):</td>
        <td class="band-highlight">${score.overall_band.toFixed(1)}</td>
        <td style="font-size: 12px; color: #64748b;">(Trung bình cộng 4 tiêu chí theo quy tắc làm tròn IELTS)</td>
      </tr>
    </tbody>
  </table>

  <div class="section-title">4. Lời Khuyên & Nhận Xét Tổng Quát Của Giáo Viên</div>
  <div class="feedback-box">${score.general_feedback ? escapeHtml(score.general_feedback) : 'Chưa có nhận xét tổng quát.'}</div>
  ` : '<div class="feedback-box">Bài viết này hiện chưa được giáo viên chấm điểm.</div>'}

  ${violations && violations.length > 0 ? `
  <div class="section-title" style="color: #dc2626; border-left-color: #dc2626;">Nhật ký vi phạm quy chế (Anti-cheating Log)</div>
  <div style="font-size: 13px; color: #dc2626;">
    ${violations.map(v => `• ${new Date(v.timestamp).toLocaleTimeString('vi-VN')}: ${v.event_type} - ${escapeHtml(v.details || '')}`).join('<br>')}
  </div>
  ` : ''}

  <div class="signature-row">
    <div class="signature-block">
      <div><em>Ngày ..... tháng ..... năm 202...</em></div>
      <div style="font-weight: bold; margin-top: 5px;">Giáo viên chấm thi</div>
      <div style="height: 60px;"></div>
      <div>(Ký và ghi rõ họ tên)</div>
    </div>
  </div>
</body>
</html>`;
}

function translateStatus(st) {
  switch (st) {
    case 'NOT_STARTED': return 'Chưa bắt đầu';
    case 'IN_PROGRESS':
    case 'IN PROGRESS': return 'IN PROGRESS (Đang làm bài)';
    case 'SUBMITTED': return 'SUBMITTED (Đã nộp bài)';
    case 'AUTO-SUBMITTED':
    case 'AUTO_SUBMITTED':
    case 'EXPIRED': return 'AUTO-SUBMITTED (Tự động nộp khi hết giờ)';
    case 'CANCELLED':
    case 'INVALIDATED': return 'INVALIDATED (Đã bị hủy do vi phạm)';
    case 'TECHNICAL ISSUE':
    case 'TECHNICAL_ISSUE': return 'TECHNICAL ISSUE (Sự cố kỹ thuật)';
    case 'NEEDS_REVIEW': return 'Cần giáo viên xem xét';
    default: return st || 'Không rõ';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  generateSubmissionsExcel,
  generatePrintableReportHtml,
  generateStudentEssayDocxBuffer,
  generateClassSubmissionsZipBuffer,
  buildDocxFilename,
  sanitizeFilenamePart,
  translateStatus
};
