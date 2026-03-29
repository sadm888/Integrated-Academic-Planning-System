import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import SemesterSubnav from '../components/SemesterSubnav';
import { semesterAPI, subjectAPI, documentAPI, todoAPI, classroomAPI, announcementAPI, linksAPI, timetableAPI, attendanceAPI, BACKEND_URL } from '../services/api';
import '../styles/Classroom.css';
import { Link as LinkIcon, X, FileText, Megaphone, Clock, ClipboardList, Bell, BellOff, ChevronDown, ChevronRight } from 'lucide-react';

function SemesterDetail({ user }) {
  const { classroomId, semesterId } = useParams();
  const navigate = useNavigate();

  const [semester, setSemester] = useState(null);
  const [classroom, setClassroom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Subjects
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [subjectName, setSubjectName] = useState('');
  const [subjectCode, setSubjectCode] = useState('');
  const [subjectCredits, setSubjectCredits] = useState('');
  const [subjectFaculties, setSubjectFaculties] = useState('');
  const [subjectDetails, setSubjectDetails] = useState('');
  const [subjectLoading, setSubjectLoading] = useState(false);
  const [expandedSubjectId, setExpandedSubjectId] = useState(null);
  const [editingSubjectId, setEditingSubjectId] = useState(null);
  const [editSubjectDraft, setEditSubjectDraft] = useState({});
  const [editSubjectSaving, setEditSubjectSaving] = useState(false);
  // Multi-layer delete: step 1 = confirm intent, step 2 = type name to confirm
  const [confirmDeleteSubject, setConfirmDeleteSubject] = useState(null); // { id, name }
  const [deleteSubjectConfirmStep, setDeleteSubjectConfirmStep] = useState(1); // 1 or 2
  const [deleteSubjectTyped, setDeleteSubjectTyped] = useState('');

  // Documents
  const [documents, setDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Todos
  const [todos, setTodos] = useState([]);
  const [newTodoText, setNewTodoText] = useState('');
  const [newTodoSubjectId, setNewTodoSubjectId] = useState('');
  const [newTodoDueDate, setNewTodoDueDate] = useState('');
  const [todoLoading, setTodoLoading] = useState(false);
  const [todoFilterSubjectId, setTodoFilterSubjectId] = useState('');

  const [docSearch, setDocSearch] = useState('');

  // Links
  const [links, setLinks] = useState([]);
  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [showAddLink, setShowAddLink] = useState(false);

  // Announcements
  const [announcements, setAnnouncements] = useState([]);
  const [newAnnouncementText, setNewAnnouncementText] = useState('');
  const [announcementLoading, setAnnouncementLoading] = useState(false);
  const [confirmPostAnnouncement, setConfirmPostAnnouncement] = useState(false);
  const [confirmDeleteAnnouncement, setConfirmDeleteAnnouncement] = useState(null); // { id, text }

  // Delete semester
  const [confirmDeleteSemester, setConfirmDeleteSemester] = useState(false);
  const [deleteSemesterLoading, setDeleteSemesterLoading] = useState(false);

  // Attendance summary cards
  const [attendanceSummary, setAttendanceSummary] = useState([]);

  // Today's timetable classes
  const [todayClasses, setTodayClasses] = useState([]);
  const [todayDay, setTodayDay] = useState('');
  const [todayLoading, setTodayLoading] = useState(false);

  // Upcoming exams (next 7 days from academic calendar)
  const [upcomingExams, setUpcomingExams] = useState([]);
  const [expandedExam, setExpandedExam] = useState(null); // index
  const [expandedClass, setExpandedClass] = useState(null); // index
  const [notifPermission, setNotifPermission] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [notifEnabled, setNotifEnabled] = useState(() =>
    localStorage.getItem(`exam_notifs_enabled_${semesterId}`) !== 'false'
  );

  const toggleNotif = () => {
    const next = !notifEnabled;
    setNotifEnabled(next);
    localStorage.setItem(`exam_notifs_enabled_${semesterId}`, next ? 'true' : 'false');
  };

  const [attendanceVisible, setAttendanceVisible] = useState(() =>
    localStorage.getItem(`attendance_hidden_${semesterId}`) !== 'true'
  );
  const [resourcesVisible, setResourcesVisible] = useState(() =>
    localStorage.getItem(`resources_hidden_${semesterId}`) !== 'true'
  );
  const toggleAttendanceVisible = () => {
    const next = !attendanceVisible;
    setAttendanceVisible(next);
    localStorage.setItem(`attendance_hidden_${semesterId}`, next ? 'false' : 'true');
  };
  const toggleResourcesVisible = () => {
    const next = !resourcesVisible;
    setResourcesVisible(next);
    localStorage.setItem(`resources_hidden_${semesterId}`, next ? 'false' : 'true');
  };

  useEffect(() => { loadAll(); }, [semesterId]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [semRes, classRes] = await Promise.all([
        semesterAPI.getDetail(semesterId),
        classroomAPI.getDetails(classroomId),
      ]);
      setSemester(semRes.data.semester);
      setClassroom(classRes.data.classroom);
      loadDocuments();
      loadTodos();
      loadAnnouncements();
      loadLinks();
      loadTodayClasses();
      loadUpcomingExams();
      loadAttendanceSummary();
    } catch (err) {
      setError('Failed to load semester');
    } finally {
      setLoading(false);
    }
  };

  const loadAttendanceSummary = async () => {
    const hidden = localStorage.getItem(`attendance_hidden_${semesterId}`) === 'true';
    if (hidden) return;
    try {
      const res = await attendanceAPI.getSummary(semesterId);
      setAttendanceSummary(res.data.subjects || []);
    } catch {
      // Non-critical — attendance may not be set up yet
    }
  };

  const loadDocuments = async () => {
    setDocsLoading(true);
    try {
      const res = await documentAPI.list(semesterId);
      setDocuments(res.data.documents || []);
    } catch (err) {
      console.error('Failed to load documents', err);
    } finally {
      setDocsLoading(false);
    }
  };

  const loadTodos = async () => {
    try {
      const res = await todoAPI.list(semesterId);
      setTodos(res.data.todos || []);
    } catch (err) {
      console.error('Failed to load todos', err);
    }
  };

  const loadAnnouncements = async () => {
    try {
      const res = await announcementAPI.list(semesterId);
      setAnnouncements(res.data.announcements || []);
    } catch (err) {
      console.error('Failed to load announcements', err);
    }
  };

  const loadLinks = async () => {
    try {
      const res = await linksAPI.list(semesterId);
      setLinks(res.data.links || []);
    } catch (err) {
      console.error('Failed to load links', err);
    }
  };

  const loadTodayClasses = async () => {
    setTodayLoading(true);
    try {
      const res = await timetableAPI.getToday(semesterId);
      setTodayClasses(res.data.classes || []);
      setTodayDay(res.data.day || '');
    } catch (err) {
      // non-critical — timetable may not be set up yet
    } finally {
      setTodayLoading(false);
    }
  };

  function localDateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const loadUpcomingExams = async () => {
    try {
      const res = await timetableAPI.getAcademicCalendar(semesterId);
      const acData = res.data.academic_calendar;
      if (!acData) return;
      const today = new Date();
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      const todayKey = localDateKey(today);
      const nextWeekKey = localDateKey(nextWeek);
      const exams = (acData.events || []).filter(ev => {
        if (!ev.date) return false;
        if (!['Exam', 'Semester Exam'].includes(ev.type)) return false;
        return ev.date >= todayKey && ev.date <= nextWeekKey;
      }).sort((a, b) => a.date.localeCompare(b.date));
      setUpcomingExams(exams);
      // Schedule browser notifications for exams happening tomorrow or today
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && localStorage.getItem(`exam_notifs_enabled_${semesterId}`) !== 'false') {
        const todayDate = localDateKey(new Date());
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowDate = localDateKey(tomorrow);
        exams.forEach(ev => {
          if (ev.date === todayDate) {
            new Notification(`Exam Today: ${ev.title}`, { body: ev.description || 'Good luck!', icon: '/favicon.ico' });
          } else if (ev.date === tomorrowDate) {
            new Notification(`Exam Tomorrow: ${ev.title}`, { body: ev.description || 'Prepare well!', icon: '/favicon.ico' });
          }
        });
      }
    } catch {
      // non-critical
    }
  };

  const requestNotifPermission = async () => {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
    if (result === 'granted') {
      setNotifEnabled(true);
      localStorage.setItem(`exam_notifs_enabled_${semesterId}`, 'true');
      loadUpcomingExams();
    }
  };

  // Countdown helper: returns "Today", "Tomorrow", "In N days"
  const examCountdown = (dateStr) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [y, m, d] = dateStr.split('-').map(Number);
    const examDate = new Date(y, m - 1, d);
    const diff = Math.round((examDate - today) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return `In ${diff} days`;
  };

  const handleAddLink = async (e) => {
    e.preventDefault();
    if (!newLinkLabel.trim() || !newLinkUrl.trim()) return;
    setLinkLoading(true);
    try {
      const res = await linksAPI.add(semesterId, newLinkLabel.trim(), newLinkUrl.trim());
      setLinks(prev => [...prev, res.data.link]);
      setNewLinkLabel(''); setNewLinkUrl(''); setShowAddLink(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add link');
    } finally { setLinkLoading(false); }
  };

  const handleDeleteLink = async (linkId) => {
    try {
      await linksAPI.delete(semesterId, linkId);
      setLinks(prev => prev.filter(l => l.id !== linkId));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete link');
    }
  };

  // ── Subjects ────────────────────────────────────────────────────────────────

  const handleAddSubject = async (e) => {
    e.preventDefault();
    if (!subjectName.trim()) return;
    setSubjectLoading(true);
    try {
      await subjectAPI.create({
        classroom_id: classroomId,
        semester_id: semesterId,
        name: subjectName.trim(),
        code: subjectCode.trim(),
        credits: subjectCredits.trim(),
        faculties: subjectFaculties.split(',').map(f => f.trim()).filter(Boolean),
        details: subjectDetails.trim(),
      });
      setSubjectName(''); setSubjectCode(''); setSubjectCredits('');
      setSubjectFaculties(''); setSubjectDetails(''); setShowAddSubject(false);
      const res = await semesterAPI.getDetail(semesterId);
      setSemester(res.data.semester);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add subject');
    } finally { setSubjectLoading(false); }
  };

  const startEditSubject = (sub) => {
    setEditSubjectDraft({
      code: sub.code || '',
      credits: sub.credits || '',
      faculties: sub.faculties?.join(', ') || '',
      details: sub.details || '',
    });
    setEditingSubjectId(sub.id);
  };

  const saveEditSubject = async (subjectId) => {
    setEditSubjectSaving(true);
    try {
      const facultiesArr = editSubjectDraft.faculties.split(',').map(f => f.trim()).filter(Boolean);
      await subjectAPI.update(subjectId, {
        code: editSubjectDraft.code.trim(),
        credits: editSubjectDraft.credits ? parseInt(editSubjectDraft.credits) : null,
        faculties: facultiesArr,
        details: editSubjectDraft.details.trim(),
      });
      // Refresh semester data to reflect changes
      const res = await semesterAPI.getDetail(semesterId);
      setSemester(res.data.semester);
      setEditingSubjectId(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setEditSubjectSaving(false);
    }
  };

  const handleDeleteSubject = async (subjectId) => {
    setConfirmDeleteSubject(null);
    try {
      await subjectAPI.delete(subjectId);
      const res = await semesterAPI.getDetail(semesterId);
      setSemester(res.data.semester);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete subject');
    }
  };

  // ── Documents ────────────────────────────────────────────────────────────────

  const handleDocUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('semesterId', semesterId);
      fd.append('classroomId', classroomId);
      await documentAPI.upload(fd);
      loadDocuments();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload document');
    } finally { setUploading(false); }
  };

  const handleDeleteDoc = async (docId) => {
    if (!window.confirm('Delete this document?')) return;
    try {
      await documentAPI.delete(docId);
      setDocuments(docs => docs.filter(d => d.id !== docId));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete document');
    }
  };

  const docUrl = (doc) => {
    const token = localStorage.getItem('token') || '';
    return `${BACKEND_URL}/api/document/${doc.id}/download?token=${encodeURIComponent(token)}`;
  };

  // ── Todos ───────────────────────────────────────────────────────────────────

  const handleAddTodo = async (e) => {
    e.preventDefault();
    if (!newTodoText.trim()) return;
    setTodoLoading(true);
    try {
      const res = await todoAPI.create({
        classroom_id: classroomId,
        semester_id: semesterId,
        text: newTodoText.trim(),
        subject_id: newTodoSubjectId || undefined,
        due_date: newTodoDueDate || undefined,
      });
      setTodos(prev => [res.data.todo, ...prev]);
      setNewTodoText('');
      setNewTodoSubjectId('');
      setNewTodoDueDate('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add todo');
    } finally { setTodoLoading(false); }
  };

  const handleToggleTodo = async (todoId) => {
    try {
      const res = await todoAPI.toggle(todoId);
      setTodos(prev => prev.map(t => t.id === todoId ? { ...t, completed: res.data.completed } : t));
    } catch (err) { console.error(err); }
  };

  const handleDeleteTodo = async (todoId) => {
    try {
      await todoAPI.delete(todoId);
      setTodos(prev => prev.filter(t => t.id !== todoId));
    } catch (err) { setError(err.response?.data?.error || 'Failed to delete todo'); }
  };

  // ── Announcements ────────────────────────────────────────────────────────────

  const handleAddAnnouncement = async (e) => {
    e.preventDefault();
    if (!newAnnouncementText.trim()) return;
    setConfirmPostAnnouncement(true);
  };

  const doPostAnnouncement = async () => {
    setConfirmPostAnnouncement(false);
    setAnnouncementLoading(true);
    try {
      const res = await announcementAPI.create(semesterId, newAnnouncementText.trim());
      setAnnouncements(prev => [res.data.announcement, ...prev]);
      setNewAnnouncementText('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to post announcement');
    } finally { setAnnouncementLoading(false); }
  };

  const handleDeleteAnnouncement = (ann) => {
    setConfirmDeleteAnnouncement({ id: ann.id, text: ann.text });
  };

  const doDeleteAnnouncement = async () => {
    const id = confirmDeleteAnnouncement?.id;
    setConfirmDeleteAnnouncement(null);
    if (!id) return;
    try {
      await announcementAPI.delete(id);
      setAnnouncements(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete announcement');
    }
  };

  // ── Delete Semester ──────────────────────────────────────────────────────────

  const handleDeleteSemester = async () => {
    setDeleteSemesterLoading(true);
    try {
      await semesterAPI.delete(semesterId);
      navigate(`/classroom/${classroomId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete semester');
      setConfirmDeleteSemester(false);
    } finally {
      setDeleteSemesterLoading(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '18px', color: '#667eea' }}>
        Loading...
      </div>
    );
  }

  if (!semester) {
    return (
      <div className="classroom-container">
        <p>Semester not found.</p>
        <button className="btn-primary" onClick={() => navigate(`/classroom/${classroomId}`)}>Back</button>
      </div>
    );
  }

  const isCr = semester.is_user_cr;
  const subjects = semester.subjects || [];
  const completedCount = todos.filter(t => t.completed).length;

  const subjectInputStyle = {
    padding: '7px 10px', borderRadius: '7px',
    border: '1.5px solid var(--border-color)',
    fontSize: '13px', background: 'var(--bg-color)',
    color: 'var(--text-primary)', outline: 'none',
    width: '100%', boxSizing: 'border-box',
  };
  const detailLabelStyle = {
    fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px',
  };

  return (
    <div className="classroom-container">
      {/* Header */}
      <div style={{ marginBottom: '4px' }}>
        <button onClick={() => navigate(`/classroom/${classroomId}`)} style={{
          background: 'none', border: 'none', color: '#667eea',
          cursor: 'pointer', fontSize: '13px', marginBottom: '10px', padding: 0,
        }}>
          &larr; Back to {classroom?.name || 'Classroom'}
        </button>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0 }}>{semester.name}</h1>
            <p style={{ color: '#888', margin: '4px 0 0', fontSize: '14px' }}>
              {semester.type} · {semester.year}{semester.session && ` · ${semester.session}`}
              {semester.is_active && (
                <span style={{ marginLeft: '10px', background: '#dcfce7', color: '#166534', padding: '2px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: 600 }}>Active</span>
              )}
            </p>
          </div>
        </div>
      </div>

      <SemesterSubnav active="dashboard" classroomId={classroomId} semesterId={semesterId}>
        <div className="page-subnav-spacer" />
        {isCr && (
          <button className="page-subnav-item danger" onClick={() => setConfirmDeleteSemester(true)}>
            Delete Semester
          </button>
        )}
      </SemesterSubnav>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {/* Two-column layout */}
      <div style={{ display: 'flex', gap: '30px', alignItems: 'flex-start' }}>
        {/* Left column */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Notification Toggle Card */}
          {notifPermission !== 'unsupported' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '14px',
              background: 'var(--card-bg)', border: '1px solid var(--border-color)',
              borderRadius: '12px', padding: '14px 18px', marginBottom: '20px',
            }}>
              <div style={{
                width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0,
                background: (notifPermission === 'granted' && notifEnabled) ? 'rgba(102,126,234,0.1)' : 'var(--bg-color)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {(notifPermission === 'granted' && notifEnabled)
                  ? <Bell size={18} strokeWidth={1.75} style={{ color: '#667eea' }} />
                  : <BellOff size={18} strokeWidth={1.75} style={{ color: 'var(--text-secondary)' }} />
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>Exam Notifications</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {notifPermission === 'denied'
                    ? <>Blocked by browser. <a href="https://support.google.com/chrome/answer/3220216" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'none', fontWeight: 600 }}>How to allow →</a></>
                    : notifPermission === 'default'
                      ? 'Get browser alerts for upcoming exams.'
                      : notifEnabled
                        ? 'Alerts on for today/tomorrow exams.'
                        : 'Notifications paused. Toggle on to re-enable.'}
                </div>
              </div>
              {notifPermission === 'default' ? (
                <button
                  onClick={requestNotifPermission}
                  style={{
                    flexShrink: 0, padding: '6px 14px', borderRadius: '8px',
                    border: 'none', background: '#667eea', color: 'white',
                    fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Enable
                </button>
              ) : notifPermission === 'denied' ? (
                <span style={{
                  flexShrink: 0, padding: '4px 10px', borderRadius: '8px',
                  fontSize: '11px', fontWeight: 700,
                  background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                }}>
                  BLOCKED
                </span>
              ) : (
                /* Left-right toggle switch */
                <div
                  onClick={toggleNotif}
                  style={{
                    flexShrink: 0, width: '44px', height: '24px', borderRadius: '12px',
                    background: notifEnabled ? '#667eea' : 'var(--border-color)',
                    position: 'relative', cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: '3px',
                    left: notifEnabled ? '23px' : '3px',
                    width: '18px', height: '18px', borderRadius: '50%',
                    background: 'white',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    transition: 'left 0.2s',
                  }} />
                </div>
              )}
            </div>
          )}


          {notifPermission === 'granted' && (
            <div style={{ marginTop: '-14px', marginBottom: '20px', paddingLeft: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                To fully revoke browser permission: click the{' '}
                <strong style={{ fontWeight: 600 }}>lock icon</strong> in your address bar → Notifications → Block.
              </span>
            </div>
          )}

          {/* Tab Visibility */}
          <div style={{
            background: 'var(--card-bg)', border: '1px solid var(--border-color)',
            borderRadius: '12px', padding: '14px 18px', marginBottom: '20px',
          }}>
            <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Tab Visibility
            </div>
            {[
              { label: 'Attendance', visible: attendanceVisible, toggle: toggleAttendanceVisible },
              { label: 'Resources',  visible: resourcesVisible,  toggle: toggleResourcesVisible  },
            ].map(({ label, visible, toggle }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0' }}>
                <span style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 500 }}>{label}</span>
                <div
                  onClick={toggle}
                  style={{
                    width: '44px', height: '24px', borderRadius: '12px',
                    background: visible ? 'var(--primary-color)' : 'var(--border-color)',
                    position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
                  }}
                >
                  <div style={{
                    position: 'absolute', top: '3px',
                    left: visible ? '23px' : '3px',
                    width: '18px', height: '18px', borderRadius: '50%',
                    background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    transition: 'left 0.2s',
                  }} />
                </div>
              </div>
            ))}
          </div>

          {/* Upcoming Exams Widget */}
          {upcomingExams.length > 0 && (
            <div className="classrooms-section" style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px' }}>
                  <ClipboardList size={16} strokeWidth={1.75} color="var(--primary-color)" />
                  Upcoming Exams
                  <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--text-secondary)' }}>· next 7 days</span>
                </h2>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <Link to={`/classroom/${classroomId}/semester/${semesterId}/academic-calendar`} style={{ fontSize: '12px', color: 'var(--primary-color)', textDecoration: 'none', fontWeight: 600 }}>
                    Full Calendar →
                  </Link>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {upcomingExams.map((ex, i) => {
                  const isSemExam = ex.type === 'Semester Exam';
                  const isOpen = expandedExam === i;
                  const countdown = examCountdown(ex.date);
                  const isUrgent = countdown === 'Today' || countdown === 'Tomorrow';
                  return (
                    <div key={i} style={{
                      borderRadius: '10px',
                      background: isSemExam ? 'var(--cell-semexam-bg)' : 'var(--cell-exam-bg)',
                      border: `1.5px solid ${isSemExam ? 'var(--cell-semexam-border)' : 'var(--cell-exam-border)'}`,
                      overflow: 'hidden',
                    }}>
                      <div
                        onClick={() => setExpandedExam(isOpen ? null : i)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '12px',
                          padding: '10px 14px', cursor: 'pointer',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: isSemExam ? 'var(--cell-semexam-text)' : 'var(--cell-exam-text)' }}>
                            {ex.title}
                          </p>
                          {ex.start_time && (
                            <p style={{ margin: 0, fontSize: '11px', color: isSemExam ? 'var(--cell-semexam-text)' : 'var(--cell-exam-text)', opacity: 0.8, marginTop: '2px' }}>
                              {ex.start_time}{ex.end_time ? `–${ex.end_time}` : ''}
                            </p>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: isSemExam ? 'var(--cell-semexam-text)' : 'var(--cell-exam-text)' }}>
                            {new Date(ex.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                          </span>
                          <span style={{
                            fontSize: '10px', padding: '2px 7px', borderRadius: '4px', fontWeight: 800,
                            background: isUrgent ? (isSemExam ? 'var(--cell-semexam-text)' : 'var(--cell-exam-text)') : (isSemExam ? 'var(--cell-semexam-border)' : 'var(--cell-exam-border)'),
                            color: isUrgent ? (isSemExam ? 'var(--cell-semexam-bg)' : 'var(--cell-exam-bg)') : (isSemExam ? 'var(--cell-semexam-text)' : 'var(--cell-exam-text)'),
                          }}>
                            {countdown}
                          </span>
                        </div>
                        <span style={{ fontSize: '12px', color: isSemExam ? 'var(--cell-semexam-text)' : 'var(--cell-exam-text)', opacity: 0.6 }}>{isOpen ? '▲' : '▼'}</span>
                      </div>
                      {isOpen && (
                        <div style={{ padding: '0 14px 12px', borderTop: `1px solid ${isSemExam ? 'var(--cell-semexam-border)' : 'var(--cell-exam-border)'}` }}>
                          <p style={{ margin: '10px 0 4px', fontSize: '11px', fontWeight: 700, color: isSemExam ? 'var(--cell-semexam-text)' : 'var(--cell-exam-text)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {isSemExam ? 'Semester Exam' : 'Exam'} · {new Date(ex.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                          </p>
                          {ex.description ? (
                            <p style={{ margin: 0, fontSize: '13px', color: isSemExam ? 'var(--cell-semexam-text)' : 'var(--cell-exam-text)', opacity: 0.85, lineHeight: 1.5 }}>{ex.description}</p>
                          ) : (
                            <p style={{ margin: 0, fontSize: '12px', color: isSemExam ? 'var(--cell-semexam-text)' : 'var(--cell-exam-text)', opacity: 0.5, fontStyle: 'italic' }}>No description added.</p>
                          )}
                          {ex.end_date && ex.end_date !== ex.date && (
                            <p style={{ margin: '6px 0 0', fontSize: '11px', color: isSemExam ? 'var(--cell-semexam-text)' : 'var(--cell-exam-text)', opacity: 0.7 }}>
                              Ends: {new Date(ex.end_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Today's Classes Widget */}
          {(todayClasses.length > 0 || todayLoading) && (
            <div className="classrooms-section" style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Clock size={18} strokeWidth={1.75} color="#667eea" />
                  Today's Classes
                  {todayDay && <span style={{ fontSize: '14px', fontWeight: 400, color: '#6b7280' }}>· {todayDay}</span>}
                </h2>
                <Link to={`/classroom/${classroomId}/semester/${semesterId}/timetable`} style={{ fontSize: '12px', color: '#667eea', textDecoration: 'none', fontWeight: 600 }}>
                  Full Timetable →
                </Link>
              </div>
              {todayLoading ? (
                <p style={{ color: '#999', fontSize: '13px' }}>Loading...</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '300px', overflowY: 'auto', paddingRight: '4px' }}>
                  {(() => {
                    const filtered = todayClasses.filter(c => c.subject && !['Free', 'Lunch', 'Library', 'Break'].includes(c.type));
                    // Merge consecutive identical classes (same subject/teacher/room/type/status)
                    const merged = [];
                    for (const cls of filtered) {
                      const prev = merged[merged.length - 1];
                      const sameClass = prev &&
                        prev.subject === cls.subject &&
                        prev.teacher === cls.teacher &&
                        prev.room === cls.room &&
                        prev.type === cls.type &&
                        prev.status === cls.status;
                      if (sameClass) {
                        // Extend the time range: keep start from prev, take end from current
                        const prevEnd = prev.slot.includes('-') ? prev.slot.split('-')[0] : prev.slot;
                        const curEnd = cls.slot.includes('-') ? cls.slot.split('-')[1] : cls.slot;
                        prev.slot = prevEnd + '-' + curEnd;
                      } else {
                        merged.push({ ...cls });
                      }
                    }
                    return merged;
                  })().map((cls, i) => {
                    const isCancelled = cls.status === 'cancelled';
                    const isOpen = expandedClass === i;
                    const hasDetail = cls.override_reason || cls.notes || cls.rescheduled_time;
                    return (
                      <div key={i} style={{
                        borderRadius: '8px',
                        background: isCancelled ? 'var(--cell-cancel-bg)' : 'var(--bg-color)',
                        border: `1px solid ${isCancelled ? 'var(--cell-cancel-border)' : 'var(--border-color)'}`,
                        overflow: 'hidden',
                      }}>
                        <div
                          onClick={() => setExpandedClass(isOpen ? null : i)}
                          style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', cursor: 'pointer' }}
                        >
                          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 500, whiteSpace: 'nowrap', minWidth: '80px' }}>
                            {cls.slot}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: isCancelled ? 'var(--cell-cancel-text)' : 'var(--text-primary)', textDecoration: isCancelled ? 'line-through' : 'none' }}>
                              {cls.subject}
                            </p>
                            {(cls.teacher || cls.room) && (
                              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)' }}>
                                {[cls.teacher, cls.room].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                          {isCancelled && <span style={{ fontSize: '10px', fontWeight: 700, background: 'var(--cell-cancel-border)', color: 'var(--cell-cancel-text)', borderRadius: '4px', padding: '2px 6px', whiteSpace: 'nowrap' }}>CANCELLED</span>}
                          {cls.status === 'modified' && <span style={{ fontSize: '10px', fontWeight: 700, background: 'var(--cell-holiday-border)', color: 'var(--cell-holiday-text)', borderRadius: '4px', padding: '2px 6px', whiteSpace: 'nowrap' }}>MODIFIED</span>}
                          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', opacity: 0.5 }}>{isOpen ? '▲' : '▼'}</span>
                        </div>
                        {isOpen && (
                          <div style={{ padding: '0 12px 10px', borderTop: '1px solid var(--border-color)' }}>
                            {cls.override_reason && <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Note: {cls.override_reason}</p>}
                            {cls.notes && <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--text-primary)' }}>{cls.notes}</p>}
                            {cls.rescheduled_time && <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--warning-color)', fontWeight: 600 }}>Rescheduled to: {cls.rescheduled_time}</p>}
                            {!hasDetail && <p style={{ margin: '8px 0 0', fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic', opacity: 0.6 }}>No additional notes.</p>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Subjects Widget */}
          <div className="classrooms-section" style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '16px' }}>Subjects</h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Link to={`/classroom/${classroomId}/semester/${semesterId}/marks`} style={{ fontSize: '12px', color: 'var(--primary-color)', textDecoration: 'none', fontWeight: 600 }}>
                  Marks →
                </Link>
                {isCr && (
                  <button onClick={() => setShowAddSubject(v => !v)} style={{
                    padding: '5px 12px', borderRadius: '7px', border: 'none',
                    background: '#667eea', color: 'white', fontSize: '12px',
                    fontWeight: 600, cursor: 'pointer',
                  }}>
                    {showAddSubject ? 'Cancel' : '+ Add'}
                  </button>
                )}
              </div>
            </div>

            {showAddSubject && (
              <form onSubmit={handleAddSubject} style={{ marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <input value={subjectName} onChange={e => setSubjectName(e.target.value)}
                    placeholder="Subject name *" required style={subjectInputStyle} />
                  <input value={subjectCode} onChange={e => setSubjectCode(e.target.value)}
                    placeholder="Code (e.g. IT250-2026)" style={subjectInputStyle} />
                  <input value={subjectCredits} onChange={e => setSubjectCredits(e.target.value)}
                    placeholder="Credits (e.g. 4)" style={subjectInputStyle} />
                  <input value={subjectFaculties} onChange={e => setSubjectFaculties(e.target.value)}
                    placeholder="Faculty (comma-separated)" style={subjectInputStyle} />
                </div>
                <textarea value={subjectDetails} onChange={e => setSubjectDetails(e.target.value)}
                  placeholder="Course details / description (optional)" rows={2}
                  style={{ ...subjectInputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
                <button type="submit" disabled={subjectLoading || !subjectName.trim()} style={{
                  alignSelf: 'flex-start', padding: '7px 18px', borderRadius: '7px',
                  border: 'none', background: '#667eea', color: 'white',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  opacity: (subjectLoading || !subjectName.trim()) ? 0.5 : 1,
                }}>
                  {subjectLoading ? 'Adding...' : 'Add Subject'}
                </button>
              </form>
            )}

            {subjects.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: 0 }}>
                {isCr ? 'No subjects yet. Add the first one above.' : 'No subjects added yet.'}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {subjects.map(sub => {
                  const isOpen = expandedSubjectId === sub.id;
                  return (
                    <div key={sub.id} style={{
                      background: 'var(--bg-color)', borderRadius: '8px',
                      border: '1px solid var(--border-color)', overflow: 'hidden',
                    }}>
                      {/* Clickable header row */}
                      <div
                        onClick={() => setExpandedSubjectId(p => p === sub.id ? null : sub.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', cursor: 'pointer' }}
                      >
                        <span style={{ color: 'var(--text-secondary)', flexShrink: 0, display: 'flex' }}>
                          {isOpen ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>{sub.name}</span>
                          {sub.personal && <span style={{ marginLeft: '8px', fontSize: '11px', color: '#667eea' }}>Personal</span>}
                        </div>
                        {(isCr || sub.personal) && (
                          <button
                            onClick={e => { e.stopPropagation(); setConfirmDeleteSubject({ id: sub.id, name: sub.name }); setDeleteSubjectConfirmStep(1); setDeleteSubjectTyped(''); }}
                            style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                          >
                            <X size={14} strokeWidth={2.5} />
                          </button>
                        )}
                      </div>

                      {/* Dropdown details */}
                      {isOpen && (
                        <div style={{ padding: '12px 14px 14px 36px', borderTop: '1px solid var(--border-color)' }}>
                          {editingSubjectId === sub.id ? (
                            /* ── Inline edit form ── */
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                <div>
                                  <div style={detailLabelStyle}>Code</div>
                                  <input value={editSubjectDraft.code} onChange={e => setEditSubjectDraft(p => ({ ...p, code: e.target.value }))} placeholder="e.g. CS301" style={subjectInputStyle} />
                                </div>
                                <div>
                                  <div style={detailLabelStyle}>Credits</div>
                                  <input type="number" min="1" value={editSubjectDraft.credits} onChange={e => setEditSubjectDraft(p => ({ ...p, credits: e.target.value }))} placeholder="e.g. 4" style={subjectInputStyle} />
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                  <div style={detailLabelStyle}>Faculty (comma-separated)</div>
                                  <input value={editSubjectDraft.faculties} onChange={e => setEditSubjectDraft(p => ({ ...p, faculties: e.target.value }))} placeholder="e.g. Dr. Smith, Prof. Jones" style={subjectInputStyle} />
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                  <div style={detailLabelStyle}>Details / Syllabus</div>
                                  <textarea value={editSubjectDraft.details} onChange={e => setEditSubjectDraft(p => ({ ...p, details: e.target.value }))} placeholder="Course description, syllabus, topics…" rows={3} style={{ ...subjectInputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button onClick={() => saveEditSubject(sub.id)} disabled={editSubjectSaving} style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', background: '#667eea', color: 'white', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                                  {editSubjectSaving ? 'Saving…' : 'Save'}
                                </button>
                                <button onClick={() => setEditingSubjectId(null)} style={{ padding: '5px 14px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* ── Read-only view ── */
                            <>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                                {(isCr || sub.personal) && (
                                  <button onClick={e => { e.stopPropagation(); startEditSubject(sub); }} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '12px', fontWeight: 600, padding: 0 }}>
                                    Edit
                                  </button>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: sub.details ? '10px' : 0 }}>
                                <div>
                                  <div style={detailLabelStyle}>Code</div>
                                  <div style={{ fontSize: '13px', fontWeight: 600 }}>{sub.code || '—'}</div>
                                </div>
                                <div>
                                  <div style={detailLabelStyle}>Credits</div>
                                  <div style={{ fontSize: '13px', fontWeight: 600 }}>{sub.credits || '—'}</div>
                                </div>
                                <div>
                                  <div style={detailLabelStyle}>Faculty</div>
                                  <div style={{ fontSize: '13px' }}>{sub.faculties?.length ? sub.faculties.join(', ') : '—'}</div>
                                </div>
                              </div>
                              {sub.details && (
                                <div style={{
                                  background: 'var(--card-bg)', borderRadius: '6px',
                                  padding: '8px 10px', fontSize: '12px', lineHeight: 1.65,
                                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                  border: '1px solid var(--border-color)', color: 'var(--text-secondary)',
                                }}>
                                  {sub.details}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Attendance summary cards (after subjects, before documents) */}
          {attendanceSummary.length > 0 && (
            <div className="classrooms-section" style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <h2 style={{ margin: 0, fontSize: '16px' }}>Attendance</h2>
                <Link to={`/classroom/${classroomId}/semester/${semesterId}/attendance`} style={{ fontSize: '12px', color: 'var(--primary-color)', textDecoration: 'none', fontWeight: 600 }}>
                  Full View →
                </Link>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
                {attendanceSummary.map(s => {
                  const colorVar = s.zone === 'green' ? 'var(--attendance-green)'
                    : s.zone === 'yellow' ? 'var(--attendance-yellow)'
                    : s.zone === 'orange' ? 'var(--attendance-orange)'
                    : 'var(--attendance-red)';
                  const attendedEff = s.attended + (s.leaves_count || 0);
                  const belowCutoff = s.total > 0 && s.percentage < s.threshold;
                  const statusText = s.total === 0
                    ? 'No classes yet'
                    : (belowCutoff && s.recoverable === false)
                      ? `Cannot reach ${s.threshold}%`
                      : belowCutoff
                        ? `Attend ${s.must_attend} more`
                        : s.leaves_left > 0
                          ? `${s.leaves_left} ${s.leaves_left === 1 ? 'leave' : 'leaves'} left`
                          : 'Fully safe';
                  return (
                    <div key={s.subject} style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '12px 14px 0', overflow: 'hidden' }}>
                      <p style={{ margin: '0 0 2px', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>{s.subject}</p>
                      <p style={{ margin: '0 0 2px', fontSize: '12px', color: 'var(--text-primary)' }}>
                        {attendedEff}/{s.total} · <span style={{ fontWeight: 700, color: colorVar }}>{s.percentage}%</span>
                      </p>
                      <p style={{ margin: '0 0 10px', fontSize: '12px', fontWeight: 600, color: s.total === 0 ? 'var(--text-secondary)' : colorVar }}>
                        {statusText}
                      </p>
                      <div style={{ margin: '0 -14px', height: '3px', background: 'var(--border-color)' }}>
                        <div style={{ width: `${Math.min(100, s.percentage)}%`, height: '100%', background: colorVar }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Documents */}
          <div className="classrooms-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h2 style={{ margin: 0 }}>Documents</h2>
              <label style={{
                background: '#667eea', color: 'white', borderRadius: '8px',
                padding: '7px 16px', fontSize: '13px', cursor: 'pointer', fontWeight: 600,
                opacity: uploading ? 0.6 : 1,
              }}>
                {uploading ? 'Uploading...' : '+ Upload'}
                <input type="file" onChange={handleDocUpload} style={{ display: 'none' }} disabled={uploading} />
              </label>
            </div>
            <input
              type="text"
              value={docSearch}
              onChange={e => setDocSearch(e.target.value)}
              placeholder="Search documents…"
              style={{
                width: '100%', boxSizing: 'border-box', marginBottom: '12px',
                padding: '7px 12px', fontSize: '13px', borderRadius: '7px',
                border: '1px solid var(--border-color)', background: 'var(--bg-color)',
                color: 'var(--text-primary)', outline: 'none',
              }}
            />
            {docsLoading ? (
              <p style={{ color: '#999' }}>Loading documents...</p>
            ) : documents.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-secondary)' }}>
                <FileText size={28} strokeWidth={1.25} style={{ marginBottom: '8px', opacity: 0.4 }} />
                <p style={{ fontSize: '14px', margin: 0 }}>No documents yet.</p>
                <p style={{ fontSize: '12px', margin: '4px 0 0', opacity: 0.7 }}>Upload your first file above.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto', paddingRight: '2px' }}>
                {documents.filter(doc => doc.filename.toLowerCase().includes(docSearch.trim().toLowerCase())).map(doc => (
                  <div key={doc.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', background: 'var(--bg-color)', borderRadius: '8px',
                    border: '1px solid #e0e7ff',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <a href={docUrl(doc)} target="_blank" rel="noopener noreferrer" style={{
                        color: '#4338ca', fontWeight: 600, fontSize: '14px', textDecoration: 'none',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
                      }}>{doc.filename}</a>
                      <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                        {doc.uploaded_by?.username} · {new Date(doc.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    {(isCr || doc.uploaded_by?.id === user?.id) && (
                      <button onClick={() => handleDeleteDoc(doc.id)} style={{
                        background: 'none', border: 'none', color: '#dc2626',
                        cursor: 'pointer', padding: '2px', marginLeft: '8px', display: 'flex', alignItems: 'center',
                      }}><X size={15} strokeWidth={2} /></button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Right column: Todos + Announcements */}
        <div style={{
          width: '320px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '20px',
          position: 'sticky', top: '20px', alignSelf: 'flex-start',
        }}>
        <div style={{
          background: 'var(--card-bg)', borderRadius: '12px',
          border: '1.5px solid var(--border-color)', padding: '20px',
          display: 'flex', flexDirection: 'column', maxHeight: '480px', overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h2 style={{ margin: 0, fontSize: '18px' }}>To-Do</h2>
            <span style={{ fontSize: '13px', color: '#667eea', fontWeight: 600 }}>{completedCount}/{todos.length}</span>
          </div>

          {todos.length > 0 && (
            <div style={{ height: '6px', background: 'var(--border-color)', borderRadius: '3px', marginBottom: '16px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${todos.length ? (completedCount / todos.length) * 100 : 0}%`,
                background: '#667eea', borderRadius: '3px', transition: 'width 0.3s',
              }} />
            </div>
          )}

          {semester.is_active && (
            <form onSubmit={handleAddTodo} style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="text" value={newTodoText} onChange={(e) => setNewTodoText(e.target.value)}
                  placeholder="Add a task..." disabled={todoLoading}
                  style={{ flex: 1, padding: '8px 12px', border: '1.5px solid var(--border-color)', borderRadius: '6px', fontSize: '14px', fontFamily: 'inherit', outline: 'none', background: 'var(--bg-color)', color: 'var(--text-primary)' }} />
                <button type="submit" disabled={todoLoading || !newTodoText.trim()} style={{
                  padding: '8px 14px', background: '#667eea', color: 'white', border: 'none',
                  borderRadius: '6px', fontSize: '14px', cursor: 'pointer', fontWeight: 600,
                  opacity: (!newTodoText.trim() || todoLoading) ? 0.5 : 1,
                }}>+</button>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {subjects.length > 0 && (
                  <select
                    value={newTodoSubjectId}
                    onChange={e => setNewTodoSubjectId(e.target.value)}
                    disabled={todoLoading}
                    style={{
                      flex: 1, minWidth: 0, padding: '6px 8px', border: '1.5px solid var(--border-color)',
                      borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit',
                      outline: 'none', background: 'var(--card-bg)', color: 'var(--text-primary)',
                    }}
                  >
                    <option value="">No subject</option>
                    {subjects.map(s => (
                      <option key={s.id} value={s.id}>{s.code ? `${s.code} — ` : ''}{s.name}</option>
                    ))}
                  </select>
                )}
                <input
                  type="date"
                  value={newTodoDueDate}
                  onChange={e => setNewTodoDueDate(e.target.value)}
                  disabled={todoLoading}
                  title="Due date (optional)"
                  style={{
                    padding: '6px 8px', border: '1.5px solid var(--border-color)',
                    borderRadius: '6px', fontSize: '12px', fontFamily: 'inherit',
                    outline: 'none', background: 'var(--card-bg)', color: 'var(--text-primary)',
                    width: subjects.length > 0 ? '130px' : '100%', flexShrink: 0,
                  }}
                />
              </div>
            </form>
          )}

          {/* Subject filter chips */}
          {subjects.length > 0 && todos.some(t => t.subject_id) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '12px' }}>
              <button
                onClick={() => setTodoFilterSubjectId('')}
                style={{
                  padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                  border: todoFilterSubjectId === '' ? '1.5px solid #667eea' : '1px solid var(--border-color)',
                  background: todoFilterSubjectId === '' ? 'rgba(102,126,234,0.15)' : 'var(--bg-color)',
                  color: todoFilterSubjectId === '' ? '#667eea' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >All</button>
              {subjects.filter(s => todos.some(t => t.subject_id === s.id)).map(s => (
                <button
                  key={s.id}
                  onClick={() => setTodoFilterSubjectId(todoFilterSubjectId === s.id ? '' : s.id)}
                  style={{
                    padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                    border: todoFilterSubjectId === s.id ? '1.5px solid #667eea' : '1px solid var(--border-color)',
                    background: todoFilterSubjectId === s.id ? 'rgba(102,126,234,0.15)' : 'var(--bg-color)',
                    color: todoFilterSubjectId === s.id ? '#667eea' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >{s.code || s.name}</button>
              ))}
            </div>
          )}

          {(() => {
            const filtered = todoFilterSubjectId
              ? todos.filter(t => t.subject_id === todoFilterSubjectId)
              : todos;
            return filtered.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#999', fontSize: '14px', margin: '30px 0' }}>
              {todoFilterSubjectId ? 'No tasks for this subject.' : 'No tasks yet.'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '2px' }}>
              {filtered.map(todo => {
                const isOverdue = !todo.completed && todo.due_date && new Date(todo.due_date) < new Date();
                return (
                <div key={todo.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px',
                  borderRadius: '8px',
                  background: todo.completed ? 'rgba(16,185,129,0.08)' : isOverdue ? 'rgba(220,38,38,0.05)' : 'var(--bg-color)',
                  border: '1px solid', borderColor: todo.completed ? 'rgba(16,185,129,0.3)' : isOverdue ? 'rgba(220,38,38,0.3)' : 'var(--border-color)',
                }}>
                  <input type="checkbox" checked={todo.completed} onChange={() => handleToggleTodo(todo.id)}
                    style={{ marginTop: '3px', cursor: 'pointer', width: '16px', height: '16px', accentColor: '#667eea', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '2px' }}>
                      {todo.subject_id && (() => {
                        const sub = subjects.find(s => s.id === todo.subject_id);
                        return sub ? (
                          <span style={{
                            fontSize: '11px', fontWeight: 600,
                            background: 'rgba(102,126,234,0.15)', color: '#667eea',
                            padding: '1px 8px', borderRadius: '10px',
                          }}>
                            {sub.code || sub.name}
                          </span>
                        ) : null;
                      })()}
                      {todo.due_date && (
                        <span style={{
                          fontSize: '11px', fontWeight: 600,
                          background: isOverdue ? 'rgba(220,38,38,0.12)' : 'rgba(0,0,0,0.06)',
                          color: isOverdue ? '#dc2626' : 'var(--text-secondary)',
                          padding: '1px 8px', borderRadius: '10px',
                        }}>
                          {isOverdue ? 'Overdue · ' : 'Due · '}{new Date(todo.due_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                    <p style={{
                      margin: 0, fontSize: '14px', lineHeight: '1.4',
                      textDecoration: todo.completed ? 'line-through' : 'none',
                      color: todo.completed ? '#999' : isOverdue ? '#dc2626' : 'var(--text-primary)', wordBreak: 'break-word',
                    }}>{todo.text}</p>
                  </div>
                  <button onClick={() => handleDeleteTodo(todo.id)} style={{
                    background: 'none', border: 'none', color: '#ccc',
                    cursor: 'pointer', padding: '2px', flexShrink: 0, display: 'flex', alignItems: 'center',
                  }}><X size={13} strokeWidth={2} /></button>
                </div>
              );
              })}
            </div>
          );
          })()}
        </div>{/* end todo card */}

        {/* Links panel */}
        {(links.length > 0 || isCr) && (
          <div style={{
            background: 'var(--card-bg)', borderRadius: '12px',
            border: '1.5px solid var(--border-color)', padding: '20px',
            display: 'flex', flexDirection: 'column', maxHeight: '300px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '17px' }}>Links</h2>
              {isCr && !showAddLink && (
                <button onClick={() => setShowAddLink(true)} style={{
                  background: 'none', border: 'none', color: '#667eea',
                  cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: '0 2px',
                }}>+</button>
              )}
            </div>

            {isCr && showAddLink && (
              <form onSubmit={handleAddLink} style={{ marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <input
                  type="text" value={newLinkLabel} onChange={e => setNewLinkLabel(e.target.value)}
                  placeholder="Label (e.g. Syllabus PDF)" required disabled={linkLoading}
                  style={{ padding: '7px 10px', border: '1.5px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit', background: 'var(--bg-color)', color: 'var(--text-primary)', outline: 'none' }}
                />
                <input
                  type="url" value={newLinkUrl} onChange={e => setNewLinkUrl(e.target.value)}
                  placeholder="https://..." required disabled={linkLoading}
                  style={{ padding: '7px 10px', border: '1.5px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit', background: 'var(--bg-color)', color: 'var(--text-primary)', outline: 'none' }}
                />
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button type="submit" disabled={linkLoading || !newLinkLabel.trim() || !newLinkUrl.trim()} style={{
                    flex: 1, padding: '7px', background: '#667eea', color: 'white',
                    border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: 600,
                    opacity: (!newLinkLabel.trim() || !newLinkUrl.trim() || linkLoading) ? 0.5 : 1,
                  }}>Add</button>
                  <button type="button" onClick={() => { setShowAddLink(false); setNewLinkLabel(''); setNewLinkUrl(''); }} style={{
                    padding: '7px 12px', background: 'var(--bg-color)', color: 'var(--text-secondary)',
                    border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '13px', cursor: 'pointer',
                  }}>Cancel</button>
                </div>
              </form>
            )}

            {links.length === 0 && !showAddLink && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center', margin: '8px 0' }}>No links added yet.</p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '2px' }}>
              {links.map(link => (
                <div key={link.id} style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 10px', borderRadius: '8px',
                  background: 'var(--bg-color)', border: '1px solid var(--border-color)',
                }}>
                  <LinkIcon size={14} strokeWidth={1.75} style={{ flexShrink: 0, color: '#667eea' }} />
                  <a href={link.url} target="_blank" rel="noopener noreferrer" style={{
                    flex: 1, color: '#667eea', fontSize: '13px', fontWeight: 500,
                    textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{link.label}</a>
                  {isCr && (
                    <button onClick={() => handleDeleteLink(link.id)} style={{
                      background: 'none', border: 'none', color: 'var(--text-secondary)',
                      cursor: 'pointer', padding: '2px', flexShrink: 0, display: 'flex', alignItems: 'center',
                    }}><X size={13} strokeWidth={2} /></button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Announcements panel */}
        <div style={{
          background: 'var(--card-bg)', borderRadius: '12px',
          border: '1.5px solid var(--border-color)', padding: '20px',
          display: 'flex', flexDirection: 'column', maxHeight: '420px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <h2 style={{ margin: 0, fontSize: '17px' }}>Announcements</h2>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>
              {announcements.length > 0 ? `${announcements.length}` : ''}
            </span>
          </div>

          {isCr && semester.is_active && (
            <form onSubmit={handleAddAnnouncement} style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <textarea
                  value={newAnnouncementText}
                  onChange={e => setNewAnnouncementText(e.target.value)}
                  placeholder="Write an announcement..."
                  disabled={announcementLoading}
                  rows={2}
                  style={{
                    width: '100%', padding: '8px 12px', border: '1.5px solid var(--border-color)',
                    borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit',
                    resize: 'vertical', boxSizing: 'border-box', outline: 'none',
                    background: 'var(--bg-color)', color: 'var(--text-primary)',
                  }}
                />
                <button
                  type="submit"
                  disabled={announcementLoading || !newAnnouncementText.trim()}
                  style={{
                    padding: '7px 14px', background: '#667eea', color: 'white', border: 'none',
                    borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: 600,
                    alignSelf: 'flex-end',
                    opacity: (!newAnnouncementText.trim() || announcementLoading) ? 0.5 : 1,
                  }}
                >
                  {announcementLoading ? 'Posting...' : 'Post'}
                </button>
              </div>
            </form>
          )}

          {announcements.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-secondary)' }}>
              <Megaphone size={24} strokeWidth={1.25} style={{ marginBottom: '6px', opacity: 0.35 }} />
              <p style={{ fontSize: '13px', margin: 0 }}>No announcements yet.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '2px' }}>
              {announcements.map(ann => (
                <div key={ann.id} style={{
                  background: 'rgba(234,179,8,0.05)',
                  borderLeft: '3px solid #f59e0b',
                  borderRadius: '6px',
                  padding: '10px 12px 10px 14px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '6px' }}>
                    <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.5', color: 'var(--text-primary)', flex: 1, wordBreak: 'break-word' }}>
                      {ann.text}
                    </p>
                    {isCr && (
                      <button onClick={() => handleDeleteAnnouncement(ann)} style={{
                        background: 'none', border: 'none', color: 'var(--text-secondary)',
                        cursor: 'pointer', padding: '2px', flexShrink: 0, display: 'flex', alignItems: 'center',
                      }}><X size={13} strokeWidth={2} /></button>
                    )}
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {ann.created_by_name} · {new Date(ann.created_at).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>{/* end announcements card */}

        </div>{/* end right column */}
      </div>

      {/* Confirm Delete Subject Modal — Multi-layer */}
      {confirmDeleteSubject && (
        <div className="modal-overlay" onClick={() => { setConfirmDeleteSubject(null); setDeleteSubjectTyped(''); setDeleteSubjectConfirmStep(1); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', textAlign: 'center' }}>
            <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}><X size={32} strokeWidth={2} color="#dc2626" /></div>
            <h2 style={{ margin: '0 0 8px' }}>Delete subject?</h2>

            {deleteSubjectConfirmStep === 1 ? (
              <>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '0 0 6px' }}>
                  You are about to delete <strong>"{confirmDeleteSubject.name}"</strong>.
                </p>
                <p style={{ color: '#dc2626', fontSize: '13px', margin: '0 0 20px', fontWeight: 500 }}>
                  All associated files and academic resources will be permanently removed.
                </p>
                <div className="modal-buttons" style={{ justifyContent: 'center' }}>
                  <button type="button" onClick={() => { setConfirmDeleteSubject(null); setDeleteSubjectTyped(''); setDeleteSubjectConfirmStep(1); }}>Cancel</button>
                  <button type="button" onClick={() => setDeleteSubjectConfirmStep(2)} style={{ background: '#dc2626', color: 'white' }}>
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '0 0 14px' }}>
                  Type the subject name to confirm deletion:
                </p>
                <p style={{ fontWeight: 700, background: 'var(--bg-color)', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', margin: '0 0 10px', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                  {confirmDeleteSubject.name}
                </p>
                <input
                  value={deleteSubjectTyped}
                  onChange={e => setDeleteSubjectTyped(e.target.value)}
                  placeholder="Type subject name…"
                  autoFocus
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '8px 12px',
                    borderRadius: '7px', border: '1.5px solid var(--border-color)',
                    fontSize: '13px', background: 'var(--bg-color)', color: 'var(--text-primary)',
                    outline: 'none', marginBottom: '20px',
                    borderColor: deleteSubjectTyped === confirmDeleteSubject.name ? '#16a34a' : 'var(--border-color)',
                  }}
                />
                <div className="modal-buttons" style={{ justifyContent: 'center' }}>
                  <button type="button" onClick={() => { setConfirmDeleteSubject(null); setDeleteSubjectTyped(''); setDeleteSubjectConfirmStep(1); }}>Cancel</button>
                  <button
                    type="button"
                    disabled={deleteSubjectTyped !== confirmDeleteSubject.name}
                    onClick={() => { handleDeleteSubject(confirmDeleteSubject.id); setDeleteSubjectTyped(''); setDeleteSubjectConfirmStep(1); }}
                    style={{ background: '#dc2626', color: 'white', opacity: deleteSubjectTyped !== confirmDeleteSubject.name ? 0.4 : 1 }}
                  >
                    Delete Forever
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Confirm Post Announcement Modal */}
      {confirmPostAnnouncement && (
        <div className="modal-overlay" onClick={() => setConfirmPostAnnouncement(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px' }}>
            <h2 style={{ margin: '0 0 8px' }}>Post announcement?</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '0 0 12px' }}>
              This will be visible to all members of this semester.
            </p>
            <div style={{
              background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px',
              padding: '10px 14px', fontSize: '14px', color: 'var(--text-primary)',
              marginBottom: '20px', lineHeight: '1.5', wordBreak: 'break-word',
            }}>
              {newAnnouncementText}
            </div>
            <div className="modal-buttons">
              <button type="button" onClick={() => setConfirmPostAnnouncement(false)}>Cancel</button>
              <button type="button" onClick={doPostAnnouncement} style={{ background: '#667eea' }}>
                {announcementLoading ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Semester Modal */}
      {confirmDeleteSemester && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteSemester(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', textAlign: 'center' }}>
            <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}><X size={36} strokeWidth={2} color="#dc2626" /></div>
            <h2 style={{ margin: '0 0 8px' }}>Delete this semester?</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '0 0 6px' }}>
              <strong>{semester.name}</strong> and all its subjects, files, and todos will be permanently removed.
            </p>
            <p style={{ color: '#dc2626', fontSize: '13px', margin: '0 0 24px', fontWeight: 500 }}>
              This cannot be undone.
            </p>
            <div className="modal-buttons" style={{ justifyContent: 'center' }}>
              <button type="button" onClick={() => setConfirmDeleteSemester(false)} disabled={deleteSemesterLoading}>Cancel</button>
              <button type="button" onClick={handleDeleteSemester} disabled={deleteSemesterLoading} style={{ background: '#dc2626', color: 'white' }}>
                {deleteSemesterLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Announcement Modal */}
      {confirmDeleteAnnouncement && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteAnnouncement(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px', textAlign: 'center' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px', display: 'flex', justifyContent: 'center' }}><X size={32} strokeWidth={2} color="#dc2626" /></div>
            <h2 style={{ margin: '0 0 8px' }}>Delete announcement?</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '0 0 12px' }}>
              This cannot be undone.
            </p>
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
              padding: '10px 14px', fontSize: '13px', color: 'var(--text-primary)',
              marginBottom: '20px', lineHeight: '1.5', wordBreak: 'break-word',
            }}>
              {confirmDeleteAnnouncement.text}
            </div>
            <div className="modal-buttons" style={{ justifyContent: 'center' }}>
              <button type="button" onClick={() => setConfirmDeleteAnnouncement(null)}>Cancel</button>
              <button type="button" onClick={doDeleteAnnouncement} style={{ background: '#dc2626', color: 'white' }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SemesterDetail;
