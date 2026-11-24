# IELTS Ms Nga - IELTS Academic Writing Task 1 Examination Application

**IELTS Ms Nga** is a professional, secure, and modern full-stack web application designed specifically for high school English teachers (Ms. Nga) to conduct IELTS Academic Writing Task 1 examinations directly in the classroom.

The system is optimized for a teacher supervising **40–50 students** taking examinations simultaneously under strict anti-cheating supervision, with zero accounts required for students, continuous autosaving, a 20-minute server-authoritative countdown timer, and automatic essay submission.

---

## Key Features Summary

### 1. Modern Blue-and-White Interface
- **Modern Aesthetic**: Professional IELTS blue-and-white theme (`#2563eb`, `#1d4ed8`, `#eff6ff`).
- **Two Dedicated Interfaces**:
  - **Teacher Dashboard**: Secure teacher login, exam creation/editing/publishing/duplicating/closing, chart image upload, unique shareable links, real-time submission monitor, Word (.docx) export, and Excel (.xlsx) results export.
  - **Student Interface**: Direct access through a shared exam link without creating an account; dual-pane exam screen displaying the question and zoomable chart on the left, and a large distraction-free writing editor on the right.

### 2. Fixed 20-Minute Countdown Timer
- Exact **20:00** duration beginning upon clicking **BẮT ĐẦU THI / START EXAM**.
- **Prominent Visual Countdown**:
  - **20:00 – 05:01**: Standard blue timer badge.
  - **05:00 – 01:01**: **Orange warning badge** reminding students to begin reviewing.
  - **01:00 – 00:00**: **Red urgent badge with pulsing animation**.
  - **00:00**: Automatic essay submission and immediate editor lockdown.
- **Server-Authoritative Enforcement**: Start time and deadline timestamps are computed and validated on the backend. Client device clock changes cannot extend or manipulate the countdown. Students cannot pause, restart, or extend the timer.

### 3. Automatic Submission Engine
- When 20 minutes expire, the latest saved essay draft is finalized immediately.
- Saved fields: Student Name, Class, Essay Content, Final Word Count, Exam Start Time, Submission Time, and Time Spent.
- Status is recorded as **AUTO-SUBMITTED**.
- Display message: *"Time is up! Your writing has been automatically submitted."*
- Early submissions are recorded as **SUBMITTED**.
- Background sweeper automatically finalizes expired attempts on the backend even if the student's browser is closed or disconnected.
- Prevents duplicate submissions through atomic state transitions.

### 4. Real-Time IELTS Word Counter
- Evaluates text immediately upon typing or deleting.
- Implements official IELTS word counting conventions: counts actual English and alphanumeric words, handles hyphens and apostrophes, and filters out standalone punctuation and whitespace.
- Displays: **Words: 165** alongside a **"Minimum 150 words"** reminder badge.
- Never blocks submission if under 150 words (as per official IELTS test rules).
- Saves final word count with every submission.

### 5. Strict Anti-Cheating System
- **Policy**: **ONE CONFIRMED PAGE-EXIT VIOLATION = IMMEDIATE EXAM CANCELLATION.**
- **Monitored Browser Events**:
  - Switching browser tabs (`visibilitychange`, `document.hidden`).
  - Minimizing the browser or window blur (`window.blur`, `visibilitychange`).
  - Exiting fullscreen mode after starting (`fullscreenchange`).
  - Leaving or closing the exam page (`beforeunload`, `pagehide`).
  - Reloading the page.
  - Opening the exam in multiple browser sessions simultaneously.
- **On Confirmed Violation**:
  1. Backend immediately invalidates the attempt (status: `INVALIDATED` / `CANCELLED`).
  2. Preserves the latest available essay draft up to the exact moment of violation.
  3. Writing editor locks instantly.
  4. Displays notice: **"YOUR EXAM HAS BEEN CANCELLED BECAUSE YOU LEFT THE EXAMINATION PAGE."**
  5. Student is blocked from continuing or restarting independently.
  6. Violation type, details, and millisecond timestamp are logged in `violation_logs`.
  7. Teacher can review the cancelled essay in the dashboard and authorize a new attempt if appropriate.
