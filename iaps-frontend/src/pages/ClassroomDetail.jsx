import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { classroomAPI, semesterAPI, settingsAPI, dmAPI } from '../services/api';
import FilePickerModal from '../components/FilePickerModal';
import { useDMSocket } from '../hooks/useDMSocket';
import Avatar from '../components/Avatar';
import '../styles/Classroom.css';

function ClassroomDetail({ user, onDmRead }) {
  const { classroomId } = useParams();
  const navigate = useNavigate();
  const [classroom, setClassroom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreateSemester, setShowCreateSemester] = useState(false);
  const [newSemester, setNewSemester] = useState({ name: '', type: 'odd', year: '', session: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [removePhotoTarget, setRemovePhotoTarget] = useState(null); // { id, name }
  const [removePhotoReason, setRemovePhotoReason] = useState('');
  const [removePhotoLoading, setRemovePhotoLoading] = useState(false);
  const [flagNameTarget, setFlagNameTarget] = useState(null); // { id, name }
  const [flagNameReason, setFlagNameReason] = useState('');
  const [flagNameLoading, setFlagNameLoading] = useState(false);
  const [fullscreenPhoto, setFullscreenPhoto] = useState(null); // URL string or null
  const [showDmFilePicker, setShowDmFilePicker] = useState(false);

  // DM state
  const [dmTarget, setDmTarget] = useState(null); // { id, name } or null
  const [dmMessages, setDmMessages] = useState([]);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmError, setDmError] = useState('');
  const [dmText, setDmText] = useState('');
  const [dmSending, setDmSending] = useState(false);
  const [dmUploading, setDmUploading] = useState(false);
  const [pendingDmFile, setPendingDmFile] = useState(null);
  const [memberDmStats, setMemberDmStats] = useState({}); // { user_id: count }
  const [unreadBySender, setUnreadBySender] = useState({}); // { user_id: unread_count }
  const dmBottomRef = useRef(null);
  const dmFileInputRef = useRef(null);

  useEffect(() => { loadClassroomData(); }, [classroomId]);

  // DM socket — connects only when a DM thread is open
  const { connected: dmConnected } = useDMSocket(
    dmTarget ? classroomId : null,
    dmTarget?.id || null,
    {
      onMessage: useCallback((msg) => {
        setDmMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        setTimeout(() => dmBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }, []),
      onDeleted: useCallback(({ message_id }) => {
        setDmMessages(prev => prev.filter(m => m.id !== message_id));
      }, []),
    }
  );

  // Load DM thread when dmTarget changes
  useEffect(() => {
    if (!dmTarget) { setDmMessages([]); return; }
    setDmLoading(true); setDmError('');
    dmAPI.getThread(classroomId, dmTarget.id)
      .then(res => {
        setDmMessages(res.data.messages || []);
        setTimeout(() => dmBottomRef.current?.scrollIntoView({ behavior: 'auto' }), 50);
      })
      .catch(() => setDmError('Failed to load messages'))
      .finally(() => setDmLoading(false));
    dmAPI.markRead(classroomId, dmTarget.id)
      .then(() => {
        // Clear unread badge for this sender and notify App
        setUnreadBySender(prev => {
          const next = { ...prev };
          delete next[dmTarget.id];
          return next;
        });
        if (onDmRead) onDmRead();
      })
      .catch(() => {});
  }, [dmTarget, classroomId]);

  const loadClassroomData = async () => {
    try {
      const res = await classroomAPI.getDetails(classroomId);
      const c = res.data.classroom;
      setClassroom(c);
      // Load per-member DM send counts for CRs
      if (c?.is_cr) {
        dmAPI.getMemberStats(classroomId)
          .then(r => setMemberDmStats(r.data.stats || {}))
          .catch(() => {});
      }
      // Load unread DM counts per sender for all members
      dmAPI.getUnreadBySender(classroomId)
        .then(r => setUnreadBySender(r.data.unread || {}))
        .catch(() => {});
    } catch (err) {
      setError('Failed to load classroom data');
    } finally {
      setLoading(false);
    }
  };

  const sendDmMessage = async () => {
    if (dmSending || dmUploading || !dmTarget) return;
    if (pendingDmFile) {
      const caption = dmText.trim();
      const file = pendingDmFile;
      setPendingDmFile(null); setDmText('');
      setDmUploading(true); setDmError('');
      try {
        await dmAPI.uploadFile(classroomId, dmTarget.id, file, caption || undefined);
      } catch (err) {
        setDmError(err.response?.data?.error || 'Failed to send file');
      } finally { setDmUploading(false); }
      return;
    }
    const text = dmText.trim();
    if (!text) return;
    setDmSending(true); setDmError('');
    try {
      const res = await dmAPI.sendMessage(classroomId, dmTarget.id, text);
      setDmText('');
      // Message comes back via socket; add optimistically if socket not yet connected
      if (!dmConnected) {
        setDmMessages(prev => [...prev, res.data.message]);
        setTimeout(() => dmBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }
    } catch (err) {
      setDmError(err.response?.data?.error || 'Failed to send');
    } finally { setDmSending(false); }
  };

  const deleteDmMessage = async (messageId) => {
    try {
      await dmAPI.deleteMessage(classroomId, messageId);
    } catch (err) {
      setDmError(err.response?.data?.error || 'Failed to delete');
    }
  };

  const handleApproveRequest = async (userId) => {
    setError('');
    try {
      await classroomAPI.approve(classroomId, userId);
      setSuccess('Member approved!');
      loadClassroomData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to approve');
    }
  };

  const handleRejectRequest = async (userId) => {
    setError('');
    try {
      await classroomAPI.reject(classroomId, userId);
      setSuccess('Request rejected.');
      loadClassroomData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reject');
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!window.confirm('Remove this member?')) return;
    setError('');
    try {
      await classroomAPI.removeMember(classroomId, memberId);
      setSuccess('Member removed.');
      loadClassroomData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove member');
    }
  };

  const handleRemovePhoto = async (e) => {
    e.preventDefault();
    if (!removePhotoTarget || !removePhotoReason.trim()) return;
    setRemovePhotoLoading(true);
    setError('');
    try {
      await classroomAPI.removeMemberAvatar(classroomId, removePhotoTarget.id, removePhotoReason.trim());
      setSuccess(`Profile photo removed for ${removePhotoTarget.name}.`);
      setRemovePhotoTarget(null);
      setRemovePhotoReason('');
      loadClassroomData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove photo');
    } finally {
      setRemovePhotoLoading(false);
    }
  };

  const handleFlagName = async (e) => {
    e.preventDefault();
    if (!flagNameTarget || !flagNameReason.trim()) return;
    setFlagNameLoading(true);
    setError('');
    try {
      await classroomAPI.flagMemberName(classroomId, flagNameTarget.id, flagNameReason.trim());
      setSuccess(`Display name flagged for ${flagNameTarget.name}. They will be prompted to change it.`);
      setFlagNameTarget(null);
      setFlagNameReason('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to flag display name');
    } finally {
      setFlagNameLoading(false);
    }
  };

  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const [leaveLoading, setLeaveLoading] = useState(false);

  const handleLeaveConfirm = async () => {
    setLeaveLoading(true);
    setLeaveError('');
    try {
      await classroomAPI.leave(classroomId);
      navigate('/classrooms');
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to leave classroom';
      setLeaveError(msg);
      setLeaveLoading(false);
    }
  };

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

  const handleDeleteClassroom = async () => {
    if (deleteConfirmName !== classroom?.name) return;
    setDeleteLoading(true);
    setError('');
    try {
      await classroomAPI.delete(classroomId);
      navigate('/classrooms');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete classroom');
      setDeleteLoading(false);
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

  const handleCreateSemester = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setActionLoading(true);
    try {
      await semesterAPI.create({
        classroom_id: classroomId,
        name: newSemester.name,
        type: newSemester.type,
        year: newSemester.year,
        session: newSemester.session,
      });
      setSuccess('Semester created!');
      setNewSemester({ name: '', type: 'odd', year: '', session: '' });
      setShowCreateSemester(false);
      loadClassroomData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create semester');
    } finally { setActionLoading(false); }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '18px', color: '#667eea' }}>
        Loading...
      </div>
    );
  }

  if (!classroom) {
    return (
      <div className="classroom-container">
        <p>Classroom not found.</p>
        <button className="btn-primary" onClick={() => navigate('/classrooms')}>Back</button>
      </div>
    );
  }

  const semesters = classroom.semesters || [];
  const activeSemester = semesters.find(s => s.is_active);

  return (
    <div className="classroom-container">
      {/* Header */}
      <div className="classroom-header-section">
        <div>
          <button onClick={() => navigate('/classrooms')} style={{
            background: 'none', border: 'none', color: '#667eea',
            cursor: 'pointer', fontSize: '14px', marginBottom: '8px', padding: 0,
          }}>
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
            <button className="btn-primary" onClick={() => setShowCreateSemester(true)}>
              New Semester
            </button>
          )}
          <button onClick={() => { setShowLeaveModal(true); setLeaveError(''); }} style={{
            background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
            borderRadius: '8px', padding: '10px 20px', fontSize: '14px',
            fontWeight: 600, cursor: 'pointer',
          }}>
            Leave
          </button>
        </div>
      </div>

      {/* Info bar */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '30px', padding: '15px 20px', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
        <span style={{ color: '#555' }}><strong>Members:</strong> {classroom.member_count || 0}</span>
        <span style={{ color: '#555' }}><strong>Role:</strong> {classroom.is_cr ? 'Class Representative' : 'Member'}</span>
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
                  <h3>{req.fullName || req.username}</h3>
                </div>
                {req.fullName && <p style={{ color: '#888', fontSize: '13px', margin: '2px 0' }}>@{req.username}</p>}
                <p className="classroom-description">{req.email}</p>
                <div className="classroom-footer" style={{ gap: '8px' }}>
                  <button className="btn-primary" style={{ padding: '6px 16px', fontSize: '13px' }}
                    onClick={() => handleApproveRequest(req.user_id)}>Approve</button>
                  <button className="btn-secondary" style={{ padding: '6px 16px', fontSize: '13px' }}
                    onClick={() => handleRejectRequest(req.user_id)}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Semesters */}
      <div className="classrooms-section">
        <h2>Semesters</h2>
        {semesters.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#999' }}>
            <p style={{ fontSize: '16px' }}>No semesters yet.</p>
            {classroom.is_cr && <p>Click "New Semester" to create one.</p>}
          </div>
        ) : (
          <div className="classrooms-grid">
            {semesters.map(sem => (
              <SemesterCard key={sem.id} semester={sem} classroomId={classroomId} />
            ))}
          </div>
        )}
      </div>

      {/* Members */}
      {classroom.members && classroom.members.length > 0 && (
        <div className="classrooms-section">
          <h2>Members ({classroom.members.length})</h2>
          <div className="classrooms-grid">
            {classroom.members.map(member => {
              const isMemberCr = activeSemester && activeSemester.cr_ids?.includes(member.id);
              const isCreator = member.id === classroom.created_by;
              const canKick = classroom.is_cr && member.id !== user?.id && !isMemberCr;
              const isSelf = member.id === user?.id;
              // Show DM button: member→CRs only, CR→anyone (not self)
              const canDm = !isSelf && (classroom.is_cr || isMemberCr);
              const memberMsgCount = memberDmStats[member.id] || 0;
              const unreadFromMember = unreadBySender[member.id] || 0;
              return (
                <div key={member.id} className="classroom-card" style={{ cursor: 'default' }}>
                  {/* Avatar row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div
                        style={{ cursor: member.profile_picture ? 'pointer' : 'default' }}
                        onClick={() => member.profile_picture && setFullscreenPhoto({ url: settingsAPI.getAvatarUrl(member.id), userId: member.id, name: member.fullName || member.username })}
                        title={member.profile_picture ? 'View full photo' : ''}
                      >
                        <Avatar user={member} size={40} />
                      </div>
                      {unreadFromMember > 0 && (
                        <span style={{
                          position: 'absolute', top: -4, right: -4,
                          background: '#ef4444', color: 'white',
                          borderRadius: '50%', minWidth: '17px', height: '17px',
                          fontSize: '10px', fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          padding: '0 3px', border: '2px solid var(--card-bg)',
                          pointerEvents: 'none',
                        }}>
                          {unreadFromMember > 99 ? '99+' : unreadFromMember}
                        </span>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{member.fullName || member.username}</strong>
                        {isCreator && (
                          <span className="classroom-badge" style={{ background: '#fef3c7', color: '#92400e', padding: '2px 7px', borderRadius: '10px', fontSize: '11px', fontWeight: 600 }}>Owner</span>
                        )}
                        {isMemberCr && (
                          <span className="classroom-badge" style={{ background: '#e0f2fe', color: '#0284c7', padding: '2px 7px', borderRadius: '10px', fontSize: '11px', fontWeight: 600 }}>CR</span>
                        )}
                      </div>
                      {member.fullName && <p style={{ color: '#888', fontSize: '12px', margin: '1px 0 0' }}>@{member.username}</p>}
                    </div>
                  </div>
                  <p className="classroom-description">{member.email}</p>
                  {member.phone && (
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                      📞 {member.phone}
                      {member.phone_public && (
                        <span style={{ marginLeft: '5px', fontSize: '10px', color: '#16a34a' }}>public</span>
                      )}
                    </p>
                  )}
                  {/* DM button + outbound message count (CR view) */}
                  <div className="classroom-footer" style={{ gap: '8px', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {canDm && (
                        <button
                          onClick={() => setDmTarget({ id: member.id, name: member.fullName || member.username })}
                          style={{
                            background: '#ede9fe', color: '#7c3aed', border: '1px solid #ddd6fe',
                            borderRadius: '6px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: 500,
                          }}
                        >
                          Message
                        </button>
                      )}
                      {canKick && (
                        <>
                          <button onClick={() => handleRemoveMember(member.id)} style={{
                            background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
                            borderRadius: '6px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer',
                          }}>Remove</button>
                          {member.profile_picture && (
                            <button onClick={() => { setRemovePhotoTarget({ id: member.id, name: member.fullName || member.username }); setRemovePhotoReason(''); }} style={{
                              background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa',
                              borderRadius: '6px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer',
                            }}>Remove Photo</button>
                          )}
                          <button onClick={() => { setFlagNameTarget({ id: member.id, name: member.fullName || member.username }); setFlagNameReason(''); }} style={{
                            background: '#fdf4ff', color: '#7e22ce', border: '1px solid #e9d5ff',
                            borderRadius: '6px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer',
                          }}>Flag Name</button>
                        </>
                      )}
                    </div>
                    {classroom.is_cr && memberMsgCount > 0 && (
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', background: 'var(--bg-color)', padding: '2px 7px', borderRadius: '10px', border: '1px solid var(--border-color)', flexShrink: 0 }}>
                        {memberMsgCount} msg{memberMsgCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
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
                <select value={newSemester.type} onChange={(e) => handleSemesterFieldChange('type', e.target.value)}
                  style={{ width: '100%', padding: '12px 15px', border: '1.5px solid var(--border-color)', borderRadius: '6px', fontSize: '15px', fontFamily: 'inherit', background: 'var(--card-bg)', color: 'var(--text-primary)' }}>
                  <option value="odd">Odd</option>
                  <option value="even">Even</option>
                </select>
              </div>
              <div className="form-group">
                <label>Year *</label>
                <input type="text" value={newSemester.year} onChange={(e) => handleSemesterFieldChange('year', e.target.value)}
                  placeholder="e.g., 2024-2025" required disabled={actionLoading} />
              </div>
              <div className="form-group">
                <label>Session *</label>
                <input type="text" value={newSemester.session} onChange={(e) => handleSemesterFieldChange('session', e.target.value)}
                  placeholder="e.g., Jan-Jun" required disabled={actionLoading} />
              </div>
              <div className="form-group">
                <label>Semester Name</label>
                <input type="text" value={newSemester.name} onChange={(e) => setNewSemester({ ...newSemester, name: e.target.value })}
                  placeholder="Auto-generated" required disabled={actionLoading} />
                <small>Auto-generated, but you can edit it</small>
              </div>
              <div className="modal-buttons">
                <button type="button" onClick={() => setShowCreateSemester(false)} disabled={actionLoading}>Cancel</button>
                <button type="submit" disabled={actionLoading}>{actionLoading ? 'Creating...' : 'Create Semester'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Remove Photo Modal */}
      {removePhotoTarget && (
        <div className="modal-overlay" onClick={() => setRemovePhotoTarget(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <h2>Remove Profile Photo</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
              You are removing <strong>{removePhotoTarget.name}</strong>'s profile photo.
              They will see the reason you provide below.
            </p>
            <form onSubmit={handleRemovePhoto}>
              <div className="form-group">
                <label>Reason *</label>
                <textarea
                  value={removePhotoReason}
                  onChange={(e) => setRemovePhotoReason(e.target.value)}
                  placeholder="e.g., Inappropriate or offensive content"
                  rows="3"
                  required
                  disabled={removePhotoLoading}
                />
              </div>
              <div className="modal-buttons">
                <button type="button" onClick={() => setRemovePhotoTarget(null)} disabled={removePhotoLoading}>Cancel</button>
                <button type="submit" disabled={removePhotoLoading || !removePhotoReason.trim()} style={{ background: '#ea580c', color: 'white' }}>
                  {removePhotoLoading ? 'Removing...' : 'Remove Photo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Flag Display Name Modal */}
      {flagNameTarget && (
        <div className="modal-overlay" onClick={() => setFlagNameTarget(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <h2>Flag Inappropriate Name</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '6px' }}>
              Flagging <strong>{flagNameTarget.name}</strong>'s display name as inappropriate.
              They will be shown as <em>Anonymous User</em> and prompted to change their name in Settings.
            </p>
            <form onSubmit={handleFlagName}>
              <div className="form-group">
                <label>Reason *</label>
                <textarea
                  value={flagNameReason}
                  onChange={(e) => setFlagNameReason(e.target.value)}
                  placeholder="e.g., Contains offensive or inappropriate language"
                  rows="3"
                  required
                  disabled={flagNameLoading}
                />
              </div>
              <div className="modal-buttons">
                <button type="button" onClick={() => setFlagNameTarget(null)} disabled={flagNameLoading}>Cancel</button>
                <button type="submit" disabled={flagNameLoading || !flagNameReason.trim()} style={{ background: '#7e22ce', color: 'white' }}>
                  {flagNameLoading ? 'Flagging...' : 'Flag Name'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Danger zone: Delete Classroom (CR only) */}
      {classroom.is_cr && (
        <div style={{
          marginTop: '40px', padding: '20px 24px',
          border: '1.5px solid rgba(220,38,38,0.35)', borderRadius: '12px',
          background: 'rgba(220,38,38,0.06)',
        }}>
          <h3 style={{ margin: '0 0 6px', fontSize: '16px', color: '#b91c1c' }}>Danger Zone</h3>
          <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#dc2626' }}>
            Permanently delete this classroom and all its data. This cannot be undone.
          </p>
          <button
            onClick={() => { setConfirmDelete(true); setDeleteConfirmName(''); }}
            style={{
              background: '#dc2626', color: 'white', border: 'none',
              borderRadius: '8px', padding: '8px 20px', fontSize: '14px',
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            Delete Classroom
          </button>
        </div>
      )}

      {/* Leave Classroom Modal */}
      {showLeaveModal && (
        <div className="modal-overlay" onClick={() => setShowLeaveModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <h2 style={{ color: '#b91c1c', margin: '0 0 10px' }}>Leave Classroom</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '0 0 12px' }}>
              You will lose access to <strong>{classroom.name}</strong> and will need the invite code to rejoin.
            </p>
            {classroom.is_cr && !leaveError && (
              <div style={{
                background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px',
                padding: '10px 14px', marginBottom: '14px', fontSize: '13px', color: '#92400e',
              }}>
                You are a CR in this classroom. Leaving will remove your CR role from all semesters.<br />
                <span style={{ fontSize: '12px', opacity: 0.85 }}>
                  (Only allowed if another CR exists in each semester you are CR of.)
                </span>
              </div>
            )}
            {leaveError && (
              <div style={{
                background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
                padding: '10px 14px', color: '#b91c1c', fontSize: '13px', marginBottom: '14px',
              }}>
                {leaveError}
                {leaveError.includes('Transfer') && (
                  <div style={{ marginTop: '6px', fontSize: '12px' }}>
                    Go to the active semester and use <strong>Transfer CR</strong> to nominate someone before leaving.
                  </div>
                )}
              </div>
            )}
            <div className="modal-buttons">
              <button type="button" onClick={() => setShowLeaveModal(false)} disabled={leaveLoading}>Cancel</button>
              <button
                type="button"
                onClick={handleLeaveConfirm}
                disabled={leaveLoading}
                style={{ background: '#dc2626', color: 'white' }}
              >
                {leaveLoading ? 'Leaving...' : 'Leave Classroom'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Classroom Confirmation Modal */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <h2 style={{ color: '#b91c1c', margin: '0 0 8px' }}>Delete Classroom</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '0 0 16px' }}>
              This will permanently delete <strong>{classroom.name}</strong>, all its semesters, subjects, documents, and messages.
              This action <strong>cannot be undone</strong>.
            </p>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Type the classroom name to confirm:
            </p>
            <input
              type="text"
              value={deleteConfirmName}
              onChange={e => setDeleteConfirmName(e.target.value)}
              placeholder={classroom.name}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '8px',
                border: '1.5px solid var(--border-color)', fontSize: '14px',
                fontFamily: 'inherit', background: 'var(--bg-color)', color: 'var(--text-primary)',
                outline: 'none', boxSizing: 'border-box', marginBottom: '16px',
              }}
            />
            <div className="modal-buttons">
              <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleteLoading}>Cancel</button>
              <button
                type="button"
                onClick={handleDeleteClassroom}
                disabled={deleteLoading || deleteConfirmName !== classroom.name}
                style={{ background: '#dc2626', color: 'white', opacity: deleteConfirmName !== classroom.name ? 0.5 : 1 }}
              >
                {deleteLoading ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DM Modal */}
      {dmTarget && (
        <DMModal
          target={dmTarget}
          messages={dmMessages}
          loading={dmLoading}
          error={dmError}
          text={dmText}
          onTextChange={setDmText}
          pendingFile={pendingDmFile}
          onFilePick={() => dmFileInputRef.current?.click()}
          onClearFile={() => setPendingDmFile(null)}
          onSend={sendDmMessage}
          onDelete={deleteDmMessage}
          sending={dmSending}
          uploading={dmUploading}
          bottomRef={dmBottomRef}
          userId={user?.id}
          onClose={() => { setDmTarget(null); setDmText(''); setPendingDmFile(null); setDmError(''); }}
          onOpenFilePicker={() => setShowDmFilePicker(true)}
        />
      )}
      {showDmFilePicker && (
        <FilePickerModal
          onSelect={file => { setPendingDmFile(file); setShowDmFilePicker(false); }}
          onClose={() => setShowDmFilePicker(false)}
          user={user}
        />
      )}
      {/* Hidden file input for DM attachments */}
      <input
        ref={dmFileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) setPendingDmFile(f);
          e.target.value = '';
        }}
      />

      {/* Fullscreen photo overlay */}
      {fullscreenPhoto && (
        <div
          onClick={() => setFullscreenPhoto(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, cursor: 'zoom-out', gap: '16px',
          }}
        >
          <img
            src={fullscreenPhoto.url}
            alt="Profile"
            style={{ maxWidth: '80vw', maxHeight: '70vh', borderRadius: '12px', objectFit: 'contain', boxShadow: '0 8px 40px rgba(0,0,0,0.5)', cursor: 'default' }}
            onClick={e => e.stopPropagation()}
          />
          <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '15px', fontWeight: 600 }}>
            {fullscreenPhoto.name}
          </span>
          {/* CR shortcut: open the reason modal for this member */}
          {classroom?.is_cr && (
            <button
              onClick={e => { e.stopPropagation(); setFullscreenPhoto(null); setRemovePhotoTarget({ id: fullscreenPhoto.userId, name: fullscreenPhoto.name }); setRemovePhotoReason(''); }}
              style={{
                background: '#ea580c', color: 'white', border: 'none',
                borderRadius: '8px', padding: '8px 24px', fontSize: '13px',
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Remove Photo
            </button>
          )}
          <button
            onClick={() => setFullscreenPhoto(null)}
            style={{
              position: 'absolute', top: '16px', right: '20px',
              background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white',
              fontSize: '24px', cursor: 'pointer', borderRadius: '50%',
              width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        </div>
      )}
    </div>
  );
}

function sizeLabel(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dmFileIcon(mime) {
  if (!mime) return '📎';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf') return '📄';
  return '📎';
}

function DMModal({ target, messages, loading, error, text, onTextChange, pendingFile, onFilePick, onClearFile, onSend, onDelete, sending, uploading, bottomRef, userId, onClose, onOpenFilePicker }) {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 600, padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: '520px', height: '560px',
          background: 'var(--card-bg)', borderRadius: '16px',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border-color)',
          display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>
              {target.name}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Private Message</div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer',
            color: 'var(--text-secondary)', lineHeight: 1, padding: '2px 6px',
          }}>×</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {loading && <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px', marginTop: '40px' }}>Loading…</div>}
          {!loading && messages.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px', marginTop: '40px' }}>
              No messages yet. Say hello!
            </div>
          )}
          {messages.map(msg => {
            const isMe = msg.sender_id === userId;
            const hasFile = !!msg.file;
            const fileUrl = hasFile ? dmAPI.getDmFileUrl(msg.id) : null;
            return (
              <div key={msg.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: '6px' }}>
                {!isMe && (
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#667eea', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: 'white', fontWeight: 700, flexShrink: 0 }}>
                    {(msg.sender_name || '?')[0].toUpperCase()}
                  </div>
                )}
                <div style={{ maxWidth: '72%' }}>
                  {!isMe && (
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '2px', paddingLeft: '4px' }}>
                      {msg.sender_name}
                    </div>
                  )}
                  <div style={{
                    background: isMe ? '#667eea' : 'var(--bg-color)',
                    color: isMe ? 'white' : 'var(--text-primary)',
                    borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    padding: '9px 13px', fontSize: '14px', wordBreak: 'break-word',
                    border: isMe ? 'none' : '1px solid var(--border-color)',
                    position: 'relative',
                  }}>
                    {hasFile && (
                      <a href={fileUrl} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: isMe ? 'rgba(255,255,255,0.9)' : '#667eea', textDecoration: 'none', marginBottom: msg.text ? '6px' : 0 }}>
                        <span style={{ fontSize: '18px' }}>{dmFileIcon(msg.file.mime_type)}</span>
                        <span style={{ fontSize: '13px', fontWeight: 500 }}>{msg.file.name}</span>
                        <span style={{ fontSize: '11px', opacity: 0.75 }}>{sizeLabel(msg.file.size)}</span>
                      </a>
                    )}
                    {msg.text && <span>{msg.text}</span>}
                    {isMe && (
                      <button
                        onClick={() => onDelete(msg.id)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'rgba(255,255,255,0.6)', fontSize: '11px', padding: '0 0 0 8px',
                          verticalAlign: 'middle',
                        }}
                        title="Delete"
                      >✕</button>
                    )}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px', paddingLeft: '4px', textAlign: isMe ? 'right' : 'left' }}>
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: '4px 20px', background: '#fef2f2', color: '#dc2626', fontSize: '12px', flexShrink: 0 }}>
            {error}
          </div>
        )}

        {/* Pending file preview */}
        {pendingFile && (
          <div style={{
            padding: '8px 20px', background: 'var(--bg-color)', borderTop: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
          }}>
            <span style={{ fontSize: '18px' }}>📎</span>
            <span style={{ flex: 1, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
              {pendingFile.name}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0 }}>
              {sizeLabel(pendingFile.size)}
            </span>
            <button onClick={onClearFile} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '16px', padding: '0 2px' }}>✕</button>
          </div>
        )}

        {/* Input */}
        <div style={{
          padding: '12px 16px', borderTop: '1px solid var(--border-color)',
          display: 'flex', alignItems: 'flex-end', gap: '8px', flexShrink: 0,
        }}>
          <button
            onClick={onFilePick}
            disabled={!!pendingFile}
            title={pendingFile ? 'Remove the staged file first' : 'Attach from desktop'}
            style={{
              background: 'none', border: '1px solid var(--border-color)', borderRadius: '8px',
              padding: '8px 10px', cursor: pendingFile ? 'not-allowed' : 'pointer',
              fontSize: '16px', color: pendingFile ? 'var(--text-secondary)' : '#667eea', flexShrink: 0,
            }}
          >📎</button>
          <button
            onClick={onOpenFilePicker}
            disabled={!!pendingFile}
            title={pendingFile ? 'Remove the staged file first' : 'Pick from Files'}
            style={{
              background: 'none', border: '1px solid var(--border-color)', borderRadius: '8px',
              padding: '8px 10px', cursor: pendingFile ? 'not-allowed' : 'pointer',
              fontSize: '13px', fontWeight: 600, color: pendingFile ? 'var(--text-secondary)' : '#667eea', flexShrink: 0,
            }}
          >Files</button>
          <textarea
            value={text}
            onChange={e => onTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={pendingFile ? 'Add a caption (optional)…' : 'Type a message…'}
            rows={1}
            style={{
              flex: 1, resize: 'none', border: '1px solid var(--border-color)', borderRadius: '8px',
              padding: '9px 12px', fontSize: '14px', fontFamily: 'inherit',
              background: 'var(--bg-color)', color: 'var(--text-primary)', outline: 'none',
              maxHeight: '100px', overflowY: 'auto',
            }}
            onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'; }}
          />
          <button
            onClick={onSend}
            disabled={sending || uploading || (!text.trim() && !pendingFile)}
            style={{
              background: '#667eea', color: 'white', border: 'none', borderRadius: '8px',
              padding: '9px 18px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              opacity: (sending || uploading || (!text.trim() && !pendingFile)) ? 0.5 : 1, flexShrink: 0,
            }}
          >
            {sending || uploading ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SemesterCard({ semester, classroomId }) {
  const navigate = useNavigate();

  return (
    <div
      className="classroom-card"
      onClick={() => navigate(`/classroom/${classroomId}/semester/${semester.id}`)}
      style={{ cursor: 'pointer' }}
    >
      <div className="classroom-header">
        <h3>{semester.name}</h3>
        <div style={{ display: 'flex', gap: '6px' }}>
          {semester.is_active && <span className="classroom-badge teacher">Active</span>}
          {semester.is_user_cr && (
            <span className="classroom-badge" style={{ background: '#e0f2fe', color: '#0284c7', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 }}>CR</span>
          )}
        </div>
      </div>
      {semester.year && <p className="classroom-subject">Year: {semester.year}</p>}
      {semester.session && <p className="classroom-description">Session: {semester.session}</p>}
      {(semester.subjects || []).length > 0 && (
        <p style={{ fontSize: '13px', color: '#667eea', margin: '6px 0 0' }}>
          {semester.subjects.length} subject{semester.subjects.length !== 1 ? 's' : ''}
        </p>
      )}
      <div className="classroom-footer">
        <span className="student-count">{semester.type}</span>
      </div>
    </div>
  );
}

export default ClassroomDetail;
