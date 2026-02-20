import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { classroomAPI, semesterAPI, todoAPI, subjectAPI } from '../services/api';
import '../styles/Classroom.css';

function ClassroomDetail({ user, onLogout }) {
  const { classroomId } = useParams();
  const navigate = useNavigate();
  const [classroom, setClassroom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreateSemester, setShowCreateSemester] = useState(false);
  const [newSemester, setNewSemester] = useState({
    name: '',
    type: 'odd',
    year: '',
    session: ''
  });
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Todo state
  const [todos, setTodos] = useState([]);
  const [newTodoText, setNewTodoText] = useState('');
  const [todoLoading, setTodoLoading] = useState(false);
  const [selectedSemesterId, setSelectedSemesterId] = useState(null);

  useEffect(() => {
    loadClassroomData();
  }, [classroomId]);

  const loadClassroomData = async () => {
    try {
      const response = await classroomAPI.getDetails(classroomId);
      const classroomData = response.data.classroom;
      setClassroom(classroomData);

      // Load todos for the selected semester (or active by default)
      const sems = classroomData.semesters || [];
      const activeSem = sems.find(s => s.is_active);
      const targetSemId = selectedSemesterId || (activeSem ? activeSem.id : null);
      if (targetSemId) {
        setSelectedSemesterId(targetSemId);
        loadTodos(targetSemId);
      }
    } catch (err) {
      console.error('Failed to load classroom:', err);
      setError('Failed to load classroom data');
    } finally {
      setLoading(false);
    }
  };

  const loadTodos = async (semesterId) => {
    try {
      const response = await todoAPI.list(semesterId);
      setTodos(response.data.todos || []);
    } catch (err) {
      console.error('Failed to load todos:', err);
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!window.confirm('Remove this member from the classroom?')) return;
    setError('');
    try {
      await classroomAPI.removeMember(classroomId, memberId);
      setSuccess('Member removed.');
      loadClassroomData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove member');
    }
  };

  const handleSemesterSelect = (semId) => {
    setSelectedSemesterId(semId);
    loadTodos(semId);
  };

  const handleAddTodo = async (e) => {
    e.preventDefault();
    if (!newTodoText.trim()) return;

    if (!selectedSemesterId) return;

    setTodoLoading(true);
    try {
      const response = await todoAPI.create({
        classroom_id: classroomId,
        semester_id: selectedSemesterId,
        text: newTodoText.trim()
      });
      setTodos([response.data.todo, ...todos]);
      setNewTodoText('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add todo');
    } finally {
      setTodoLoading(false);
    }
  };

  const handleToggleTodo = async (todoId) => {
    try {
      const response = await todoAPI.toggle(todoId);
      setTodos(todos.map(t =>
        t.id === todoId ? { ...t, completed: response.data.completed } : t
      ));
    } catch (err) {
      console.error('Failed to toggle todo:', err);
    }
  };

  const handleDeleteTodo = async (todoId) => {
    try {
      await todoAPI.delete(todoId);
      setTodos(todos.filter(t => t.id !== todoId));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete todo');
    }
  };

  const handleCreateSemester = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setActionLoading(true);

    try {
      await semesterAPI.create({
        classroom_id: classroomId,
        name: newSemester.name,
        type: newSemester.type,
        year: newSemester.year,
        session: newSemester.session
      });
      setSuccess('Semester created successfully!');
      setNewSemester({ name: '', type: 'odd', year: '', session: '' });
      setShowCreateSemester(false);
      loadClassroomData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create semester');
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproveRequest = async (userId) => {
    setError('');
    try {
      await classroomAPI.approve(classroomId, userId);
      setSuccess('Member approved!');
      loadClassroomData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to approve request');
    }
  };

  const handleRejectRequest = async (userId) => {
    setError('');
    try {
      await classroomAPI.reject(classroomId, userId);
      setSuccess('Request rejected.');
      loadClassroomData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reject request');
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setActionLoading(true);

    try {
      const response = await classroomAPI.invite(classroomId, inviteEmail);
      setSuccess(response.data.message || 'Invitation sent!');
      setInviteEmail('');
      setShowInviteModal(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send invite');
    } finally {
      setActionLoading(false);
    }
  };

  const generateSemesterName = (type, year, session) => {
    const parts = [];
    if (type) parts.push(type === 'odd' ? 'Odd Semester' : 'Even Semester');
    if (year) parts.push(year);
    if (session) parts.push(`(${session})`);
    return parts.join(' ') || '';
  };

  const handleSemesterFieldChange = (field, value) => {
    const updated = { ...newSemester, [field]: value };
    updated.name = generateSemesterName(updated.type, updated.year, updated.session);
    setNewSemester(updated);
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        height: '100vh', fontSize: '18px', color: '#667eea'
      }}>
        Loading classroom...
      </div>
    );
  }

  if (!classroom) {
    return (
      <div className="classroom-container">
        <p>Classroom not found.</p>
        <button className="btn-primary" onClick={() => navigate('/classrooms')}>
          Back to Classrooms
        </button>
      </div>
    );
  }

  const semesters = classroom.semesters || [];
  const activeSemester = semesters.find(s => s.is_active);
  const oddSemesters = semesters.filter(s => s.type === 'odd');
  const evenSemesters = semesters.filter(s => s.type === 'even');
  const otherSemesters = semesters.filter(s => s.type !== 'odd' && s.type !== 'even');

  const completedCount = todos.filter(t => t.completed).length;

  return (
    <div className="classroom-container">
      {/* Header */}
      <div className="classroom-header-section">
        <div>
          <button
            onClick={() => navigate('/classrooms')}
            style={{
              background: 'none', border: 'none', color: '#667eea',
              cursor: 'pointer', fontSize: '14px', marginBottom: '8px',
              padding: 0
            }}
          >
            &larr; Back to Classrooms
          </button>
          <h1>{classroom.name}</h1>
          {classroom.description && (
            <p style={{ color: '#666', margin: '4px 0' }}>{classroom.description}</p>
          )}
        </div>
        <div className="action-buttons">
          {classroom.code && (
            <span className="classroom-code" style={{ padding: '12px 24px', fontSize: '15px' }}>
              Code: {classroom.code}
            </span>
          )}
          {classroom.is_cr && (
            <>
              <button
                className="btn-secondary"
                onClick={() => setShowInviteModal(true)}
              >
                Invite Member
              </button>
              <button
                className="btn-primary"
                onClick={() => setShowCreateSemester(true)}
              >
                New Semester
              </button>
            </>
          )}
        </div>
      </div>

      {/* Info bar */}
      <div style={{
        display: 'flex', gap: '20px', marginBottom: '30px',
        padding: '15px 20px', background: '#f8f9ff', borderRadius: '8px'
      }}>
        <span style={{ color: '#555' }}>
          <strong>Members:</strong> {classroom.member_count || 0}
        </span>
        <span style={{ color: '#555' }}>
          <strong>Role:</strong> {classroom.is_cr ? 'Class Representative' : 'Member'}
        </span>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {/* Pending Join Requests (CR only) */}
      {classroom.is_cr && classroom.join_requests && classroom.join_requests.length > 0 && (
        <div className="classrooms-section">
          <h2>Pending Join Requests</h2>
          <div className="classrooms-grid">
            {classroom.join_requests.map(req => (
              <div key={req.user_id} className="classroom-card">
                <div className="classroom-header">
                  <h3>{req.username}</h3>
                </div>
                <p className="classroom-description">{req.email}</p>
                {req.fullName && <p className="classroom-subject">{req.fullName}</p>}
                <div className="classroom-footer" style={{ gap: '8px' }}>
                  <button
                    className="btn-primary"
                    style={{ padding: '6px 16px', fontSize: '13px' }}
                    onClick={(e) => { e.stopPropagation(); handleApproveRequest(req.user_id); }}
                  >
                    Approve
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ padding: '6px 16px', fontSize: '13px' }}
                    onClick={(e) => { e.stopPropagation(); handleRejectRequest(req.user_id); }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Two-column layout: Main content + Todo panel */}
      <div style={{ display: 'flex', gap: '30px', alignItems: 'flex-start' }}>
        {/* Left: Semesters + Members */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Semesters */}
          {semesters.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#999' }}>
              <p style={{ fontSize: '18px' }}>No semesters yet.</p>
              {classroom.is_cr && (
                <p>Click "New Semester" to create one.</p>
              )}
            </div>
          ) : (
            <>
              {oddSemesters.length > 0 && (
                <div className="classrooms-section">
                  <h2>Odd Semesters</h2>
                  <div className="classrooms-grid">
                    {oddSemesters.map(sem => (
                      <SemesterCard key={sem.id} semester={sem} classroomId={classroomId} isCr={classroom.is_cr} onSubjectsChange={loadClassroomData} />
                    ))}
                  </div>
                </div>
              )}

              {evenSemesters.length > 0 && (
                <div className="classrooms-section">
                  <h2>Even Semesters</h2>
                  <div className="classrooms-grid">
                    {evenSemesters.map(sem => (
                      <SemesterCard key={sem.id} semester={sem} classroomId={classroomId} isCr={classroom.is_cr} onSubjectsChange={loadClassroomData} />
                    ))}
                  </div>
                </div>
              )}

              {otherSemesters.length > 0 && (
                <div className="classrooms-section">
                  <h2>Semesters</h2>
                  <div className="classrooms-grid">
                    {otherSemesters.map(sem => (
                      <SemesterCard key={sem.id} semester={sem} classroomId={classroomId} isCr={classroom.is_cr} onSubjectsChange={loadClassroomData} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Members List */}
          {classroom.members && classroom.members.length > 0 && (
            <div className="classrooms-section">
              <h2>Members ({classroom.members.length})</h2>
              <div className="classrooms-grid">
                {classroom.members.map(member => {
                  const isMemberCr = activeSemester && activeSemester.cr_ids.includes(member.id);
                  const isCreator = member.id === classroom.created_by;
                  const canKick = classroom.is_cr && member.id !== user?.id && !isCreator;
                  return (
                    <div key={member.id} className="classroom-card" style={{ cursor: 'default' }}>
                      <div className="classroom-header">
                        <h3>{member.username}</h3>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {isCreator && (
                            <span className="classroom-badge" style={{
                              background: '#fef3c7', color: '#92400e', padding: '3px 8px',
                              borderRadius: '10px', fontSize: '11px', fontWeight: 600
                            }}>Owner</span>
                          )}
                          {isMemberCr && (
                            <span className="classroom-badge" style={{
                              background: '#e0f2fe', color: '#0284c7', padding: '3px 8px',
                              borderRadius: '10px', fontSize: '11px', fontWeight: 600
                            }}>CR</span>
                          )}
                        </div>
                      </div>
                      <p className="classroom-description">{member.email}</p>
                      {member.fullName && (
                        <p className="classroom-subject">{member.fullName}</p>
                      )}
                      {canKick && (
                        <div className="classroom-footer">
                          <button
                            onClick={() => handleRemoveMember(member.id)}
                            style={{
                              background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
                              borderRadius: '6px', padding: '4px 12px', fontSize: '12px',
                              cursor: 'pointer', fontWeight: 500
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: Todo Panel */}
        {semesters.length > 0 && (
          <div style={{
            width: '340px',
            flexShrink: 0,
            background: 'white',
            borderRadius: '12px',
            border: '1.5px solid #e5e7eb',
            padding: '20px',
            position: 'sticky',
            top: '20px',
            maxHeight: 'calc(100vh - 40px)',
            overflowY: 'auto'
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: '12px'
            }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>To-Do List</h2>
              <span style={{
                fontSize: '13px', color: '#667eea', fontWeight: 600
              }}>
                {completedCount}/{todos.length}
              </span>
            </div>

            {/* Semester selector */}
            {semesters.length > 1 && (
              <select
                value={selectedSemesterId || ''}
                onChange={(e) => handleSemesterSelect(e.target.value)}
                style={{
                  width: '100%', padding: '7px 10px', border: '1.5px solid #ddd',
                  borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit',
                  background: 'white', marginBottom: '12px', color: '#333'
                }}
              >
                {semesters.map(sem => (
                  <option key={sem.id} value={sem.id}>
                    {sem.name}{sem.is_active ? ' (Active)' : ''}
                  </option>
                ))}
              </select>
            )}

            {/* Progress bar */}
            {todos.length > 0 && (
              <div style={{
                height: '6px', background: '#e5e7eb', borderRadius: '3px',
                marginBottom: '16px', overflow: 'hidden'
              }}>
                <div style={{
                  height: '100%',
                  width: `${(completedCount / todos.length) * 100}%`,
                  background: '#667eea',
                  borderRadius: '3px',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            )}

            {/* Add todo form — only for active semester */}
            {selectedSemesterId === activeSemester?.id && (
              <form onSubmit={handleAddTodo} style={{
                display: 'flex', gap: '8px', marginBottom: '16px'
              }}>
                <input
                  type="text"
                  value={newTodoText}
                  onChange={(e) => setNewTodoText(e.target.value)}
                  placeholder="Add a task..."
                  disabled={todoLoading}
                  style={{
                    flex: 1, padding: '8px 12px', border: '1.5px solid #ddd',
                    borderRadius: '6px', fontSize: '14px', fontFamily: 'inherit',
                    outline: 'none'
                  }}
                />
                <button
                  type="submit"
                  disabled={todoLoading || !newTodoText.trim()}
                  style={{
                    padding: '8px 14px', background: '#667eea', color: 'white',
                    border: 'none', borderRadius: '6px', fontSize: '14px',
                    cursor: 'pointer', fontWeight: 600, opacity: (!newTodoText.trim() || todoLoading) ? 0.5 : 1
                  }}
                >
                  +
                </button>
              </form>
            )}

            {/* Todo items */}
            {todos.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#999', fontSize: '14px', margin: '30px 0' }}>
                No tasks for this semester.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {todos.map(todo => (
                  <div
                    key={todo.id}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: '10px',
                      padding: '10px 12px', borderRadius: '8px',
                      background: todo.completed ? '#f0fdf4' : '#fafafa',
                      border: '1px solid',
                      borderColor: todo.completed ? '#bbf7d0' : '#e5e7eb',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={todo.completed}
                      onChange={() => handleToggleTodo(todo.id)}
                      style={{
                        marginTop: '3px', cursor: 'pointer',
                        width: '16px', height: '16px', accentColor: '#667eea',
                        flexShrink: 0
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        margin: 0, fontSize: '14px', lineHeight: '1.4',
                        textDecoration: todo.completed ? 'line-through' : 'none',
                        color: todo.completed ? '#999' : '#333',
                        wordBreak: 'break-word'
                      }}>
                        {todo.text}
                      </p>
                      <span style={{ fontSize: '11px', color: '#aaa' }}>
                        {todo.created_by?.username}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteTodo(todo.id)}
                      style={{
                        background: 'none', border: 'none', color: '#ccc',
                        cursor: 'pointer', fontSize: '16px', padding: '0 2px',
                        lineHeight: 1, flexShrink: 0
                      }}
                      title="Delete"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Semester Modal */}
      {showCreateSemester && (
        <div className="modal-overlay" onClick={() => setShowCreateSemester(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Semester</h2>
            <form onSubmit={handleCreateSemester}>
              <div className="form-group">
                <label>Semester Type *</label>
                <select
                  value={newSemester.type}
                  onChange={(e) => handleSemesterFieldChange('type', e.target.value)}
                  style={{
                    width: '100%', padding: '12px 15px', border: '1.5px solid #ddd',
                    borderRadius: '6px', fontSize: '15px', fontFamily: 'inherit',
                    background: 'white'
                  }}
                >
                  <option value="odd">Odd Semester</option>
                  <option value="even">Even Semester</option>
                </select>
              </div>

              <div className="form-group">
                <label>Year *</label>
                <input
                  type="text"
                  value={newSemester.year}
                  onChange={(e) => handleSemesterFieldChange('year', e.target.value)}
                  placeholder="e.g., 2024-2025"
                  required
                  disabled={actionLoading}
                />
              </div>

              <div className="form-group">
                <label>Session *</label>
                <input
                  type="text"
                  value={newSemester.session}
                  onChange={(e) => handleSemesterFieldChange('session', e.target.value)}
                  placeholder="e.g., Jan-Jun or Jul-Dec"
                  required
                  disabled={actionLoading}
                />
              </div>

              <div className="form-group">
                <label>Semester Name</label>
                <input
                  type="text"
                  value={newSemester.name}
                  onChange={(e) => setNewSemester({ ...newSemester, name: e.target.value })}
                  placeholder="Auto-generated from above fields"
                  required
                  disabled={actionLoading}
                />
                <small>Auto-generated, but you can edit it</small>
              </div>

              <div className="modal-buttons">
                <button
                  type="button"
                  onClick={() => setShowCreateSemester(false)}
                  disabled={actionLoading}
                >
                  Cancel
                </button>
                <button type="submit" disabled={actionLoading}>
                  {actionLoading ? 'Creating...' : 'Create Semester'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite Member Modal */}
      {showInviteModal && (
        <div className="modal-overlay" onClick={() => setShowInviteModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Invite Member</h2>
            <p style={{ color: '#666', marginBottom: '20px' }}>
              Send an email invitation to join this classroom. They'll be added directly — no approval needed.
            </p>
            <form onSubmit={handleInvite}>
              <div className="form-group">
                <label>Email Address *</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="student@example.com"
                  required
                  disabled={actionLoading}
                />
              </div>

              <div className="modal-buttons">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  disabled={actionLoading}
                >
                  Cancel
                </button>
                <button type="submit" disabled={actionLoading}>
                  {actionLoading ? 'Sending...' : 'Send Invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function SemesterCard({ semester, classroomId, isCr, onSubjectsChange }) {
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [subjectName, setSubjectName] = useState('');
  const [subjectCode, setSubjectCode] = useState('');
  const [subjectLoading, setSubjectLoading] = useState(false);

  const subjects = semester.subjects || [];
  const canManageSubjects = isCr && semester.is_active;

  const handleAddSubject = async (e) => {
    e.preventDefault();
    if (!subjectName.trim()) return;
    setSubjectLoading(true);
    try {
      await subjectAPI.create({
        classroom_id: classroomId,
        semester_id: semester.id,
        name: subjectName.trim(),
        code: subjectCode.trim()
      });
      setSubjectName('');
      setSubjectCode('');
      setShowAddSubject(false);
      onSubjectsChange();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add subject');
    } finally {
      setSubjectLoading(false);
    }
  };

  const handleDeleteSubject = async (subjectId) => {
    try {
      await subjectAPI.delete(subjectId);
      onSubjectsChange();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete subject');
    }
  };

  return (
    <div className="classroom-card">
      <div className="classroom-header">
        <h3>{semester.name}</h3>
        <div style={{ display: 'flex', gap: '6px' }}>
          {semester.is_active && (
            <span className="classroom-badge teacher">Active</span>
          )}
          {semester.is_user_cr && (
            <span className="classroom-badge" style={{
              background: '#e0f2fe', color: '#0284c7', padding: '4px 10px',
              borderRadius: '12px', fontSize: '12px', fontWeight: 600
            }}>CR</span>
          )}
        </div>
      </div>
      {semester.year && (
        <p className="classroom-subject">Year: {semester.year}</p>
      )}
      {semester.session && (
        <p className="classroom-description">Session: {semester.session}</p>
      )}

      {/* Subjects */}
      {(subjects.length > 0 || canManageSubjects) && (
        <div style={{ marginTop: '10px', borderTop: '1px solid #eee', paddingTop: '10px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
            {subjects.map(sub => (
              <span key={sub.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                background: '#f0f4ff', color: '#4338ca', padding: '3px 10px',
                borderRadius: '14px', fontSize: '12px', fontWeight: 500
              }}>
                {sub.code ? `${sub.code} — ` : ''}{sub.name}
                {canManageSubjects && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteSubject(sub.id); }}
                    style={{
                      background: 'none', border: 'none', color: '#a5b4fc',
                      cursor: 'pointer', fontSize: '14px', padding: '0 2px',
                      lineHeight: 1, marginLeft: '2px'
                    }}
                    title="Remove subject"
                  >&times;</button>
                )}
              </span>
            ))}
            {canManageSubjects && !showAddSubject && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowAddSubject(true); }}
                style={{
                  background: '#e0e7ff', color: '#4338ca', border: 'none',
                  borderRadius: '14px', padding: '3px 10px', fontSize: '12px',
                  cursor: 'pointer', fontWeight: 600
                }}
                title="Add subject"
              >+ Add</button>
            )}
          </div>

          {showAddSubject && (
            <form onSubmit={handleAddSubject} onClick={(e) => e.stopPropagation()} style={{
              marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap'
            }}>
              <input
                type="text"
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                placeholder="Subject name *"
                required
                disabled={subjectLoading}
                style={{
                  flex: 1, minWidth: '100px', padding: '5px 8px',
                  border: '1.5px solid #ddd', borderRadius: '6px', fontSize: '12px'
                }}
              />
              <input
                type="text"
                value={subjectCode}
                onChange={(e) => setSubjectCode(e.target.value)}
                placeholder="Code"
                disabled={subjectLoading}
                style={{
                  width: '70px', padding: '5px 8px',
                  border: '1.5px solid #ddd', borderRadius: '6px', fontSize: '12px'
                }}
              />
              <button type="submit" disabled={subjectLoading || !subjectName.trim()} style={{
                padding: '5px 10px', background: '#667eea', color: 'white',
                border: 'none', borderRadius: '6px', fontSize: '12px',
                cursor: 'pointer', fontWeight: 600
              }}>Add</button>
              <button type="button" onClick={() => setShowAddSubject(false)} style={{
                padding: '5px 8px', background: '#f3f4f6', color: '#666',
                border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer'
              }}>Cancel</button>
            </form>
          )}
        </div>
      )}

      <div className="classroom-footer">
        <span className="student-count">
          {semester.type === 'odd' ? 'Odd' : semester.type === 'even' ? 'Even' : ''} Semester
        </span>
      </div>
    </div>
  );
}

export default ClassroomDetail;