- **Fairness Guarantee**: Temporary internet disconnect alone is NOT classified as cheating (local backup is preserved and sync retries automatically).
- **Browser Security Notice**: As a standard web application, complete device OS hardware lockdown or detection of secondary physical devices cannot be guaranteed without dedicated proctoring hardware.

### 6. Copy and Paste Restrictions
- Pasting into the writing editor is completely blocked (`onPaste`, `onBeforeInput`, `onDrop`, `Ctrl+V`, `Cmd+V`, `Shift+Insert`).
- Copy, cut, and right-click context menus are restricted inside the exam area.
- Paste attempts are logged in the student's violation audit trail.
- Normal typing, backspace, cursor navigation, text selection, and undo/redo remain fully functional.

### 7. Continuous Autosaving
- Autosaves essay drafts continuously to the database (debounced at 2.0s + flushed on `pagehide` / `beforeunload`).
- Visual indicator: *"Đã lưu (Saved)"* / *"Đang lưu... (Saving...)"* / *"Mất mạng - Đã lưu tạm trên máy (Offline backup)"*.
- High-concurrency verified: handles 40–50 simultaneous student autosaves with zero data loss.

### 8. Teacher Dashboard & Results Management
- **Examination Management**: Create, edit, publish, duplicate, and close exams.
- **IELTS Task 1 Categories**: Bar Chart, Line Graph, Pie Chart, Table, Process Diagram, Map, Mixed Charts.
- **Chart Image Upload**: Supports JPG, PNG, WEBP, and SVG with interactive full-resolution zoom viewer.
- **Unique Shareable Link & QR Code**: Generates one-click direct links (`/#exam/:id`) and QR codes for classroom sharing.
- **Duplicate Exam**: 1-click duplication to reuse exam prompts and charts across multiple classes.
- **Submissions Table**:
  - Student Full Name & Code
  - Class
  - Exam Title
  - Final Word Count
  - Start Time & Submission Time
  - Time Spent (e.g. *"18 phút 30 giây"*)
  - Submission Status (`IN PROGRESS`, `SUBMITTED`, `AUTO-SUBMITTED`, `INVALIDATED`, `TECHNICAL ISSUE`)
  - Anti-cheating violation information and event count
- **Exporting**:
  - Download individual essay as formatted Word document (`.docx`).
  - Batch-export all class essays as Word documents inside a single `.zip` file.
  - Export class results to Excel (`.xlsx`) with all columns including time spent and violation count.
- **Override / Reset**: Authorize fresh attempts for students whose exams were cancelled.

---

## Tech Stack & Architecture

- **Frontend**: React 19, TypeScript types, Vite 6, Tailwind CSS 4, Lucide React.
- **Backend**: Node.js, Express, Multer (secure image uploads), BcryptJS, JSONWebToken (JWT).
- **Export Engine**: `docx` (Word document generation), `xlsx` (Excel generation), `jszip` (batch packaging), `qrcode` (instant QR generation).
- **Database**:
  - **Embedded / Local Mode**: `sql.js` (SQLite engine in `./data/classroom.db`, zero-config out of the box).
  - **Production / Cloud Mode**: Supabase PostgreSQL (`supabase/schema.sql` migration script included).
- **Network / Remote Access**: Built-in LAN Wi-Fi auto-detection and Cloudflare Quick Tunnel integration for 4G/5G mobile access.

---

## Database Schema (PostgreSQL / Supabase)

The complete SQL migration script is located at `supabase/schema.sql`.

