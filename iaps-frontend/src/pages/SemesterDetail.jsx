import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { semesterAPI, subjectAPI, documentAPI, todoAPI, scheduleAPI, classroomAPI, announcementAPI, linksAPI, BACKEND_URL } from '../services/api';
import '../styles/Classroom.css';
import { Link as LinkIcon, Trash2, X, FileText, CalendarDays, Megaphone } from 'lucide-react';

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
  const [subjectLoading, setSubjectLoading] = useState(false);
  const [confirmDeleteSubject, setConfirmDeleteSubject] = useState(null); // { id, name }

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

  // Schedule
  const [scheduleRequests, setScheduleRequests] = useState([]);
  const [showPostScheduleModal, setShowPostScheduleModal] = useState(false);
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [scheduleDescription, setScheduleDescription] = useState('');
  const [scheduleEvents, setScheduleEvents] = useState([
    { title: '', start_datetime: '', end_datetime: '', description: '', location: '' }
  ]);
  const [scheduleLoading, setScheduleLoading] = useState(false);

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
      loadSchedule();
      loadAnnouncements();
      loadLinks();
    } catch (err) {
      setError('Failed to load semester');
    } finally {
      setLoading(false);
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

  const loadSchedule = async () => {
    try {
      const res = await scheduleAPI.listForClassroom(classroomId);
      setScheduleRequests(res.data.schedule_requests || []);
    } catch (err) {
      console.error('Failed to load schedule', err);
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
      });
      setSubjectName(''); setSubjectCode(''); setShowAddSubject(false);
      const res = await semesterAPI.getDetail(semesterId);
      setSemester(res.data.semester);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add subject');
    } finally { setSubjectLoading(false); }
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

  // ── Schedule ─────────────────────────────────────────────────────────────────

  const addScheduleEvent = () =>
    setScheduleEvents(prev => [...prev, { title: '', start_datetime: '', end_datetime: '', description: '', location: '' }]);

  const removeScheduleEvent = (idx) =>
    setScheduleEvents(prev => prev.filter((_, i) => i !== idx));

  const updateScheduleEvent = (idx, field, value) => {
    setScheduleEvents(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  };

  const handlePostSchedule = async (e) => {
    e.preventDefault();
    setScheduleLoading(true);
    try {
      const events = scheduleEvents.map(ev => ({
        title: ev.title,
        start_datetime: new Date(ev.start_datetime).toISOString(),
        end_datetime: new Date(ev.end_datetime).toISOString(),
        description: ev.description,
        location: ev.location,
      }));
      await scheduleAPI.create({
        classroom_id: classroomId,
        semester_id: semesterId,
        title: scheduleTitle,
        description: scheduleDescription,
        events,
      });
      setSuccess('Schedule posted!');
      setShowPostScheduleModal(false);
      setScheduleTitle(''); setScheduleDescription('');
      setScheduleEvents([{ title: '', start_datetime: '', end_datetime: '', description: '', location: '' }]);
      loadSchedule();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to post schedule');
    } finally { setScheduleLoading(false); }
  };

  const handlePullSchedule = async (requestId) => {
    try {
      await scheduleAPI.pullRequest(requestId);
      setSuccess('Events added to your Google Calendar!');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to pull to calendar. Make sure Google Calendar is connected.');
    }
  };

  const handleDeleteSchedule = async (requestId) => {
    if (!window.confirm('Delete this schedule?')) return;
    try {
      await scheduleAPI.deleteRequest(requestId);
      setScheduleRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete schedule');
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

      {/* Sub-navbar */}
      <div className="page-subnav">
        <button className="page-subnav-item" onClick={() => navigate(`/classroom/${classroomId}/semester/${semesterId}/chat`)}>
          Chat
        </button>
        <Link className="page-subnav-item" to={`/classroom/${classroomId}/semester/${semesterId}/files`}>
          Subjects
        </Link>
        {isCr && (
          <button className="page-subnav-item accent" onClick={() => setShowPostScheduleModal(true)}>
            Post Schedule
          </button>
        )}
        <div className="page-subnav-spacer" />
        {isCr && (
          <button className="page-subnav-item danger" onClick={() => setConfirmDeleteSemester(true)}>
            Delete Semester
          </button>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {/* Two-column layout */}
      <div style={{ display: 'flex', gap: '30px', alignItems: 'flex-start' }}>
        {/* Left column */}
        <div style={{ flex: 1, minWidth: 0 }}>

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

          {/* Schedule Requests */}
          <div className="classrooms-section">
            <h2>Schedules</h2>
            {scheduleRequests.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-secondary)' }}>
                <CalendarDays size={28} strokeWidth={1.25} style={{ marginBottom: '8px', opacity: 0.4 }} />
                <p style={{ fontSize: '14px', margin: 0 }}>No schedules posted yet.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '420px', overflowY: 'auto', paddingRight: '2px' }}>
                {scheduleRequests.map(req => (
                  <div key={req.id} style={{
                    background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '15px', color: 'var(--text-primary)' }}>{req.title}</h4>
                        {req.description && <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#666' }}>{req.description}</p>}
                        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#9ca3af' }}>
                          {req.events?.length || 0} event{(req.events?.length || 0) !== 1 ? 's' : ''} · Posted {new Date(req.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexShrink: 0, marginLeft: '12px' }}>
                        <button onClick={() => handlePullSchedule(req.id)} style={{
                          background: '#4338ca', color: 'white', border: 'none', borderRadius: '6px',
                          padding: '6px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: 600,
                        }}>+ Calendar</button>
                        {isCr && (
                          <button onClick={() => handleDeleteSchedule(req.id)} style={{
                            background: '#dc2626', color: 'white', border: 'none',
                            borderRadius: '6px', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', fontWeight: 600,
                          }}>Delete</button>
                        )}
                      </div>
                    </div>
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

      {/* Post Schedule Modal */}
      {showPostScheduleModal && (
        <div className="modal-overlay" onClick={() => setShowPostScheduleModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '680px', width: '90%', maxHeight: '85vh', overflowY: 'auto' }}>
            <h2>Post Schedule</h2>
            <p style={{ color: '#666', marginBottom: '20px', fontSize: '14px' }}>
              Post events for this semester. Students can pull them into Google Calendar.
            </p>
            <form onSubmit={handlePostSchedule}>
              <div className="form-group">
                <label>Schedule Title *</label>
                <input type="text" value={scheduleTitle} onChange={(e) => setScheduleTitle(e.target.value)}
                  placeholder="e.g., Week 3 Timetable" required disabled={scheduleLoading} />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea value={scheduleDescription} onChange={(e) => setScheduleDescription(e.target.value)}
                  placeholder="Optional notes" rows="2" disabled={scheduleLoading} />
              </div>

              <h3 style={{ fontSize: '15px', margin: '20px 0 10px', color: '#333' }}>Events ({scheduleEvents.length})</h3>

              {scheduleEvents.map((ev, idx) => (
                <div key={idx} style={{ background: 'var(--bg-color)', borderRadius: '8px', padding: '14px', marginBottom: '12px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <strong style={{ fontSize: '13px', color: '#4338ca' }}>Event {idx + 1}</strong>
                    {scheduleEvents.length > 1 && (
                      <button type="button" onClick={() => removeScheduleEvent(idx)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}><X size={15} strokeWidth={2} /></button>
                    )}
                  </div>
                  <div className="form-group">
                    <label>Event Title *</label>
                    <input type="text" value={ev.title} onChange={(e) => updateScheduleEvent(idx, 'title', e.target.value)} placeholder="e.g., OS Lecture" required disabled={scheduleLoading} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="form-group">
                      <label>Start *</label>
                      <input type="datetime-local" value={ev.start_datetime} onChange={(e) => updateScheduleEvent(idx, 'start_datetime', e.target.value)} required disabled={scheduleLoading} />
                    </div>
                    <div className="form-group">
                      <label>End *</label>
                      <input type="datetime-local" value={ev.end_datetime} onChange={(e) => updateScheduleEvent(idx, 'end_datetime', e.target.value)} required disabled={scheduleLoading} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Location</label>
                    <input type="text" value={ev.location} onChange={(e) => updateScheduleEvent(idx, 'location', e.target.value)} placeholder="e.g., Room 301" disabled={scheduleLoading} />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <input type="text" value={ev.description} onChange={(e) => updateScheduleEvent(idx, 'description', e.target.value)} placeholder="Optional" disabled={scheduleLoading} />
                  </div>
                </div>
              ))}

              <button type="button" onClick={addScheduleEvent} disabled={scheduleLoading} style={{
                width: '100%', padding: '10px', background: 'rgba(102,126,234,0.1)', color: '#667eea',
                border: '2px dashed rgba(102,126,234,0.4)', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px', marginBottom: '20px',
              }}>+ Add Another Event</button>

              <div className="modal-buttons">
                <button type="button" onClick={() => setShowPostScheduleModal(false)} disabled={scheduleLoading}>Cancel</button>
                <button type="submit" disabled={scheduleLoading} style={{ background: '#4338ca' }}>
                  {scheduleLoading ? 'Posting...' : 'Post Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Delete Subject Modal */}
      {confirmDeleteSubject && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteSubject(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px', textAlign: 'center' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px', display: 'flex', justifyContent: 'center' }}><Trash2 size={32} strokeWidth={1.75} color="#dc2626" /></div>
            <h2 style={{ margin: '0 0 8px' }}>Delete subject?</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '0 0 20px' }}>
              "<strong>{confirmDeleteSubject.name}</strong>" and all its associated files will be permanently removed.
            </p>
            <div className="modal-buttons" style={{ justifyContent: 'center' }}>
              <button type="button" onClick={() => setConfirmDeleteSubject(null)}>Cancel</button>
              <button
                type="button"
                onClick={() => handleDeleteSubject(confirmDeleteSubject.id)}
                style={{ background: '#dc2626', color: 'white' }}
              >
                Delete
              </button>
            </div>
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
            <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}><Trash2 size={36} strokeWidth={1.75} color="#dc2626" /></div>
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
            <div style={{ fontSize: '32px', marginBottom: '12px', display: 'flex', justifyContent: 'center' }}><Trash2 size={32} strokeWidth={1.75} color="#dc2626" /></div>
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
