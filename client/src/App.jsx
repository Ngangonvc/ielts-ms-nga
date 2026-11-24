import React, { useState, useEffect, useRef } from 'react';
import StudentLogin from './components/StudentLogin';
import StudentWriting from './components/StudentWriting';
import StudentAssignments from './components/StudentAssignments';
import TeacherLogin from './components/TeacherLogin';
import TeacherDashboard from './components/TeacherDashboard';
import {
  getTeacherToken,
  setTeacherToken,
  getStudentToken,
  setStudentToken,
  TEACHER_TOKEN_KEY,
  STUDENT_TOKEN_KEY,
  apiRequest
} from './api';
import { Loader2 } from 'lucide-react';

export default function App() {
  const [view, setView] = useState('STUDENT_LOGIN'); // 'STUDENT_LOGIN', 'STUDENT_ASSIGNMENTS', 'STUDENT_WRITING', 'TEACHER_LOGIN', 'TEACHER_DASHBOARD'
  const [currentUser, setCurrentUser] = useState(null);
  const [activeAssignmentId, setActiveAssignmentId] = useState(null);
  const [loading, setLoading] = useState(true);

  const authSeqRef = useRef(0);
  const ignoreNextHashRef = useRef(false);
  const viewRef = useRef(view);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  function setHashProgrammatic(targetHash) {
    if (window.location.hash === targetHash || (!window.location.hash && !targetHash)) {
      return;
    }
    ignoreNextHashRef.current = true;
    if (!targetHash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      ignoreNextHashRef.current = false;
    } else {
      window.location.hash = targetHash;
    }
  }

  async function resolveRoute(showSpinner = false) {
    const seq = ++authSeqRef.current;
    if (showSpinner) setLoading(true);

    const hash = window.location.hash;

    // 1. Teacher portal routes (#/teacher)
    if (hash.startsWith('#/teacher')) {
      const teacherToken = getTeacherToken();
      if (teacherToken) {
        try {
          const res = await apiRequest('/auth/teacher/me');
          if (seq !== authSeqRef.current) return;
          setCurrentUser(res.teacher);
          setView('TEACHER_DASHBOARD');
          if (showSpinner) setLoading(false);
          return;
        } catch (e) {
          if (seq !== authSeqRef.current) return;
          setTeacherToken(null);
        }
      }
      if (seq !== authSeqRef.current) return;
      setCurrentUser(null);
      setView('TEACHER_LOGIN');
      if (showSpinner) setLoading(false);
      return;
    }

    // 2. Student portal routes (direct shared exam link, or student portal)
    let targetAssignmentId = null;
    if (hash.startsWith('#exam/')) {
      targetAssignmentId = hash.replace('#exam/', '');
    } else if (hash.startsWith('#/exam/')) {
      targetAssignmentId = hash.replace('#/exam/', '');
    } else if (hash.startsWith('#/student/write/')) {
      targetAssignmentId = hash.replace('#/student/write/', '');
    } else {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('exam')) {
        targetAssignmentId = urlParams.get('exam');
      }
    }

    if (targetAssignmentId) {
      setActiveAssignmentId(targetAssignmentId);
    }

    const studentToken = getStudentToken();
    if (studentToken) {
      try {
        const res = await apiRequest('/auth/student/me');
        if (seq !== authSeqRef.current) return;
        setCurrentUser(res.student);
        setView(targetAssignmentId ? 'STUDENT_WRITING' : 'STUDENT_ASSIGNMENTS');
        if (showSpinner) setLoading(false);
        return;
      } catch (e) {
        if (seq !== authSeqRef.current) return;
        setStudentToken(null);
      }
    }

    // Direct exam link access without an account
    if (targetAssignmentId) {
      if (seq !== authSeqRef.current) return;
      setCurrentUser(null);
      setView('STUDENT_WRITING');
      if (showSpinner) setLoading(false);
      return;
    }

    if (seq !== authSeqRef.current) return;
    setCurrentUser(null);
    setView('STUDENT_LOGIN');
    if (showSpinner) setLoading(false);
  }

  useEffect(() => {
    resolveRoute(true);

    const onHashChange = () => {
      if (ignoreNextHashRef.current) {
        ignoreNextHashRef.current = false;
        return;
      }
      resolveRoute(false);
    };

    const onAuthInvalid = (e) => {
      const role = e.detail?.role;
      if (role === 'TEACHER' && viewRef.current.startsWith('TEACHER_')) {
        authSeqRef.current++;
        setTeacherToken(null);
        setCurrentUser(null);
        setHashProgrammatic('#/teacher');
        setView('TEACHER_LOGIN');
      } else if (role === 'STUDENT' && viewRef.current.startsWith('STUDENT_')) {
        authSeqRef.current++;
        setStudentToken(null);
        setCurrentUser(null);
        setView('STUDENT_LOGIN');
      }
    };

    const onStorageSync = (e) => {
      if (e.key === TEACHER_TOKEN_KEY && !e.newValue && viewRef.current === 'TEACHER_DASHBOARD') {
        authSeqRef.current++;
        setCurrentUser(null);
        setHashProgrammatic('#/teacher');
        setView('TEACHER_LOGIN');
      } else if (e.key === STUDENT_TOKEN_KEY && !e.newValue && (viewRef.current === 'STUDENT_ASSIGNMENTS' || viewRef.current === 'STUDENT_WRITING')) {
        authSeqRef.current++;
        setCurrentUser(null);
        setView('STUDENT_LOGIN');
      }
    };

    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('ielts-auth-invalid', onAuthInvalid);
    window.addEventListener('storage', onStorageSync);

    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('ielts-auth-invalid', onAuthInvalid);
      window.removeEventListener('storage', onStorageSync);
    };
  }, []);

  function handleStudentLoginSuccess(student) {
    authSeqRef.current++;
    setCurrentUser(student);
    if (activeAssignmentId) {
      setHashProgrammatic(`#/student/write/${activeAssignmentId}`);
      setView('STUDENT_WRITING');
    } else {
      setHashProgrammatic('');
      setView('STUDENT_ASSIGNMENTS');
    }
  }

  function handleTeacherLoginSuccess(teacher) {
    authSeqRef.current++;
    setCurrentUser(teacher);
    setHashProgrammatic('#/teacher');
    setView('TEACHER_DASHBOARD');
  }

  function handleStudentLogout() {
    authSeqRef.current++;
    setStudentToken(null);
    setCurrentUser(null);
    setActiveAssignmentId(null);
    setHashProgrammatic('');
    setView('STUDENT_LOGIN');
  }

  function handleTeacherLogout() {
    authSeqRef.current++;
    setTeacherToken(null);
    setCurrentUser(null);
    setHashProgrammatic('#/teacher');
    setView('TEACHER_LOGIN');
  }

  function switchToTeacher() {
    setHashProgrammatic('#/teacher');
    resolveRoute(false);
  }

  function switchToStudent() {
    setActiveAssignmentId(null);
    setHashProgrammatic('');
    resolveRoute(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-500 font-medium">Đang khởi tạo IELTS Ms Nga Examination Portal...</p>
        </div>
      </div>
    );
  }

  switch (view) {
    case 'STUDENT_LOGIN':
      return (
        <StudentLogin
          onLoginSuccess={handleStudentLoginSuccess}
          onSwitchToTeacher={switchToTeacher}
        />
      );

    case 'STUDENT_ASSIGNMENTS':
      return (
        <StudentAssignments
          student={currentUser}
          onSelectAssignment={(id) => {
            setActiveAssignmentId(id);
            setHashProgrammatic(`#/student/write/${id}`);
            setView('STUDENT_WRITING');
          }}
          onLogout={handleStudentLogout}
        />
      );

    case 'STUDENT_WRITING':
      return (
        <StudentWriting
          assignmentId={activeAssignmentId}
          student={currentUser}
          onSelectAssignment={() => {
            setActiveAssignmentId(null);
            setHashProgrammatic('');
            setView('STUDENT_ASSIGNMENTS');
          }}
          onLogout={handleStudentLogout}
        />
      );

    case 'TEACHER_LOGIN':
      return (
        <TeacherLogin
          onLoginSuccess={handleTeacherLoginSuccess}
          onSwitchToStudent={switchToStudent}
        />
      );

    case 'TEACHER_DASHBOARD':
      return (
        <TeacherDashboard
          teacher={currentUser}
          onTeacherUpdated={(updatedTeacher) => setCurrentUser(updatedTeacher)}
          onLogout={handleTeacherLogout}
          onSwitchToStudent={switchToStudent}
        />
      );

    default:
      return (
        <StudentLogin
          onLoginSuccess={handleStudentLoginSuccess}
          onSwitchToTeacher={switchToTeacher}
        />
      );
  }
}
