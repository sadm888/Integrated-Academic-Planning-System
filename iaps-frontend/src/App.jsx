import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AlertTriangle, Tag, Image as ImageIcon, MessageSquare } from 'lucide-react';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Classrooms from './pages/Classrooms';
import ClassroomDetail from './pages/ClassroomDetail';
import SemesterDetail from './pages/SemesterDetail';
import Calendar from './pages/Calendar';
import Chat from './pages/Chat';
import Settings from './pages/Settings';
import Academics from './pages/Academics';
import Files from './pages/Files';
import Timetable from './pages/Timetable';
import AcademicCalendar from './pages/AcademicCalendar';
import Marks from './pages/Marks';
import MarksDetail from './pages/MarksDetail';
import Attendance from './pages/Attendance';
import Navbar from './components/Navbar';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import { settingsAPI, chatAPI, dmAPI } from './services/api';

function RouteTitle() {
  const loc = useLocation();
  useEffect(() => {
    if (loc.pathname.includes('/chat')) { document.title = 'Chat · IAPS'; return; }
    if (loc.pathname.includes('/files')) { document.title = 'Files · IAPS'; return; }
    if (loc.pathname.match(/\/semester\/\d+$/)) { document.title = 'Semester · IAPS'; return; }
    if (loc.pathname.includes('/classroom/')) { document.title = 'Classroom · IAPS'; return; }
    const map = { '/classrooms': 'Classrooms', '/calendar': 'Calendar', '/settings': 'Settings', '/login': 'Login', '/signup': 'Sign Up' };
    const key = Object.keys(map).find(k => loc.pathname.startsWith(k));
    document.title = key ? `${map[key]} · IAPS` : 'IAPS';
  }, [loc]);
  return null;
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [photoNotice, setPhotoNotice] = useState(null); // { reason, removedBy } or null
  const [nameNotice, setNameNotice] = useState(null); // { reason, removedBy } or null
  const [pendingWarnings, setPendingWarnings] = useState([]); // queue of unshown warnings
  const [dmUnreadCount, setDmUnreadCount] = useState(0);

  const fetchWarnings = async () => {
    try {
      const res = await chatAPI.getMyWarnings();
      if (res.data.warnings?.length > 0) {
        setPendingWarnings(res.data.warnings);
      }
    } catch {
      // non-critical
    }
  };

  const fetchDmUnread = async () => {
    try {
      const res = await dmAPI.getUnreadCount();
      setDmUnreadCount(res.data.count || 0);
    } catch {
      // non-critical
    }
  };

  const dismissCurrentWarning = async (warningId) => {
    try { await chatAPI.dismissWarning(warningId); } catch {}
    setPendingWarnings(prev => prev.slice(1));
  };

  const checkPhotoRemoval = async () => {
    try {
      const res = await settingsAPI.getMe();
      const profile = res.data.user;
      // Always sync user state + localStorage with fresh DB data
      setUser(profile);
      localStorage.setItem('user', JSON.stringify(profile));
      if (profile?.photo_removed_reason) {
        setPhotoNotice({
          reason: profile.photo_removed_reason,
          removedBy: profile.photo_removed_by || 'a Class Representative',
        });
      } else {
        setPhotoNotice(null);
      }
      if (profile?.name_removed_reason) {
        setNameNotice({
          reason: profile.name_removed_reason,
          removedBy: profile.name_removed_by || 'a Class Representative',
        });
      } else {
        setNameNotice(null);
      }
    } catch {
      // silently ignore — not critical
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');

    if (token && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
        checkPhotoRemoval();
        fetchWarnings();
        fetchDmUnread();
      } catch (e) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  // Poll DM unread count every 20s while logged in
  useEffect(() => {
    if (!user) return;
    const id = setInterval(fetchDmUnread, 20000);
    return () => clearInterval(id);
  }, [user]);

  // Refresh user data when the tab regains focus (stale user fix, #18)
  useEffect(() => {
    const handleFocus = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;
      try {
        const res = await settingsAPI.getMe();
        const fresh = res.data.user;
        localStorage.setItem('user', JSON.stringify(fresh));
        setUser(fresh);
        // Keep notices in sync with fresh DB data
        if (fresh.photo_removed_reason) {
          setPhotoNotice({ reason: fresh.photo_removed_reason, removedBy: fresh.photo_removed_by || 'a Class Representative' });
        } else {
          setPhotoNotice(null);
        }
        if (fresh.name_removed_reason) {
          setNameNotice({ reason: fresh.name_removed_reason, removedBy: fresh.name_removed_by || 'a Class Representative' });
        } else {
          setNameNotice(null);
        }
      } catch {
        // Token expired or revoked — log out
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const handleAuthSuccess = (userData, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    checkPhotoRemoval();
    fetchWarnings();
    fetchDmUnread();
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const handleProfileUpdate = (updatedUser, newToken) => {
    if (newToken) localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(updatedUser));
    setUser(updatedUser);
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '18px',
        color: '#667eea'
      }}>
        Loading...
      </div>
    );
  }

  return (
    <ToastProvider>
    <ThemeProvider userId={user?.id}>
    {/* Photo removal notice modal */}
    {photoNotice && (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000,
      }}>
        <div style={{
          background: 'white', borderRadius: '16px', padding: '32px',
          maxWidth: '420px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '40px', marginBottom: '12px', display: 'flex', justifyContent: 'center' }}><AlertTriangle size={40} strokeWidth={1.75} color="#f59e0b" /></div>
          <h2 style={{ margin: '0 0 8px', color: '#1f2937', fontSize: '18px' }}>
            Your profile photo was removed
          </h2>
          <p style={{ color: '#6b7280', fontSize: '14px', margin: '0 0 8px' }}>
            Removed by <strong>{photoNotice.removedBy}</strong>
          </p>
          <p style={{
            background: '#fef2f2', color: '#991b1b', borderRadius: '8px',
            padding: '12px 16px', fontSize: '14px', margin: '0 0 24px', lineHeight: '1.5',
          }}>
            {photoNotice.reason}
          </p>
          <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '24px' }}>
            You can upload a new photo that follows community guidelines from your settings.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button
              onClick={async () => {
                try { await settingsAPI.acknowledgePhotoRemoval(); } catch {}
                const cleaned = user ? { ...user, photo_removed_reason: null, photo_removed_by: null } : user;
                if (cleaned) localStorage.setItem('user', JSON.stringify(cleaned));
                setUser(cleaned);
                setPhotoNotice(null);
              }}
              style={{
                padding: '10px 24px', borderRadius: '8px', border: '1.5px solid #e5e7eb',
                background: 'white', color: '#374151', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              }}
            >
              Dismiss
            </button>
            <button
              onClick={async () => {
                try { await settingsAPI.acknowledgePhotoRemoval(); } catch {}
                const cleaned = user ? { ...user, photo_removed_reason: null, photo_removed_by: null } : user;
                if (cleaned) localStorage.setItem('user', JSON.stringify(cleaned));
                setUser(cleaned);
                setPhotoNotice(null);
                window.location.href = '/settings';
              }}
              style={{
                padding: '10px 24px', borderRadius: '8px', border: 'none',
                background: '#667eea', color: 'white', fontSize: '14px', fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Go to Settings
            </button>
          </div>
        </div>
      </div>
    )}
    {/* Display name flagged notice */}
    {nameNotice && !photoNotice && (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000,
      }}>
        <div style={{
          background: 'var(--card-bg, white)', borderRadius: '16px', padding: '32px',
          maxWidth: '420px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          textAlign: 'center', border: '2px solid #a855f7',
        }}>
          <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}><Tag size={40} color="#a855f7" strokeWidth={1.5} /></div>
          <h2 style={{ margin: '0 0 8px', color: 'var(--text-primary, #1f2937)', fontSize: '18px' }}>
            Your display name has been flagged
          </h2>
          <p style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '14px', margin: '0 0 8px' }}>
            Flagged by <strong>{nameNotice.removedBy}</strong>
          </p>
          <p style={{
            background: '#fdf4ff', color: '#6b21a8', borderRadius: '8px',
            padding: '12px 16px', fontSize: '14px', margin: '0 0 12px', lineHeight: '1.5',
          }}>
            {nameNotice.reason}
          </p>
          <p style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '13px', marginBottom: '24px' }}>
            You are currently shown as <strong>Anonymous User</strong>. Please change your <strong>Full Name</strong> in
            Settings to restore your display name.
          </p>
          <button
            onClick={() => { window.location.href = '/settings'; }}
            style={{
              padding: '10px 32px', borderRadius: '8px', border: 'none',
              background: '#7c3aed', color: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Change Name
          </button>
        </div>
      </div>
    )}
    {/* One-time warning popup (chat content / username / picture) */}
    {pendingWarnings.length > 0 && !photoNotice && (() => {
      const w = pendingWarnings[0];
      const typeLabel = w.warn_type === 'name' ? 'Display Name' : w.warn_type === 'picture' ? 'Profile Picture' : 'Chat Message';
      const typeIcon = w.warn_type === 'name' ? <Tag size={16} strokeWidth={1.75} style={{ verticalAlign: 'middle' }} /> : w.warn_type === 'picture' ? <ImageIcon size={16} strokeWidth={1.75} style={{ verticalAlign: 'middle' }} /> : <MessageSquare size={16} strokeWidth={1.75} style={{ verticalAlign: 'middle' }} />;
      return (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2100,
        }}>
          <div style={{
            background: 'var(--card-bg, white)', borderRadius: '16px', padding: '32px',
            maxWidth: '440px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            textAlign: 'center', border: '2px solid #fbbf24',
          }}>
            <div style={{ fontSize: '40px', marginBottom: '8px', display: 'flex', justifyContent: 'center' }}><AlertTriangle size={40} strokeWidth={1.75} color="#f59e0b" /></div>
            <h2 style={{ margin: '0 0 4px', color: 'var(--text-primary, #1f2937)', fontSize: '18px' }}>
              Warning — {typeIcon} {typeLabel}
            </h2>
            <p style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '13px', margin: '0 0 6px' }}>
              Warning from <strong>{w.cr_name}</strong>
            </p>
            {w.warn_type === 'username' && w.warned_name && (
              <p style={{
                background: 'rgba(251,191,36,0.15)', border: '1px solid #fbbf24', borderRadius: '8px',
                padding: '8px 14px', fontSize: '13px', margin: '0 0 10px', color: 'var(--text-primary, #1f2937)',
              }}>
                Flagged name: <strong>{w.warned_name}</strong>
              </p>
            )}
            {w.reason && (
              <p style={{
                background: '#fef2f2', color: '#991b1b', borderRadius: '8px',
                padding: '12px 16px', fontSize: '14px', margin: '0 0 18px', lineHeight: '1.5',
              }}>
                {w.reason}
              </p>
            )}
            <p style={{ color: 'var(--text-secondary, #6b7280)', fontSize: '12px', marginBottom: '20px' }}>
              Please ensure your {typeLabel.toLowerCase()} follows community guidelines.
            </p>
            <button
              onClick={() => dismissCurrentWarning(w.id)}
              style={{
                padding: '10px 32px', borderRadius: '8px', border: 'none',
                background: '#667eea', color: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              }}
            >
              I Understand
            </button>
          </div>
        </div>
      );
    })()}

    <Router>
      <RouteTitle />
      {user && <Navbar user={user} onLogout={handleLogout} dmUnreadCount={dmUnreadCount} />}
      <Routes>
        <Route
          path="/login"
          element={
            user ? (
              <Navigate to="/classrooms" replace />
            ) : (
              <Login onAuthSuccess={handleAuthSuccess} />
            )
          }
        />
        <Route
          path="/signup"
          element={
            user ? (
              <Navigate to="/classrooms" replace />
            ) : (
              <Signup onAuthSuccess={handleAuthSuccess} />
            )
          }
        />
        <Route
          path="/classrooms"
          element={
            user ? (
              <Classrooms user={user} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/classroom/:classroomId"
          element={
            user ? (
              <ClassroomDetail user={user} onDmRead={fetchDmUnread} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/files"
          element={
            user ? (
              <Files user={user} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/classroom/:classroomId/semester/:semesterId/files"
          element={
            user ? (
              <Academics user={user} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/calendar"
          element={
            user ? (
              <Calendar user={user} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/classroom/:classroomId/semester/:semesterId"
          element={
            user ? (
              <SemesterDetail user={user} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/classroom/:classroomId/semester/:semesterId/marks"
          element={
            user ? (
              <Marks user={user} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/classroom/:classroomId/semester/:semesterId/marks/:subjectId"
          element={
            user ? (
              <MarksDetail user={user} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/classroom/:classroomId/semester/:semesterId/timetable"
          element={
            user ? (
              <Timetable user={user} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/classroom/:classroomId/semester/:semesterId/attendance"
          element={
            user ? (
              <Attendance user={user} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/classroom/:classroomId/semester/:semesterId/academic-calendar"
          element={
            user ? (
              <AcademicCalendar user={user} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/classroom/:classroomId/semester/:semesterId/calendar"
          element={
            user ? (
              <Calendar user={user} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/classroom/:classroomId/semester/:semesterId/chat"
          element={
            user ? (
              <Chat user={user} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/settings"
          element={
            user ? (
              <Settings user={user} onLogout={handleLogout} onProfileUpdate={handleProfileUpdate} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/"
          element={<Navigate to={user ? "/classrooms" : "/login"} replace />}
        />
        <Route
          path="*"
          element={<Navigate to={user ? "/classrooms" : "/login"} replace />}
        />
      </Routes>
    </Router>
    </ThemeProvider>
    </ToastProvider>
  );
}

export default App;
