import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { chatAPI, semesterAPI, classroomAPI, settingsAPI, documentAPI, BACKEND_URL } from '../services/api';
import Avatar from '../components/Avatar';
import { useSocket } from '../hooks/useSocket';
import FilePickerModal from '../components/FilePickerModal';

// ── File category helpers ────────────────────────────────────────────────────
function fileCategory(mime) {
  if (!mime) return 'documents';
  if (mime.startsWith('image/')) return 'images';
  if (mime.startsWith('video/')) return 'videos';
  if (mime.startsWith('audio/')) return 'audio';
  return 'documents';
}

const CATEGORY_META = {
  images:    { label: 'Images',    icon: '🖼️' },
  videos:    { label: 'Videos',    icon: '🎬' },
  audio:     { label: 'Audio',     icon: '🎵' },
  documents: { label: 'Documents', icon: '📄' },
};

// ── Files & Media panel ──────────────────────────────────────────────────────
function FilesPanel({ messages }) {
  const [openSections, setOpenSections] = useState({ images: true, videos: true, audio: true, documents: true });

  const grouped = useMemo(() => {
    const g = { images: [], videos: [], audio: [], documents: [] };
    for (const msg of messages) {
      if (!msg.file) continue;
      g[fileCategory(msg.file.mime_type)].push(msg);
    }
    return g;
  }, [messages]);

  const total = Object.values(grouped).reduce((s, a) => s + a.length, 0);

  const toggleSection = (cat) =>
    setOpenSections(prev => ({ ...prev, [cat]: !prev[cat] }));

  const formatDate = (iso) =>
    new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });

  const sizeLabel = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div style={{
      width: '272px', flexShrink: 0, background: 'var(--card-bg)',
      borderLeft: '1.5px solid var(--border-color)', display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid var(--border-color)',
        fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexShrink: 0,
      }}>
        <span>Files & Media</span>
        <span style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 400 }}>
          {total} {total === 1 ? 'file' : 'files'}
        </span>
      </div>

      {total === 0 && (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
          No files shared yet.
        </div>
      )}

      {Object.entries(CATEGORY_META).map(([cat, meta]) => {
        const items = grouped[cat];
        if (items.length === 0) return null;
        const open = openSections[cat];
        return (
          <div key={cat} style={{ borderBottom: '1px solid var(--border-color)' }}>
            <button
              onClick={() => toggleSection(cat)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 16px', background: 'var(--bg-color)', border: 'none',
                cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)',
              }}
            >
              <span>{meta.icon} {meta.label} ({items.length})</span>
              <span style={{ fontSize: '10px', color: '#9ca3af' }}>{open ? '▲' : '▼'}</span>
            </button>

            {open && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', padding: '4px 0' }}>
                {items.map(msg => {
                  const { name, mime_type, size } = msg.file;
                  const fileUrl = chatAPI.getFileUrl(msg.id);
                  const isImage = mime_type?.startsWith('image/');
                  const isVideo = mime_type?.startsWith('video/');
                  const isAudio = mime_type?.startsWith('audio/');

                  return (
                    <div key={msg.id} style={{
                      padding: '8px 16px', display: 'flex', gap: '10px',
                      alignItems: 'flex-start', cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      onClick={() => window.open(fileUrl, '_blank')}
                    >
                      <div style={{
                        width: '40px', height: '40px', borderRadius: '6px',
                        background: 'var(--border-color)', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        overflow: 'hidden', fontSize: '20px',
                      }}>
                        {isImage ? (
                          <img
                            src={fileUrl}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🖼️'; }}
                          />
                        ) : isVideo ? '🎬' : isAudio ? '🎵' : (mime_type === 'application/pdf' ? '📄' : '📎')}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }} title={name}>
                          {name}
                        </div>
                        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                          {msg.full_name || msg.username} · {formatDate(msg.created_at)}
                        </div>
                        {size > 0 && (
                          <div style={{ fontSize: '11px', color: '#b0b7c3' }}>
                            {sizeLabel(size)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Chat component ──────────────────────────────────────────────────────
function Chat({ user }) {
  const { classroomId, semesterId } = useParams();
  const navigate = useNavigate();

  const [semester, setSemester]           = useState(null);
  const [messages, setMessages]           = useState([]);
  const [text, setText]                   = useState('');
  const [sending, setSending]             = useState(false);
  const [uploading, setUploading]         = useState(false);
  const [pendingChatFile, setPendingChatFile] = useState(null);
  const [error, setError]                 = useState('');
  const [showFiles, setShowFiles]         = useState(false);
  const [hoveredMsgId, setHoveredMsgId]   = useState(null);
  const [warnBanner, setWarnBanner]       = useState(null);   // private warning from CR
  const [fullscreenPhoto, setFullscreenPhoto] = useState(null);
  const [removePhotoReason, setRemovePhotoReason] = useState('');
  const [removePhotoLoading, setRemovePhotoLoading] = useState(false);
  // New state
  const [pinnedMessages, setPinnedMessages] = useState([]);   // array, most recent first
  const [currentPinIdx, setCurrentPinIdx]   = useState(0);   // WhatsApp-style cycling index
  const [highlightedMsgId, setHighlightedMsgId] = useState(null); // brief highlight on scroll
  const [hasMore, setHasMore]             = useState(false);  // #8
  const [loadingMore, setLoadingMore]     = useState(false);  // #8
  const [warnModal, setWarnModal]         = useState(null);   // #2 { userId, name, messageId }
  const [warnReason, setWarnReason]       = useState('');     // #2
  const [warnType, setWarnType]           = useState('chat'); // 'chat' | 'picture'
  const [showScrollBtn, setShowScrollBtn] = useState(false);  // #3
  const [newMsgCount, setNewMsgCount]     = useState(0);

  // Attach-from-docs states
  const [showAttachMenu, setShowAttachMenu]     = useState(false);
  const [showFilePicker, setShowFilePicker]     = useState(false);
  const [semDocsModal, setSemDocsModal]         = useState(false);
  const [semDocs, setSemDocs]                   = useState([]);
  const [semDocsLoading, setSemDocsLoading]     = useState(false);
  const [persDocsModal, setPersDocsModal]       = useState(false); // 'pw' | 'list' | false
  const [persDocs, setPersDocs]                 = useState([]);
  const [persDocsPw, setPersDocsPw]             = useState('');
  const [persDocsPwErr, setPersDocsPwErr]       = useState('');
  const [persDocsPwChecking, setPersDocsPwChecking] = useState(false);
  const [attachingDoc, setAttachingDoc]         = useState(false);

  const bottomRef             = useRef(null);
  const fileInputRef          = useRef(null);
  const messagesContainerRef  = useRef(null);
  const isAtBottomRef         = useRef(true);
  const attachMenuRef         = useRef(null);
  const persDocsPwRef         = useRef(null);

  // ── Load semester ──────────────────────────────────────────────────────────
  useEffect(() => {
    semesterAPI.getDetail(semesterId)
      .then(res => {
        const sem = res.data.semester;
        setSemester(sem);
        setPinnedMessages(sem.pinned_messages || []);
      })
      .catch(() => navigate(`/classroom/${classroomId}`));
  }, [semesterId, classroomId, navigate]);

  // ── Load initial history ───────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      chatAPI.getMessages(semesterId, 50),
      chatAPI.markRead(semesterId).catch(() => {}),
    ]).then(([res]) => {
      const msgs = res.data.messages || [];
      setMessages(msgs);
      setHasMore(msgs.length === 50);
    });
  }, [semesterId]);

  // ── Socket handlers ────────────────────────────────────────────────────────
  const handleMessage = useCallback((msg) => {
    let replacedOptimistic = false;
    setMessages(prev => {
      // #9 — replace optimistic placeholder when local_id matches
      if (msg.local_id) {
        const idx = prev.findIndex(m => m.local_id === msg.local_id && m.pending);
        if (idx !== -1) {
          replacedOptimistic = true;
          const next = [...prev];
          next[idx] = msg;
          return next;
        }
      }
      return [...prev, msg];
    });
    if (!isAtBottomRef.current && !replacedOptimistic) {
      setNewMsgCount(c => c + 1);
    }
    chatAPI.markRead(semesterId).catch(() => {});
  }, [semesterId]);

  const handleDeleted = useCallback(({ message_id }) => {
    setMessages(prev => prev.filter(m => m.id !== message_id));
  }, []);

  const handleWarnSocket = useCallback(({ cr_name, reason }) => {
    setWarnBanner({ crName: cr_name, reason });
  }, []);

  const handlePinned = useCallback(({ message }) => {
    setPinnedMessages(prev => {
      const filtered = prev.filter(m => m.id !== message.id);
      return [message, ...filtered].slice(0, 3);
    });
  }, []);

  const handleUnpinned = useCallback(({ message_id }) => {
    if (message_id) {
      setPinnedMessages(prev => prev.filter(m => m.id !== message_id));
    } else {
      setPinnedMessages([]);
    }
  }, []);

  // #7 + #16 — useSocket hook (replaces manual socket setup, exposes connected)
  const { socketRef, connected } = useSocket(semesterId, {
    onMessage:  handleMessage,
    onDeleted:  handleDeleted,
    onWarn:     handleWarnSocket,
    onPinned:   handlePinned,
    onUnpinned: handleUnpinned,
  });

  // ── Close attach menu on outside click ────────────────────────────────────
  useEffect(() => {
    if (!showAttachMenu) return;
    const handler = (e) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAttachMenu]);

  // ── Auto-scroll only when already near the bottom ─────────────────────────
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const { scrollHeight, scrollTop, clientHeight } = container;
    if (scrollHeight - scrollTop - clientHeight < 160) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // ── Track scroll position for scroll-to-bottom button (#3) ────────────────
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distFromBottom <= 200;
    isAtBottomRef.current = atBottom;
    setShowScrollBtn(!atBottom);
    if (atBottom) setNewMsgCount(0);
  }, []);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setNewMsgCount(0);
  };

  // Scroll to a specific message by id and briefly highlight it
  const scrollToMessageById = useCallback((id) => {
    const el = document.querySelector(`[data-msg-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMsgId(id);
      setTimeout(() => setHighlightedMsgId(null), 1800);
    }
  }, []);

  // ── Load earlier messages (#8) ─────────────────────────────────────────────
  const loadMore = async () => {
    if (!hasMore || loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    const container = messagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight || 0;
    try {
      const oldest = messages[0].id;
      const res = await chatAPI.getMessages(semesterId, 50, oldest);
      const older = res.data.messages || [];
      setMessages(prev => [...older, ...prev]);
      setHasMore(older.length === 50);
      // Restore scroll position after prepend
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevScrollHeight;
        }
      });
    } finally {
      setLoadingMore(false);
    }
  };

  // ── Send text with optimistic UI (#9) ─────────────────────────────────────
  const sendMessage = useCallback(async () => {
    // If there is a staged file, upload it (with optional text caption)
    if (pendingChatFile) {
      const caption = text.trim();
      const file = pendingChatFile;
      setPendingChatFile(null);
      setText('');
      setUploading(true);
      setError('');
      try {
        await chatAPI.uploadFile(semesterId, file, caption || undefined);
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to upload file');
      } finally {
        setUploading(false);
      }
      return;
    }

    const trimmed = text.trim();
    if (!trimmed || !socketRef.current || sending) return;

    const localId = `local-${Date.now()}-${Math.random()}`;
    const optimistic = {
      id: localId,
      local_id: localId,
      user_id: user?.id,
      username: user?.username,
      full_name: user?.fullName || user?.full_name,
      profile_picture: user?.profile_picture,
      text: trimmed,
      file: null,
      type: 'text',
      created_at: new Date().toISOString(),
      pending: true,
    };
    setMessages(prev => [...prev, optimistic]);

    socketRef.current.emit('send_message', {
      semester_id: semesterId,
      text: trimmed,
      local_id: localId,
    });
    setText('');
    setSending(false);
  }, [text, pendingChatFile, semesterId, sending, user, socketRef]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Stage file (upload happens on Send) ───────────────────────────────────
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setPendingChatFile(file);
  };

  // ── Pin / Unpin (#4) ───────────────────────────────────────────────────────
  const handlePin = async (messageId) => {
    try {
      await chatAPI.pinMessage(semesterId, messageId);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to pin message');
    }
  };

  const handleUnpin = async (messageId = null) => {
    try {
      await chatAPI.unpinMessage(semesterId, messageId);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to unpin message');
    }
  };

  // ── Attach from semester documents ────────────────────────────────────────
  const openSemDocs = async () => {
    setShowAttachMenu(false);
    setSemDocsModal(true);
    setSemDocsLoading(true);
    try {
      const res = await documentAPI.list(semesterId);
      setSemDocs(res.data.documents || []);
    } catch { setSemDocs([]); }
    finally { setSemDocsLoading(false); }
  };

  // ── Attach from personal documents (password-gated) ───────────────────────
  const openPersonalDocs = () => {
    setShowAttachMenu(false);
    setPersDocsPw('');
    setPersDocsPwErr('');
    setPersDocsModal('pw');
  };

  const verifyPersonalDocsPw = async () => {
    if (!persDocsPw) { setPersDocsPwErr('Enter your password.'); return; }
    setPersDocsPwChecking(true);
    setPersDocsPwErr('');
    try {
      await settingsAPI.verifyPassword(persDocsPw);
      const res = await settingsAPI.listPersonalDocs();
      setPersDocs(res.data.docs || []);
      setPersDocsModal('list');
    } catch (err) {
      setPersDocsPwErr(err.response?.data?.error || 'Incorrect password.');
    } finally { setPersDocsPwChecking(false); }
  };

  // ── Fetch a doc URL and stage it for sending ───────────────────────────────
  const attachDocToChat = async (fileUrl, fileName) => {
    setAttachingDoc(true);
    setSemDocsModal(false);
    setPersDocsModal(false);
    setError('');
    try {
      const token = localStorage.getItem('token') || '';
      const resp = await fetch(fileUrl.includes('?') ? fileUrl : `${fileUrl}?token=${encodeURIComponent(token)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error('Download failed');
      const blob = await resp.blob();
      const file = new File([blob], fileName, { type: blob.type });
      setPendingChatFile(file); // stage — will be uploaded on Send
    } catch (err) {
      setError('Failed to load document');
    } finally { setAttachingDoc(false); }
  };

  // ── Warn modal (#2) ────────────────────────────────────────────────────────
  const openWarnModal = (userId, name, messageId) => {
    setWarnModal({ userId, name, messageId });
    setWarnReason('');
    setWarnType('chat');
  };

  const submitWarn = async () => {
    if (!warnModal) return;
    try {
      await chatAPI.warnUser(semesterId, warnModal.userId, warnReason.trim(), warnModal.messageId, warnType);
      setWarnModal(null);
      setWarnReason('');
      setWarnType('chat');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to warn user');
    }
  };

  // ── Kick ───────────────────────────────────────────────────────────────────
  const handleKickUser = async (targetUserId, targetName) => {
    if (!window.confirm(`Remove ${targetName} from the classroom? They will lose access immediately.`)) return;
    try {
      await classroomAPI.removeMember(classroomId, targetUserId);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove user');
    }
  };

  // ── Remove photo ───────────────────────────────────────────────────────────
  const handleRemovePhoto = async (e) => {
    e.preventDefault();
    if (!fullscreenPhoto || !removePhotoReason.trim()) return;
    setRemovePhotoLoading(true);
    try {
      await classroomAPI.removeMemberAvatar(classroomId, fullscreenPhoto.userId, removePhotoReason.trim());
      setFullscreenPhoto(null);
      setRemovePhotoReason('');
      const res = await chatAPI.getMessages(semesterId);
      setMessages(res.data.messages || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove photo');
    } finally {
      setRemovePhotoLoading(false);
    }
  };

  // ── Render message content ─────────────────────────────────────────────────
  const renderContent = (msg) => {
    const isMe = msg.user_id === user?.id;

    if (!msg.file) {
      return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.text}</span>;
    }

    const { mime_type, name, size } = msg.file;
    const fileUrl = chatAPI.getFileUrl(msg.id);

    if (mime_type?.startsWith('image/')) {
      return (
        <div>
          {msg.text && <p style={{ margin: '0 0 6px', whiteSpace: 'pre-wrap' }}>{msg.text}</p>}
          <img
            src={fileUrl} alt={name}
            style={{ maxWidth: '280px', maxHeight: '220px', borderRadius: '8px', display: 'block', cursor: 'pointer' }}
            onClick={() => window.open(fileUrl, '_blank')}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        </div>
      );
    }

    if (mime_type?.startsWith('audio/')) {
      return (
        <div>
          {msg.text && <p style={{ margin: '0 0 6px', whiteSpace: 'pre-wrap' }}>{msg.text}</p>}
          <audio controls style={{ maxWidth: '280px' }}>
            <source src={fileUrl} type={mime_type} />
          </audio>
        </div>
      );
    }

    if (mime_type?.startsWith('video/')) {
      return (
        <div>
          {msg.text && <p style={{ margin: '0 0 6px', whiteSpace: 'pre-wrap' }}>{msg.text}</p>}
          <video controls style={{ maxWidth: '320px', maxHeight: '220px', borderRadius: '8px' }}>
            <source src={fileUrl} type={mime_type} />
          </video>
        </div>
      );
    }

    const isPdf = mime_type === 'application/pdf';
    const sizeLabel = size ? ` · ${(size / 1024).toFixed(0)} KB` : '';
    return (
      <div>
        {msg.text && <p style={{ margin: '0 0 6px', whiteSpace: 'pre-wrap' }}>{msg.text}</p>}
        <a
          href={fileUrl} target="_blank" rel="noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            background: isMe ? 'rgba(255,255,255,0.2)' : 'var(--bg-color)',
            color: isMe ? 'white' : '#667eea',
            padding: '8px 14px', borderRadius: '8px',
            textDecoration: 'none', fontSize: '13px', fontWeight: 500,
          }}
        >
          <span style={{ fontSize: '18px' }}>{isPdf ? '📄' : '📎'}</span>
          <span style={{ wordBreak: 'break-all' }}>{name}{sizeLabel}</span>
        </a>
      </div>
    );
  };

  const formatTime = (iso) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const formatDate = (iso) => {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Today';
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // Group messages by date dividers
  const grouped = [];
  let lastDate = null;
  for (const msg of messages) {
    const dateLabel = formatDate(msg.created_at);
    if (dateLabel !== lastDate) {
      grouped.push({ type: 'divider', label: dateLabel, key: `d-${msg.created_at}` });
      lastDate = dateLabel;
    }
    grouped.push({ type: 'message', msg, key: msg.id });
  }

  const fileCount = messages.filter(m => m.file).length;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 56px)', background: 'var(--bg-color)' }}>

      {/* ── Left: Chat column ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Header */}
        <div className="chat-header" style={{
          background: 'var(--card-bg)', borderBottom: '1.5px solid var(--border-color)',
          padding: '14px 24px', display: 'flex', alignItems: 'center',
          gap: '16px', flexShrink: 0,
        }}>
          <button
            onClick={() => navigate(`/classroom/${classroomId}/semester/${semesterId}`)}
            style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: 0 }}
            title="Back to semester"
          >←</button>

          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '17px', color: 'var(--text-primary)' }}>
              {semester?.name || 'Chat'}
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af' }}>Semester chat</div>
          </div>

          <button
            onClick={() => setShowFiles(v => !v)}
            title={showFiles ? 'Hide files panel' : 'Show files & media'}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: showFiles ? '#667eea' : 'var(--bg-color)',
              color: showFiles ? 'white' : '#667eea',
              border: 'none', borderRadius: '8px',
              padding: '7px 14px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              flexShrink: 0,
            }}
          >
            📁 Files{fileCount > 0 && <span style={{
              background: showFiles ? 'rgba(255,255,255,0.3)' : '#667eea',
              color: 'white', borderRadius: '999px', padding: '1px 7px', fontSize: '11px',
            }}>{fileCount}</span>}
          </button>
        </div>

        {/* #7 — Disconnected banner */}
        {!connected && semester && (
          <div style={{
            background: '#fef3c7', borderBottom: '1px solid #fde68a',
            padding: '7px 24px', fontSize: '13px', color: '#92400e',
            display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
          }}>
            <span>⚠️</span> Reconnecting… messages may be delayed.
          </div>
        )}

        {error && (
          <div style={{
            background: '#fef2f2', color: '#dc2626', padding: '8px 24px',
            fontSize: '13px', borderBottom: '1px solid #fecaca', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span>{error}</span>
            <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '16px', padding: '0 4px' }}>×</button>
          </div>
        )}

        {/* Private warning banner */}
        {warnBanner && (
          <div style={{
            background: '#fffbeb', borderBottom: '2px solid #f59e0b',
            padding: '12px 24px', flexShrink: 0,
            display: 'flex', alignItems: 'flex-start', gap: '12px',
          }}>
            <span style={{ fontSize: '20px', flexShrink: 0 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: '#92400e', fontSize: '13px', marginBottom: '2px' }}>
                Your message was removed by {warnBanner.crName}
              </div>
              {warnBanner.reason && (
                <div style={{ color: '#78350f', fontSize: '13px' }}>Reason: {warnBanner.reason}</div>
              )}
            </div>
            <button
              onClick={() => setWarnBanner(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#92400e', fontSize: '18px', lineHeight: 1, flexShrink: 0 }}
            >×</button>
          </div>
        )}

        {/* Pinned message banner — click cycles through pins and scrolls to each */}
        {pinnedMessages.length > 0 && (() => {
          const safeIdx = currentPinIdx % pinnedMessages.length;
          const pm = pinnedMessages[safeIdx];
          const handleBannerClick = () => {
            scrollToMessageById(pm.id);
            if (pinnedMessages.length > 1) {
              setCurrentPinIdx(i => (i + 1) % pinnedMessages.length);
            }
          };
          return (
            <div
              onClick={handleBannerClick}
              style={{
                background: 'var(--card-bg)', borderBottom: '1px solid var(--border-color)',
                padding: '8px 24px', flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: '10px',
                cursor: 'pointer',
              }}
            >
              {/* Left accent bar cycling through pins */}
              {pinnedMessages.length > 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0 }}>
                  {pinnedMessages.map((_, i) => (
                    <div key={i} style={{
                      width: '3px', height: '6px', borderRadius: '2px',
                      background: i === safeIdx ? '#667eea' : 'var(--border-color)',
                      transition: 'background 0.2s',
                    }} />
                  ))}
                </div>
              )}
              <span style={{ fontSize: '14px', flexShrink: 0 }}>📌</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '11px', color: '#667eea', fontWeight: 600 }}>
                  Pinned message
                  {pinnedMessages.length > 1 && (
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 400, marginLeft: '6px' }}>
                      {safeIdx + 1} / {pinnedMessages.length}
                    </span>
                  )}
                </span>
                <p style={{
                  margin: '1px 0 0', fontSize: '13px', color: 'var(--text-primary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {pm.text || (pm.file ? `📎 ${pm.file.name || 'File'}` : '📎 File')}
                </p>
              </div>
              {semester?.is_user_cr && (
                <button
                  onClick={e => { e.stopPropagation(); handleUnpin(pm.id); }}
                  title="Unpin"
                  style={{
                    background: 'rgba(156,163,175,0.15)', border: '1px solid var(--border-color)',
                    borderRadius: '6px', cursor: 'pointer', color: 'var(--text-secondary)',
                    fontSize: '12px', fontWeight: 600, flexShrink: 0,
                    padding: '4px 10px', lineHeight: 1, whiteSpace: 'nowrap',
                  }}
                >Unpin</button>
              )}
            </div>
          );
        })()}

        {/* Messages (scrollable) */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '2px', position: 'relative' }}
        >
          {/* #8 — Load earlier messages button */}
          {hasMore && (
            <div style={{ textAlign: 'center', marginBottom: '12px' }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  background: 'var(--bg-color)', color: '#667eea', border: '1px solid var(--border-color)',
                  borderRadius: '20px', padding: '6px 20px', fontSize: '12px',
                  fontWeight: 600, cursor: loadingMore ? 'not-allowed' : 'pointer',
                  opacity: loadingMore ? 0.6 : 1,
                }}
              >
                {loadingMore ? 'Loading…' : '↑ Load earlier messages'}
              </button>
            </div>
          )}

          {grouped.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9ca3af', marginTop: '60px', fontSize: '15px' }}>
              No messages yet. Say hello!
            </div>
          )}

          {grouped.map(item => {
            if (item.type === 'divider') {
              return (
                <div key={item.key} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  margin: '16px 0 8px', color: '#9ca3af', fontSize: '12px',
                }}>
                  <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                  <span>{item.label}</span>
                  <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                </div>
              );
            }

            const { msg } = item;
            const isMe = msg.user_id === user?.id;
            const isCrOrMod = semester?.is_user_cr || semester?.is_user_mod;

            if (msg.type === 'system') {
              return (
                <div key={msg.id} style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
                  <span style={{
                    background: '#fef3c7', color: '#92400e', fontSize: '12px',
                    padding: '4px 16px', borderRadius: '999px', border: '1px solid #fde68a',
                  }}>
                    {msg.text}
                  </span>
                </div>
              );
            }

            const avatarUser = { id: msg.user_id, username: msg.username, profile_picture: msg.profile_picture };
            const avatarUrl = msg.profile_picture ? settingsAPI.getAvatarUrl(msg.user_id) : null;

            return (
              <div key={msg.id} data-msg-id={msg.id} style={{
                display: 'flex',
                flexDirection: isMe ? 'row-reverse' : 'row',
                alignItems: 'flex-end',
                gap: '8px',
                marginBottom: '6px',
                opacity: msg.pending ? 0.6 : 1,
                borderRadius: '10px',
                transition: 'background 0.3s',
                background: highlightedMsgId === msg.id ? 'rgba(102,126,234,0.12)' : 'transparent',
                padding: highlightedMsgId === msg.id ? '4px 8px' : '0',
              }}
                onMouseEnter={() => setHoveredMsgId(msg.id)}
                onMouseLeave={() => setHoveredMsgId(null)}
              >
                {/* Avatar (other users only) */}
                {!isMe && (
                  <div
                    style={{ flexShrink: 0, cursor: avatarUrl ? 'pointer' : 'default' }}
                    onClick={() => avatarUrl && setFullscreenPhoto({ url: avatarUrl, userId: msg.user_id, name: msg.full_name || msg.username })}
                    title={avatarUrl ? 'View full photo' : ''}
                  >
                    <Avatar user={avatarUser} size={32} />
                  </div>
                )}

                <div style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: isMe ? 'flex-end' : 'flex-start',
                  maxWidth: '65%',
                }}>
                  {!isMe && (
                    <span style={{ fontSize: '12px', color: '#667eea', fontWeight: 600, marginBottom: '3px', marginLeft: '4px' }}>
                      {msg.full_name || msg.username}
                    </span>
                  )}
                  <div style={{ position: 'relative' }}>
                    {/* Moderation / pin buttons on hover */}
                    {!msg.pending && hoveredMsgId === msg.id && (
                      <div
                        onMouseEnter={() => setHoveredMsgId(msg.id)}
                        style={{
                          position: 'absolute', top: '-34px',
                          [isMe ? 'right' : 'left']: 0,
                          display: 'flex', gap: '2px',
                          background: 'var(--card-bg)', borderRadius: '6px', padding: '4px 8px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.15)', border: '1px solid var(--border-color)',
                          zIndex: 10, whiteSpace: 'nowrap',
                        }}>
                        {/* #4 — Unpin button if this message is currently pinned */}
                        {isCrOrMod && pinnedMessages.some(p => p.id === msg.id) && (
                          <button
                            onClick={() => handleUnpin(msg.id)}
                            title="Unpin message"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, color: '#667eea' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >Unpin</button>
                        )}
                        {/* Pin button (CR/mod only, not already pinned, max 3) */}
                        {isCrOrMod && !pinnedMessages.some(p => p.id === msg.id) && pinnedMessages.length < 3 && (
                          <button
                            onClick={() => handlePin(msg.id)}
                            title="Pin message"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px 5px', borderRadius: '4px' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >📌</button>
                        )}
                        {/* #2 — Warn button (CR/mod, other users only) */}
                        {isCrOrMod && !isMe && (
                          <button
                            onClick={() => openWarnModal(msg.user_id, msg.full_name || msg.username, msg.id)}
                            title="Warn user"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', padding: '2px 5px', borderRadius: '4px' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fef3c7'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >⚠️</button>
                        )}
                        {/* Kick button (CR only) */}
                        {semester?.is_user_cr && !isMe && (
                          <button
                            onClick={() => handleKickUser(msg.user_id, msg.full_name || msg.username)}
                            title="Remove from classroom"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', padding: '2px 5px', borderRadius: '4px' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >🚫</button>
                        )}
                      </div>
                    )}
                    <div style={{
                      padding: '10px 14px',
                      borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                      background: isMe ? '#667eea' : 'var(--card-bg)',
                      color: isMe ? 'white' : 'var(--text-primary)',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                      fontSize: '14px', lineHeight: '1.5',
                    }}>
                      {renderContent(msg)}
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', color: '#9ca3af', marginTop: '3px', marginLeft: '4px', marginRight: '4px' }}>
                    {msg.pending ? 'Sending…' : formatTime(msg.created_at)}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* #3 — Scroll-to-bottom floating button with unread count badge */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            title="Scroll to bottom"
            style={{
              position: 'absolute',
              bottom: '80px',
              right: showFiles ? '300px' : '32px',
              width: '38px', height: '38px', borderRadius: '50%',
              background: '#667eea', color: 'white', border: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
              cursor: 'pointer', fontSize: '18px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 20,
            }}
          >
            ↓
            {newMsgCount > 0 && (
              <span style={{
                position: 'absolute', top: '-6px', right: '-6px',
                background: '#ef4444', color: 'white',
                borderRadius: '999px', padding: '2px 5px',
                fontSize: '11px', fontWeight: 700, lineHeight: 1,
                minWidth: '16px', textAlign: 'center',
                border: '2px solid #667eea',
              }}>
                {newMsgCount > 99 ? '99+' : newMsgCount}
              </span>
            )}
          </button>
        )}

        {/* Staged file preview bar */}
        {pendingChatFile && (
          <div style={{
            padding: '8px 20px', background: 'var(--card-bg)', borderTop: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0,
          }}>
            <span style={{ fontSize: '18px' }}>📎</span>
            <span style={{ flex: 1, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
              {pendingChatFile.name}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0 }}>
              {pendingChatFile.size < 1024 * 1024
                ? `${(pendingChatFile.size / 1024).toFixed(0)} KB`
                : `${(pendingChatFile.size / (1024 * 1024)).toFixed(1)} MB`}
            </span>
            <button
              onClick={() => setPendingChatFile(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '16px', lineHeight: 1, padding: '2px 4px' }}
              title="Remove"
            >✕</button>
          </div>
        )}

        {/* Input bar */}
        <div className="chat-input-bar" style={{
          background: 'var(--card-bg)', borderTop: '1.5px solid var(--border-color)',
          padding: '12px 20px', display: 'flex', gap: '10px', alignItems: 'flex-end',
          flexShrink: 0,
        }}>
          <input ref={fileInputRef} type="file" accept="*/*" style={{ display: 'none' }} onChange={handleFileChange} />
          {showFilePicker && (
            <FilePickerModal
              onSelect={file => { setPendingChatFile(file); setShowFilePicker(false); }}
              onClose={() => setShowFilePicker(false)}
              user={user}
            />
          )}

          {/* Attach button with dropdown menu */}
          <div ref={attachMenuRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => !uploading && !attachingDoc && !pendingChatFile && setShowAttachMenu(v => !v)}
              disabled={uploading || attachingDoc || !!pendingChatFile}
              title={pendingChatFile ? 'Remove the staged file first' : 'Attach'}
              style={{
                background: (uploading || attachingDoc || pendingChatFile) ? 'var(--border-color)' : 'var(--bg-color)',
                border: 'none', borderRadius: '50%', width: '40px', height: '40px',
                fontSize: '18px', cursor: (uploading || attachingDoc || pendingChatFile) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {(uploading || attachingDoc) ? '⏳' : '📎'}
            </button>

            {showAttachMenu && (
              <div
                style={{
                  position: 'absolute', bottom: '48px', left: 0,
                  background: 'var(--card-bg)', border: '1px solid var(--border-color)',
                  borderRadius: '10px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                  zIndex: 50, minWidth: '200px', overflow: 'hidden',
                }}
              >
                {[
                  { icon: '💻', label: 'From device', action: () => { setShowAttachMenu(false); fileInputRef.current?.click(); } },
                  { icon: '📁', label: 'From Files', action: () => { setShowAttachMenu(false); setShowFilePicker(true); } },
                  { icon: '📂', label: 'From semester documents', action: openSemDocs },
                  { icon: '🔒', label: 'From personal documents', action: openPersonalDocs },
                ].map(({ icon, label, action }) => (
                  <button
                    key={label}
                    onClick={action}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      width: '100%', padding: '10px 16px', background: 'none',
                      border: 'none', cursor: 'pointer', fontSize: '13px',
                      color: 'var(--text-primary)', textAlign: 'left',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <span>{icon}</span><span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
            rows={1}
            style={{
              flex: 1, resize: 'none', border: '1.5px solid var(--border-color)',
              borderRadius: '20px', padding: '10px 16px', fontSize: '14px',
              fontFamily: 'inherit', outline: 'none', lineHeight: '1.4',
              maxHeight: '120px', overflowY: 'auto', background: 'var(--bg-color)',
              color: 'var(--text-primary)',
            }}
            onInput={(e) => {
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
          />

          <button
            onClick={sendMessage}
            disabled={(!text.trim() && !pendingChatFile) || sending || uploading}
            style={{
              background: (text.trim() || pendingChatFile) ? '#667eea' : '#e5e7eb',
              color: (text.trim() || pendingChatFile) ? 'white' : '#9ca3af',
              border: 'none', borderRadius: '50%', width: '40px', height: '40px',
              fontSize: '18px', cursor: (text.trim() || pendingChatFile) ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, transition: 'background 0.2s',
            }}
            title="Send"
          >➤</button>
        </div>
      </div>

      {/* ── Right: Files & Media panel ── */}
      {showFiles && <FilesPanel messages={messages} />}

      {/* ── Fullscreen photo overlay ── */}
      {fullscreenPhoto && (
        <div
          onClick={() => { setFullscreenPhoto(null); setRemovePhotoReason(''); }}
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

          {semester?.is_user_cr && (
            <form
              onSubmit={handleRemovePhoto}
              onClick={e => e.stopPropagation()}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '320px' }}
            >
              <textarea
                value={removePhotoReason}
                onChange={e => setRemovePhotoReason(e.target.value)}
                placeholder="Reason for removing this photo…"
                rows={2}
                disabled={removePhotoLoading}
                style={{
                  width: '100%', resize: 'none', borderRadius: '8px', border: 'none',
                  padding: '10px 12px', fontSize: '13px', fontFamily: 'inherit',
                  background: 'rgba(255,255,255,0.12)', color: 'white',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
              <button
                type="submit"
                disabled={removePhotoLoading || !removePhotoReason.trim()}
                style={{
                  background: removePhotoReason.trim() ? '#ea580c' : '#6b7280',
                  color: 'white', border: 'none', borderRadius: '8px',
                  padding: '8px 24px', fontSize: '13px', fontWeight: 600,
                  cursor: removePhotoReason.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                {removePhotoLoading ? 'Removing…' : 'Remove Photo'}
              </button>
            </form>
          )}

          <button
            onClick={() => { setFullscreenPhoto(null); setRemovePhotoReason(''); }}
            style={{
              position: 'absolute', top: '16px', right: '20px',
              background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white',
              fontSize: '24px', cursor: 'pointer', borderRadius: '50%',
              width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        </div>
      )}

      {/* ── #2 Warn modal ── */}
      {/* ── Semester documents picker modal ── */}
      {semDocsModal && (
        <div onClick={() => setSemDocsModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card-bg)', borderRadius: '14px', padding: '24px', width: '420px', maxWidth: '90vw', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--text-primary)' }}>Semester Documents</h3>
            {semDocsLoading ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Loading…</p>
            ) : semDocs.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No documents in this semester.</p>
            ) : (
              <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {semDocs.map(doc => {
                  const token = localStorage.getItem('token') || '';
                  const url = `${BACKEND_URL}/api/document/${doc.id}/download?token=${encodeURIComponent(token)}`;
                  return (
                    <button
                      key={doc.id}
                      onClick={() => attachDocToChat(url, doc.name || doc.filename || 'document')}
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', background: 'var(--bg-color)', border: '1px solid var(--border-color)', cursor: 'pointer', textAlign: 'left' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(102,126,234,0.08)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-color)'}
                    >
                      <span style={{ fontSize: '20px' }}>📄</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name || doc.filename}</div>
                        {doc.created_at && <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{new Date(doc.created_at).toLocaleDateString()}</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <button onClick={() => setSemDocsModal(false)} style={{ marginTop: '16px', alignSelf: 'flex-end', padding: '7px 18px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Personal documents picker modal (password-gated) ── */}
      {persDocsModal && (
        <div onClick={() => { setPersDocsModal(false); setPersDocsPw(''); setPersDocsPwErr(''); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card-bg)', borderRadius: '14px', padding: '24px', width: '420px', maxWidth: '90vw', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
            {persDocsModal === 'pw' ? (
              <>
                <h3 style={{ margin: '0 0 8px', fontSize: '16px', color: 'var(--text-primary)' }}>Personal Documents</h3>
                <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>Enter your account password to access your personal documents.</p>
                <div style={{ position: 'relative' }}>
                  <input
                    ref={persDocsPwRef}
                    type="password"
                    autoFocus
                    value={persDocsPw}
                    onChange={e => setPersDocsPw(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && verifyPersonalDocsPw()}
                    placeholder="Your account password"
                    style={{ padding: '10px 14px', paddingRight: '52px', borderRadius: '8px', border: `1.5px solid ${persDocsPwErr ? '#ef4444' : 'var(--border-color)'}`, background: 'var(--bg-color)', color: 'var(--text-primary)', fontSize: '14px', outline: 'none', marginBottom: '6px', width: '100%', boxSizing: 'border-box' }}
                  />
                  <button
                    type="button"
                    onPointerDown={(e) => { e.preventDefault(); if (persDocsPwRef.current) persDocsPwRef.current.type = 'text'; }}
                    onPointerUp={() => { if (persDocsPwRef.current) persDocsPwRef.current.type = 'password'; }}
                    onPointerLeave={() => { if (persDocsPwRef.current) persDocsPwRef.current.type = 'password'; }}
                    tabIndex={-1}
                    title="Hold to show password"
                    style={{ position: 'absolute', right: '8px', top: 'calc(50% - 3px)', transform: 'translateY(-50%)', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '5px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600, padding: '3px 8px', lineHeight: 1.3, userSelect: 'none' }}
                  >👁</button>
                </div>
                {persDocsPwErr && <p style={{ color: '#ef4444', fontSize: '12px', margin: '0 0 10px' }}>{persDocsPwErr}</p>}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
                  <button onClick={() => { setPersDocsModal(false); setPersDocsPw(''); }} style={{ padding: '7px 18px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
                  <button onClick={verifyPersonalDocsPw} disabled={persDocsPwChecking} style={{ padding: '7px 18px', borderRadius: '8px', border: 'none', background: '#667eea', color: 'white', fontSize: '13px', fontWeight: 600, cursor: persDocsPwChecking ? 'not-allowed' : 'pointer', opacity: persDocsPwChecking ? 0.7 : 1 }}>{persDocsPwChecking ? 'Checking…' : 'Unlock'}</button>
                </div>
              </>
            ) : (
              <>
                <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: 'var(--text-primary)' }}>Personal Documents</h3>
                {persDocs.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No personal documents uploaded.</p>
                ) : (
                  <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {persDocs.map(doc => {
                      const url = settingsAPI.getPersonalDocUrl(doc.id);
                      return (
                        <button
                          key={doc.id}
                          onClick={() => attachDocToChat(url, doc.label || doc.filename || 'document')}
                          style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', background: 'var(--bg-color)', border: '1px solid var(--border-color)', cursor: 'pointer', textAlign: 'left' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(102,126,234,0.08)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-color)'}
                        >
                          <span style={{ fontSize: '20px' }}>🔒</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.label || doc.filename}</div>
                            {doc.created_at && <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{new Date(doc.created_at).toLocaleDateString()}</div>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                <button onClick={() => { setPersDocsModal(false); setPersDocsPw(''); }} style={{ marginTop: '16px', alignSelf: 'flex-end', padding: '7px 18px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── #2 Warn modal ── */}
      {warnModal && (
        <div
          onClick={() => setWarnModal(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--card-bg)', borderRadius: '16px', padding: '28px 32px',
              width: '380px', maxWidth: '90vw',
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: '16px', color: 'var(--text-primary)' }}>
              Warn {warnModal.name}
            </h3>
            <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              The user will receive a private one-time warning popup.
            </p>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
              {[['chat', 'Chat message'], ['picture', 'Profile picture']].map(([val, label]) => (
                <button key={val} type="button" onClick={() => setWarnType(val)} style={{
                  padding: '5px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                  border: `1.5px solid ${warnType === val ? '#f59e0b' : 'var(--border-color)'}`,
                  background: warnType === val ? '#fef3c7' : 'var(--bg-color)',
                  color: warnType === val ? '#92400e' : 'var(--text-secondary)',
                }}>{label}</button>
              ))}
            </div>
            <textarea
              value={warnReason}
              onChange={e => setWarnReason(e.target.value)}
              placeholder="Reason (optional — shown only to them)"
              rows={3}
              autoFocus
              style={{
                width: '100%', resize: 'none', borderRadius: '8px',
                border: '1.5px solid var(--border-color)', padding: '10px 12px',
                fontSize: '13px', fontFamily: 'inherit', outline: 'none',
                boxSizing: 'border-box', marginBottom: '16px',
                background: 'var(--bg-color)', color: 'var(--text-primary)',
              }}
              onFocus={e => e.target.style.borderColor = '#667eea'}
              onBlur={e => e.target.style.borderColor = ''}
            />
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setWarnModal(null)}
                style={{
                  padding: '8px 20px', borderRadius: '8px', border: '1.5px solid var(--border-color)',
                  background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitWarn}
                style={{
                  padding: '8px 20px', borderRadius: '8px', border: 'none',
                  background: '#f59e0b', color: 'white', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Send Warning
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Chat;
