import React, { useState, useEffect } from 'react';
import { apiRequest } from '../api';
import {
  Plus,
  Trash2,
  Upload,
  KeyRound,
  AlertTriangle,
  Loader2
} from 'lucide-react';

export default function ClassesAndStudentsManager({ classes, onRefresh, showNotification }) {
  const [selectedClass, setSelectedClass] = useState(classes[0] || null);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [studentsError, setStudentsError] = useState('');

  const [showAddClass, setShowAddClass] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [newClassDesc, setNewClassDesc] = useState('');

  const [showAddStudent, setShowAddStudent] = useState(false);
  const [studentFullName, setStudentFullName] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [studentPin, setStudentPin] = useState('');

  const [showImportExcel, setShowImportExcel] = useState(false);
  const [excelFile, setExcelFile] = useState(null);
  const [importing, setImporting] = useState(false);

  // States for Class Deletion & Data Protection Modal
  const [classToDelete, setClassToDelete] = useState(null);
  const [deletingClass, setDeletingClass] = useState(false);
  const [confirmDeleteInput, setConfirmDeleteInput] = useState('');
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    if (classes.length === 0) {
      setSelectedClass(null);
      return;
    }
    if (!selectedClass) {
      setSelectedClass(classes[0]);
      return;
    }
    const matched = classes.find((c) => c.id === selectedClass.id);
    if (matched) {
      setSelectedClass(matched);
    } else {
      setSelectedClass(classes[0]);
    }
  }, [classes]);

  useEffect(() => {
    if (selectedClass?.id) {
      loadStudents(selectedClass.id);
    } else {
      setStudents([]);
    }
  }, [selectedClass?.id]);

  async function loadStudents(classId) {
    setLoading(true);
    setStudentsError('');
    try {
      const res = await apiRequest(`/students?classId=${classId}`);
      setStudents(res.students || []);
    } catch (err) {
      setStudentsError(err.message);
      showNotification('error', 'Lỗi tải học sinh: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateClass(e) {
    e.preventDefault();
    if (!newClassName.trim()) return;
    try {
      await apiRequest('/classes', 'POST', { name: newClassName.trim(), description: newClassDesc.trim() });
      setNewClassName('');
      setNewClassDesc('');
      setShowAddClass(false);
      onRefresh();
      showNotification('success', 'Đã thêm lớp học mới');
    } catch (err) {
      showNotification('error', err.message);
    }
  }

  async function handleAddStudent(e) {
    e.preventDefault();
    if (!studentFullName.trim() || !studentPin.trim() || !selectedClass) return;
    try {
      await apiRequest('/students', 'POST', {
        classId: selectedClass.id,
        fullName: studentFullName.trim(),
        studentCode: studentCode.trim(),
        pin: studentPin.trim()
      });
      setStudentFullName('');
      setStudentCode('');
      setStudentPin('');
      setShowAddStudent(false);
      await loadStudents(selectedClass.id);
      onRefresh();
      showNotification('success', 'Đã thêm học sinh thành công');
    } catch (err) {
      showNotification('error', err.message);
    }
  }

  async function handleResetPin(studentId) {
    const customPin = prompt('Nhập mã PIN mới (4-6 số) hoặc để trống để tạo ngẫu nhiên:');
    if (customPin === null) return;
    try {
      const res = await apiRequest(`/students/${studentId}/reset-pin`, 'POST', { newPin: customPin || undefined });
      loadStudents(selectedClass.id);
      alert(`Đã đặt lại mã PIN thành công! Mã PIN mới: ${res.newPin}`);
    } catch (err) {
      showNotification('error', err.message);
    }
  }

  async function handleToggleStatus(studentId) {
    try {
      await apiRequest(`/students/${studentId}/toggle-status`, 'POST');
      loadStudents(selectedClass.id);
      showNotification('success', 'Đã thay đổi trạng thái tài khoản');
    } catch (err) {
      showNotification('error', err.message);
    }
  }

  async function handleImportExcel(e) {
    e.preventDefault();
    if (!excelFile || !selectedClass) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', excelFile);
      formData.append('classId', selectedClass.id);
      const res = await apiRequest('/students/import', 'POST', formData, true);
      setShowImportExcel(false);
      setExcelFile(null);
      await loadStudents(selectedClass.id);
      onRefresh();
      showNotification('success', `Đã nhập thành công ${res.importedCount} học sinh từ Excel!`);
    } catch (err) {
      showNotification('error', 'Lỗi nhập Excel: ' + err.message);
    } finally {
      setImporting(false);
    }
  }

  async function handlePermanentDeleteClass(classObj, typedName) {
    if (!classObj) return;
    if (!typedName || typedName.trim() !== classObj.name.trim()) {
      setDeleteError(`Tên lớp không khớp. Vui lòng nhập chính xác "${classObj.name}"`);
      return;
    }
    setDeletingClass(true);
    setDeleteError('');
    try {
      const res = await apiRequest(`/classes/${classObj.id}/permanent-delete`, 'POST', {
        confirmClassName: typedName.trim()
      });
      showNotification('success', res.message || `Đã xóa vĩnh viễn lớp "${classObj.name}"!`);
      setClassToDelete(null);
      setConfirmDeleteInput('');
      await onRefresh();
      const remaining = classes.filter((c) => c.id !== classObj.id);
      if (selectedClass?.id === classObj.id) {
        setSelectedClass(remaining.length > 0 ? remaining[0] : null);
      }
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeletingClass(false);
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {/* Classes list column */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <h3 className="font-bold text-slate-900 text-sm">Danh Sách Lớp</h3>
          <button
            onClick={() => setShowAddClass(true)}
            className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
            title="Thêm lớp mới"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {showAddClass && (
          <form onSubmit={handleCreateClass} className="p-3 bg-slate-50 rounded-xl space-y-2 border border-slate-200">
            <input
              type="text"
              placeholder="Tên lớp (ví dụ: 12A2)"
              value={newClassName}
              onChange={(e) => setNewClassName(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
            />
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setShowAddClass(false)}
                className="px-2.5 py-1 text-slate-500 text-xs cursor-pointer"
              >
                Hủy
              </button>
              <button type="submit" className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-semibold cursor-pointer">
                Lưu
              </button>
            </div>
          </form>
        )}

        <div className="space-y-1.5">
          {classes.map((c) => {
            const isSelected = selectedClass?.id === c.id;
            return (
              <div
                key={c.id}
                onClick={() => setSelectedClass(c)}
                className={`group w-full p-2.5 rounded-xl text-xs font-medium transition-all flex items-center justify-between cursor-pointer border ${
                  isSelected
                    ? 'bg-blue-600 text-white font-bold border-blue-600 shadow-xs'
                    : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-100 hover:border-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 truncate flex-1 min-w-0 pr-1">
                  <span className="truncate">{c.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-md flex-shrink-0 font-semibold ${
                      isSelected ? 'bg-blue-700 text-blue-100' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {c.student_count || 0} HS
                  </span>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setClassToDelete(c);
                  }}
                  className={`p-1.5 rounded-lg transition-colors flex-shrink-0 cursor-pointer ${
                    isSelected
                      ? 'text-blue-200 hover:text-white hover:bg-red-500/80'
                      : 'text-slate-400 hover:text-red-600 hover:bg-red-50'
                  }`}
                  title={`Xóa lớp ${c.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Students list column */}
      <div className="md:col-span-3 bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-900 text-base">
              Học Sinh: {selectedClass ? selectedClass.name : 'Chọn lớp'}
            </h3>
            <p className="text-xs text-slate-500">
              Quản lý tài khoản, mã PIN và nhập danh sách từ file Excel
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImportExcel(true)}
              disabled={!selectedClass}
              className="px-3 py-2 bg-green-50 hover:bg-green-100 text-green-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Nhập từ Excel (.xlsx)</span>
            </button>
            <button
              onClick={() => setShowAddStudent(true)}
              disabled={!selectedClass}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm Học Sinh</span>
            </button>
          </div>
        </div>

        {/* Students Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase">
              <tr>
                <th className="py-2.5 px-3">Mã HS</th>
                <th className="py-2.5 px-3">Họ và Tên</th>
                <th className="py-2.5 px-3">Trạng Thái</th>
                <th className="py-2.5 px-3 text-right">Mã PIN & Quản Trị</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-1.5 text-blue-600" />
                    <span>Đang tải danh sách học sinh...</span>
                  </td>
                </tr>
              ) : studentsError ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-red-600">
                    <p className="font-semibold mb-2">Lỗi tải danh sách học sinh: {studentsError}</p>
                    <button
                      type="button"
                      onClick={() => selectedClass && loadStudents(selectedClass.id)}
                      className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Thử tải lại
                    </button>
                  </td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-400">
                    Chưa có học sinh nào trong lớp này. Hãy thêm học sinh hoặc nhập từ file Excel.
                  </td>
                </tr>
              ) : (
                students.map((st) => (
                  <tr key={st.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-mono text-slate-500">{st.student_code || '-'}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-900">{st.full_name}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          st.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {st.status === 'ACTIVE' ? 'Hoạt động' : 'Đã khóa'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right space-x-1.5">
                      <button
                        onClick={() => handleResetPin(st.id)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                        title="Đặt lại mã PIN"
                      >
                        <KeyRound className="w-3 h-3" />
                        <span>Reset PIN</span>
                      </button>
                      <button
                        onClick={() => handleToggleStatus(st.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                          st.status === 'ACTIVE'
                            ? 'bg-red-50 text-red-600 hover:bg-red-100'
                            : 'bg-green-50 text-green-600 hover:bg-green-100'
                        }`}
                      >
                        {st.status === 'ACTIVE' ? 'Khóa' : 'Mở khóa'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Modal Add Student */}
        {showAddStudent && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
              <h3 className="font-bold text-slate-900 text-base mb-3">Thêm Học Sinh Mới Vào Lớp</h3>
              <form onSubmit={handleAddStudent} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Họ và Tên</label>
                  <input
                    type="text"
                    placeholder="Ví dụ: Trần Thị Bình"
                    value={studentFullName}
                    onChange={(e) => setStudentFullName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Mã Học Sinh (Không bắt buộc)</label>
                  <input
                    type="text"
                    placeholder="Ví dụ: HS005"
                    value={studentCode}
                    onChange={(e) => setStudentCode(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Mã PIN (4-6 số)</label>
                  <input
                    type="text"
                    placeholder="Ví dụ: 1234"
                    value={studentPin}
                    onChange={(e) => setStudentPin(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                    required
                  />
                </div>
                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddStudent(false)}
                    className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs text-slate-700 cursor-pointer"
                  >
                    Hủy
                  </button>
                  <button type="submit" className="px-4 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-bold cursor-pointer">
                    Thêm
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal Import Excel */}
        {showImportExcel && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
              <h3 className="font-bold text-slate-900 text-base mb-1">Nhập Danh Sách Học Sinh Từ Excel</h3>
              <p className="text-xs text-slate-500 mb-4">
                File Excel cần có cột <strong>Họ và Tên</strong> (và cột <strong>Mã HS</strong>, <strong>Mã PIN</strong> nếu có). Nếu không có cột PIN, hệ thống sẽ tự sinh PIN 4 số ngẫu nhiên.
              </p>
              <form onSubmit={handleImportExcel} className="space-y-4">
                <input
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  onChange={(e) => setExcelFile(e.target.files[0])}
                  className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100 cursor-pointer"
                  required
                />
                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowImportExcel(false)}
                    disabled={importing}
                    className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs text-slate-700 cursor-pointer"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={importing || !excelFile}
                    className="px-4 py-1.5 bg-green-600 text-white rounded-xl text-xs font-bold cursor-pointer"
                  >
                    {importing ? 'Đang nhập...' : 'Tải Lên & Nhập'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: XÓA VĨNH VIỄN LỚP HỌC */}
        {classToDelete && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 text-left border border-slate-100">
              <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                <div className="p-2.5 bg-red-100 rounded-2xl text-red-600">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Xóa Vĩnh Viễn Lớp Học</h3>
                  <p className="text-xs text-red-600 font-semibold">Hành động này sẽ xóa vĩnh viễn lớp và toàn bộ dữ liệu liên quan</p>
                </div>
              </div>

              {deleteError && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 text-xs text-slate-700">
                <div className="font-bold text-slate-900 text-sm">
                  Lớp: <span className="text-red-600">{classToDelete.name}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                  <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-2xs">
                    <div className="text-lg font-black text-slate-900">{classToDelete.student_count || 0}</div>
                    <div className="text-[10px] text-slate-500 font-medium">Học sinh</div>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-2xs">
                    <div className="text-lg font-black text-slate-900">{classToDelete.assignment_count || 0}</div>
                    <div className="text-[10px] text-slate-500 font-medium">Buổi Writing</div>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-2xs">
                    <div className="text-lg font-black text-slate-900">{classToDelete.attempt_count || 0}</div>
                    <div className="text-[10px] text-slate-500 font-medium">Bài làm</div>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 pt-1 leading-relaxed">
                  ⚠️ Toàn bộ tài khoản học sinh, buổi Writing và bài làm của lớp này sẽ bị xóa hoàn toàn.
                  <strong> Dữ liệu của các lớp khác vẫn được giữ nguyên 100%.</strong>
                </p>
              </div>

              <div className="mt-4 space-y-1.5">
                <label className="block text-xs font-semibold text-slate-800">
                  Nhập chính xác tên lớp để xác nhận: <span className="text-red-600 font-mono select-all font-bold">{classToDelete.name}</span>
                </label>
                <input
                  type="text"
                  value={confirmDeleteInput}
                  onChange={(e) => {
                    setConfirmDeleteInput(e.target.value);
                    setDeleteError('');
                  }}
                  placeholder={`Nhập chính xác: ${classToDelete.name}`}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 outline-none focus:bg-white focus:border-red-500 focus:ring-2 focus:ring-red-200 transition-all font-mono"
                  autoFocus
                />
              </div>

              <div className="mt-6 pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={deletingClass}
                  onClick={() => {
                    setClassToDelete(null);
                    setConfirmDeleteInput('');
                    setDeleteError('');
                  }}
                  className="px-4 py-2.5 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Hủy thao tác
                </button>
                <button
                  type="button"
                  disabled={confirmDeleteInput.trim() !== classToDelete.name.trim() || deletingClass}
                  onClick={() => handlePermanentDeleteClass(classToDelete, confirmDeleteInput)}
                  className="px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{deletingClass ? 'Đang xóa...' : 'Xóa vĩnh viễn lớp'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