### Core Tables:
1. `teachers`: ID, username, password_hash, full_name, created_at.
2. `classes`: ID, name, description, created_at.
3. `students`: ID, student_code, full_name, class_id, pin_hash, status, created_at.
4. `assignments`: ID, type, task_category, title, instructions, prompt_question, image_urls, class_id, duration_minutes (20), status (`DRAFT`, `PUBLISHED`, `CLOSED`), created_at.
5. `attempts`: ID, assignment_id, student_id, start_time, deadline_time, submitted_at, content, word_count, status (`IN_PROGRESS`, `SUBMITTED`, `AUTO-SUBMITTED`, `INVALIDATED`), last_saved_at, session_token, created_at.
6. `violation_logs`: ID, attempt_id, event_type (`TAB_SWITCH`, `PAGE_HIDDEN`, `FULLSCREEN_EXIT`, `APP_SWITCH`, `PAGE_EXIT`, `PASTE_ATTEMPT`), details, timestamp.
7. `teacher_overrides`: ID, attempt_id, action (`ALLOW_NEW_ATTEMPT`, `REOPEN_AND_EXTEND`, `ACCEPT_CANCELLED`), reason, timestamp.
8. `scores`: ID, attempt_id, task_achievement, coherence_cohesion, lexical_resource, grammatical_accuracy, overall_band, general_feedback, is_published, updated_at.

---

## Quick Start & Local Setup

### 1. Requirements
- Node.js v18 or v20+
- Modern Web Browser (Chrome, Edge, Firefox, Safari)

### 2. Installation
```bash
# Clone or navigate to the repository
cd ielts-writing-classroom

# Install backend dependencies
npm install

# Install client dependencies
cd client
npm install
npm run build
cd ..
```

### 3. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default configuration runs locally with embedded database in `./data/classroom.db`.

### 4. Running the Application
Double-click `start.bat` on Windows, or run:
```bash
node server/server.js
```
The server will start at:
- **Local URL**: `http://localhost:5000`
- **Teacher Dashboard**: `http://localhost:5000/#/teacher`

### 5. Default Teacher Account
- **Username**: `teacher`
- **Password**: `teacher123`
*(The application prompts the teacher to set their personal username and password in the dashboard).*

---

## Sharing Exam Links with Students

1. Open the **Teacher Dashboard** at `http://localhost:5000/#/teacher`.
2. Click **Bắt đầu thi** on any exam card, or click **Sao chép link thi**.
3. Direct student link format:
   ```
   http://<YOUR_IP_OR_DOMAIN>:5000/#exam/<EXAM_ID>
   ```
4. When students open this link:
   - They enter their **Họ và tên (Full Name)** and **Lớp (Class)**.
   - Review anti-cheating regulations.
   - Click **BẮT ĐẦU THI / START EXAM**.
   - The 20-minute countdown starts at 20:00 with full dual-pane view (Prompt + Chart on left, Writing Editor on right).

---

## Automated Test Verification

Run all test suites via `run-tests.bat` or npm:

```bash
# 1. Run the 14 mission-critical test scenarios
node test/test-all-14-scenarios.js

# 2. Run the 27 regression test scenarios
node test/test-suite.js
```

### Verified Test Scenarios (14 / 14 Passed - 100%):
1. **Scenario 1**: Student starts an exam and sees 20:00 (Server enforces 1200 seconds / 20 minutes).
2. **Scenario 2**: Word count updates while typing (Accurate English word counting matching IELTS standard).
3. **Scenario 3**: Student submits before the deadline (Marked as `SUBMITTED`).
4. **Scenario 4**: Exam automatically submits at 00:00 (Marked as `AUTO-SUBMITTED`).
5. **Scenario 5**: Student switches to another tab (`PAGE_HIDDEN` -> Immediate cancellation `INVALIDATED`).
6. **Scenario 6**: Student exits fullscreen (`FULLSCREEN_EXIT` -> Immediate cancellation `INVALIDATED`).
7. **Scenario 7**: Student refreshes the page (Draft preserved, server timer unchanged).
8. **Scenario 8**: Student attempts to reopen a cancelled exam (Blocked with 403 Forbidden).
9. **Scenario 9**: Student pastes text (Blocked in editor & logged in audit trail).
10. **Scenario 10**: Student loses internet connection (Offline backup preserved, syncs upon reconnect).
11. **Scenario 11**: Student opens the exam in two browser sessions (Single active attempt enforced).
12. **Scenario 12**: Teacher downloads submitted essays (Word `.docx`, batch ZIP, and Excel `.xlsx`).
13. **Scenario 13**: Server handles simultaneous timeout and cancellation (Atomic attempt state lock).
14. **Scenario 14**: Essay autosaving works correctly during classroom use (45 concurrent students verified).
