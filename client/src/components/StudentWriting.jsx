import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiRequest, countWordsClient, getStudentToken, setStudentToken, TASK_1_CATEGORIES } from '../api';
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Send,
  ShieldAlert,
  Loader2,
  RefreshCw,
  FileText,
  ZoomIn,
  X,
  Maximize2,
  Minimize2,
  Lock,
  WifiOff,
  UserCheck
} from 'lucide-react';

function getDraftBackupKey(attemptId) {
  return `ielts_draft_backup_${attemptId}`;
}

function saveLocalDraftBackup(attemptId, content) {
  if (!attemptId) return;
  try {
    localStorage.setItem(
      getDraftBackupKey(attemptId),
      JSON.stringify({ content, savedAt: Date.now() })
    );
  } catch (_) {}
}

function readLocalDraftBackup(attemptId) {
  if (!attemptId) return null;
  try {
    const raw = localStorage.getItem(getDraftBackupKey(attemptId));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function clearLocalDraftBackup(attemptId) {
  if (!attemptId) return;
  try {
    localStorage.removeItem(getDraftBackupKey(attemptId));
  } catch (_) {}
}

function sendKeepAlivePost(endpoint, payload) {
  const token = getStudentToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(`/api${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    keepalive: true
  });
}

export default function StudentWriting({ assignmentId, student: initialStudent, onSelectAssignment }) {
  const [assignment, setAssignment] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [activeStudent, setActiveStudent] = useState(initialStudent || null);
  const [content, setContent] = useState('');
  const [wordCount, setWordCount] = useState(0);

  // Status & Timers
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('Đã lưu');
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(null);
  const [serverTimeDelta, setServerTimeDelta] = useState(0);

  // Modals & UI States
  const [showPreStartModal, setShowPreStartModal] = useState(false);
  const [hasAgreedRules, setHasAgreedRules] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showImageZoom, setShowImageZoom] = useState(false);
  const [selectedZoomImage, setSelectedZoomImage] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Direct Student Start Form (when opening shared link without an account)
  const [directFullName, setDirectFullName] = useState('');
  const [directClassName, setDirectClassName] = useState('');
  const [availableClasses, setAvailableClasses] = useState([]);
  const [startingDirectExam, setStartingDirectExam] = useState(false);

  // Refs for race-free access inside event listeners & timers
  const attemptRef = useRef(null);
  const contentRef = useRef('');
  const saveTimeoutRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const isCancelledRef = useRef(false);
  const isSubmittingRef = useRef(false);
  const toastTimeoutRef = useRef(null);
  const enteredFullscreenRef = useRef(false);

  attemptRef.current = attempt;
  contentRef.current = content;

  function showToast(msg) {
    setToastMessage(msg);
    clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(''), 4000);
  }

  useEffect(() => {
    isCancelledRef.current = false;
    isSubmittingRef.current = false;
    loadExamData();
    return () => {
      clearInterval(timerIntervalRef.current);
      clearTimeout(saveTimeoutRef.current);
      clearTimeout(toastTimeoutRef.current);
    };
  }, [assignmentId]);

  async function loadExamData() {
    setLoading(true);
    setError('');
    try {
      // Sync server time
      try {
        const timeRes = await apiRequest('/time');
        if (timeRes && timeRes.serverTime) {
          setServerTimeDelta(timeRes.serverTime - Date.now());
        }
      } catch (_) {}

      // If already has student token and logged in
      const currentToken = getStudentToken();
      if (currentToken) {
        try {
          const data = await apiRequest(`/student/assignments/${assignmentId}`);
          setAssignment(data.assignment);

          if (data.attempt) {
            const loadedAttempt = data.attempt;
            isCancelledRef.current = ['CANCELLED', 'INVALIDATED'].includes(loadedAttempt.status);

            if (loadedAttempt.status === 'IN_PROGRESS') {
              let initialText = loadedAttempt.content || '';
              let initialWords = loadedAttempt.word_count || countWordsClient(initialText);

              // Recover local backup if newer
              const localBackup = readLocalDraftBackup(loadedAttempt.id);
              if (
                localBackup &&
                typeof localBackup.content === 'string' &&
                localBackup.savedAt > (loadedAttempt.last_saved_at || 0) &&
                localBackup.content !== initialText
              ) {
                initialText = localBackup.content;
                initialWords = countWordsClient(initialText);
                apiRequest(`/student/attempts/${loadedAttempt.id}/draft`, 'POST', {
                  content: initialText
                }).catch(() => {});
              }

              setAttempt(loadedAttempt);
              setContent(initialText);
              setWordCount(initialWords);
              setShowPreStartModal(false);
              startClientCountdown(loadedAttempt.deadline_time);
            } else {
              clearLocalDraftBackup(loadedAttempt.id);
              setAttempt(loadedAttempt);
              setContent(loadedAttempt.content || '');
              setWordCount(loadedAttempt.word_count || countWordsClient(loadedAttempt.content || ''));
              setShowPreStartModal(false);
            }
            setLoading(false);
            return;
          }
        } catch (_) {
          // If token expired or invalid for this assignment, fallback to public info
        }
      }

      // Load public exam info for direct link access
      const pubRes = await apiRequest(`/exam/${assignmentId}/public`);
      setAssignment(pubRes.assignment);
      setAvailableClasses(pubRes.classes || []);
      if (pubRes.classes && pubRes.classes.length > 0 && !directClassName) {
        setDirectClassName(pubRes.assignment?.class_name || pubRes.classes[0].name);
      }
      setAttempt(null);
      setContent('');
      setWordCount(0);
      setShowPreStartModal(true);
    } catch (err) {
      setError(err.message || 'Không thể tải đề thi IELTS Ms Nga');
    } finally {
      setLoading(false);
    }
  }

  function startClientCountdown(deadlineTime) {
    if (!deadlineTime) return;
    clearInterval(timerIntervalRef.current);

    const updateTimer = () => {
      const currentServerTime = Date.now() + serverTimeDelta;
      const remaining = Math.max(0, Math.floor((deadlineTime - currentServerTime) / 1000));
      setTimeLeftSeconds(remaining);

      if (remaining <= 0) {
        clearInterval(timerIntervalRef.current);
        handleTimeExpired();
      }
    };

    updateTimer();
    timerIntervalRef.current = setInterval(updateTimer, 1000);
  }

  // Automatic submission when 20:00 reaches 00:00
  async function handleTimeExpired() {
    if (!attemptRef.current || attemptRef.current.status !== 'IN_PROGRESS' || isSubmittingRef.current || isCancelledRef.current) {
      return;
    }
    isSubmittingRef.current = true;
    try {
      setSaveStatus('Hết giờ - Đang tự động nộp bài...');
      const res = await apiRequest(`/student/attempts/${attemptRef.current.id}/submit`, 'POST', {
        content: contentRef.current,
        isAutoSubmit: true
      });
      clearLocalDraftBackup(attemptRef.current.id);
      setAttempt((prev) => ({
        ...prev,
        status: 'AUTO-SUBMITTED',
        content: contentRef.current,
        word_count: res.wordCount,
        submitted_at: res.submittedAt
      }));
      showToast('Time is up! Your writing has been automatically submitted.');
    } catch (err) {
      isSubmittingRef.current = false;
      console.error('Submit on expired error:', err);
    }
  }

  // Direct student registration & exam start from shared link
  async function handleStartDirectExam(e) {
    if (e) e.preventDefault();
    if (!directFullName.trim()) {
      showToast('Vui lòng nhập Họ và Tên của bạn');
      return;
    }
    if (!directClassName.trim()) {
      showToast('Vui lòng chọn hoặc nhập Lớp học');
      return;
    }
    if (!hasAgreedRules) {
      showToast('Vui lòng đồng ý với Quy chế thi phòng chống gian lận');
      return;
    }

    setStartingDirectExam(true);
    setError('');

    // Request fullscreen mode for strict exam environment (gracefully handles mobile browsers, Safari, or headless env)
    try {
      if (typeof document.documentElement?.requestFullscreen === 'function') {
        const fsPromise = document.documentElement.requestFullscreen();
        if (fsPromise && typeof fsPromise.then === 'function') {
          await Promise.race([
            fsPromise.then(() => {
              enteredFullscreenRef.current = true;
              setIsFullscreen(true);
            }).catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, 600))
          ]);
        }
      }
    } catch (_) {
      // Browser or mobile policy might restrict automatic fullscreen
    }

    try {
      const res = await apiRequest(`/exam/${assignmentId}/start-direct`, 'POST', {
        fullName: directFullName.trim(),
        className: directClassName.trim()
      });

      setStudentToken(res.token);
      setActiveStudent(res.student);
      setAssignment(res.assignment);
      setAttempt(res.attempt);
      setContent(res.attempt.content || '');
      setWordCount(res.attempt.word_count || 0);
      setShowPreStartModal(false);

      if (res.serverTime) {
        setServerTimeDelta(res.serverTime - Date.now());
      }

      isCancelledRef.current = ['CANCELLED', 'INVALIDATED'].includes(res.attempt.status);

      if (res.attempt.status === 'IN_PROGRESS') {
        startClientCountdown(res.attempt.deadline_time);
        showToast('Bắt đầu tính giờ thi 20 phút. Chúc bạn làm bài tốt!');
      }
    } catch (err) {
      if (err.message && (err.message.includes('CANCELLED') || err.message.includes('hủy'))) {
        isCancelledRef.current = true;
      }
      setError(err.message || 'Không thể bắt đầu buổi thi');
    } finally {
      setStartingDirectExam(false);
    }
  }

  const triggerAutoSave = useCallback((newText) => {
    const activeAttempt = attemptRef.current;
    if (!activeAttempt || activeAttempt.status !== 'IN_PROGRESS' || isCancelledRef.current) {
      return;
    }

    saveLocalDraftBackup(activeAttempt.id, newText);
    setSaveStatus('Đang lưu...');
    clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      if (!attemptRef.current || attemptRef.current.status !== 'IN_PROGRESS' || isCancelledRef.current) {
        return;
      }
      try {
        const res = await apiRequest(`/student/attempts/${attemptRef.current.id}/draft`, 'POST', {
          content: newText
        });
        setSaveStatus('Saved successfully / Đã lưu thành công');
        setLastSavedTime(new Date().toLocaleTimeString('vi-VN'));
        if (typeof res.wordCount === 'number') {
          setWordCount(res.wordCount);
        }
      } catch (err) {
        console.error('Auto-save error:', err);
        if (err.message && (err.message.includes('hủy') || err.message.includes('CANCELLED') || err.message.includes('INVALIDATED'))) {
          isCancelledRef.current = true;
          clearInterval(timerIntervalRef.current);
          setAttempt((prev) => (prev ? { ...prev, status: 'INVALIDATED' } : prev));
        } else {
          setSaveStatus('Mất mạng - Đã lưu tạm trên máy');
        }
      }
    }, 2000); // 2s debounce for fast autosave
  }, []);

  function handleTextChange(e) {
    if (!attempt || attempt.status !== 'IN_PROGRESS' || isCancelledRef.current) return;
    const newText = e.target.value;
    setContent(newText);
    const count = countWordsClient(newText);
    setWordCount(count);
    triggerAutoSave(newText);
  }

  // ==========================================
  // STRICT ANTI-CHEATING SYSTEM
  // ONE CONFIRMED PAGE-EXIT VIOLATION = IMMEDIATE EXAM CANCELLATION
  // ==========================================
  useEffect(() => {
    if (!attempt || attempt.status !== 'IN_PROGRESS' || isCancelledRef.current) {
      return;
    }

    const triggerImmediateCancel = (eventType, details) => {
      if (isCancelledRef.current || isSubmittingRef.current || !attemptRef.current) return;
      if (attemptRef.current.status !== 'IN_PROGRESS') return;

      isCancelledRef.current = true;
      clearTimeout(saveTimeoutRef.current);
      clearInterval(timerIntervalRef.current);

      // Immediately lock UI locally
      const latestText = contentRef.current;
      const latestWords = countWordsClient(latestText);
      const attemptId = attemptRef.current.id;
      clearLocalDraftBackup(attemptId);

      setAttempt((prev) =>
        prev
          ? { ...prev, status: 'INVALIDATED', content: latestText, word_count: latestWords }
          : prev
      );

      // Deliver cancellation packet with keepalive: true so browser finishes sending while leaving page
      sendKeepAlivePost(`/student/attempts/${attemptId}/violation`, {
        eventType,
        details,
        currentContent: latestText
      }).catch((err) => {
        console.error('Violation report error:', err);
      });
    };

    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        triggerImmediateCancel(
          'PAGE_HIDDEN',
          'Phát hiện học sinh rời khỏi màn hình thi Writing, đổi tab hoặc chuyển sang ứng dụng khác'
        );
      }
    };

    const handleWindowBlur = () => {
      // In case student clicks outside or minimizes window
      if (document.hidden || document.visibilityState === 'hidden') {
        triggerImmediateCancel(
          'BROWSER_MINIMIZE',
          'Phát hiện học sinh thu nhỏ trình duyệt hoặc đổi cửa sổ làm bài'
        );
      }
    };

    const handleFullscreenChange = () => {
      const inFs = Boolean(document.fullscreenElement);
      setIsFullscreen(inFs);
      if (enteredFullscreenRef.current && !inFs && attemptRef.current?.status === 'IN_PROGRESS' && !isCancelledRef.current && !isSubmittingRef.current) {
        triggerImmediateCancel(
          'FULLSCREEN_EXIT',
          'Phát hiện học sinh thoát khỏi chế độ toàn màn hình (Fullscreen) trong lúc làm bài thi'
        );
      }
    };

    const handleFreeze = () => {
      triggerImmediateCancel(
        'APP_SWITCH',
        'Trình duyệt bị chuyển xuống nền trên thiết bị khi đang làm bài'
      );
    };

    const handlePageHide = () => {
      if (attemptRef.current && attemptRef.current.status === 'IN_PROGRESS' && !isCancelledRef.current && !isSubmittingRef.current) {
        saveLocalDraftBackup(attemptRef.current.id, contentRef.current);
        sendKeepAlivePost(`/student/attempts/${attemptRef.current.id}/draft`, {
          content: contentRef.current
        }).catch(() => {});
        triggerImmediateCancel(
          'PAGE_EXIT',
          'Phát hiện học sinh đóng trang hoặc rời khỏi bài thi'
        );
      }
    };

    const handleBeforeUnload = (e) => {
      if (attemptRef.current && attemptRef.current.status === 'IN_PROGRESS' && !isCancelledRef.current && !isSubmittingRef.current) {
        saveLocalDraftBackup(attemptRef.current.id, contentRef.current);
        sendKeepAlivePost(`/student/attempts/${attemptRef.current.id}/draft`, {
          content: contentRef.current
        }).catch(() => {});
        e.preventDefault();
        e.returnValue = 'Bạn đang trong giờ làm bài Writing Task 1. Rời khỏi trang sẽ làm BÀI THI BỊ HỦY!';
        return e.returnValue;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('freeze', handleFreeze);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('freeze', handleFreeze);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [attempt?.status, attempt?.id]);

  // Copy & Paste Restrictions
  function recordPasteViolation() {
    showToast('⚠️ Chức năng Dán (Paste) đã bị khóa theo quy chế thi IELTS Ms Nga!');
    if (attemptRef.current && attemptRef.current.status === 'IN_PROGRESS' && !isCancelledRef.current) {
      apiRequest(`/student/attempts/${attemptRef.current.id}/violation`, 'POST', {
        eventType: 'PASTE_ATTEMPT',
        details: 'Cố ý dán văn bản vào khung bài viết Task 1',
        currentContent: contentRef.current
      }).catch(() => {});
    }
  }

  function handlePasteAttempt(e) {
    e.preventDefault();
    recordPasteViolation();
  }

  function handleBeforeInput(e) {
    const inputType = (e?.nativeEvent?.inputType || '').toLowerCase();
    if (inputType.includes('paste') || inputType.includes('drop')) {
      e.preventDefault();
      recordPasteViolation();
    }
  }

  function handleKeyDown(e) {
    const key = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'v') {
      e.preventDefault();
      recordPasteViolation();
    } else if (e.shiftKey && e.key === 'Insert') {
      e.preventDefault();
      recordPasteViolation();
    }
  }

  function handleCopyCut(e) {
    // Restrict copying essay content out of the exam environment
    e.preventDefault();
    showToast('⚠️ Không được sao chép nội dung bài làm ra ngoài!');
  }

  // Early submission by student
  async function handleFinalSubmit() {
    if (!attempt || attempt.status !== 'IN_PROGRESS' || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSubmitting(true);
    try {
      clearTimeout(saveTimeoutRef.current);
      const res = await apiRequest(`/student/attempts/${attempt.id}/submit`, 'POST', {
        content: contentRef.current,
        isAutoSubmit: false
      });
      clearInterval(timerIntervalRef.current);
      clearLocalDraftBackup(attempt.id);
      setAttempt((prev) => ({
        ...prev,
        status: 'SUBMITTED',
        content: contentRef.current,
        word_count: res.wordCount,
        submitted_at: res.submittedAt
      }));
      setShowSubmitConfirm(false);
      showToast('Nộp bài thành công!');
    } catch (err) {
      isSubmittingRef.current = false;
      showToast('Không thể nộp bài: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function formatTime(totalSec) {
    if (totalSec === null || totalSec === undefined) return '20:00';
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // Determine Timer Color Badge:
  // <= 60s -> Red + pulse
  // <= 300s (05:00) -> Orange
  // else -> Blue
  function getTimerBadgeClass() {
    if (timeLeftSeconds === null) return 'bg-blue-50 text-blue-700 border-blue-200';
    if (timeLeftSeconds <= 60) {
      return 'bg-red-100 text-red-700 border-red-300 animate-pulse';
    }
    if (timeLeftSeconds <= 300) {
      return 'bg-amber-100 text-amber-800 border-amber-300';
    }
    return 'bg-blue-50 text-blue-700 border-blue-200';
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="w-9 h-9 text-blue-600 animate-spin mx-auto mb-3" />
          <h2 className="text-base font-bold text-slate-800">IELTS Ms Nga</h2>
          <p className="text-slate-500 text-xs mt-1">Đang tải đề thi Writing Task 1...</p>
        </div>
      </div>
    );
  }

  if (error && !attempt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="max-w-md w-full bg-white p-6 sm:p-8 rounded-2xl shadow-lg border border-slate-200 text-center">
          <div className="w-14 h-14 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Thông Báo Kỳ Thi</h2>
          <p className="text-slate-600 text-sm mb-6 leading-relaxed">{error}</p>
          {onSelectAssignment ? (
            <button
              onClick={onSelectAssignment}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm cursor-pointer shadow-md transition-all"
            >
              Quay lại danh sách
            </button>
          ) : (
            <button
              onClick={loadExamData}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm cursor-pointer shadow-md transition-all"
            >
              Tải lại trang thi
            </button>
          )}
        </div>
      </div>
    );
  }

  const isWritingActive = attempt?.status === 'IN_PROGRESS';
  const isCancelled = ['CANCELLED', 'INVALIDATED'].includes(attempt?.status);
  const isSubmitted = attempt?.status === 'SUBMITTED';
  const isAutoSubmitted = ['AUTO-SUBMITTED', 'AUTO_SUBMITTED', 'EXPIRED'].includes(attempt?.status);
  const chartImages = assignment?.image_urls || [];

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans select-none">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 text-white px-5 py-2.5 rounded-full text-xs sm:text-sm font-medium shadow-xl backdrop-blur-md text-center max-w-[92vw] border border-slate-700 transition-all">
          {toastMessage}
        </div>
      )}

      {/* Top Sticky Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-3 sm:px-6 py-2.5 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          {/* Left: Brand & Student Details */}
          <div className="flex items-center gap-3 min-w-0">
            {onSelectAssignment && !isWritingActive && (
              <button
                onClick={onSelectAssignment}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer"
              >
                ← Quay lại
              </button>
            )}
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 bg-blue-600 text-white rounded-lg flex items-center justify-center font-black text-xs shadow-xs">
                N
              </span>
              <div className="leading-tight">
                <span className="font-extrabold text-blue-900 text-sm sm:text-base tracking-tight">
                  IELTS Ms Nga
                </span>
                <span className="hidden sm:inline text-xs text-slate-400 font-normal ml-2 border-l border-slate-200 pl-2">
                  Academic Writing Task 1
                </span>
              </div>
            </div>

            {/* Student identity badge */}
            {(activeStudent || initialStudent) && (
              <div className="hidden md:flex items-center gap-1.5 bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-200 truncate max-w-[200px]">
                <UserCheck className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                <span className="truncate">
                  {activeStudent?.fullName || initialStudent?.fullName} ({activeStudent?.className || initialStudent?.className})
                </span>
              </div>
            )}
          </div>

          {/* Center: Live Word Counter */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 rounded-lg border border-slate-200 text-slate-800 text-xs sm:text-sm font-bold">
              <span>Words: {wordCount}</span>
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                  wordCount >= 150
                    ? 'bg-green-100 text-green-700 border border-green-200'
                    : 'bg-slate-200 text-slate-600'
                }`}
                title="Yêu cầu tối thiểu 150 từ cho IELTS Task 1 (vẫn nộp được nếu dưới 150 từ)"
              >
                Min 150
              </span>
            </div>

            {isWritingActive && (
              <span className="text-[11px] text-slate-500 font-medium hidden lg:inline">
                {saveStatus}
              </span>
            )}
          </div>

          {/* Right: 20-Minute Countdown Timer & Submit Button */}
          <div className="flex items-center gap-2 sm:gap-3">
            {isWritingActive && (
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono font-bold text-xs sm:text-base border shadow-2xs transition-colors ${getTimerBadgeClass()}`}
              >
                <Clock className="w-4 h-4 flex-shrink-0" />
                <span>{formatTime(timeLeftSeconds)}</span>
              </div>
            )}

            {isWritingActive && (
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(true)}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs sm:text-sm font-bold shadow-xs flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <Send className="w-3.5 h-3.5" />
                <span>SUBMIT</span>
              </button>
            )}

            {isSubmitted && (
              <span className="px-3 py-1 bg-green-100 text-green-800 border border-green-200 rounded-lg text-xs font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> SUBMITTED
              </span>
            )}

            {isAutoSubmitted && (
              <span className="px-3 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-bold flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> AUTO-SUBMITTED
              </span>
            )}

            {isCancelled && (
              <span className="px-3 py-1 bg-red-100 text-red-800 border border-red-300 rounded-lg text-xs font-bold flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5" /> INVALIDATED
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Dual-Pane Examination Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 flex flex-col gap-4">
        {/* Banner if Cancelled / Invalidated */}
        {isCancelled && (
          <div className="p-5 bg-red-50 border-2 border-red-400 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
            <div className="flex items-start gap-3.5">
              <ShieldAlert className="w-8 h-8 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-extrabold text-red-900 text-sm sm:text-base tracking-wide uppercase">
                  YOUR EXAM HAS BEEN CANCELLED BECAUSE YOU LEFT THE EXAMINATION PAGE.
                </h3>
                <p className="text-red-700 text-xs sm:text-sm mt-1.5 leading-relaxed">
                  BÀI THI CỦA BẠN ĐÃ BỊ HỦY DO HỆ THỐNG PHÁT HIỆN RỜI KHỎI TRANG THI (chuyển tab, thu nhỏ trình duyệt, thoát toàn màn hình hoặc mở ứng dụng khác).
                  <br />
                  <span className="text-red-800 font-medium">
                    Toàn bộ nội dung đã viết của bạn ({attempt?.word_count ?? wordCount} từ) đã được lưu lại để giáo viên xem xét. Bạn không thể tự làm tiếp hoặc khởi động lại nếu không có sự phê duyệt của giáo viên.
                  </span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={loadExamData}
              className="self-start sm:self-center px-4 py-2 bg-white hover:bg-red-100 text-red-700 border border-red-300 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-xs transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Kiểm tra lại trạng thái</span>
            </button>
          </div>
        )}

        {/* Banner if Auto-Submitted */}
        {isAutoSubmitted && (
          <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl flex items-start gap-3.5 shadow-2xs">
            <Clock className="w-7 h-7 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-amber-900 text-sm sm:text-base">
                Time is up! Your writing has been automatically submitted.
              </h3>
              <p className="text-amber-800 text-xs sm:text-sm mt-1 leading-relaxed">
                Đã hết 20 phút thời gian làm bài thi! Toàn bộ nội dung bài viết được lưu gần nhất ({attempt?.word_count ?? wordCount} từ) đã được tự động nộp thành công cho giáo viên.
              </p>
            </div>
          </div>
        )}

        {/* Banner if Early Submitted */}
        {isSubmitted && (
          <div className="p-4 bg-green-50 border-2 border-green-300 rounded-2xl flex items-start gap-3.5 shadow-2xs">
            <CheckCircle2 className="w-7 h-7 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-green-900 text-sm sm:text-base">
                Bài viết đã được nộp thành công (SUBMITTED)
              </h3>
              <p className="text-green-800 text-xs sm:text-sm mt-1">
                Thời gian nộp: {attempt?.submitted_at ? new Date(attempt.submitted_at).toLocaleString('vi-VN') : ''} • Tổng số từ: <strong>{attempt?.word_count ?? wordCount} từ</strong>. Giáo viên sẽ tiến hành chấm theo 4 tiêu chí IELTS.
              </p>
            </div>
          </div>
        )}

        {/* Dual-Pane Layout: Left Pane = Prompt & Chart, Right Pane = Writing Area */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch min-h-[580px]">
          {/* LEFT PANE: Task 1 Instructions, Question Prompt & Chart Image */}
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto max-h-[calc(100vh-140px)]">
            {/* Header info */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 gap-2">
              <span className="px-2.5 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-lg uppercase tracking-wide">
                {TASK_1_CATEGORIES[assignment?.task_category] || assignment?.task_category || 'Writing Task 1'}
              </span>
              <span className="text-xs text-slate-500 font-medium">
                Thời gian: 20 phút • Tối thiểu: 150 từ
              </span>
            </div>

            {/* IELTS Task 1 Standard Instructions Box */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-700 italic space-y-1">
              <p>You should spend about <strong>20 minutes</strong> on this task.</p>
              <p>Write at least <strong>150 words</strong>.</p>
            </div>

            {/* Question Prompt */}
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-tight mb-1 text-blue-900">
                {assignment?.title}
              </h2>
              <p className="text-sm sm:text-base text-slate-800 leading-relaxed font-serif whitespace-pre-line">
                {assignment?.prompt_question || 'The chart below shows information about the topic. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.'}
              </p>
            </div>

            {/* Uploaded Chart Image Display */}
            {chartImages.length > 0 ? (
              <div className="mt-1 flex-1 flex flex-col">
                <div className="text-xs font-semibold text-slate-500 mb-2 flex items-center justify-between">
                  <span>Biểu đồ / Chart:</span>
                  <span className="text-blue-600 text-[11px]">Bấm vào ảnh để phóng to</span>
                </div>
                <div className="space-y-3">
                  {chartImages.map((imgUrl, idx) => (
                    <div
                      key={idx}
                      className="relative group border border-slate-200 rounded-xl overflow-hidden bg-slate-50 p-2 text-center cursor-zoom-in hover:border-blue-400 transition-colors shadow-2xs"
                      onClick={() => {
                        setSelectedZoomImage(imgUrl);
                        setShowImageZoom(true);
                      }}
                    >
                      <img
                        src={imgUrl}
                        alt={`IELTS Task 1 Chart ${idx + 1}`}
                        className="max-h-[360px] w-auto mx-auto object-contain rounded-lg"
                      />
                      <button
                        type="button"
                        className="absolute bottom-3 right-3 px-2.5 py-1.5 bg-slate-900/80 hover:bg-slate-900 text-white text-xs font-medium rounded-lg flex items-center gap-1 shadow-md backdrop-blur-xs transition-opacity"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                        <span>Phóng to</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-6 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center text-xs text-slate-400">
                (Đề bài không đính kèm ảnh biểu đồ điện tử • Vui lòng quan sát đề phát trên lớp)
              </div>
            )}
          </div>

          {/* RIGHT PANE: Writing Editor & Anti-Paste System */}
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-4 sm:p-5 flex flex-col justify-between">
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-slate-100 text-xs">
                <span className="font-bold text-slate-700 uppercase tracking-tight flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-blue-600" />
                  <span>Khung Viết Bài / Writing Area</span>
                </span>
                <span className="text-slate-400 text-[11px]">
                  {isWritingActive ? 'Đang bật tự động lưu • Chặn Paste' : 'Chế độ chỉ đọc'}
                </span>
              </div>

              {/* Textarea */}
              <textarea
                value={content}
                onChange={handleTextChange}
                onPaste={handlePasteAttempt}
                onBeforeInput={handleBeforeInput}
                onKeyDown={handleKeyDown}
                onCopy={handleCopyCut}
                onCut={handleCopyCut}
                onContextMenu={(e) => {
                  if (isWritingActive) {
                    e.preventDefault();
                    showToast('⚠️ Menu ngữ cảnh chuột phải bị hạn chế trong phòng thi!');
                  }
                }}
                onDrop={(e) => e.preventDefault()}
                disabled={!isWritingActive}
                placeholder={
                  isWritingActive
                    ? 'Write your IELTS Academic Task 1 essay here...\n\n(Lưu ý: Không chuyển tab hoặc rời màn hình làm bài vì hệ thống sẽ lập tức HỦY bài thi).'
                    : '(Bài viết đang ở chế độ xem lại / đã kết thúc)'
                }
                className={`flex-1 w-full min-h-[380px] p-3.5 text-slate-900 ielts-writing-textarea rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all ${
                  !isWritingActive ? 'bg-slate-50 cursor-not-allowed opacity-90' : 'bg-white'
                }`}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>

            {/* Bottom Status Bar */}
            <div className="pt-3 mt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <span className="font-black text-slate-900 text-sm tracking-tight">
                  WORDS: {wordCount}
                </span>
                <span
                  className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold ${
                    wordCount >= 150
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-amber-100 text-amber-900 border border-amber-300'
                  }`}
                >
                  {wordCount >= 150 ? '✓ Đạt chuẩn 150 từ' : 'Minimum recommended: 150 words (Tối thiểu 150 từ)'}
                </span>
              </div>

              <div className="flex items-center gap-3">
                {lastSavedTime && (
                  <span className="text-slate-400 text-[11px] hidden sm:inline">
                    Lưu lúc: {lastSavedTime}
                  </span>
                )}
                {isWritingActive && (
                  <button
                    type="button"
                    onClick={() => setShowSubmitConfirm(true)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Nộp Bài (Submit)</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Disclaimer / Browser limitations note */}
        <div className="text-center text-[11px] text-slate-400 py-1">
          IELTS Ms Nga Examination System • Lưu ý: Ứng dụng web kiểm soát chuyển tab & rời trang; học sinh cần tuân thủ nghiêm túc sự giám sát của giáo viên tại phòng thi.
        </div>
      </main>

      {/* Direct Student Entry / Pre-Start Rules Modal */}
      {showPreStartModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-6">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-700 to-blue-600 px-6 py-5 text-white flex items-center gap-3.5">
              <div className="w-10 h-10 bg-white/15 rounded-2xl flex items-center justify-center font-black text-lg">
                N
              </div>
              <div>
                <h3 className="font-extrabold text-lg sm:text-xl">IELTS Ms Nga - Phòng Thi Writing</h3>
                <p className="text-blue-100 text-xs">IELTS Academic Writing Task 1 • Thời gian: 20 phút</p>
              </div>
            </div>

            {/* Form & Rules */}
            <form onSubmit={handleStartDirectExam} className="p-6 sm:p-7 space-y-4">
              <div>
                <h4 className="text-base font-bold text-slate-900 mb-1">
                  {assignment?.title || 'Đề thi IELTS Academic Task 1'}
                </h4>
                <p className="text-xs text-slate-500">
                  Vui lòng điền đúng Họ tên và Lớp của bạn trước khi bấm bắt đầu làm bài.
                </p>
              </div>

              {/* Student Identification Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Họ và Tên học sinh <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={directFullName}
                    onChange={(e) => setDirectFullName(e.target.value)}
                    placeholder="Ví dụ: Nguyễn Văn An"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Lớp học <span className="text-red-500">*</span>
                  </label>
                  {availableClasses.length > 0 ? (
                    <div className="relative">
                      <input
                        type="text"
                        list="classListOptions"
                        required
                        value={directClassName}
                        onChange={(e) => setDirectClassName(e.target.value)}
                        placeholder="Chọn hoặc nhập tên lớp..."
                        className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                      />
                      <datalist id="classListOptions">
                        {availableClasses.map((c) => (
                          <option key={c.id} value={c.name} />
                        ))}
                      </datalist>
                    </div>
                  ) : (
                    <input
                      type="text"
                      required
                      value={directClassName}
                      onChange={(e) => setDirectClassName(e.target.value)}
                      placeholder="Ví dụ: 12A1"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                    />
                  )}
                </div>
              </div>

              {/* Strict Anti-Cheating Warning Box (Requirement 5) */}
              <div className="p-4 bg-red-50 border-2 border-red-300 rounded-2xl text-xs text-red-950 space-y-2 leading-relaxed">
                <div className="flex items-center gap-1.5 font-black text-red-800 text-sm">
                  <ShieldAlert className="w-4 h-4 text-red-600" />
                  <span>QUY ĐỊNH PHÒNG THI & CHÍNH SÁCH CHỐNG GIAN LẬN:</span>
                </div>
                <div className="p-3 bg-red-100/80 rounded-xl text-red-950 font-bold border border-red-200">
                  "Trong quá trình làm bài, học sinh không được chuyển tab, mở trang web khác, thu nhỏ trình duyệt hoặc thoát chế độ toàn màn hình. Nếu hệ thống phát hiện một lần rời trang làm bài, bài thi sẽ bị hủy ngay lập tức. Học sinh không được tiếp tục nếu chưa có sự cho phép của giáo viên."
                </div>
                <ul className="list-disc pl-5 space-y-1 text-red-800 text-[11px] font-medium">
                  <li>Không chuyển tab hoặc mở ứng dụng khác trên thiết bị.</li>
                  <li>Không thoát chế độ toàn màn hình (Fullscreen) sau khi bấm bắt đầu.</li>
                  <li>Không tải lại (F5) trang khi đang làm bài.</li>
                  <li>Chức năng dán văn bản (Paste) bị vô hiệu hóa hoàn toàn trong khung viết.</li>
                </ul>
              </div>

              {/* Agreement Checkbox */}
              <label className="flex items-start gap-3 p-3 bg-blue-50/70 border border-blue-200 rounded-xl cursor-pointer hover:bg-blue-50 transition-colors">
                <input
                  type="checkbox"
                  required
                  checked={hasAgreedRules}
                  onChange={(e) => setHasAgreedRules(e.target.checked)}
                  className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 mt-0.5 cursor-pointer flex-shrink-0"
                />
                <span className="text-xs sm:text-sm font-semibold text-slate-800">
                  Tôi đã đọc rõ quy định phòng thi của Ms Nga và cam kết làm bài nghiêm túc, không rời khỏi trang làm bài.
                </span>
              </label>

              {/* Action Buttons */}
              <div className="pt-2 flex gap-3">
                {onSelectAssignment && (
                  <button
                    type="button"
                    onClick={onSelectAssignment}
                    className="w-1/3 py-3 border border-slate-300 text-slate-700 font-bold rounded-xl text-sm hover:bg-slate-50 cursor-pointer"
                  >
                    Quay lại
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!hasAgreedRules || startingDirectExam}
                  className="flex-1 py-3.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white font-extrabold rounded-xl text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {startingDirectExam ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Đang vào phòng thi...</span>
                    </>
                  ) : (
                    <span>BẮT ĐẦU THI / START EXAM (20:00)</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Early Submit Confirmation Modal */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 text-center border border-slate-100">
            <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-3">
              <Send className="w-6 h-6 ml-0.5" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">Xác Nhận Nộp Bài Writing</h3>
            <p className="text-slate-600 text-sm mb-4 leading-relaxed">
              Tổng số từ hiện tại của bạn: <strong>{wordCount} từ</strong>.
              <br />
              {wordCount < 150 ? (
                <span className="text-xs text-amber-600 font-semibold block mt-1">
                  (Bài viết chưa đạt 150 từ theo chuẩn IELTS, nhưng bạn vẫn có thể nộp bình thường)
                </span>
              ) : (
                <span className="text-xs text-green-600 font-semibold block mt-1">
                  (Bài viết đã đạt trên 150 từ tiêu chuẩn)
                </span>
              )}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(false)}
                disabled={submitting}
                className="w-1/2 py-2.5 border border-slate-300 rounded-xl text-slate-700 text-sm font-bold hover:bg-slate-50 cursor-pointer"
              >
                Viết tiếp
              </button>
              <button
                type="button"
                onClick={handleFinalSubmit}
                disabled={submitting}
                className="w-1/2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang nộp...</span>
                  </>
                ) : (
                  <span>Nộp Bài Ngay</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chart Image Lightbox Zoom Modal */}
      {showImageZoom && selectedZoomImage && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setShowImageZoom(false)}
        >
          <div className="absolute top-4 right-4 flex items-center gap-3">
            <button
              onClick={() => setShowImageZoom(false)}
              className="p-2 bg-white/20 hover:bg-white/30 text-white rounded-full transition-colors cursor-pointer"
              title="Đóng phóng to"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <div
            className="max-w-[94vw] max-h-[90vh] bg-white rounded-2xl p-3 shadow-2xl overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={selectedZoomImage}
              alt="Zoomed IELTS Chart"
              className="max-h-[82vh] w-auto mx-auto object-contain"
            />
          </div>
          <p className="text-white/80 text-xs mt-3 text-center">
            Nhấp chuột vào bất cứ đâu bên ngoài để đóng phóng to biểu đồ
          </p>
        </div>
      )}
    </div>
  );
}
