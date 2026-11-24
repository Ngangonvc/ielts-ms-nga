import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiRequest, downloadTeacherFile, TASK_1_CATEGORIES, TASK_2_CATEGORIES, getCategoryLabelClient } from '../api';
import ClassesAndStudentsManager from './ClassesAndStudentsManager';
import {
  BookOpen,
  Users,
  FileText,
  ShieldAlert,
  Download,
  Plus,
  QrCode,
  Eye,
  RefreshCw,
  KeyRound,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  AlertCircle,
  X,
  Save,
  LogOut,
  Copy,
  Check,
  Loader2,
  Globe,
  Wifi,
  WifiOff,
  Play,
  Square,
  FolderArchive,
  FileDown,
  Lock,
  FileSpreadsheet,
  Edit,
  Image as ImageIcon,
  Share2,
  ChevronDown,
  ChevronUp,
  Activity
} from 'lucide-react';

function formatTimeSpent(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} giây`;
  return `${m} phút ${s > 0 ? s + 's' : ''}`.trim();
}

export default function TeacherDashboard({ teacher, onTeacherUpdated, onLogout, onSwitchToStudent }) {
  const [activeTab, setActiveTab] = useState('sessions'); // 'sessions' | 'submissions' | 'classes'
  const [message, setMessage] = useState({ type: '', text: '' });

  // Core data
  const [classes, setClasses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  // Filters for submissions
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [submissionFilterStatus, setSubmissionFilterStatus] = useState('');
  const [selectedTaskType, setSelectedTaskType] = useState(''); // '' | 'TASK_1' | 'TASK_2'

  // Filter for exam list
  const [examFilterTask, setExamFilterTask] = useState('ALL'); // 'ALL' | 'TASK_1' | 'TASK_2'

  // Create Writing Session Form
  const [newTaskType, setNewTaskType] = useState('TASK_1'); // 'TASK_1' | 'TASK_2'
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('LINE_GRAPH');
  const [newClassId, setNewClassId] = useState('');
  const [newDuration, setNewDuration] = useState(20);
  const [newInstructions, setNewInstructions] = useState('You should spend about 20 minutes on this task. Write at least 150 words.');
  const [newPromptQuestion, setNewPromptQuestion] = useState('');
  const [newChartFiles, setNewChartFiles] = useState([]);
  const [chartPreviews, setChartPreviews] = useState([]);
  const [showDetailedCreate, setShowDetailedCreate] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);

  function handleSwitchNewTaskType(type) {
    setNewTaskType(type);
    if (type === 'TASK_2') {
      setNewDuration(40);
      setNewCategory('OPINION');
      setNewInstructions('You should spend about 40 minutes on this task. Write at least 250 words.');
    } else {
      setNewDuration(20);
      setNewCategory('LINE_GRAPH');
      setNewInstructions('You should spend about 20 minutes on this task. Write at least 150 words.');
    }
  }

  // Edit Writing Session Modal
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [editTaskType, setEditTaskType] = useState('TASK_1');
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('LINE_GRAPH');
  const [editClassId, setEditClassId] = useState('');
  const [editDuration, setEditDuration] = useState(20);
  const [editInstructions, setEditInstructions] = useState('');
  const [editPromptQuestion, setEditPromptQuestion] = useState('');
  const [editStatus, setEditStatus] = useState('DRAFT');
  const [editExistingImages, setEditExistingImages] = useState([]);
  const [editNewFiles, setEditNewFiles] = useState([]);
  const [editPreviews, setEditPreviews] = useState([]);
  const [savingEdit, setSavingEdit] = useState(false);

  // Operations state
  const [copiedExamId, setCopiedExamId] = useState(null);
  const [duplicatingId, setDuplicatingId] = useState(null);
  const [exportingExcel, setExportingExcel] = useState(false);

  // Cloudflare Quick Tunnel state
  const [tunnelInfo, setTunnelInfo] = useState({
    binaryInstalled: false,
    status: 'DISCONNECTED',
    publicUrl: null,
    lastError: null,
    disconnectReason: null,
    localUrl: 'http://localhost:5000',
    requiresAccountSetup: Boolean(teacher?.requiresAccountSetup)
  });
  const [tunnelBusy, setTunnelBusy] = useState(false);

  // Modals
  const [showQrModal, setShowQrModal] = useState(null);
  const [copiedModalLink, setCopiedModalLink] = useState(false);
  const [viewingEssayData, setViewingEssayData] = useState(null);
  const [loadingEssay, setLoadingEssay] = useState(false);
  const [showOverrideModal, setShowOverrideModal] = useState(null);
  const [showAccountModal, setShowAccountModal] = useState(false);

  // Account setup form
  const [accCurrentPwd, setAccCurrentPwd] = useState('');
  const [accNewUsername, setAccNewUsername] = useState(teacher?.username === 'teacher' ? '' : (teacher?.username || ''));
  const [accFullName, setAccFullName] = useState(teacher?.fullName || '');
  const [accNewPwd, setAccNewPwd] = useState('');
  const [accConfirmPwd, setAccConfirmPwd] = useState('');
  const [accError, setAccError] = useState('');
  const [accSaving, setAccSaving] = useState(false);

  // System Readiness Check state (Requirement 14)
  const [checkingSystem, setCheckingSystem] = useState(false);
  const [systemCheckResult, setSystemCheckResult] = useState(null);
  const [showSystemCheckModal, setShowSystemCheckModal] = useState(false);

  async function handleRunSystemCheck() {
    setCheckingSystem(true);
    setShowSystemCheckModal(true);
    try {
      const res = await apiRequest('/teacher/system-check');
      setSystemCheckResult(res);
    } catch (err) {
      setSystemCheckResult({
        ready: false,
        overallStatus: 'HỆ THỐNG CHƯA SẴN SÀNG – KHÔNG NÊN BẮT ĐẦU BÀI THI.',
        durationMs: 0,
        checks: [
          {
            id: 'network_fail',
            name: 'Máy Chủ & API',
            status: 'ERROR',
            detail: 'Không thể kết nối đến máy chủ: ' + err.message
          }
        ]
      });
    } finally {
      setCheckingSystem(false);
    }
  }

  function showNotification(type, text) {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 4500);
  }

  const loadClasses = useCallback(async () => {
    try {
      const res = await apiRequest('/classes');
      const list = res.classes || [];
      setClasses(list);
      if (list.length > 0) {
        setNewClassId((prev) => prev || list[0].id);
      }
    } catch (err) {
      showNotification('error', 'Lỗi tải danh sách lớp: ' + err.message);
    }
  }, []);

  const loadAssignments = useCallback(async () => {
    try {
      const res = await apiRequest('/assignments');
      setAssignments(res.assignments || []);
    } catch (err) {
      showNotification('error', 'Lỗi tải danh sách buổi Writing: ' + err.message);
    }
  }, []);

  const loadTunnelStatus = useCallback(async () => {
    try {
      const res = await apiRequest('/teacher/tunnel/status');
      setTunnelInfo(res);
    } catch (_) {}
  }, []);

  const loadSubmissions = useCallback(async () => {
    setLoadingSubmissions(true);
    try {
      const params = new URLSearchParams();
      if (selectedClassId) params.set('classId', selectedClassId);
      if (selectedAssignmentId) params.set('assignmentId', selectedAssignmentId);
      if (submissionFilterStatus) params.set('status', submissionFilterStatus);
      if (selectedTaskType) params.set('taskType', selectedTaskType);
      const queryStr = params.toString() ? `?${params.toString()}` : '';
      const res = await apiRequest(`/teacher/submissions${queryStr}`);
      setSubmissions(res.submissions || []);
    } catch (err) {
      showNotification('error', 'Lỗi tải danh sách bài viết: ' + err.message);
    } finally {
      setLoadingSubmissions(false);
    }
  }, [selectedClassId, selectedAssignmentId, submissionFilterStatus, selectedTaskType]);

  useEffect(() => {
    loadClasses();
    loadAssignments();
    loadTunnelStatus();
  }, [loadClasses, loadAssignments, loadTunnelStatus]);

  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  useEffect(() => {
    const id = setInterval(loadTunnelStatus, 6000);
    return () => clearInterval(id);
  }, [loadTunnelStatus]);

  const requiresAccountSetup = Boolean(teacher?.requiresAccountSetup || tunnelInfo?.requiresAccountSetup);

  function getExamShareUrl(assignmentId) {
    const baseUrl = tunnelInfo?.status === 'CONNECTED' && tunnelInfo?.publicUrl
      ? tunnelInfo.publicUrl
      : window.location.origin;
    return `${baseUrl}/#exam/${assignmentId}`;
  }

  async function handleToggleTunnel(action) {
    if (tunnelBusy) return;
    setTunnelBusy(true);
    try {
      if (action === 'start') {
        const res = await apiRequest('/teacher/tunnel/start', 'POST');
        setTunnelInfo((prev) => ({ ...prev, ...res }));
        showNotification('success', 'Đã bật thành công kết nối Internet (HTTPS) cho học sinh!');
      } else {
        const res = await apiRequest('/teacher/tunnel/stop', 'POST');
        setTunnelInfo((prev) => ({ ...prev, ...res }));
        showNotification('success', 'Đã tắt kết nối Internet an toàn.');
      }
    } catch (err) {
      showNotification('error', err.message || 'Lỗi thao tác kết nối Internet');
      await loadTunnelStatus();
    } finally {
      setTunnelBusy(false);
    }
  }

  function handleCopyExamLink(assign) {
    const directUrl = getExamShareUrl(assign.id);
    navigator.clipboard.writeText(directUrl);
    setCopiedExamId(assign.id);
    showNotification('success', `Đã sao chép link thi của đề "${assign.title}"!`);
    setTimeout(() => setCopiedExamId(null), 3000);
  }

  async function handleDuplicateExam(assign) {
    setDuplicatingId(assign.id);
    try {
      const res = await apiRequest(`/assignments/${assign.id}/duplicate`, 'POST');
      showNotification('success', `Đã nhân bản thành công buổi thi: "${res.assignment.title}"`);
      await loadAssignments();
    } catch (err) {
      showNotification('error', 'Lỗi nhân bản đề thi: ' + err.message);
    } finally {
      setDuplicatingId(null);
    }
  }

  function handleChartFilesChange(e) {
    const files = Array.from(e.target.files || []);
    setNewChartFiles(files);
    const urls = files.map((f) => URL.createObjectURL(f));
    setChartPreviews(urls);
  }

  async function handleCreateSession(startImmediately = true) {
    if (!newTitle.trim()) {
      showNotification('error', 'Vui lòng nhập Tên buổi Writing');
      return;
    }
    if (!newClassId) {
      showNotification('error', 'Vui lòng chọn lớp học');
      return;
    }

    setCreatingSession(true);
    try {
      const defaultDuration = newTaskType === 'TASK_2' ? 40 : 20;
      const formData = new FormData();
      formData.append('title', newTitle.trim());
      formData.append('type', newTaskType);
      formData.append('taskType', newTaskType);
      formData.append('classId', newClassId);
      formData.append('taskCategory', newCategory);
      formData.append('instructions', newInstructions.trim());
      formData.append('promptQuestion', newPromptQuestion.trim());
      formData.append('durationMinutes', Math.min(240, Math.max(1, parseInt(newDuration, 10) || defaultDuration)));
      formData.append('status', startImmediately ? 'PUBLISHED' : 'DRAFT');

      if (newTaskType === 'TASK_1') {
        for (const file of newChartFiles) {
          formData.append('images', file);
        }
      }

      const res = await apiRequest('/assignments', 'POST', formData, true);

      setNewTitle('');
      setNewPromptQuestion('');
      setNewChartFiles([]);
      setChartPreviews([]);
      await loadAssignments();

      const taskLabel = newTaskType === 'TASK_2' ? 'IELTS Task 2' : 'IELTS Task 1';
      if (startImmediately && res.assignment?.id) {
        showNotification('success', `Đã mở phòng thi ${taskLabel} "${res.assignment.title}"!`);
        await openSessionQrModal(res.assignment.id, res.assignment.title);
      } else {
        showNotification('success', `Đã lưu buổi Writing ${taskLabel} ở trạng thái chuẩn bị (DRAFT).`);
      }
    } catch (err) {
      showNotification('error', err.message);
    } finally {
      setCreatingSession(false);
    }
  }

  function handleOpenEditModal(assign) {
    const taskType = assign.type || assign.task_type || 'TASK_1';
    setEditingAssignment(assign);
    setEditTaskType(taskType);
    setEditTitle(assign.title || '');
    setEditCategory(assign.task_category || (taskType === 'TASK_2' ? 'OPINION' : 'LINE_GRAPH'));
    setEditClassId(assign.class_id || '');
    setEditDuration(assign.duration_minutes || (taskType === 'TASK_2' ? 40 : 20));
    setEditInstructions(assign.instructions || '');
    setEditPromptQuestion(assign.prompt_question || '');
    setEditStatus(assign.status || 'DRAFT');
    setEditExistingImages(assign.image_urls || []);
    setEditNewFiles([]);
    setEditPreviews([]);
  }

  async function handleSaveEditAssignment(e) {
    e.preventDefault();
    if (!editingAssignment) return;
    if (!editTitle.trim()) {
      showNotification('error', 'Vui lòng nhập tên buổi thi');
      return;
    }

    setSavingEdit(true);
    try {
      const formData = new FormData();
      formData.append('title', editTitle.trim());
      formData.append('type', editTaskType);
      formData.append('taskType', editTaskType);
      formData.append('classId', editClassId);
      formData.append('taskCategory', editCategory);
      formData.append('durationMinutes', editDuration);
      formData.append('instructions', editInstructions.trim());
      formData.append('promptQuestion', editPromptQuestion.trim());
      formData.append('status', editStatus);

      if (editTaskType === 'TASK_1') {
        formData.append('existingImages', JSON.stringify(editExistingImages));
        for (const file of editNewFiles) {
          formData.append('images', file);
        }
      } else {
        formData.append('existingImages', '[]');
      }

      await apiRequest(`/assignments/${editingAssignment.id}`, 'PUT', formData, true);
      showNotification('success', 'Đã cập nhật đề thi thành công!');
      setEditingAssignment(null);
      await loadAssignments();
    } catch (err) {
      showNotification('error', 'Lỗi cập nhật: ' + err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleStartExistingSession(assign) {
    try {
      await apiRequest(`/assignments/${assign.id}/status`, 'POST', { status: 'PUBLISHED' });
      await loadAssignments();
      showNotification('success', `Đã mở buổi Writing "${assign.title}"!`);
      await openSessionQrModal(assign.id, assign.title);
    } catch (err) {
      showNotification('error', err.message);
    }
  }

  async function handleCloseExistingSession(assign) {
    try {
      await apiRequest(`/assignments/${assign.id}/status`, 'POST', { status: 'CLOSED' });
      await loadAssignments();
      showNotification('success', `Đã đóng buổi Writing "${assign.title}".`);
    } catch (err) {
      showNotification('error', err.message);
    }
  }

  async function openSessionQrModal(assignmentId, fallbackTitle = 'Buổi Writing') {
    try {
      const res = await apiRequest(`/assignments/${assignmentId}/qr`);
      const assign = assignments.find((a) => a.id === assignmentId);
      const shareUrl = getExamShareUrl(assignmentId);
      setShowQrModal({
        assignmentId,
        directUrl: shareUrl,
        qrDataUrl: res.qrDataUrl,
        connectionMode: res.connectionMode,
        title: assign?.title || fallbackTitle
      });
    } catch (err) {
      showNotification('error', 'Không thể tạo mã QR: ' + err.message);
    }
  }

  async function openGeneralQrModal() {
    try {
      const res = await apiRequest('/teacher/network-info');
      setShowQrModal({
        assignmentId: null,
        directUrl: res.baseUrl,
        qrDataUrl: res.qrDataUrl,
        connectionMode: res.connectionMode,
        title: res.connectionMode === 'CLOUDFLARE_TUNNEL'
          ? 'Cổng Thi Học Sinh IELTS Ms Nga (4G/5G Internet)'
          : `Cổng Thi Học Sinh IELTS Ms Nga (Wi-Fi nội bộ: ${res.lanIp})`
      });
    } catch (err) {
      showNotification('error', 'Không thể tạo mã QR: ' + err.message);
    }
  }

  async function handleViewEssay(attemptId) {
    setLoadingEssay(true);
    try {
      const res = await apiRequest(`/teacher/attempts/${attemptId}`);
      setViewingEssayData(res);
    } catch (err) {
      showNotification('error', 'Không thể tải bài viết: ' + err.message);
    } finally {
      setLoadingEssay(false);
    }
  }

  async function handleDownloadSingleWord(subOrId, fallbackName = 'Bai_Writing.docx') {
    const attemptId = typeof subOrId === 'string' ? subOrId : subOrId.id;
    try {
      await downloadTeacherFile(`/teacher/export/docx/${attemptId}`, fallbackName);
      showNotification('success', 'Đã tải bài viết Word (.docx) thành công!');
    } catch (err) {
      showNotification('error', 'Không thể tải file Word: ' + err.message);
    }
  }

  async function handleDownloadClassZip() {
    try {
      const params = new URLSearchParams();
      if (selectedClassId) params.set('classId', selectedClassId);
      if (selectedAssignmentId) params.set('assignmentId', selectedAssignmentId);
      if (selectedTaskType) params.set('taskType', selectedTaskType);
      const queryStr = params.toString() ? `?${params.toString()}` : '';
      const zipName = selectedTaskType === 'TASK_2'
        ? 'Tat_Ca_Bai_Writing_Task_2.zip'
        : selectedTaskType === 'TASK_1'
        ? 'Tat_Ca_Bai_Writing_Task_1.zip'
        : 'Tat_Ca_Bai_Writing_IELTS.zip';
      await downloadTeacherFile(`/teacher/export/zip${queryStr}`, zipName);
      showNotification('success', 'Đã tải thành công file nén ZIP chứa tất cả bài viết Word (.docx)!');
    } catch (err) {
      showNotification('error', 'Không thể tải file ZIP: ' + err.message);
    }
  }

  async function handleExportExcel() {
    setExportingExcel(true);
    try {
      const params = new URLSearchParams();
      if (selectedClassId) params.set('classId', selectedClassId);
      if (selectedAssignmentId) params.set('assignmentId', selectedAssignmentId);
      if (selectedTaskType) params.set('taskType', selectedTaskType);
      const queryStr = params.toString() ? `?${params.toString()}` : '';
      const excelName = selectedTaskType === 'TASK_2'
        ? 'Ket_Qua_IELTS_Task_2.xlsx'
        : selectedTaskType === 'TASK_1'
        ? 'Ket_Qua_IELTS_Task_1.xlsx'
        : 'Ket_Qua_IELTS_Ms_Nga.xlsx';
      await downloadTeacherFile(`/teacher/export/excel${queryStr}`, excelName);
      showNotification('success', 'Đã xuất bảng kết quả Excel (.xlsx) thành công!');
    } catch (err) {
      showNotification('error', 'Lỗi xuất Excel: ' + err.message);
    } finally {
      setExportingExcel(false);
    }
  }

  async function handleUpdateTeacherAccount(e) {
    e.preventDefault();
    setAccError('');
    if (!accNewUsername.trim() || accNewUsername.trim().toLowerCase() === 'teacher') {
      setAccError('Vui lòng chọn tên đăng nhập mới (khác "teacher")');
      return;
    }
    if (!accNewPwd || accNewPwd.length < 6) {
      setAccError('Mật khẩu mới phải có tối thiểu 6 ký tự');
      return;
    }
    if (accNewPwd !== accConfirmPwd) {
      setAccError('Mật khẩu mới và mật khẩu xác nhận không trùng khớp');
      return;
    }

    setAccSaving(true);
    try {
      const res = await apiRequest('/auth/teacher/update-account', 'POST', {
        currentPassword: accCurrentPwd,
        newUsername: accNewUsername.trim(),
        newPassword: accNewPwd,
        fullName: accFullName.trim()
      });

      if (onTeacherUpdated && res.teacher) {
        onTeacherUpdated(res.teacher);
      }
      setShowAccountModal(false);
      showNotification('success', 'Cập nhật tài khoản giáo viên thành công!');
    } catch (err) {
      setAccError(err.message);
    } finally {
      setAccSaving(false);
    }
  }

  // Quick count summaries
  const countInProgress = submissions.filter((s) => s.status === 'IN_PROGRESS').length;
  const countSubmitted = submissions.filter((s) => s.status === 'SUBMITTED' || s.status === 'AUTO-SUBMITTED').length;
  const countCancelled = submissions.filter((s) => ['CANCELLED', 'INVALIDATED'].includes(s.status)).length;

  function renderSessionsTab() {
    const isCloudMode = !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1');
    const isPublicLive = isCloudMode || (tunnelInfo?.status === 'CONNECTED' && tunnelInfo?.publicUrl);
    const effectivePublicUrl = isCloudMode ? window.location.origin : (tunnelInfo?.publicUrl || window.location.origin);

    return (
      <div className="space-y-6">
        {/* Cloudflare Quick Tunnel / Permanent Cloud Status Card */}
        <div className={`rounded-2xl p-5 border shadow-xs transition-all ${
          isPublicLive
            ? 'bg-gradient-to-r from-blue-900 to-indigo-900 text-white border-blue-700'
            : tunnelInfo?.status === 'CONNECTING'
            ? 'bg-amber-50 text-amber-950 border-amber-300'
            : 'bg-white text-slate-900 border-slate-200'
        }`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {isPublicLive ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    {isCloudMode ? 'MÁY CHỦ ĐÁM MÂY 24/7 (RENDER & SUPABASE)' : 'INTERNET ONLINE (HTTPS)'}
                  </span>
                ) : tunnelInfo?.status === 'CONNECTING' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-200 text-amber-800">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ĐANG KẾT NỐI INTERNET...
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300">
                    <WifiOff className="w-3.5 h-3.5 text-slate-500" />
                    KẾT NỐI INTERNET ĐANG TẮT (CHỈ NỘI BỘ)
                  </span>
                )}
                <span className={`text-xs font-semibold ${isPublicLive ? 'text-blue-200' : 'text-slate-500'}`}>
                  {isCloudMode
                    ? 'Hoạt động độc lập 24/7 – Máy tính của cô KHÔNG CẦN BẬT khi học sinh thi'
                    : 'Phục vụ 23 học sinh làm bài cùng lúc bằng điện thoại 4G/5G/Wi-Fi'}
                </span>
              </div>

              <h2 className={`text-base sm:text-lg font-black ${isPublicLive ? 'text-white' : 'text-slate-900'}`}>
                {isPublicLive
                  ? 'Cổng Thi Trực Tuyến IELTS Ms Nga Đang Sẵn Sàng Cho Học Sinh'
                  : 'Cổng Thi IELTS Ms Nga Chưa Mở Ra Internet'}
              </h2>

              <p className={`text-xs ${isPublicLive ? 'text-blue-200' : 'text-slate-500'}`}>
                {isPublicLive
                  ? 'Học sinh dùng điện thoại (iPhone, Android, laptop) mở camera quét mã QR hoặc bấm link HTTPS để làm bài trực tiếp trong 20 phút mà không cần tài khoản.'
                  : 'Đường link và mã QR bên dưới hiện dùng localhost:5000 (chỉ mở được trên máy tính này). Nhấn "Bật Link Internet Cho Học Sinh" để tạo địa chỉ HTTPS công khai.'}
              </p>

              {isPublicLive && (
                <div className="mt-3 flex flex-wrap items-center gap-2 pt-1">
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-black/30 rounded-xl font-mono text-xs text-blue-200 border border-blue-400/30 select-all">
                    <Globe className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-bold text-white">{effectivePublicUrl}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(effectivePublicUrl);
                      showNotification('success', 'Đã sao chép link trang chủ cổng thi học sinh!');
                    }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Sao chép link</span>
                  </button>
                  <button
                    type="button"
                    onClick={openGeneralQrModal}
                    className="px-3 py-1.5 bg-white text-blue-950 hover:bg-blue-50 text-xs font-bold rounded-xl flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Mã QR Cổng Thi</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRunSystemCheck}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Kiểm Tra Hệ Thống</span>
                  </button>
                  <a
                    href={effectivePublicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl flex items-center gap-1 transition-colors"
                  >
                    <span>Mở thử nghiệm</span>
                  </a>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isCloudMode ? (
                <button
                  type="button"
                  onClick={handleRunSystemCheck}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold rounded-xl flex items-center gap-2 cursor-pointer shadow-md transition-all"
                >
                  <Activity className="w-4 h-4" />
                  <span>Kiểm Tra Sẵn Sàng (23 HS)</span>
                </button>
              ) : tunnelInfo?.status === 'CONNECTED' ? (
                <button
                  type="button"
                  disabled={tunnelBusy}
                  onClick={() => handleToggleTunnel('stop')}
                  className="px-4 py-2 bg-red-600/80 hover:bg-red-600 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  {tunnelBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                  <span>Tắt kết nối tạm thời</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={tunnelBusy}
                  onClick={() => handleToggleTunnel('start')}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-black rounded-xl flex items-center gap-2 cursor-pointer shadow-md hover:shadow-lg transition-all"
                >
                  {tunnelBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  <span>Bật Link Internet Cho Học Sinh</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Create Writing Session Form */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
          {/* Task 1 / Task 2 Selector Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-600">Phần thi:</span>
              <div className="inline-flex p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => handleSwitchNewTaskType('TASK_1')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    newTaskType === 'TASK_1'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  📊 Task 1 (20 phút • 150 từ)
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchNewTaskType('TASK_2')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    newTaskType === 'TASK_2'
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  📝 Task 2 (40 phút • 250 từ)
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowDetailedCreate(!showDetailedCreate)}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
            >
              <span>{showDetailedCreate ? 'Thu gọn tùy chọn' : (newTaskType === 'TASK_2' ? 'Câu hỏi chi tiết & Tùy chọn' : 'Đề thi chi tiết & Đính kèm ảnh biểu đồ')}</span>
              {showDetailedCreate ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h2 className={`text-base sm:text-lg font-extrabold flex items-center gap-2 ${newTaskType === 'TASK_2' ? 'text-purple-900' : 'text-blue-900'}`}>
                <BookOpen className={`w-5 h-5 ${newTaskType === 'TASK_2' ? 'text-purple-600' : 'text-blue-600'}`} />
                <span>Tạo Đề Thi IELTS Academic Writing {newTaskType === 'TASK_2' ? 'Task 2' : 'Task 1'}</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {newTaskType === 'TASK_2'
                  ? 'Nhập câu hỏi bài luận Task 2 (Opinion, Discussion,...) và phát link/mã QR cho học sinh làm bài trong 40 phút.'
                  : 'Nhập đề bài, tải ảnh biểu đồ và phát link/mã QR cho học sinh làm bài trong 20 phút.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {newTaskType === 'TASK_2' ? 'Chủ đề / Tên bài luận Task 2' : 'Tên buổi thi / Đề bài Task 1'}
              </label>
              <input
                type="text"
                placeholder={newTaskType === 'TASK_2' ? 'Ví dụ: Technology and Education in University' : 'Ví dụ: Line Graph - Life Expectancy (1950 - 2020)'}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {newTaskType === 'TASK_2' ? 'Dạng bài Task 2' : 'Dạng biểu đồ Task 1'}
              </label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-medium"
              >
                {Object.entries(newTaskType === 'TASK_2' ? TASK_2_CATEGORIES : TASK_1_CATEGORIES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Chọn lớp thi</label>
              <select
                value={newClassId}
                onChange={(e) => setNewClassId(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
              >
                {classes.length === 0 ? (
                  <option value="">Chưa có lớp nào</option>
                ) : (
                  classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.student_count || 0} HS)
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="md:col-span-2 flex gap-2">
              <button
                type="button"
                disabled={creatingSession || classes.length === 0}
                onClick={() => handleCreateSession(true)}
                className={`w-full py-2.5 px-3 text-white rounded-xl text-xs sm:text-sm font-bold shadow-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 ${
                  newTaskType === 'TASK_2' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {creatingSession ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                <span>Bắt đầu thi</span>
              </button>
            </div>
          </div>

          {/* Detailed Question Prompt & Image Upload Area */}
          {showDetailedCreate && (
            <div className="pt-3 border-t border-slate-100 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Đề bài câu hỏi ({newTaskType === 'TASK_2' ? 'Essay Question Prompt' : 'Question Prompt'})
                </label>
                <textarea
                  rows={newTaskType === 'TASK_2' ? 3 : 2}
                  value={newPromptQuestion}
                  onChange={(e) => setNewPromptQuestion(e.target.value)}
                  placeholder={
                    newTaskType === 'TASK_2'
                      ? 'Some people believe that unpaid community service should be a compulsory part of high school programmes. To what extent do you agree or disagree? Give reasons for your answer and include any relevant examples from your own knowledge or experience.'
                      : 'The chart below shows information about... Summarise the information by selecting and reporting the main features, and make comparisons where relevant.'
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-serif"
                />
              </div>

              {newTaskType === 'TASK_1' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                    <span>Tải lên ảnh biểu đồ Task 1 (Bar, Line, Pie, Table, Process, Map, Mixed)</span>
                    <span className="text-slate-400 text-[11px]">Hỗ trợ JPG, PNG, WEBP, SVG tối đa 10MB</span>
                  </label>
                  <input
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.webp,.svg"
                    onChange={handleChartFilesChange}
                    className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                  />

                  {chartPreviews.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {chartPreviews.map((url, i) => (
                        <div key={i} className="relative w-20 h-20 border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-1">
                          <img src={url} alt="Preview" className="w-full h-full object-contain" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-500">Thời gian quy chuẩn {newTaskType === 'TASK_2' ? 'Task 2' : 'Task 1'}:</span>
              <span className={`px-2.5 py-1 rounded-lg font-bold border ${
                newTaskType === 'TASK_2'
                  ? 'bg-purple-100 text-purple-800 border-purple-200'
                  : 'bg-blue-100 text-blue-800 border-blue-200'
              }`}>
                {newTaskType === 'TASK_2' ? '40 phút • Tối thiểu 250 từ' : '20 phút • Tối thiểu 150 từ'}
              </span>
            </div>
            <button
              type="button"
              disabled={creatingSession || classes.length === 0}
              onClick={() => handleCreateSession(false)}
              className="text-xs font-semibold text-slate-600 hover:text-blue-600 underline cursor-pointer"
            >
              Lưu bản nháp đề thi (chưa mở cho học sinh)
            </button>
          </div>
        </div>

        {/* Writing Sessions List */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-extrabold text-slate-900 text-sm sm:text-base flex items-center gap-2">
              <span>Danh Sách Các Đề Thi Writing ({assignments.length})</span>
            </h3>

            {/* Filter pills: All, Task 1, Task 2 */}
            <div className="inline-flex p-1 bg-slate-100 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setExamFilterTask('ALL')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  examFilterTask === 'ALL'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tất cả ({assignments.length})
              </button>
              <button
                type="button"
                onClick={() => setExamFilterTask('TASK_1')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  examFilterTask === 'TASK_1'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-blue-700'
                }`}
              >
                📊 Task 1 ({assignments.filter((a) => (a.type || a.task_type) !== 'TASK_2').length})
              </button>
              <button
                type="button"
                onClick={() => setExamFilterTask('TASK_2')}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  examFilterTask === 'TASK_2'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-purple-700'
                }`}
              >
                📝 Task 2 ({assignments.filter((a) => (a.type || a.task_type) === 'TASK_2').length})
              </button>
            </div>
          </div>

          {assignments.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center border border-slate-200 text-slate-400 text-sm">
              Chưa có buổi thi nào. Hãy nhập tên đề bài và bấm "Bắt đầu thi" ở trên.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {assignments
                .filter((a) => {
                  const isT2 = (a.type || a.task_type) === 'TASK_2';
                  if (examFilterTask === 'TASK_1') return !isT2;
                  if (examFilterTask === 'TASK_2') return isT2;
                  return true;
                })
                .map((assign) => {
                const isTask2 = (assign.type || assign.task_type) === 'TASK_2';
                const isOpen = assign.status === 'PUBLISHED';
                const isCopied = copiedExamId === assign.id;
                const isDuplicating = duplicatingId === assign.id;

                return (
                  <div
                    key={assign.id}
                    className={`bg-white rounded-2xl p-5 border shadow-xs flex flex-col justify-between gap-4 transition-all ${
                      isOpen
                        ? isTask2 ? 'border-purple-300 ring-2 ring-purple-100/70' : 'border-blue-300 ring-2 ring-blue-100/70'
                        : 'border-slate-200'
                    }`}
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-md border ${
                            isTask2
                              ? 'text-purple-800 bg-purple-50 border-purple-200'
                              : 'text-blue-800 bg-blue-50 border-blue-200'
                          }`}>
                            {isTask2 ? 'Task 2 • 40m' : 'Task 1 • 20m'}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                            {getCategoryLabelClient(assign.type || assign.task_type, assign.task_category)}
                          </span>
                        </div>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            isOpen
                              ? 'bg-green-100 text-green-800'
                              : assign.status === 'CLOSED'
                              ? 'bg-slate-200 text-slate-600'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {isOpen ? 'Đang mở' : assign.status === 'CLOSED' ? 'Đã đóng' : 'Bản nháp'}
                        </span>
                      </div>

                      <h4 className="text-base font-bold text-slate-900 line-clamp-2 leading-snug">
                        {assign.title}
                      </h4>

                      <div className="flex items-center justify-between text-xs text-slate-500 pt-0.5">
                        <span>Lớp: <strong className="text-slate-700">{assign.class_name}</strong></span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-blue-600" /> {assign.duration_minutes} phút
                        </span>
                      </div>

                      <div className="text-xs text-slate-500 flex items-center justify-between">
                        <span>
                          Bài nộp: <strong className="text-green-700">{assign.submitted_count || 0}</strong> / {assign.attempt_count || 0}
                        </span>
                        {assign.image_urls && assign.image_urls.length > 0 && (
                          <span className="text-[11px] text-blue-600 flex items-center gap-1">
                            <ImageIcon className="w-3 h-3" /> {assign.image_urls.length} biểu đồ
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons for each exam */}
                    <div className="pt-3 border-t border-slate-100 space-y-2">
                      <div className="flex items-center gap-2">
                        {/* Copy Exam Link Button */}
                        <button
                          type="button"
                          onClick={() => handleCopyExamLink(assign)}
                          className={`flex-1 py-1.5 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                            isCopied
                              ? 'bg-green-600 text-white'
                              : 'bg-blue-50 hover:bg-blue-100 text-blue-700'
                          }`}
                          title="Sao chép link trực tiếp gửi cho học sinh"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{isCopied ? 'Đã copy link thi!' : 'Sao chép link thi'}</span>
                        </button>

                        {/* Duplicate Button */}
                        <button
                          type="button"
                          disabled={isDuplicating}
                          onClick={() => handleDuplicateExam(assign)}
                          className="py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                          title="Nhân bản đề thi này cho lớp khác"
                        >
                          {isDuplicating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
                          <span>Nhân bản</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        {!isOpen ? (
                          <button
                            type="button"
                            onClick={() => handleStartExistingSession(assign)}
                            className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                          >
                            <Play className="w-3.5 h-3.5" />
                            <span>Mở phòng thi</span>
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => openSessionQrModal(assign.id, assign.title)}
                              className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                              <span>Mã QR & Link</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCloseExistingSession(assign)}
                              className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                            >
                              Đóng
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(assign)}
                          className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                          title="Chỉnh sửa đề thi"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedClassId(assign.class_id);
                            setSelectedAssignmentId(assign.id);
                            setSubmissionFilterStatus('');
                            setActiveTab('submissions');
                          }}
                          className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                          title="Xem danh sách bài viết của đề này"
                        >
                          Xem bài
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderSubmissionsTab() {
    return (
      <div className="space-y-4">
        {/* Filters & Export Bar */}
        <div className="bg-white p-4 rounded-2xl shadow-xs border border-slate-200 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">Phần thi</label>
              <select
                value={selectedTaskType}
                onChange={(e) => setSelectedTaskType(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 outline-none"
              >
                <option value="">-- Cả Task 1 & Task 2 --</option>
                <option value="TASK_1">📊 Task 1 (20 phút • 150 từ)</option>
                <option value="TASK_2">📝 Task 2 (40 phút • 250 từ)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">Lớp học</label>
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 outline-none"
              >
                <option value="">-- Tất cả các lớp --</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">Đề thi Writing</label>
              <select
                value={selectedAssignmentId}
                onChange={(e) => setSelectedAssignmentId(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 outline-none max-w-xs"
              >
                <option value="">-- Tất cả đề thi --</option>
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">Trạng thái</label>
              <select
                value={submissionFilterStatus}
                onChange={(e) => setSubmissionFilterStatus(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 outline-none"
              >
                <option value="">Tất cả trạng thái</option>
                <option value="IN_PROGRESS">IN PROGRESS (Đang làm bài)</option>
                <option value="SUBMITTED">SUBMITTED (Đã nộp)</option>
                <option value="AUTO-SUBMITTED">AUTO-SUBMITTED (Tự động nộp khi hết giờ)</option>
                <option value="CANCELLED">INVALIDATED (Bị hủy do vi phạm)</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadSubmissions}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingSubmissions ? 'animate-spin' : ''}`} />
              <span>Làm mới</span>
            </button>

            {/* Export Excel Button */}
            <button
              type="button"
              disabled={exportingExcel || submissions.length === 0}
              onClick={handleExportExcel}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
            >
              {exportingExcel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              <span>Xuất kết quả Excel</span>
            </button>

            {/* Batch Export Word Button */}
            <button
              type="button"
              disabled={submissions.length === 0}
              onClick={handleDownloadClassZip}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
            >
              <FolderArchive className="w-4 h-4" />
              <span>Tải tất cả Word (.ZIP)</span>
            </button>
          </div>
        </div>

        {/* Quick Status Counters */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl font-semibold text-slate-700">
            Tổng bài viết: <strong>{submissions.length}</strong>
          </span>
          <span className="px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-xl font-semibold text-blue-800">
            Đang làm: <strong>{countInProgress}</strong>
          </span>
          <span className="px-3 py-1.5 bg-green-50 border border-green-200 rounded-xl font-semibold text-green-800">
            Đã nộp: <strong>{countSubmitted}</strong>
          </span>
          <span className="px-3 py-1.5 bg-red-50 border border-red-200 rounded-xl font-semibold text-red-800">
            Bị hủy (Vi phạm): <strong>{countCancelled}</strong>
          </span>
        </div>

        {/* Submissions Table with exact required columns */}
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Học sinh</th>
                  <th className="py-3 px-4">Lớp</th>
                  <th className="py-3 px-4 text-center">Phần thi</th>
                  <th className="py-3 px-4">Đề thi Writing</th>
                  <th className="py-3 px-4 text-center">Số từ</th>
                  <th className="py-3 px-4">Bắt đầu</th>
                  <th className="py-3 px-4">Nộp lúc</th>
                  <th className="py-3 px-4">Thời gian làm</th>
                  <th className="py-3 px-4">Trạng thái</th>
                  <th className="py-3 px-4 text-center">Vi phạm</th>
                  <th className="py-3 px-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {submissions.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-slate-400">
                      Chưa có bài viết nào phù hợp với bộ lọc hiện tại.
                    </td>
                  </tr>
                ) : (
                  submissions.map((sub) => {
                    const isInvalidated = ['CANCELLED', 'INVALIDATED'].includes(sub.status);
                    const isAuto = ['AUTO-SUBMITTED', 'AUTO_SUBMITTED', 'EXPIRED'].includes(sub.status);
                    const isSubTask2 = sub.assignment_type === 'TASK_2' || sub.task_type === 'TASK_2';
                    const targetMinWords = isSubTask2 ? 250 : 150;

                    return (
                      <tr key={sub.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          {sub.full_name}
                          {sub.student_code && (
                            <span className="block text-[11px] font-normal text-slate-400">{sub.student_code}</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-600">{sub.class_name}</td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-md text-[11px] font-extrabold border ${
                            isSubTask2
                              ? 'bg-purple-50 text-purple-800 border-purple-200'
                              : 'bg-blue-50 text-blue-800 border-blue-200'
                          }`}>
                            {isSubTask2 ? 'Task 2 (40p)' : 'Task 1 (20p)'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-800 font-medium max-w-[200px] truncate" title={sub.assignment_title}>
                          {sub.assignment_title}
                        </td>
                        <td className="py-3 px-4 text-center font-bold text-slate-700">
                          <span className={sub.word_count >= targetMinWords ? 'text-green-700 font-black' : 'text-slate-700'}>
                            {sub.word_count || 0} từ
                          </span>
                          <span className="block text-[10px] text-slate-400 font-normal">
                            Min {targetMinWords}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                          {sub.start_time ? new Date(sub.start_time).toLocaleTimeString('vi-VN') : '-'}
                        </td>
                        <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                          {sub.submitted_at ? new Date(sub.submitted_at).toLocaleTimeString('vi-VN') : '-'}
                        </td>
                        <td className="py-3 px-4 text-slate-600 font-medium whitespace-nowrap">
                          {formatTimeSpent(sub.time_spent_seconds)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {sub.status === 'SUBMITTED' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-800">
                              <CheckCircle className="w-3 h-3" /> SUBMITTED
                            </span>
                          ) : isAuto ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900">
                              <Clock className="w-3 h-3" /> AUTO-SUBMITTED
                            </span>
                          ) : sub.status === 'IN_PROGRESS' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800">
                              <Clock className="w-3 h-3" /> IN PROGRESS
                            </span>
                          ) : isInvalidated ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-800">
                              <XCircle className="w-3 h-3" /> INVALIDATED
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
                              {sub.status}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {sub.violation_count > 0 ? (
                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[11px] font-bold bg-red-100 text-red-700">
                              <ShieldAlert className="w-3 h-3" /> {sub.violation_count}
                            </span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleViewEssay(sub.id)}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Đọc bài</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadSingleWord(sub, `${sub.full_name}.docx`)}
                            className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <FileDown className="w-3.5 h-3.5" />
                            <span>Word</span>
                          </button>
                          {(isInvalidated || isAuto) && (
                            <button
                              type="button"
                              onClick={() => setShowOverrideModal(sub)}
                              className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-600 text-amber-800 hover:text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                              title="Cho phép học sinh làm lại hoặc mở khóa"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                              <span>Mở lại / Cấp quyền</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
      {/* Top Bar */}
      <header className="bg-gradient-to-r from-blue-900 via-blue-800 to-blue-900 text-white border-b border-blue-950 px-4 py-3 sticky top-0 z-40 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white text-blue-900 rounded-xl flex items-center justify-center font-black text-lg shadow-sm">
              N
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-black tracking-tight leading-tight">
                IELTS Ms Nga
              </h1>
              <span className="text-[11px] text-blue-200">
                Teacher Dashboard • <strong>{teacher?.fullName}</strong> ({teacher?.username})
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRunSystemCheck}
              className="px-3 py-1.5 text-xs text-emerald-100 hover:text-white bg-emerald-800 hover:bg-emerald-700 border border-emerald-600 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs font-bold"
              title="Kiểm tra trạng thái máy chủ, cơ sở dữ liệu và bộ nộp bài trước khi bắt đầu tiết thi"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-300" />
              <span>Kiểm Tra Hệ Thống</span>
            </button>

            <button
              type="button"
              onClick={openGeneralQrModal}
              className="px-3 py-1.5 text-xs text-blue-100 hover:text-white bg-blue-800 hover:bg-blue-700 border border-blue-600 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Link phòng thi</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setAccError('');
                setAccCurrentPwd('');
                setAccNewPwd('');
                setAccConfirmPwd('');
                setAccNewUsername(teacher?.username === 'teacher' ? '' : (teacher?.username || ''));
                setAccFullName(teacher?.fullName || '');
                setShowAccountModal(true);
              }}
              className={`px-3 py-1.5 text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer ${
                requiresAccountSetup
                  ? 'bg-amber-400 text-slate-950 font-bold hover:bg-amber-300'
                  : 'text-blue-100 hover:text-white bg-blue-800 hover:bg-blue-700 border border-blue-600'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>{requiresAccountSetup ? 'Đổi mật khẩu mặc định!' : 'Tài khoản giáo viên'}</span>
            </button>

            <button
              type="button"
              onClick={onSwitchToStudent}
              className="px-3 py-1.5 text-xs text-blue-100 hover:text-white bg-blue-800 hover:bg-blue-700 border border-blue-600 rounded-xl transition-colors cursor-pointer"
            >
              Cổng học sinh
            </button>

            <button
              type="button"
              onClick={onLogout}
              className="p-1.5 text-blue-200 hover:text-red-300 hover:bg-blue-800 rounded-xl transition-colors cursor-pointer"
              title="Đăng xuất"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* 3-Tab Navigation */}
      <nav className="bg-white border-b border-slate-200 px-4 sticky top-[57px] z-30 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center gap-1 overflow-x-auto py-1">
          <TabButton
            active={activeTab === 'sessions'}
            onClick={() => setActiveTab('sessions')}
            icon={<BookOpen className="w-4 h-4" />}
            label="Đề Thi & Link/Mã QR"
          />
          <TabButton
            active={activeTab === 'submissions'}
            onClick={() => setActiveTab('submissions')}
            icon={<FileText className="w-4 h-4" />}
            label={`Bài Nộp Của Học Sinh (${submissions.length})`}
          />
          <TabButton
            active={activeTab === 'classes'}
            onClick={() => setActiveTab('classes')}
            icon={<Users className="w-4 h-4" />}
            label="Lớp Học & Danh Sách Học Sinh"
          />
        </div>
      </nav>

      {/* Toast Notification */}
      {message.text && (
        <div
          className={`fixed top-16 right-4 z-50 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold shadow-lg text-white flex items-center gap-2 animate-bounce ${
            message.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {message.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6">
        {activeTab === 'sessions' && renderSessionsTab()}
        {activeTab === 'submissions' && renderSubmissionsTab()}
        {activeTab === 'classes' && (
          <ClassesAndStudentsManager classes={classes} onRefresh={loadClasses} showNotification={showNotification} />
        )}
      </main>

      {/* MODAL: Link & QR Code */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 text-center space-y-4 border border-slate-100">
            <div>
              <span className="inline-block px-3 py-1 rounded-full text-[11px] font-bold mb-2 bg-blue-100 text-blue-800">
                IELTS Ms Nga - Link & Mã QR Phòng Thi
              </span>
              <h3 className="font-extrabold text-slate-900 text-base">{showQrModal.title}</h3>
              <p className="text-xs text-slate-500 mt-1">
                Học sinh mở Camera điện thoại để quét mã QR hoặc mở trực tiếp đường link bên dưới để vào làm bài.
              </p>
            </div>

            <div className="p-4 bg-white border border-slate-200 rounded-2xl inline-block shadow-xs">
              <img src={showQrModal.qrDataUrl} alt="QR Code" className="w-60 h-60 mx-auto" />
            </div>

            <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
              <span className="truncate flex-1 font-mono select-all text-left text-blue-700 font-semibold">{showQrModal.directUrl}</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(showQrModal.directUrl);
                  setCopiedModalLink(true);
                  setTimeout(() => setCopiedModalLink(false), 2000);
                }}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
              >
                {copiedModalLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedModalLink ? 'Đã chép' : 'Chép link'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowQrModal(null)}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer transition-colors"
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {/* MODAL: Edit Assignment */}
      {editingAssignment && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl max-w-xl w-full p-6 space-y-4 my-6 border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-extrabold text-slate-900 text-base">
                Chỉnh Sửa Đề Thi IELTS Writing {editTaskType === 'TASK_2' ? 'Task 2' : 'Task 1'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingAssignment(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditAssignment} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phần thi</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditTaskType('TASK_1');
                      if (editDuration === 40) setEditDuration(20);
                      if (Object.keys(TASK_2_CATEGORIES).includes(editCategory)) setEditCategory('LINE_GRAPH');
                    }}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      editTaskType === 'TASK_1'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    📊 IELTS Task 1 (20 phút)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditTaskType('TASK_2');
                      if (editDuration === 20) setEditDuration(40);
                      if (Object.keys(TASK_1_CATEGORIES).includes(editCategory)) setEditCategory('OPINION');
                    }}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      editTaskType === 'TASK_2'
                        ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    📝 IELTS Task 2 (40 phút)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tên đề thi</label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {editTaskType === 'TASK_2' ? 'Dạng bài Task 2' : 'Dạng biểu đồ Task 1'}
                  </label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none font-medium"
                  >
                    {Object.entries(editTaskType === 'TASK_2' ? TASK_2_CATEGORIES : TASK_1_CATEGORIES).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Thời gian làm bài (phút)</label>
                  <input
                    type="number"
                    min="1"
                    max="240"
                    value={editDuration}
                    onChange={(e) => setEditDuration(parseInt(e.target.value, 10) || (editTaskType === 'TASK_2' ? 40 : 20))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Trạng thái đề</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none font-semibold"
                >
                  <option value="DRAFT">Bản nháp (DRAFT)</option>
                  <option value="PUBLISHED">Đang mở (PUBLISHED)</option>
                  <option value="CLOSED">Đã đóng (CLOSED)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Đề bài câu hỏi (Prompt Question)</label>
                <textarea
                  rows={3}
                  value={editPromptQuestion}
                  onChange={(e) => setEditPromptQuestion(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-serif"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Hướng dẫn làm bài</label>
                <input
                  type="text"
                  value={editInstructions}
                  onChange={(e) => setEditInstructions(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none"
                />
              </div>

              {editTaskType === 'TASK_1' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tải thêm ảnh biểu đồ mới</label>
                  <input
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.webp,.svg"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      setEditNewFiles(files);
                      setEditPreviews(files.map((f) => URL.createObjectURL(f)));
                    }}
                    className="w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 cursor-pointer"
                  />
                </div>
              )}

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingAssignment(null)}
                  className="px-4 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>Lưu thay đổi</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Verbatim Essay Reader */}
      {(viewingEssayData || loadingEssay) && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-100">
            {loadingEssay ? (
              <div className="p-12 text-center text-slate-500">
                <Loader2 className="w-7 h-7 animate-spin mx-auto mb-2 text-blue-600" />
                <p className="text-xs">Đang tải nội dung bài viết...</p>
              </div>
            ) : (
              <>
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3 bg-slate-50">
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-base">
                      {viewingEssayData.student?.full_name} ({viewingEssayData.student?.class_name})
                    </h3>
                    <p className="text-xs text-slate-500">
                      Đề thi: <strong>{viewingEssayData.assignment?.title}</strong> • Tổng số từ:{' '}
                      <strong className="text-blue-700">{viewingEssayData.attempt?.word_count || 0} từ</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setViewingEssayData(null)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-4 flex-1">
                  <div className="text-xs text-slate-500 flex flex-wrap gap-4 pb-2 border-b border-slate-100">
                    <span>
                      Bắt đầu: <strong className="text-slate-700">{viewingEssayData.attempt?.start_time ? new Date(viewingEssayData.attempt.start_time).toLocaleString('vi-VN') : '-'}</strong>
                    </span>
                    <span>
                      Nộp lúc: <strong className="text-slate-700">{viewingEssayData.attempt?.submitted_at ? new Date(viewingEssayData.attempt.submitted_at).toLocaleString('vi-VN') : '-'}</strong>
                    </span>
                    <span>
                      Trạng thái: <strong className="text-blue-800 uppercase font-bold">{viewingEssayData.attempt?.status}</strong>
                    </span>
                  </div>

                  {/* Question Prompt Preview */}
                  {viewingEssayData.assignment?.prompt_question && (
                    <div className="p-3 bg-blue-50/60 border border-blue-100 rounded-xl text-xs text-blue-900">
                      <strong className="block mb-1 font-bold">
                        Đề bài {(viewingEssayData.assignment?.type || viewingEssayData.assignment?.task_type) === 'TASK_2' ? 'IELTS Academic Writing Task 2:' : 'IELTS Academic Writing Task 1:'}
                      </strong>
                      <p className="font-serif whitespace-pre-line">{viewingEssayData.assignment.prompt_question}</p>
                    </div>
                  )}

                  {/* Verbatim Student Essay Content */}
                  <div>
                    <span className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
                      Bài làm nguyên văn của học sinh:
                    </span>
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-900 whitespace-pre-wrap leading-relaxed min-h-[200px] font-sans">
                      {viewingEssayData.attempt?.content || '(Học sinh chưa gõ nội dung)'}
                    </div>
                  </div>

                  {/* Anti-cheating Violation Audit Log */}
                  {viewingEssayData.violations && viewingEssayData.violations.length > 0 && (
                    <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <ShieldAlert className="w-4 h-4 text-red-600" /> Nhật ký chống gian lận (Rời màn hình / dán văn bản):
                      </div>
                      {viewingEssayData.violations.map((v) => (
                        <div key={v.id} className="font-mono text-[11px]">
                          • {new Date(v.timestamp).toLocaleTimeString('vi-VN')}: <strong>{v.event_type}</strong> — {v.details}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    {(['CANCELLED', 'INVALIDATED', 'EXPIRED', 'AUTO-SUBMITTED'].includes(viewingEssayData.attempt?.status)) && (
                      <button
                        type="button"
                        onClick={() => {
                          const target = {
                            ...viewingEssayData.attempt,
                            full_name: viewingEssayData.student?.full_name,
                            assignment_title: viewingEssayData.assignment?.title
                          };
                          setViewingEssayData(null);
                          setShowOverrideModal(target);
                        }}
                        className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <ShieldAlert className="w-4 h-4" />
                        <span>Cấp quyền làm lại / Mở khóa</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleDownloadSingleWord(
                          viewingEssayData.attempt.id,
                          `${viewingEssayData.student?.full_name || 'Bai_Writing'}.docx`
                        )
                      }
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Download className="w-4 h-4" />
                      <span>Tải file Word (.docx)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewingEssayData(null)}
                      className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-semibold cursor-pointer"
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Replace Default Teacher Account */}
      {showAccountModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 border border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Cập Nhật Tài Khoản Giáo Viên</h3>
                  <p className="text-xs text-slate-500">Thay thế tài khoản mặc định bằng tên và mật khẩu riêng</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAccountModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateTeacherAccount} className="space-y-3.5">
              {accError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{accError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tên đăng nhập mới (khác <code className="font-mono">teacher</code>)
                </label>
                <input
                  type="text"
                  value={accNewUsername}
                  onChange={(e) => setAccNewUsername(e.target.value)}
                  placeholder="Ví dụ: ms.nga hoặc co_nga_ielts"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tên hiển thị giáo viên</label>
                <input
                  type="text"
                  value={accFullName}
                  onChange={(e) => setAccFullName(e.target.value)}
                  placeholder="Ví dụ: Ms Nga (Giáo viên IELTS)"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mật khẩu hiện tại {requiresAccountSetup ? '(mặc định: teacher123)' : ''}
                </label>
                <input
                  type="password"
                  value={accCurrentPwd}
                  onChange={(e) => setAccCurrentPwd(e.target.value)}
                  placeholder="Nhập mật khẩu hiện tại"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Mật khẩu mới (tối thiểu 6 ký tự)</label>
                <input
                  type="password"
                  value={accNewPwd}
                  onChange={(e) => setAccNewPwd(e.target.value)}
                  placeholder="Nhập mật khẩu mới an toàn"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Xác nhận mật khẩu mới</label>
                <input
                  type="password"
                  value={accConfirmPwd}
                  onChange={(e) => setAccConfirmPwd(e.target.value)}
                  placeholder="Nhập lại mật khẩu mới"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAccountModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={accSaving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {accSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>Lưu tài khoản mới</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: KIỂM TRA HỆ THỐNG TRƯỚC GIỜ THI (Requirement 14) */}
      {showSystemCheckModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl max-w-xl w-full p-6 space-y-4 my-6 border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-100 text-emerald-800 rounded-xl">
                  <Activity className="w-5 h-5 text-emerald-700" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-base">Kiểm Tra Hệ Thống Trước Giờ Thi</h3>
                  <p className="text-xs text-slate-500">Tự động chẩn đoán 6 thành phần quan trọng trước khi bắt đầu bài kiểm tra</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSystemCheckModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {checkingSystem ? (
              <div className="py-12 text-center space-y-3">
                <Loader2 className="w-10 h-10 text-blue-600 animate-spin mx-auto" />
                <p className="font-extrabold text-slate-800 text-sm">Đang kiểm tra toàn diện hệ thống phòng thi trực tuyến...</p>
                <p className="text-xs text-slate-500">Đang kiểm tra máy chủ, cơ sở dữ liệu, đồng hồ 20 phút và bộ nộp bài cho 23 học sinh</p>
              </div>
            ) : systemCheckResult ? (
              <div className="space-y-4">
                {/* Result Header Banner */}
                <div className={`p-4 rounded-2xl flex items-start gap-3 border-2 ${
                  systemCheckResult.ready
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                    : 'bg-red-50 border-red-300 text-red-950'
                }`}>
                  {systemCheckResult.ready ? (
                    <CheckCircle className="w-7 h-7 text-emerald-600 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-7 h-7 text-red-600 flex-shrink-0 mt-0.5" />
                  )}
                  <div>
                    <h4 className="font-black text-sm sm:text-base tracking-tight">
                      {systemCheckResult.overallStatus}
                    </h4>
                    <p className={`text-xs mt-1 ${systemCheckResult.ready ? 'text-emerald-800' : 'text-red-800'}`}>
                      {systemCheckResult.ready
                        ? 'Tất cả các dịch vụ đang hoạt động hoàn hảo. Sẵn sàng cho 23 học sinh làm bài đồng thời.'
                        : 'Phát hiện thành phần chưa sẵn sàng. Vui lòng kiểm tra lại trước khi bắt đầu tiết thi.'}
                    </p>
                  </div>
                </div>

                {/* Checklist Detail */}
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {systemCheckResult.checks?.map((chk) => (
                    <div
                      key={chk.id}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-slate-800">{chk.name}</div>
                        <div className="text-slate-500">{chk.detail}</div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full font-bold text-[10px] shrink-0 ${
                        chk.status === 'READY'
                          ? 'bg-emerald-100 text-emerald-800'
                          : chk.status === 'WARNING'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {chk.status === 'READY' ? 'SẴN SÀNG' : chk.status === 'WARNING' ? 'LƯU Ý' : 'CHƯA ĐẠT'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Helpful tips for teacher */}
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-[11px] text-blue-900 leading-relaxed">
                  <strong>💡 Lời khuyên dành cho Cô Nga trước giờ thi:</strong>
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">
                    <li>Nếu dùng gói máy chủ miễn phí (Render Free), hãy bấm nút này trước giờ thi 2 phút để máy chủ khởi động hoàn toàn (tránh tình trạng ngủ đông).</li>
                    <li>Chiếu mã QR lên bảng hoặc gửi link vào nhóm lớp cho 23 học sinh quét mã vào phòng thi.</li>
                    <li>Nhắc học sinh để điện thoại ở chế độ "Không làm phiền" để tránh nhận cuộc gọi làm gián đoạn bài thi.</li>
                  </ul>
                </div>
              </div>
            ) : null}

            <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleRunSystemCheck}
                disabled={checkingSystem}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checkingSystem ? 'animate-spin' : ''}`} />
                <span>Kiểm tra lại</span>
              </button>
              <button
                type="button"
                onClick={() => setShowSystemCheckModal(false)}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Teacher Override / Reopen / Reset Attempt */}
      {showOverrideModal && (
        <TeacherOverrideModal
          attempt={showOverrideModal}
          onClose={() => setShowOverrideModal(null)}
          onSuccess={() => {
            setShowOverrideModal(null);
            loadSubmissions();
            loadAssignments();
            showNotification('success', 'Đã cấp quyền / mở khóa bài thi cho học sinh thành công!');
          }}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 text-xs font-bold rounded-xl flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
        active
          ? 'bg-blue-50 text-blue-700 shadow-2xs'
          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function TeacherOverrideModal({ attempt, onClose, onSuccess }) {
  const [action, setAction] = useState('ALLOW_NEW_ATTEMPT');
  const [reason, setReason] = useState('Giáo viên đồng ý cho phép học sinh làm lại bài thi mới');
  const [extendMinutes, setExtendMinutes] = useState(10);
  const [loading, setLoading] = useState(false);

  async function handleOverride(e) {
    e.preventDefault();
    if (!reason.trim()) {
      alert('Vui lòng nhập lý do can thiệp');
      return;
    }

    setLoading(true);
    try {
      await apiRequest(`/teacher/attempts/${attempt.id}/override`, 'POST', {
        action,
        reason: reason.trim(),
        extendMinutes
      });
      onSuccess();
    } catch (err) {
      alert('Không thể mở khóa bài: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-6 border border-slate-100">
        <div className="flex items-center gap-2 mb-3 text-amber-600">
          <ShieldAlert className="w-6 h-6" />
          <h3 className="font-extrabold text-slate-900 text-base">Cấp Quyền Làm Lại / Mở Khóa Bài</h3>
        </div>
        <p className="text-xs text-slate-600 mb-4">
          Học sinh: <strong>{attempt.full_name}</strong> • Đề: {attempt.assignment_title}
        </p>

        <form onSubmit={handleOverride} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Chọn hình thức xử lý</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none font-medium"
            >
              <option value="ALLOW_NEW_ATTEMPT">Cho phép làm lại bài mới (Reset attempt để học sinh thi lại)</option>
              <option value="REOPEN_AND_EXTEND">Mở lại bài đã làm (giữ văn bản cũ) và cộng thêm phút</option>
              <option value="ACCEPT_CANCELLED">Công nhận bài làm bị hủy sang trạng thái Đã nộp</option>
            </select>
          </div>

          {action === 'REOPEN_AND_EXTEND' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Cộng thêm số phút làm bài</label>
              <input
                type="number"
                min={1}
                max={120}
                value={extendMinutes}
                onChange={(e) => setExtendMinutes(parseInt(e.target.value, 10) || 10)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Lý do mở lại / phê duyệt</label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
              required
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-slate-300 rounded-xl text-xs text-slate-700 cursor-pointer font-semibold"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold cursor-pointer shadow-xs"
            >
              {loading ? 'Đang xử lý...' : 'Xác nhận mở khóa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
