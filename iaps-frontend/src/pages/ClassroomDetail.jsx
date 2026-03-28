import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { classroomAPI, semesterAPI, settingsAPI, dmAPI, chatAPI, BACKEND_URL } from '../services/api';
import FilePickerModal from '../components/FilePickerModal';
import { useDMSocket } from '../hooks/useDMSocket';
import { io } from 'socket.io-client';
import Avatar from '../components/Avatar';
import '../styles/Classroom.css';
import { Bell, MessageSquare, EyeOff, Check, Eye, Trash2, Paperclip, X, Clock, CheckCircle, XCircle, Mail, Phone, UserX, Users, Crown, Shield, Flag, CameraOff, Smile, Pin, PinOff } from 'lucide-react';
import RemovedNotification from '../components/RemovedNotification';
import { FileTypeIcon, sizeLabel } from '../utils/fileUtils';
import { formatTime, formatDate } from '../utils/timeUtils';
import { toggleReactionOptimistic } from '../utils/reactionUtils';
import EmojiMartPicker from '@emoji-mart/react';
import emojiData from '@emoji-mart/data';

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
  const [dmTyping, setDmTyping]           = useState(false); // other person is typing
  const dmTypingTimerRef                  = useRef(null);
  const dmLastTypingEmitRef               = useRef(0);
  const dmSocketRef                       = useRef(null);
  const [memberDmStats, setMemberDmStats] = useState({}); // { user_id: count }
  const [unreadBySender, setUnreadBySender] = useState({}); // { user_id: unread_count }
  const [activity, setActivity] = useState({ announcements: [], unread_chat: {}, pending_requests: null });
  const [crNotifications, setCrNotifications] = useState([]);
  const [pendingNominations, setPendingNominations] = useState([]);
  const [removeMemberTarget, setRemoveMemberTarget] = useState(null); // { id, name }
  const [removeMemberReason, setRemoveMemberReason] = useState('');
  const [removeMemberLoading, setRemoveMemberLoading] = useState(false);
  const [removedNotification, setRemovedNotification] = useState(null); // { classroom_name, removed_by, reason }
  const [flagBioTarget, setFlagBioTarget] = useState(null); // { id, name }
  const [flagBioReason, setFlagBioReason] = useState('');
  const [flagBioLoading, setFlagBioLoading] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [onlineLoaded, setOnlineLoaded] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const [leaveLoading, setLeaveLoading] = useState(false);
  const dmBottomRef = useRef(null);
  const dmFileInputRef = useRef(null);
  const [photoBlurred, setPhotoBlurred] = useState(false);
  const [photoWatermark, setPhotoWatermark] = useState(false);

  // Blur on focus loss (Alt+Tab, window switch)
  useEffect(() => {
    if (!fullscreenPhoto) return;
    setPhotoBlurred(false);
    const onHide = () => setPhotoBlurred(true);
    const onShow = () => setPhotoBlurred(false);
    const onVisibility = () => (document.hidden ? onHide() : onShow());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onHide);
    window.addEventListener('focus', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onHide);
      window.removeEventListener('focus', onShow);
    };
  }, [fullscreenPhoto]);

  // Screenshot key detection — fires on keydown so blur+watermark appear BEFORE screenshot is captured
  useEffect(() => {
    if (!fullscreenPhoto) return;
    const onKey = (e) => {
      const isPrintScreen = e.key === 'PrintScreen';
      const isMacShot = e.metaKey && e.shiftKey && ['3', '4', '5'].includes(e.key);
      if (isPrintScreen || isMacShot) {
        setPhotoBlurred(true);
        setPhotoWatermark(true);
        setTimeout(() => { setPhotoBlurred(false); setPhotoWatermark(false); }, 2000);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreenPhoto]);

  useEffect(() => { loadClassroomData(); }, [classroomId]);

  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape') return;
      setShowCreateSemester(false); setRemovePhotoTarget(null); setFlagNameTarget(null);
      setFullscreenPhoto(null); setDmTarget(null); setRemoveMemberTarget(null); setShowLeaveModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Persistent socket for personal notifications (CR nominations, etc.)
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const socket = io(BACKEND_URL, { query: { token }, transports: ['websocket', 'polling'] });
    socket.on('cr_nominated', () => {
      classroomAPI.getPendingNominations(classroomId)
        .then(r => setPendingNominations(r.data.nominations || []))
        .catch(() => {});
    });
    socket.on('cr_transfer_result', () => { loadClassroomData(); });
    socket.on('member_removed', (data) => {
      if (data.classroom_id === classroomId) setRemovedNotification(data);
    });
    return () => socket.disconnect();
  }, [classroomId]);

  useEffect(() => {
    const interval = setInterval(() => {
      classroomAPI.getActivity(classroomId)
        .then(r => setActivity(r.data))
        .catch(() => {});
    }, 86400000);
    return () => clearInterval(interval);
  }, [classroomId]);

  // DM socket — connects only when a DM thread is open
  const { socketRef: _dmSocketRef, connected: dmConnected } = useDMSocket(
    dmTarget ? classroomId : null,
    dmTarget?.id || null,
    {
      onMessage: useCallback((msg) => {
        setDmMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          // Replace optimistic placeholder from same sender if present
          const pendingIdx = prev.findIndex(m => m.pending && m.sender_id === msg.sender_id);
          if (pendingIdx !== -1) {
            const next = [...prev];
            next[pendingIdx] = msg;
            return next;
          }
          return [...prev, msg];
        });
        setTimeout(() => dmBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }, []),
      onDeleted: useCallback(({ message_id }) => {
        setDmMessages(prev => prev.filter(m => m.id !== message_id));
      }, []),
      onTombstoned: useCallback(({ message_id }) => {
        setDmMessages(prev => prev.map(m =>
          m.id === message_id ? { ...m, deleted_for_everyone: true, text: null, file: null } : m
        ));
      }, []),
      onRead: useCallback(({ reader_id }) => {
        setDmMessages(prev => prev.map(m => ({
          ...m,
          read_by: m.read_by?.includes(reader_id) ? m.read_by : [...(m.read_by || []), reader_id],
        })));
      }, []),
      onTyping: useCallback(() => {
        setDmTyping(true);
        if (dmTypingTimerRef.current) clearTimeout(dmTypingTimerRef.current);
        dmTypingTimerRef.current = setTimeout(() => setDmTyping(false), 3000);
      }, []),
      onReactionUpdated: useCallback(({ id, reactions }) => {
        setDmMessages(prev => prev.map(m => m.id === id ? { ...m, reactions } : m));
      }, []),
      onPinUpdated: useCallback((msg) => {
        setDmMessages(prev => prev.map(m => m.id === msg.id ? { ...m, pinned: msg.pinned } : m));
      }, []),
    }
  );
  // Keep a stable ref to the DM socket so the textarea onChange can emit dm_typing
  useEffect(() => { dmSocketRef.current = _dmSocketRef.current; });

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
      const [res] = await Promise.all([
        classroomAPI.getDetails(classroomId),
        classroomAPI.getCrNotifications(classroomId)
          .then(r => setCrNotifications(r.data.notifications || []))
          .catch(() => {}),
        classroomAPI.getPendingNominations(classroomId)
          .then(r => setPendingNominations(r.data.nominations || []))
          .catch(() => {}),
      ]);
      const c = res.data.classroom;
      setClassroom(c);
      // Load online status for all members
      if (c?.members?.length) {
        const memberIds = c.members.map(m => m.id || m._id).filter(Boolean);
        chatAPI.getOnlineStatus(memberIds)
          .then(r => { setOnlineUsers(new Set(r.data.online_user_ids || [])); setOnlineLoaded(true); })
          .catch(() => setOnlineLoaded(true));
      } else {
        setOnlineLoaded(true);
      }
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
      // Load classroom activity (notifications)
      classroomAPI.getActivity(classroomId)
        .then(r => setActivity(r.data))
        .catch(() => {});
    } catch (err) {
      setError('Failed to load classroom data');
    } finally {
      setLoading(false);
    }
  };

  const sendDmMessage = async (replyingTo = null) => {
    if (dmSending || dmUploading || !dmTarget) return;
    const replyPayload = replyingTo ? { reply_to_id: replyingTo.id } : {};
    if (pendingDmFile) {
      const caption = dmText.trim();
      const file = pendingDmFile;
      setPendingDmFile(null); setDmText('');
      setDmUploading(true); setDmError('');
      try {
        await dmAPI.uploadFile(classroomId, dmTarget.id, file, caption || undefined, replyPayload);
      } catch (err) {
        setDmError(err.response?.data?.error || 'Failed to send file');
      } finally { setDmUploading(false); }
      return;
    }
    const text = dmText.trim();
    if (!text) return;
    // Optimistic message
    const optimisticId = `pending-${Date.now()}`;
    const optimisticMsg = {
      id: optimisticId, pending: true,
      sender_id: user?.id, sender_name: user?.fullName || user?.username,
      text, created_at: new Date().toISOString(),
      read_by: [], reactions: [],
      ...(replyingTo ? { reply_to: { id: replyingTo.id, text: replyingTo.text, sender_name: replyingTo.senderName } } : {}),
    };
    setDmMessages(prev => [...prev, optimisticMsg]);
    setTimeout(() => dmBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    setDmSending(true); setDmError(''); setDmText('');
    try {
      await dmAPI.sendMessage(classroomId, dmTarget.id, text, replyPayload);
      // Socket handler replaces the optimistic message; remove it here only if socket was slow
      setTimeout(() => {
        setDmMessages(prev => prev.filter(m => m.id !== optimisticId));
      }, 3000);
    } catch (err) {
      setDmError(err.response?.data?.error || 'Failed to send');
      setDmMessages(prev => prev.filter(m => m.id !== optimisticId));
    } finally { setDmSending(false); }
  };

  const handleDmReact = async (msgId, emoji) => {
    setDmMessages(prev => prev.map(m =>
      m.id === msgId ? toggleReactionOptimistic(m, emoji, user?.id) : m
    ));
    try {
      await dmAPI.reactToDm(classroomId, msgId, emoji);
    } catch (err) {
      setDmError(err.response?.data?.error || 'Failed to react');
      dmAPI.getThread(classroomId, dmTarget.id)
        .then(res => setDmMessages(res.data.messages || []))
        .catch(() => {});
    }
  };

  const deleteDmMessage = async (messageId, mode = 'for_everyone') => {
    try {
      await dmAPI.deleteMessage(classroomId, messageId, mode);
      if (mode === 'for_me') {
        setDmMessages(prev => prev.filter(m => m.id !== messageId));
      }
    } catch (err) {
      setDmError(err.response?.data?.error || 'Failed to delete');
    }
  };

  const handleDmPin = async (msgId) => {
    // Optimistic toggle
    setDmMessages(prev => prev.map(m => m.id === msgId ? { ...m, pinned: !m.pinned } : m));
    try {
      await dmAPI.pinDm(classroomId, msgId);
    } catch (err) {
      // Revert on failure
      setDmMessages(prev => prev.map(m => m.id === msgId ? { ...m, pinned: !m.pinned } : m));
      setDmError(err.response?.data?.error || 'Failed to pin message');
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

  const handleRemoveMember = (memberId, memberName) => {
    setRemoveMemberTarget({ id: memberId, name: memberName });
    setRemoveMemberReason('');
  };

  const handleConfirmRemoveMember = async () => {
    if (!removeMemberTarget) return;
    setRemoveMemberLoading(true);
    setError('');
    try {
      await classroomAPI.removeMember(classroomId, removeMemberTarget.id, removeMemberReason.trim());
      setSuccess('Member removed.');
      setRemoveMemberTarget(null);
      setRemoveMemberReason('');
      loadClassroomData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove member');
    } finally {
      setRemoveMemberLoading(false);
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
      await loadClassroomData();
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

  const handleFlagBio = async (e) => {
    e.preventDefault();
    if (!flagBioTarget || !flagBioReason.trim()) return;
    setFlagBioLoading(true);
    setError('');
    try {
      await classroomAPI.flagMemberBio(classroomId, flagBioTarget.id, flagBioReason.trim());
      setSuccess(`Bio flagged for ${flagBioTarget.name}. They will be prompted to update it.`);
      await loadClassroomData();
      setFlagBioTarget(null);
      setFlagBioReason('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to flag bio');
    } finally {
      setFlagBioLoading(false);
    }
  };

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

  // Quit CR
  const [showQuitCrModal, setShowQuitCrModal] = useState(false);
  const [quitCrLoading, setQuitCrLoading] = useState(false);
  const [quitCrError, setQuitCrError] = useState('');

  const handleQuitCr = async () => {
    setQuitCrLoading(true);
    setQuitCrError('');
    try {
      await classroomAPI.quitCr(classroomId, activeSemester?.id);
      setShowQuitCrModal(false);
      await loadClassroomData();
    } catch (err) {
      setQuitCrError(err.response?.data?.error || 'Failed to quit CR role');
    } finally {
      setQuitCrLoading(false);
    }
  };

  // CR Transfer & Co-CR (for active semester)
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferNomineeId, setTransferNomineeId] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [showAddCrModal, setShowAddCrModal] = useState(false);
  const [addCrTargetId, setAddCrTargetId] = useState('');
  const [addCrLoading, setAddCrLoading] = useState(false);

  const handleAcceptNomination = async (semId) => {
    setPendingNominations(prev => prev.filter(n => n.semester_id !== semId));
    try {
      await semesterAPI.acceptCr(semId);
      setSuccess('You are now the CR!');
      loadClassroomData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to accept nomination');
      loadClassroomData(); // re-fetch in case of error
    }
  };

  const handleDeclineNomination = async (semId) => {
    setPendingNominations(prev => prev.filter(n => n.semester_id !== semId));
    try {
      await semesterAPI.declineCr(semId);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to decline nomination');
    }
  };

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

  const handleAddCoCr = async (e) => {
    e.preventDefault();
    if (!addCrTargetId || !activeSemester) return;
    setAddCrLoading(true);
    setError('');
    try {
      await semesterAPI.nominateAddCr(activeSemester.id, addCrTargetId);
      setSuccess('Co-CR nomination sent. They must accept to get CR access.');
      setShowAddCrModal(false);
      setAddCrTargetId('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send co-CR nomination');
    } finally { setAddCrLoading(false); }
  };

  const handleNominateCr = async (e) => {
    e.preventDefault();
    if (!transferNomineeId || !activeSemester) return;
    setTransferLoading(true);
    setError('');
    try {
      await semesterAPI.nominateCr(activeSemester.id, transferNomineeId);
      setSuccess('Nomination sent. The member must accept to complete the transfer.');
      setShowTransferModal(false);
      setTransferNomineeId('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send nomination');
    } finally { setTransferLoading(false); }
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

  const modalSelectStyle = {
    width: '100%', padding: '12px 15px', border: '1.5px solid var(--border-color)',
    borderRadius: '6px', fontSize: '15px', fontFamily: 'inherit',
    background: 'var(--bg-color)', color: 'var(--text-primary)',
  };

  return (
    <div className="classroom-container">
      {/* Header */}
      <div style={{ marginBottom: '4px' }}>
        <button onClick={() => navigate('/classrooms')} style={{
          background: 'none', border: 'none', color: '#667eea',
          cursor: 'pointer', fontSize: '13px', marginBottom: '10px', padding: 0,
        }}>
          &larr; Back to Classrooms
        </button>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0 }}>{classroom.name}</h1>
            {classroom.description && (
              <p style={{ color: '#888', margin: '4px 0 0', fontSize: '14px' }}>{classroom.description}</p>
            )}
            <p style={{ color: '#aaa', margin: '4px 0 0', fontSize: '13px' }}>
              {classroom.member_count || 0} members &nbsp;·&nbsp; {classroom.is_cr ? 'Class Representative' : 'Member'}
            </p>
          </div>
          {classroom.code && (
            <span className="classroom-code" style={{ fontSize: '13px', padding: '6px 14px', marginTop: '6px' }}>
              Code: {classroom.code}
            </span>
          )}
        </div>
      </div>

      {/* Sub-navbar */}
      <div className="page-subnav">
        {classroom.is_cr && (
          <button className="page-subnav-item" onClick={() => setShowCreateSemester(true)}>
            + New Semester
          </button>
        )}
        {activeSemester?.is_user_cr && (
          <>
            <button className="page-subnav-item" onClick={() => { setShowAddCrModal(true); setAddCrTargetId(''); }}>
              + Co-CR
            </button>
            <button className="page-subnav-item warning" onClick={() => { setShowTransferModal(true); setTransferNomineeId(''); }}>
              Transfer CR
            </button>
            {activeSemester?.cr_ids?.length > 1 && (
              <button className="page-subnav-item danger" onClick={() => { setShowQuitCrModal(true); setQuitCrError(''); }}>
                Quit CR
              </button>
            )}
          </>
        )}
        <div className="page-subnav-spacer" />
        <button className="page-subnav-item danger" onClick={() => { setShowLeaveModal(true); setLeaveError(''); }}>
          Leave
        </button>
        {classroom.is_cr && (
          <button className="page-subnav-item danger" onClick={() => { setConfirmDelete(true); setDeleteConfirmName(''); }}>
            Delete Classroom
          </button>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {/* CR nomination banners */}
      {pendingNominations.map(nom => (
        <div key={nom.semester_id} style={{
          background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: '10px',
          padding: '14px 20px', marginBottom: '16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
        }}>
          <div>
            <strong style={{ color: '#92400e', fontSize: '14px' }}>
              {nom.nomination_type === 'add_co_cr' ? 'Co-CR invitation' : 'CR role transfer offered'}
              {' '}<span style={{ fontWeight: 400, color: '#b45309' }}>· {nom.semester_name}</span>
            </strong>
            <p style={{ margin: '2px 0 0', color: '#b45309', fontSize: '13px' }}>
              <strong>{nom.nominated_by}</strong>{' '}
              {nom.nomination_type === 'add_co_cr'
                ? 'wants to appoint you as a co-CR. You will both have CR access.'
                : 'wants to transfer the CR role to you. They will lose CR access.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <button onClick={() => handleAcceptNomination(nom.semester_id)} style={{
              background: '#667eea', color: 'white', border: 'none',
              borderRadius: '6px', padding: '7px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}>Accept</button>
            <button onClick={() => handleDeclineNomination(nom.semester_id)} style={{
              background: 'var(--card-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)',
              borderRadius: '6px', padding: '7px 14px', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
            }}>Decline</button>
          </div>
        </div>
      ))}

      {/* CR result notifications (accepted / declined / stepped down) */}
      {crNotifications.map(note => (
        <div key={note.id} style={{
          background: note.type === 'cr_accepted' ? 'rgba(16,185,129,0.1)' : note.type === 'cr_stepped_down' ? 'rgba(217,119,6,0.1)' : 'rgba(239,68,68,0.08)',
          border: `1.5px solid ${note.type === 'cr_accepted' ? 'rgba(16,185,129,0.35)' : note.type === 'cr_stepped_down' ? 'rgba(217,119,6,0.35)' : 'rgba(239,68,68,0.35)'}`,
          borderRadius: '10px', padding: '12px 18px', marginBottom: '12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
        }}>
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary)' }}>
            {note.type === 'cr_accepted'
              ? <CheckCircle size={14} strokeWidth={1.75} style={{ color: '#10b981', marginRight: '4px', verticalAlign: 'middle' }} />
              : note.type === 'cr_stepped_down'
                ? <Bell size={14} strokeWidth={1.75} style={{ color: '#d97706', marginRight: '4px', verticalAlign: 'middle' }} />
                : <XCircle size={14} strokeWidth={1.75} style={{ color: '#ef4444', marginRight: '4px', verticalAlign: 'middle' }} />}
            {note.message}
          </p>
          <button onClick={() => setCrNotifications(prev => prev.filter(n => n.id !== note.id))} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '16px', flexShrink: 0,
          }}><X size={14} strokeWidth={2} /></button>
        </div>
      ))}

      {/* Notifications / Activity Section — always visible */}
      <div style={{
        background: 'var(--card-bg)', border: '1.5px solid var(--border-color)',
        borderRadius: '12px', padding: '18px 20px', marginBottom: '24px',
      }}>
        <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bell size={15} strokeWidth={1.75} /> Recent Activity
        </div>

        {(activity.announcements.length === 0 && Object.keys(activity.unread_chat).length === 0 && !activity.pending_requests) ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: 0 }}>No recent activity.</p>
        ) : (
          <>
            {/* Unread chat messages */}
            {Object.keys(activity.unread_chat).length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                {Object.entries(activity.unread_chat).map(([sid, info]) => (
                  <div key={sid} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'rgba(102,126,234,0.08)', borderRadius: '8px', marginBottom: '4px', fontSize: '13px' }}>
                    <MessageSquare size={14} strokeWidth={1.75} />
                    <span style={{ color: 'var(--text-primary)', flex: 1 }}>
                      <strong>{info.count}</strong> new message{info.count !== 1 ? 's' : ''} in <strong>{info.semester_name}</strong> chat
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Pending join requests */}
            {activity.pending_requests > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'rgba(245,158,11,0.1)', borderRadius: '8px', marginBottom: '12px', fontSize: '13px' }}>
                <Clock size={14} strokeWidth={1.75} style={{ color: '#f59e0b', flexShrink: 0 }} />
                <span style={{ color: 'var(--text-primary)' }}>
                  <strong>{activity.pending_requests}</strong> pending join request{activity.pending_requests !== 1 ? 's' : ''} awaiting approval
                </span>
              </div>
            )}

            {/* Recent announcements */}
            {activity.announcements.length > 0 && (
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Announcements</div>
                {activity.announcements.slice(0, 5).map(a => (
                  <div key={a.id} style={{ padding: '8px 10px', background: 'var(--bg-color)', borderRadius: '8px', marginBottom: '4px', borderLeft: '3px solid #667eea' }}>
                    <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.4 }}>{a.text}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                      {a.created_by_name} · {a.semester_name} · {formatDate(a.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

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
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={18} strokeWidth={2} style={{ color: 'var(--text-secondary)' }} />
            Members ({classroom.members.length})
          </h2>
          <div className="classrooms-grid">
            {classroom.members.map(member => {
              const isMemberCr = activeSemester && activeSemester.cr_ids?.includes(member.id);
              const isCreator = member.id === classroom.created_by;
              const canKick = classroom.is_cr && member.id !== user?.id && !isMemberCr;
              const isSelf = member.id === user?.id;
              // Show DM button: member→CRs only, CR→anyone (not self)
              const canDm = !isSelf && (classroom.is_cr || isMemberCr);
              const unreadFromMember = unreadBySender[member.id] || 0;
              return (
                <div key={member.id} className="classroom-card" style={{ cursor: 'default' }}>
                  {/* Avatar row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div
                        style={{ cursor: member.profile_picture ? 'pointer' : 'default' }}
                        onClick={async () => {
                          if (!member.profile_picture) return;
                          setPhotoBlurred(false); setPhotoWatermark(false);
                          setFullscreenPhoto({ url: null, userId: member.id, name: member.fullName || member.username });
                          try {
                            const signedUrl = await settingsAPI.getSignedAvatarUrl(member.id);
                            setFullscreenPhoto({ url: signedUrl, userId: member.id, name: member.fullName || member.username });
                          } catch {
                            setFullscreenPhoto(null);
                          }
                        }}
                        title={member.profile_picture ? 'View full photo' : ''}
                      >
                        <Avatar
                          user={member}
                          size={40}
                          showOnline={onlineLoaded ? (member.id === user?.id ? true : onlineUsers.has(member.id)) : null}
                          dotColor={member.id === user?.id && user?.show_online_status === false ? '#667eea' : undefined}
                        />
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
                          <span className="classroom-badge" style={{ background: '#fef3c7', color: '#92400e', padding: '2px 7px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <Crown size={10} strokeWidth={2} />Owner
                          </span>
                        )}
                        {isMemberCr && (
                          <span className="classroom-badge" style={{ background: '#e0f2fe', color: '#0284c7', padding: '2px 7px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <Shield size={10} strokeWidth={2} />CR
                          </span>
                        )}
                      </div>
                      {member.fullName && <p style={{ color: '#888', fontSize: '12px', margin: '1px 0 0' }}>@{member.username}</p>}
                    </div>
                  </div>
                  {/* Bio */}
                  {member.bio && !member.bio_flagged_reason && (
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 2px', fontStyle: 'italic', lineHeight: 1.45 }}>
                      "{member.bio}"
                    </p>
                  )}
                  {member.bio_flagged_reason && member.id === user?.id && (
                    <p style={{ fontSize: '11px', color: 'var(--warning-text)', margin: '4px 0 2px', background: 'var(--warning-bg)', borderRadius: '6px', padding: '4px 8px' }}>
                      Your bio was flagged — please update it in Settings.
                    </p>
                  )}
                  <p className="classroom-description" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Mail size={12} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
                    {member.email}
                  </p>
                  {member.phone && (
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Phone size={12} style={{ flexShrink: 0 }} />
                      {member.phone}
                      {member.phone_public && (
                        <span style={{ fontSize: '10px', color: '#16a34a' }}>public</span>
                      )}
                    </p>
                  )}
                  {/* Member actions */}
                  <div className="classroom-footer" style={{ flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
                    {/* Row 1: Chat */}
                    {canDm && (
                      <button
                        onClick={() => setDmTarget({ id: member.id, name: member.fullName || member.username })}
                        style={{
                          background: 'rgba(59,130,246,0.1)', color: '#3b82f6',
                          border: '1px solid rgba(59,130,246,0.3)',
                          borderRadius: '6px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: 600,
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                        }}
                      >
                        <MessageSquare size={12} strokeWidth={2} />Message
                      </button>
                    )}
                    {/* Row 2: CR actions */}
                    {canKick && (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button onClick={() => handleRemoveMember(member.id, member.fullName || member.username)} style={{
                          background: 'rgba(220,38,38,0.08)', color: '#dc2626',
                          border: '1px solid rgba(220,38,38,0.25)',
                          borderRadius: '6px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: 600,
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                        }}>
                          <UserX size={12} strokeWidth={2} />Remove
                        </button>
                        {member.profile_picture && (
                          <button onClick={() => { setRemovePhotoTarget({ id: member.id, name: member.fullName || member.username }); setRemovePhotoReason(''); }} style={{
                            background: 'rgba(220,38,38,0.08)', color: '#dc2626',
                            border: '1px solid rgba(220,38,38,0.25)',
                            borderRadius: '6px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: 600,
                            display: 'inline-flex', alignItems: 'center', gap: '5px',
                          }}><CameraOff size={12} strokeWidth={2} />Remove Photo</button>
                        )}
                        <button onClick={() => { setFlagNameTarget({ id: member.id, name: member.fullName || member.username }); setFlagNameReason(''); }} style={{
                          background: 'rgba(22,163,74,0.08)', color: '#16a34a',
                          border: '1px solid rgba(22,163,74,0.25)',
                          borderRadius: '6px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: 600,
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                        }}><Flag size={12} strokeWidth={2} />Flag Name</button>
                        {member.bio && (
                          <button onClick={() => { setFlagBioTarget({ id: member.id, name: member.fullName || member.username }); setFlagBioReason(''); }} style={{
                            background: 'rgba(22,163,74,0.08)', color: '#16a34a',
                            border: '1px solid rgba(22,163,74,0.25)',
                            borderRadius: '6px', padding: '4px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: 600,
                            display: 'inline-flex', alignItems: 'center', gap: '5px',
                          }}><Flag size={12} strokeWidth={2} />Flag Bio</button>
                        )}
                      </div>
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


      {/* Flag Bio Modal */}
      {flagBioTarget && (
        <div className="modal-overlay" onClick={() => setFlagBioTarget(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <h2>Flag Inappropriate Bio</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '6px' }}>
              Flagging <strong>{flagBioTarget.name}</strong>'s bio as inappropriate.
              Their bio will be hidden from other members.
            </p>
            <form onSubmit={handleFlagBio}>
              <div className="form-group">
                <label>Reason *</label>
                <textarea
                  value={flagBioReason}
                  onChange={(e) => setFlagBioReason(e.target.value)}
                  placeholder="e.g., Contains offensive or inappropriate content"
                  rows="3"
                  required
                  disabled={flagBioLoading}
                />
              </div>
              <div className="modal-buttons">
                <button type="button" onClick={() => setFlagBioTarget(null)} disabled={flagBioLoading}>Cancel</button>
                <button type="submit" disabled={flagBioLoading || !flagBioReason.trim()} style={{ background: 'var(--success-color)', color: 'white' }}>
                  {flagBioLoading ? 'Flagging...' : 'Flag Bio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Co-CR Modal */}
      {showAddCrModal && activeSemester && (
        <div className="modal-overlay" onClick={() => setShowAddCrModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <h2>Add Co-CR</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '8px' }}>
              Appoint another member as CR for <strong>{activeSemester.name}</strong>. They will have full CR access. <strong>You keep your own CR role.</strong>
            </p>
            <form onSubmit={handleAddCoCr}>
              <div className="form-group">
                <label>Select Member *</label>
                <select
                  value={addCrTargetId}
                  onChange={e => setAddCrTargetId(e.target.value)}
                  required
                  disabled={addCrLoading}
                  style={modalSelectStyle}
                >
                  <option value="">— select a member —</option>
                  {(classroom?.members || [])
                    .filter(m => !(activeSemester.cr_ids || []).includes(m.id))
                    .map(m => (
                      <option key={m.id} value={m.id}>
                        {m.fullName || m.username} ({m.username})
                      </option>
                    ))}
                </select>
              </div>
              <div className="modal-buttons">
                <button type="button" onClick={() => setShowAddCrModal(false)} disabled={addCrLoading}>Cancel</button>
                <button type="submit" disabled={addCrLoading || !addCrTargetId} style={{ background: '#667eea', color: 'white' }}>
                  {addCrLoading ? 'Adding...' : 'Add as Co-CR'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer CR Role Modal */}
      {showTransferModal && activeSemester && (
        <div className="modal-overlay" onClick={() => setShowTransferModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <h2>Transfer CR Role</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
              Select a member to nominate for <strong>{activeSemester.name}</strong>. They must accept before the role transfers. You will lose CR access once they accept.
            </p>
            <form onSubmit={handleNominateCr}>
              <div className="form-group">
                <label>Nominate a Member *</label>
                <select
                  value={transferNomineeId}
                  onChange={(e) => setTransferNomineeId(e.target.value)}
                  required
                  disabled={transferLoading}
                  style={modalSelectStyle}
                >
                  <option value="">— select a member —</option>
                  {(classroom?.members || [])
                    .filter(m => !(activeSemester.cr_ids || []).includes(m.id))
                    .map(m => (
                      <option key={m.id} value={m.id}>
                        {m.fullName || m.username} ({m.username})
                      </option>
                    ))}
                </select>
              </div>
              <div className="modal-buttons">
                <button type="button" onClick={() => setShowTransferModal(false)} disabled={transferLoading}>Cancel</button>
                <button type="submit" disabled={transferLoading || !transferNomineeId} style={{ background: '#f59e0b', color: 'white' }}>
                  {transferLoading ? 'Sending...' : 'Send Nomination'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quit CR Modal */}
      {showQuitCrModal && (
        <div className="modal-overlay" onClick={() => setShowQuitCrModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', textAlign: 'center' }}>
            <h2 style={{ margin: '0 0 10px' }}>Step down as CR?</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '0 0 20px' }}>
              You will remain in <strong>{classroom.name}</strong> but lose your CR privileges for the active semester.
            </p>
            {quitCrError && (
              <div style={{
                background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
                padding: '10px 14px', color: '#b91c1c', fontSize: '13px', marginBottom: '14px',
              }}>
                {quitCrError}
              </div>
            )}
            <div className="modal-buttons" style={{ justifyContent: 'center' }}>
              <button type="button" onClick={() => setShowQuitCrModal(false)} disabled={quitCrLoading}>Cancel</button>
              <button type="button" onClick={handleQuitCr} disabled={quitCrLoading} style={{ background: '#dc2626', color: 'white' }}>
                {quitCrLoading ? 'Stepping down...' : 'Step Down'}
              </button>
            </div>
          </div>
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
            {activeSemester?.is_user_cr && activeSemester?.cr_ids?.length === 1 && !leaveError && (
              <div style={{
                background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px',
                padding: '10px 14px', marginBottom: '14px', fontSize: '13px', color: '#92400e',
              }}>
                You are the only CR in the active semester. You must transfer your CR role before leaving.
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
          onTextChange={(val) => {
            setDmText(val);
            // Throttled dm_typing emit
            const now = Date.now();
            if (dmSocketRef.current && now - dmLastTypingEmitRef.current > 2000) {
              dmLastTypingEmitRef.current = now;
              dmSocketRef.current.emit('dm_typing', { classroom_id: classroomId, with_user_id: dmTarget.id });
            }
          }}
          pendingFile={pendingDmFile}
          onFilePick={() => dmFileInputRef.current?.click()}
          onClearFile={() => setPendingDmFile(null)}
          onSend={sendDmMessage}
          onDelete={(msgId, mode) => deleteDmMessage(msgId, mode)}
          onReact={handleDmReact}
          onPin={handleDmPin}
          sending={dmSending}
          uploading={dmUploading}
          bottomRef={dmBottomRef}
          userId={user?.id}
          onClose={() => { setDmTarget(null); setDmText(''); setPendingDmFile(null); setDmError(''); }}
          onOpenFilePicker={() => setShowDmFilePicker(true)}
          isOnline={onlineUsers.has(dmTarget?.id)}
          isTyping={dmTyping}
          classroomId={classroomId}
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

      {/* Remove Member Modal */}
      {removeMemberTarget && (
        <div className="modal-overlay" onClick={() => setRemoveMemberTarget(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <UserX size={18} strokeWidth={2} style={{ color: '#dc2626' }} />
              Remove {removeMemberTarget.name}?
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: '0 0 14px' }}>
              They will be removed immediately and notified with your reason.
            </p>
            <textarea
              value={removeMemberReason}
              onChange={e => setRemoveMemberReason(e.target.value)}
              placeholder="Reason for removal (optional but recommended)…"
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', borderRadius: '8px',
                border: '1.5px solid var(--border-color)', padding: '10px 12px',
                fontSize: '13px', background: 'var(--card-bg)', color: 'var(--text-primary)',
                resize: 'vertical', outline: 'none', marginBottom: '16px',
              }}
            />
            <div className="modal-buttons">
              <button type="button" onClick={() => setRemoveMemberTarget(null)} disabled={removeMemberLoading}>Cancel</button>
              <button
                type="button"
                onClick={handleConfirmRemoveMember}
                disabled={removeMemberLoading}
                style={{ background: '#dc2626', color: 'white' }}
              >
                {removeMemberLoading ? 'Removing…' : 'Remove Member'}
              </button>
            </div>
          </div>
        </div>
      )}

      <RemovedNotification data={removedNotification} />

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
          <div
            onClick={e => e.stopPropagation()}
            onContextMenu={e => e.preventDefault()}
            style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}
          >
            {!fullscreenPhoto.url && (
              <div style={{ width: '120px', height: '120px', borderRadius: '12px', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px' }}>Loading...</span>
              </div>
            )}
            <img
              src={fullscreenPhoto.url || ''}
              alt="Profile"
              draggable={false}
              style={{
                maxWidth: '80vw', maxHeight: '70vh', borderRadius: '12px',
                objectFit: 'contain', boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                cursor: 'default', display: fullscreenPhoto.url ? 'block' : 'none',
                filter: photoBlurred ? 'blur(20px)' : 'none',
                transition: 'filter 0.2s',
                userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'none',
              }}
            />
            {/* Watermark — shown when screenshot key detected */}
            {photoWatermark && fullscreenPhoto.url && (
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '12px', overflow: 'hidden',
                pointerEvents: 'none',
                backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
                  `<svg xmlns='http://www.w3.org/2000/svg' width='280' height='110'><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='sans-serif' font-size='14' fill='rgba(255,255,255,0.18)' transform='rotate(-25 140 55)'>${user?.username || ''} • ${new Date().toLocaleString()}</text></svg>`
                )}")`,
                backgroundRepeat: 'repeat',
              }} />
            )}
          </div>
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
              cursor: 'pointer', borderRadius: '50%',
              width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          ><X size={20} strokeWidth={2} /></button>
        </div>
      )}
    </div>
  );
}


function DMModal({ target, messages, loading, error, text, onTextChange, pendingFile, onFilePick, onClearFile, onSend, onDelete, onReact, onPin, sending, uploading, bottomRef, userId, onClose, onOpenFilePicker, isOnline, isTyping }) {
  const [dmDeleteMenu, setDmDeleteMenu] = React.useState(null); // { msgId, x, y }
  const [reactionPickerState, setReactionPickerState] = React.useState(null); // { msgId, x, y }
  const [showInputEmoji, setShowInputEmoji] = React.useState(false);
  const smileBtnRef = React.useRef(null);
  const [reactionDetailsMsg, setReactionDetailsMsg] = React.useState(null);
  const [hoveredMsgId, setHoveredMsgId] = React.useState(null);
  const [reactionTooltip, setReactionTooltip] = React.useState(null);
  const textareaRef = React.useRef(null);
  const [replyingTo, setReplyingTo] = React.useState(null); // { id, text, senderName }
  const [reactionDetailsTab, setReactionDetailsTab] = React.useState('all');
  const [atBottom, setAtBottom] = React.useState(true);
  const [newMsgCount, setNewMsgCount] = React.useState(0);
  const scrollRef = React.useRef(null);
  const prevMsgCountRef = React.useRef(messages.length);

  // Track scroll position to show/hide scroll-to-bottom button
  const handleScroll = React.useCallback((e) => {
    const el = e.currentTarget;
    const threshold = 80;
    const isBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setAtBottom(isBottom);
    if (isBottom) setNewMsgCount(0);
  }, []);

  // Track new messages when not at bottom
  React.useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      const lastNew = messages[messages.length - 1];
      if (!atBottom && lastNew?.sender_id !== userId) {
        setNewMsgCount(c => c + (messages.length - prevMsgCountRef.current));
      }
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync reactionDetailsMsg live when messages change
  React.useEffect(() => {
    if (!reactionDetailsMsg) return;
    const updated = messages.find(m => m.id === reactionDetailsMsg.id);
    if (updated) setReactionDetailsMsg(updated);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!reactionPickerState) return;
    const handler = (e) => {
      if (!e.target.closest('.dm-reaction-picker')) setReactionPickerState(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [reactionPickerState]);

  React.useEffect(() => {
    if (!dmDeleteMenu) return;
    const handler = () => setDmDeleteMenu(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dmDeleteMenu]);

  React.useEffect(() => {
    if (!showInputEmoji) return;
    const handler = (e) => {
      // Don't close when clicking the smile button itself — its click handler toggles
      if (smileBtnRef.current?.contains(e.target)) return;
      if (!e.target.closest('.dm-emoji-input-picker')) setShowInputEmoji(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showInputEmoji]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && replyingTo) { e.preventDefault(); setReplyingTo(null); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(replyingTo); setReplyingTo(null); }
  };

  const lastMyMsgIdx = messages.reduce((last, m, i) => m.sender_id === userId ? i : last, -1);

  // Resolve display name from user ID (1:1 DM)
  const resolveName = (uid) => {
    if (uid === userId) return 'You';
    if (uid === target.id) return target.name;
    return 'Unknown';
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
          display: 'flex', flexDirection: 'column',
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
            <div style={{ fontSize: '12px', color: isOnline ? '#22c55e' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {isOnline && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />}
              {isOnline ? 'Online' : 'Private Message'}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-secondary)', padding: '4px', display: 'flex', alignItems: 'center',
          }}><X size={18} strokeWidth={2} /></button>
        </div>

        {/* Pinned message banner */}
        {messages.filter(m => m.pinned).length > 0 && (() => {
          const pinned = messages.filter(m => m.pinned);
          const latest = pinned[pinned.length - 1];
          return (
            <div style={{
              padding: '6px 16px', borderBottom: '1px solid var(--border-color)',
              background: 'rgba(102,126,234,0.06)', display: 'flex', alignItems: 'center',
              gap: '8px', flexShrink: 0, cursor: 'default',
            }}>
              <Pin size={12} strokeWidth={2} style={{ color: '#667eea', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#667eea' }}>Pinned </span>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '280px', verticalAlign: 'bottom' }}>
                  {latest.text || latest.file?.name || '[file]'}
                </span>
              </div>
              {pinned.length > 1 && (
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0 }}>+{pinned.length - 1} more</span>
              )}
              <button
                onClick={() => onPin(latest.id)}
                title="Unpin"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', color: 'var(--text-secondary)', flexShrink: 0 }}
                onMouseEnter={e => e.currentTarget.style.color = '#667eea'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
              ><PinOff size={12} strokeWidth={2} /></button>
            </div>
          );
        })()}

        {/* Messages */}
        {/* Scroll-to-bottom FAB — outside scroll container so it stays visible */}
        {!atBottom && (
          <div style={{ position: 'relative', flexShrink: 0, height: 0 }}>
            <button
              onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setAtBottom(true); setNewMsgCount(0); }}
              style={{
                position: 'absolute', bottom: '-36px', left: '50%', transform: 'translateX(-50%)', zIndex: 5,
                background: '#667eea', color: 'white', border: 'none', borderRadius: '20px',
                padding: '5px 14px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(102,126,234,0.4)',
                display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap',
              }}
            >
              {newMsgCount > 0 ? `${newMsgCount} new ↓` : '↓'}
            </button>
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '2px' }}
        >
          {loading && <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px', marginTop: '40px' }}>Loading…</div>}
          {!loading && messages.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px', marginTop: '40px' }}>
              No messages yet. Say hello!
            </div>
          )}
          {messages.map((msg, idx) => {
            const isMe = msg.sender_id === userId;
            const isDeleted = msg.deleted_for_everyone;
            const hasFile = !!msg.file && !isDeleted;
            const fileUrl = hasFile ? dmAPI.getDmFileUrl(msg.id) : null;
            const isRead = isMe && msg.read_by?.includes(target.id);
            const isLastMine = isMe && idx === lastMyMsgIdx;
            const isPending = !!msg.pending;

            // Date divider
            const msgDate = msg.created_at ? new Date(msg.created_at) : null;
            const prevMsgDate = idx > 0 && messages[idx - 1].created_at ? new Date(messages[idx - 1].created_at) : null;
            const showDateDivider = msgDate && (!prevMsgDate || msgDate.toDateString() !== prevMsgDate.toDateString());

            // Message grouping — hide avatar/name if same sender as previous (within 2min)
            const prevMsg = idx > 0 ? messages[idx - 1] : null;
            const isGrouped = prevMsg && prevMsg.sender_id === msg.sender_id &&
              msgDate && prevMsgDate && (msgDate - prevMsgDate) < 120000;

            return (
              <React.Fragment key={msg.id}>
                {/* Date divider */}
                {showDateDivider && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '10px 0 6px', opacity: 0.6 }}>
                    <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontWeight: 600 }}>
                      {msgDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                  </div>
                )}
              <div
                style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: '6px', marginTop: isGrouped ? '2px' : '8px', opacity: isPending ? 0.6 : 1 }}
                onMouseEnter={() => setHoveredMsgId(msg.id)}
                onMouseLeave={() => setHoveredMsgId(null)}
              >
                {!isMe && (
                  isGrouped
                    ? <div style={{ width: 28 }} />
                    : <Avatar user={{ username: msg.sender_name || '?' }} size={28} />
                )}
                <div style={{ maxWidth: '72%' }}>
                  {!isMe && !isGrouped && (
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '2px', paddingLeft: '4px' }}>
                      {msg.sender_name}
                    </div>
                  )}
                  <div style={{ position: 'relative' }}>
                    {/* Hover toolbar */}
                    {!isDeleted && hoveredMsgId === msg.id && (
                      <div
                        onMouseEnter={() => setHoveredMsgId(msg.id)}
                        style={{
                          position: 'absolute',
                          top: '50%', transform: 'translateY(-50%)',
                          [isMe ? 'right' : 'left']: 'calc(100% + 4px)',
                          display: 'flex', gap: '2px',
                          background: 'var(--card-bg)', borderRadius: '6px', padding: '3px 6px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.15)', border: '1px solid var(--border-color)',
                          zIndex: 10, whiteSpace: 'nowrap',
                        }}
                      >
                        <button
                          onClick={(e) => {
                            if (reactionPickerState?.msgId === msg.id) { setReactionPickerState(null); return; }
                            const rect = e.currentTarget.getBoundingClientRect();
                            const pickerW = 352, pickerH = 420;
                            const x = Math.max(8, Math.min(rect.left, window.innerWidth - pickerW - 8));
                            const y = rect.top - pickerH - 8 < 8
                              ? rect.bottom + 8
                              : rect.top - pickerH - 8;
                            setReactionPickerState({ msgId: msg.id, x, y });
                          }}
                          title="React"
                          style={{ background: reactionPickerState?.msgId === msg.id ? 'var(--bg-color)' : 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', borderRadius: '4px', display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                          onMouseLeave={e => { if (reactionPickerState?.msgId !== msg.id) e.currentTarget.style.background = 'none'; }}
                        ><Smile size={13} strokeWidth={1.75} /></button>
                        {/* Reply button */}
                        {!isDeleted && (
                          <button
                            onClick={() => setReplyingTo({ id: msg.id, text: msg.text, senderName: isMe ? 'You' : (msg.sender_name || target.name) })}
                            title="Reply"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', borderRadius: '4px', display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >↩</button>
                        )}
                        {/* Copy text — available for all non-deleted messages */}
                        {!isDeleted && (msg.text || msg.file?.name) && (
                          <button
                            onClick={() => navigator.clipboard.writeText(msg.text || msg.file?.name || '')}
                            title="Copy"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', borderRadius: '4px', display: 'flex', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '11px', fontWeight: 700 }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                        )}
                        {/* Pin / Unpin — available for all non-deleted, non-pending messages */}
                        {!isDeleted && !isPending && (
                          <button
                            onClick={() => onPin(msg.id)}
                            title={msg.pinned ? 'Unpin' : 'Pin'}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', borderRadius: '4px', display: 'flex', alignItems: 'center', color: msg.pinned ? '#667eea' : 'var(--text-secondary)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >{msg.pinned ? <PinOff size={13} strokeWidth={1.75} /> : <Pin size={13} strokeWidth={1.75} />}</button>
                        )}
                        {isMe && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDmDeleteMenu({ msgId: msg.id, x: e.clientX, y: e.clientY }); }}
                            title="Delete"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', borderRadius: '4px', display: 'flex', alignItems: 'center', color: '#9ca3af' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          ><Trash2 size={13} strokeWidth={1.75} /></button>
                        )}
                      </div>
                    )}

                    {/* Message bubble */}
                    <div style={{
                      background: isMe ? '#667eea' : 'var(--bg-color)',
                      color: isMe ? 'white' : 'var(--text-primary)',
                      borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      padding: '9px 13px', fontSize: '14px', wordBreak: 'break-word',
                      border: isMe ? 'none' : '1px solid var(--border-color)',
                      opacity: isDeleted ? 0.7 : 1,
                    }}>
                      {isDeleted ? (
                        <span style={{ color: isMe ? 'rgba(255,255,255,0.55)' : '#9ca3af', fontStyle: 'italic', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <EyeOff size={13} strokeWidth={1.75} /> This message was deleted
                        </span>
                      ) : (
                        <>
                          {/* Reply quote block */}
                          {msg.reply_to && (
                            <div style={{
                              borderLeft: `3px solid ${isMe ? 'rgba(255,255,255,0.5)' : '#667eea'}`,
                              paddingLeft: '8px', marginBottom: '6px',
                              opacity: 0.75, fontSize: '12px',
                              color: isMe ? 'rgba(255,255,255,0.85)' : 'var(--text-secondary)',
                            }}>
                              <div style={{ fontWeight: 600, marginBottom: '1px' }}>{msg.reply_to.sender_name}</div>
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                                {msg.reply_to.text || '[file]'}
                              </div>
                            </div>
                          )}
                          {hasFile && (
                            <a href={fileUrl} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: isMe ? 'rgba(255,255,255,0.9)' : '#667eea', textDecoration: 'none', marginBottom: msg.text ? '6px' : 0 }}>
                              <FileTypeIcon mime={msg.file.mime_type} size={18} />
                              <span style={{ fontSize: '13px', fontWeight: 500 }}>{msg.file.name}</span>
                              <span style={{ fontSize: '11px', opacity: 0.75 }}>{sizeLabel(msg.file.size)}</span>
                            </a>
                          )}
                          {msg.text && <span>{msg.text}</span>}
                        </>
                      )}
                    </div>

                    {/* reaction picker rendered as fixed overlay — see bottom of component */}
                  </div>

                  {/* Reactions bar — max 4 visible + overflow chip + tooltips */}
                  {msg.reactions?.some(r => r.user_ids?.length > 0) && (() => {
                    const activeReactions = msg.reactions.filter(r => r.user_ids?.length > 0);
                    const MAX_VISIBLE = 4;
                    const visible = activeReactions.slice(0, MAX_VISIBLE);
                    const overflow = activeReactions.slice(MAX_VISIBLE);
                    const overflowCount = overflow.reduce((s, r) => s + r.user_ids.length, 0);
                    return (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '-4px', paddingBottom: '2px', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                        {visible.map(r => {
                          const reacted = r.user_ids?.includes(userId);
                          const isTooltipOpen = reactionTooltip?.msgId === msg.id && reactionTooltip?.emoji === r.emoji;
                          const reactorNames = r.user_ids.map(uid => resolveName(uid));
                          return (
                            <div key={r.emoji} style={{ position: 'relative' }}>
                              {isTooltipOpen && (
                                <div style={{
                                  position: 'absolute', bottom: 'calc(100% + 6px)',
                                  [isMe ? 'right' : 'left']: 0,
                                  background: 'rgba(30,30,30,0.93)', color: 'white',
                                  borderRadius: '8px', padding: '6px 10px',
                                  fontSize: '12px', whiteSpace: 'nowrap',
                                  zIndex: 50, pointerEvents: 'none',
                                  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                                }}>
                                  <span style={{ fontSize: '15px', marginRight: '6px' }}>{r.emoji}</span>
                                  {reactorNames.slice(0, 5).join(', ')}
                                  {reactorNames.length > 5 && ` +${reactorNames.length - 5}`}
                                </div>
                              )}
                              <button
                                onClick={() => onReact(msg.id, r.emoji)}
                                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; setReactionTooltip({ msgId: msg.id, emoji: r.emoji }); }}
                                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; setReactionTooltip(null); }}
                                style={{
                                  background: reacted ? 'rgba(102,126,234,0.12)' : 'var(--card-bg)',
                                  border: `1.5px solid ${reacted ? 'var(--primary-color)' : 'var(--border-color)'}`,
                                  borderRadius: '12px', padding: '2px 7px',
                                  cursor: 'pointer', fontSize: '13px',
                                  display: 'inline-flex', alignItems: 'center', gap: '3px',
                                  boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
                                  color: 'var(--text-primary)',
                                  transition: 'transform 0.1s',
                                }}
                              >
                                {r.emoji}
                                <span style={{ fontSize: '11px', fontWeight: 700, color: reacted ? 'var(--primary-color)' : 'var(--text-secondary)' }}>
                                  {r.user_ids.length}
                                </span>
                              </button>
                            </div>
                          );
                        })}
                        {overflow.length > 0 && (
                          <button
                            onClick={() => setReactionDetailsMsg(msg)}
                            style={{
                              background: 'var(--card-bg)', border: '1.5px solid var(--border-color)',
                              borderRadius: '12px', padding: '2px 7px', cursor: 'pointer',
                              fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '2px',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {overflow.slice(0, 2).map(r => r.emoji).join('')}
                            <span style={{ fontWeight: 700 }}>+{overflowCount}</span>
                          </button>
                        )}
                        <button
                          onClick={() => setReactionDetailsMsg(msg)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: '12px', color: 'var(--text-secondary)', padding: '2px 4px',
                          }}
                          title="See all reactions"
                        >···</button>
                      </div>
                    );
                  })()}

                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px', paddingLeft: '4px', textAlign: isMe ? 'right' : 'left', display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', alignItems: 'center', gap: '4px' }}>
                    <span>{formatTime(msg.created_at)}</span>
                    {isLastMine && isRead && (
                      <span style={{ color: '#667eea', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '2px' }}><Check size={11} strokeWidth={2} /> Seen</span>
                    )}
                  </div>
                </div>
              </div>
              </React.Fragment>
            );
          })}
          {/* DM delete context menu */}
          {dmDeleteMenu && (
            <div
              onMouseDown={e => e.stopPropagation()}
              style={{
                position: 'fixed',
                top: Math.min(dmDeleteMenu.y, window.innerHeight - 100),
                left: Math.min(dmDeleteMenu.x, window.innerWidth - 180),
                background: 'var(--card-bg)', borderRadius: '10px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.2)', border: '1px solid var(--border-color)',
                zIndex: 800, overflow: 'hidden', minWidth: '160px',
              }}
            >
              {[
                { label: 'Delete for me', icon: <Eye size={14} strokeWidth={1.75} />, mode: 'for_me' },
                { label: 'Delete for everyone', icon: <Trash2 size={14} strokeWidth={1.75} />, mode: 'for_everyone' },
              ].map(({ label, icon, mode }) => (
                <button
                  key={mode}
                  onMouseDown={() => { onDelete(dmDeleteMenu.msgId, mode); setDmDeleteMenu(null); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    width: '100%', padding: '11px 16px', background: 'none',
                    border: 'none', cursor: 'pointer', fontSize: '13px',
                    color: mode === 'for_everyone' ? '#dc2626' : 'var(--text-primary)',
                    textAlign: 'left', fontWeight: 500,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <span>{icon}</span><span>{label}</span>
                </button>
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Typing indicator */}
        {isTyping && (
          <div style={{ padding: '4px 20px', fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <span style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{
                  width: '5px', height: '5px', borderRadius: '50%',
                  background: 'var(--primary-color)',
                  animation: `typingDot 1.2s ${i * 0.2}s infinite`,
                  display: 'inline-block',
                }} />
              ))}
            </span>
            {target.name} is typing…
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: '4px 20px', background: '#fef2f2', color: '#dc2626', fontSize: '12px', flexShrink: 0 }}>
            {error}
          </div>
        )}

        {/* Reply preview bar */}
        {replyingTo && (
          <div style={{
            padding: '6px 16px', background: 'var(--bg-color)', borderTop: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
          }}>
            <div style={{ flex: 1, borderLeft: '3px solid #667eea', paddingLeft: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#667eea' }}>{replyingTo.senderName}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '360px' }}>
                {replyingTo.text || '[file]'}
              </div>
            </div>
            <button onClick={() => setReplyingTo(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: '2px' }}>
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        )}

        {/* Pending file preview */}
        {pendingFile && (
          <div style={{
            padding: '8px 20px', background: 'var(--bg-color)', borderTop: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
          }}>
            <Paperclip size={18} strokeWidth={1.75} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
            <span style={{ flex: 1, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
              {pendingFile.name}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0 }}>
              {sizeLabel(pendingFile.size)}
            </span>
            <button onClick={onClearFile} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '16px', padding: '0 2px', display: 'flex', alignItems: 'center' }}><X size={16} strokeWidth={1.75} /></button>
          </div>
        )}

        {/* Input */}
        <div style={{
          padding: '12px 16px', borderTop: '1px solid var(--border-color)',
          display: 'flex', alignItems: 'flex-end', gap: '8px', flexShrink: 0,
          position: 'relative',
        }}>
          {/* Emoji input picker */}
          {showInputEmoji && smileBtnRef.current && (
            <div
              className="dm-emoji-input-picker"
              onMouseDown={e => e.stopPropagation()}
              style={{
                position: 'fixed',
                bottom: window.innerHeight - smileBtnRef.current.getBoundingClientRect().top + 8,
                right: window.innerWidth - smileBtnRef.current.getBoundingClientRect().right,
                zIndex: 800,
              }}
            >
              <EmojiMartPicker
                data={emojiData}
                onEmojiSelect={e => {
                  const emoji = e.native;
                  const ta = textareaRef.current;
                  if (ta) {
                    const start = ta.selectionStart ?? text.length;
                    const end = ta.selectionEnd ?? text.length;
                    const newText = text.slice(0, start) + emoji + text.slice(end);
                    onTextChange(newText);
                    setTimeout(() => {
                      ta.focus();
                      ta.setSelectionRange(start + emoji.length, start + emoji.length);
                    }, 10);
                  } else {
                    onTextChange(text + emoji);
                  }
                  // do NOT close — multi-emoji
                }}
                theme="auto"
                previewPosition="none"
                skinTonePosition="none"
                maxFrequentRows={2}
                perLine={9}
              />
            </div>
          )}
          <button
            onClick={onFilePick}
            disabled={!!pendingFile}
            title={pendingFile ? 'Remove the staged file first' : 'Attach from desktop'}
            style={{
              background: 'none', border: '1px solid var(--border-color)', borderRadius: '8px',
              padding: '8px 10px', cursor: pendingFile ? 'not-allowed' : 'pointer',
              color: pendingFile ? 'var(--text-secondary)' : '#667eea', flexShrink: 0,
              display: 'flex', alignItems: 'center',
            }}
          ><Paperclip size={16} strokeWidth={1.75} /></button>
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
            ref={textareaRef}
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
            ref={smileBtnRef}
            onClick={() => setShowInputEmoji(prev => !prev)}
            title="Insert emoji"
            style={{
              background: 'none', border: '1px solid var(--border-color)', borderRadius: '8px',
              padding: '8px 10px', cursor: 'pointer',
              color: showInputEmoji ? '#667eea' : 'var(--text-secondary)', flexShrink: 0,
              display: 'flex', alignItems: 'center',
            }}
          ><Smile size={16} strokeWidth={1.75} /></button>
          <button
            onClick={() => { onSend(replyingTo); setReplyingTo(null); }}
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

      {/* Reaction picker — fixed overlay so it's never clipped */}
      {reactionPickerState && (
        <div
          className="dm-reaction-picker"
          onMouseDown={e => e.stopPropagation()}
          style={{ position: 'fixed', top: reactionPickerState.y, left: reactionPickerState.x, zIndex: 800 }}
        >
          <EmojiMartPicker
            data={emojiData}
            onEmojiSelect={e => {
              const { msgId } = reactionPickerState;
              setReactionPickerState(null);
              onReact(msgId, e.native);
            }}
            theme="auto"
            previewPosition="none"
            skinTonePosition="none"
            maxFrequentRows={2}
            perLine={9}
          />
        </div>
      )}

      {/* Reaction Details Bottom Sheet */}
      {reactionDetailsMsg && (() => {
        const activeReactions = (reactionDetailsMsg.reactions || []).filter(r => r.user_ids?.length > 0);
        const totalCount = activeReactions.reduce((s, r) => s + r.user_ids.length, 0);
        const activeTab = reactionDetailsTab;
        const setActiveTab = setReactionDetailsTab;
        const rows = activeTab === 'all'
          ? activeReactions.flatMap(r => r.user_ids.map(uid => ({ uid, emoji: r.emoji })))
          : (activeReactions.find(r => r.emoji === activeTab)?.user_ids || []).map(uid => ({ uid, emoji: activeTab }));
        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 700, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
            onClick={() => { setReactionDetailsMsg(null); setReactionDetailsTab('all'); }}
          >
            <div
              style={{ width: '100%', maxWidth: '520px', background: 'var(--card-bg)', borderRadius: '18px 18px 0 0', maxHeight: '60vh', display: 'flex', flexDirection: 'column', animation: 'slideUpSheet 0.22s ease', boxShadow: '0 -4px 30px rgba(0,0,0,0.2)' }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ padding: '12px 20px 0', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>Reactions</span>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', background: 'var(--bg-color)', borderRadius: '99px', padding: '1px 8px' }}>{totalCount}</span>
                <button onClick={() => { setReactionDetailsMsg(null); setReactionDetailsTab('all'); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}><X size={16} strokeWidth={2} /></button>
              </div>
              {/* Emoji tabs */}
              <div style={{ display: 'flex', gap: '4px', padding: '8px 16px', borderBottom: '1px solid var(--border-color)', flexShrink: 0, overflowX: 'auto' }}>
                <button
                  onClick={() => setActiveTab('all')}
                  style={{ background: activeTab === 'all' ? 'rgba(102,126,234,0.12)' : 'var(--bg-color)', border: `1.5px solid ${activeTab === 'all' ? 'var(--primary-color)' : 'var(--border-color)'}`, borderRadius: '99px', padding: '3px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 700, color: activeTab === 'all' ? 'var(--primary-color)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}
                >All {totalCount}</button>
                {activeReactions.map(r => (
                  <button
                    key={r.emoji}
                    onClick={() => setActiveTab(r.emoji)}
                    style={{ background: activeTab === r.emoji ? 'rgba(102,126,234,0.12)' : 'var(--bg-color)', border: `1.5px solid ${activeTab === r.emoji ? 'var(--primary-color)' : 'var(--border-color)'}`, borderRadius: '99px', padding: '3px 12px', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
                  >
                    {r.emoji}
                    <span style={{ fontSize: '12px', color: activeTab === r.emoji ? 'var(--primary-color)' : 'var(--text-secondary)', fontWeight: 700 }}>{r.user_ids.length}</span>
                  </button>
                ))}
              </div>
              {/* User rows */}
              <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
                {rows.length === 0 && <p style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>No reactions yet.</p>}
                {rows.map((row, i) => (
                  <div key={`${row.uid}-${row.emoji}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 20px' }}>
                    <Avatar user={{ username: resolveName(row.uid) }} size={36} />
                    <span style={{ flex: 1, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{resolveName(row.uid)}</span>
                    <span style={{ fontSize: '22px' }}>{row.emoji}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
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
