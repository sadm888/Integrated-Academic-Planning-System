import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { classroomAPI, semesterAPI } from '../services/api';
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

  useEffect(() => {
    loadClassroomData();
  }, [classroomId]);

  const loadClassroomData = async () => {
    try {
      const response = await classroomAPI.getDetails(classroomId);
      setClassroom(response.data.classroom);
    } catch (err) {
      console.error('Failed to load classroom:', err);
      setError('Failed to load classroom data');
    } finally {
      setLoading(false);
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
  const oddSemesters = semesters.filter(s => s.type === 'odd');
  const evenSemesters = semesters.filter(s => s.type === 'even');
  const otherSemesters = semesters.filter(s => s.type !== 'odd' && s.type !== 'even');

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
          {classroom.subject && (
            <p style={{ color: '#667eea', fontWeight: 600, margin: '4px 0' }}>
              {classroom.subject}
            </p>
          )}
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
                  <SemesterCard key={sem.id} semester={sem} />
                ))}
              </div>
            </div>
          )}

          {evenSemesters.length > 0 && (
            <div className="classrooms-section">
              <h2>Even Semesters</h2>
              <div className="classrooms-grid">
                {evenSemesters.map(sem => (
                  <SemesterCard key={sem.id} semester={sem} />
                ))}
              </div>
            </div>
          )}

          {otherSemesters.length > 0 && (
            <div className="classrooms-section">
              <h2>Semesters</h2>
              <div className="classrooms-grid">
                {otherSemesters.map(sem => (
                  <SemesterCard key={sem.id} semester={sem} />
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
            {classroom.members.map(member => (
              <div key={member.id} className="classroom-card" style={{ cursor: 'default' }}>
                <div className="classroom-header">
                  <h3>{member.username}</h3>
                </div>
                <p className="classroom-description">{member.email}</p>
                {member.fullName && (
                  <p className="classroom-subject">{member.fullName}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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

function SemesterCard({ semester }) {
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
      <div className="classroom-footer">
        <span className="student-count">
          {semester.type === 'odd' ? 'Odd' : semester.type === 'even' ? 'Even' : ''} Semester
        </span>
      </div>
    </div>
  );
}

export default ClassroomDetail;
