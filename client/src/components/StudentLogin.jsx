import React, { useState, useEffect } from 'react';
import { apiRequest, setStudentToken } from '../api';
import { GraduationCap, Lock, User, School, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';

export default function StudentLogin({ onLoginSuccess, onSwitchToTeacher }) {
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [fullName, setFullName] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchingClasses, setFetchingClasses] = useState(true);
  const [activeExams, setActiveExams] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchClasses();
    fetchActiveExams();
  }, []);

  async function fetchActiveExams() {
    try {
      const data = await apiRequest('/exam/active/list');
      setActiveExams(data.exams || []);
    } catch (_) {}
  }

  async function fetchClasses() {
    setFetchingClasses(true);
    try {
      const data = await apiRequest('/auth/student/classes');
      setClasses(data.classes || []);
      if (data.classes && data.classes.length > 0) {
        setSelectedClassId(data.classes[0].id);
      }
    } catch (err) {
      setError('Không thể tải danh sách lớp học: ' + err.message);
    } finally {
      setFetchingClasses(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!selectedClassId) {
      setError('Vui lòng chọn lớp học');
      return;
    }
    if (!fullName.trim()) {
      setError('Vui lòng nhập Họ và Tên của bạn');
      return;
    }
    if (!pin.trim()) {
      setError('Vui lòng nhập Mã PIN cá nhân');
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest('/auth/student/login', 'POST', {
        classId: selectedClassId,
        fullName: fullName.trim(),
        pin: pin.trim()
      });

      setStudentToken(res.token);
      if (onLoginSuccess) {
        onLoginSuccess(res.student);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-slate-100 flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-700 to-blue-600 px-6 py-6 text-white text-center">
          <div className="inline-flex p-3 bg-white/15 rounded-2xl mb-3 shadow-inner">
            <GraduationCap className="w-8 h-8 text-blue-100" />
          </div>
          <h1 className="text-2xl font-black tracking-tight">IELTS Ms Nga</h1>
          <p className="text-blue-100 text-xs sm:text-sm mt-1">Cổng Làm Bài Thi IELTS Academic Writing (Task 1 & Task 2)</p>
        </div>

        {/* Direct Exam Entry Banner (No Login / No Account needed) */}
        {activeExams.length > 0 && (
          <div className="p-5 bg-gradient-to-r from-blue-600 to-indigo-700 text-white space-y-3 border-b border-blue-500">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-xs font-bold uppercase tracking-wider text-blue-100">
                Đang có đề thi trực tiếp tại lớp
              </span>
            </div>
            <p className="text-xs text-blue-100">
              Học sinh bấm vào đề thi bên dưới để vào làm bài ngay (chỉ cần nhập Họ Tên, không cần tạo tài khoản hay mã PIN):
            </p>
            <div className="space-y-2 pt-1">
              {activeExams.map((exam) => (
                <button
                  key={exam.id}
                  type="button"
                  onClick={() => { window.location.hash = `#exam/${exam.id}`; }}
                  className="w-full text-left p-3.5 bg-white text-slate-900 rounded-xl font-bold text-xs sm:text-sm hover:bg-blue-50 shadow-md flex items-center justify-between gap-3 cursor-pointer transition-all hover:translate-x-0.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-blue-900 truncate font-black">{exam.title}</div>
                    <div className="text-[11px] text-slate-500 font-normal">
                      Thời gian: {exam.duration_minutes || 20} phút • {exam.class_name || 'Lớp học Ms Nga'}
                    </div>
                  </div>
                  <span className="px-3 py-1.5 bg-blue-600 text-white text-xs font-black rounded-lg shrink-0 flex items-center gap-1 shadow-xs">
                    <span>Vào thi</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="flex items-start gap-3 p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm animate-shake">
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-500 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Class Select */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              Lớp Học
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <School className="w-5 h-5" />
              </div>
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                disabled={fetchingClasses || loading}
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-base focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none"
              >
                {fetchingClasses ? (
                  <option>Đang tải danh sách lớp...</option>
                ) : classes.length === 0 ? (
                  <option>Chưa có lớp học nào</option>
                ) : (
                  classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Full Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              Họ và Tên Học Sinh
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <User className="w-5 h-5" />
              </div>
              <input
                type="text"
                placeholder="Ví dụ: Nguyễn Văn An"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={loading}
                autoComplete="name"
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-base focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none"
              />
            </div>
          </div>

          {/* PIN */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              Mã PIN Cá Nhân
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Lock className="w-5 h-5" />
              </div>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                placeholder="Mã PIN 4-6 số do giáo viên cấp"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                disabled={loading}
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-base tracking-widest focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none"
              />
            </div>
            <p className="text-xs text-slate-500 mt-1.5">
              Học sinh sử dụng mã PIN giáo viên đã cấp. Không cần tài khoản email.
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-xl shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Đang đăng nhập...</span>
              </>
            ) : (
              <>
                <span>Vào Làm Bài Viết</span>
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 text-center">
          <button
            type="button"
            onClick={onSwitchToTeacher}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors cursor-pointer"
          >
            Dành cho Giáo viên: Đăng nhập Dashboard →
          </button>
        </div>
      </div>

      <div className="mt-6 text-center text-xs text-slate-500 max-w-sm">
        Hệ thống gõ bài Writing trực tuyến trên điện thoại qua Wi-Fi, 4G hoặc 5G.
      </div>
    </div>
  );
}
