import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ArrowRight,
  LogOut,
  Loader2
} from 'lucide-react';

export default function StudentAssignments({ student, onSelectAssignment, onLogout }) {
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadAssignments();
  }, []);

  async function loadAssignments() {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest('/student/assignments');
      setAssignments(data.assignments || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function renderStatusBadge(status) {
    switch (status) {
      case 'SUBMITTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
            <CheckCircle2 className="w-3.5 h-3.5" /> Đã nộp bài
          </span>
        );
      case 'IN_PROGRESS':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
            <Clock className="w-3.5 h-3.5" /> Đang viết bài
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
            <XCircle className="w-3.5 h-3.5" /> Đã bị hủy
          </span>
        );
      case 'EXPIRED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-200 text-slate-700">
            Hết giờ
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
            Chưa bắt đầu
          </span>
        );
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 shadow-xs">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-slate-800">IELTS Writing Classroom</h1>
            <p className="text-xs text-slate-500">
              Học sinh: <strong className="text-slate-700">{student?.fullName}</strong> • Lớp: {student?.className}
            </p>
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Đăng xuất</span>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-slate-900">Danh Sách Buổi Writing</h2>
          <p className="text-xs text-slate-600">Chọn buổi Writing do giáo viên mở để bắt đầu làm bài trên điện thoại</p>
        </div>

        {error && (
          <div className="p-3 mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
            <p className="text-xs">Đang tải danh sách buổi Writing...</p>
          </div>
        ) : assignments.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center border border-slate-200">
            <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="font-semibold text-slate-800 text-sm">Chưa có buổi Writing nào được mở</h3>
            <p className="text-xs text-slate-500 mt-1">
              Giáo viên chưa mở buổi Writing cho lớp {student?.className}. Vui lòng chờ giáo viên bắt đầu buổi học.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {assignments.map((item) => (
              <div
                key={item.id}
                onClick={() => onSelectAssignment(item.id)}
                className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 hover:border-blue-400 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                      Buổi Writing
                    </span>
                    {renderStatusBadge(item.attempt_status)}
                  </div>
                  <h3 className="text-base font-bold text-slate-800 group-hover:text-blue-600 transition-colors">
                    {item.title}
                  </h3>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> Thời gian: {item.duration_minutes} phút
                    </span>
                    {item.word_count > 0 && (
                      <span>Số từ đã viết: {item.word_count} từ</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <button className="px-4 py-2 bg-blue-50 group-hover:bg-blue-600 text-blue-600 group-hover:text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all">
                    <span>
                      {item.attempt_status === 'SUBMITTED'
                        ? 'Xem lại bài đã nộp'
                        : item.attempt_status === 'IN_PROGRESS'
                        ? 'Tiếp tục viết'
                        : item.attempt_status === 'CANCELLED'
                        ? 'Xem bài bị hủy'
                        : 'Bắt đầu làm bài'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
