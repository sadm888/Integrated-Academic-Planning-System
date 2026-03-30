import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { chatAPI, semesterAPI, classroomAPI, settingsAPI, documentAPI, BACKEND_URL } from '../services/api';
import EmojiMartPicker from '@emoji-mart/react';
import emojiData from '@emoji-mart/data';
import Avatar from '../components/Avatar';
import { useSocket } from '../hooks/useSocket';
import FilePickerModal from '../components/FilePickerModal';
import { Image, Video, Music, FileText, Paperclip, Pin, PinOff, Trash2, EyeOff, Eye, AlertTriangle, Folder, FolderOpen, Lock, Clock, X, UserX, CornerUpLeft, BarChart2, Smile, Info } from 'lucide-react';
import { FileTypeIcon, sizeLabel } from '../utils/fileUtils';
import { formatTime, relativeTime, formatDate } from '../utils/timeUtils';
import { renderMentions } from '../utils/textUtils';
import { toggleReactionOptimistic } from '../utils/reactionUtils';
import RemovedNotification from '../components/RemovedNotification';
import '../styles/Classroom.css';

// ── File category helpers ────────────────────────────────────────────────────
function fileCategory(mime) {
  if (!mime) return 'documents';
  if (mime.startsWith('image/')) return 'images';
  if (mime.startsWith('video/')) return 'videos';
  if (mime.startsWith('audio/')) return 'audio';
  return 'documents';
}

const CATEGORY_META = {
  images:    { label: 'Images',    Icon: Image },
  videos:    { label: 'Videos',    Icon: Video },
  audio:     { label: 'Audio',     Icon: Music },
  documents: { label: 'Documents', Icon: FileText },
};

// ── Files & Media panel ──────────────────────────────────────────────────────
function FilesPanel({ messages }) {
  const [openSections, setOpenSections] = useState({ images: true, videos: true, audio: true, documents: true });
  const [brokenFiles, setBrokenFiles] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const grouped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const g = { images: [], videos: [], audio: [], documents: [] };
    for (const msg of messages) {
      if (!msg.file) continue;
      if (q && !msg.file.name?.toLowerCase().includes(q)) continue;
      g[fileCategory(msg.file.mime_type)].push(msg);
    }
    return g;
  }, [messages, searchQuery]);

  const total = Object.values(grouped).reduce((s, a) => s + a.length, 0);

  const toggleSection = (cat) =>
    setOpenSections(prev => ({ ...prev, [cat]: !prev[cat] }));

  return (
    <div style={{
      width: '272px', flexShrink: 0, background: 'var(--card-bg)',
      borderLeft: '1.5px solid var(--border-color)', display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid var(--border-color)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>Files & Media</span>
          <span style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 400 }}>
            {total} {total === 1 ? 'file' : 'files'}
          </span>
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search files…"
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '6px 10px', fontSize: '13px',
            background: 'var(--bg-color)', color: 'var(--text-primary)',
            border: '1px solid var(--border-color)', borderRadius: '6px', outline: 'none',
          }}
        />
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
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><meta.Icon size={14} strokeWidth={1.75} /> {meta.label} ({items.length})</span>
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

                  const isBroken = brokenFiles.has(msg.id);
                  return (
                    <div key={msg.id} style={{
                      padding: '8px 16px', display: 'flex', gap: '10px',
                      alignItems: 'flex-start', cursor: isBroken ? 'default' : 'pointer',
                      transition: 'background 0.15s',
                      opacity: isBroken ? 0.5 : 1,
                    }}
                      onMouseEnter={e => !isBroken && (e.currentTarget.style.background = 'var(--bg-color)')}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      onClick={() => !isBroken && window.open(fileUrl, '_blank')}
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
                            onError={() => setBrokenFiles(prev => new Set([...prev, msg.id]))}
                          />
                        ) : <FileTypeIcon mime={mime_type} size={20} />}
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
                        {isBroken && (
                          <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '2px' }}>File unavailable</div>
                        )}
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

// ── Emoji Picker ─────────────────────────────────────────────────────────────
const QUICK_EMOJIS = ['👍','❤️','😂','😮','😢'];

function EmojiPicker({ onSelect, isMe }) {
  const [showFull, setShowFull] = React.useState(false);

  if (!showFull) {
    return (
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{
          display: 'flex', gap: '4px', alignItems: 'center',
          background: 'var(--card-bg)',
          border: '1px solid var(--border-color)',
          borderRadius: '999px', padding: '4px 8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
      >
        {QUICK_EMOJIS.map(emoji => (
          <button
            key={emoji}
            onClick={() => onSelect(emoji)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '2px 3px', borderRadius: '4px', lineHeight: 1 }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.3)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >{emoji}</button>
        ))}
        <button
          onClick={() => setShowFull(true)}
          title="More emojis"
          style={{
            background: 'var(--bg-color)', border: '1px solid var(--border-color)',
            borderRadius: '50%', width: '26px', height: '26px',
            cursor: 'pointer', fontSize: '14px', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary)', flexShrink: 0,
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--border-color)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-color)'}
        >+</button>
      </div>
    );
  }

  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 4px)',
        [isMe ? 'right' : 'left']: 0,
        zIndex: 30,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        borderRadius: '14px',
        overflow: 'hidden',
      }}
    >
      <EmojiMartPicker
        data={emojiData}
        onEmojiSelect={e => onSelect(e.native)}
        theme="auto"
        previewPosition="none"
        skinTonePosition="none"
        maxFrequentRows={2}
        perLine={9}
      />
    </div>
  );
}

// ── Reaction Details Modal ───────────────────────────────────────────────────
function ReactionDetailsModal({ msg, classroomMembers, myId, onClose }) {
  const [activeTab, setActiveTab] = React.useState('all');
  if (!msg) return null;

  const reactions = (msg.reactions || []).filter(r => r.user_ids?.length > 0);
  if (reactions.length === 0) return null;

  // Resolve user info from classroomMembers
  const resolveUser = (uid) => {
    if (uid === myId) return { id: uid, username: 'you', name: 'You', isSelf: true };
    const m = classroomMembers.find(m => m.id === uid);
    return { id: uid, username: m?.username, profile_picture: m?.profile_picture, name: m ? (m.fullName || m.full_name || m.username) : uid, isSelf: false };
  };

  // Flat list: { user, emoji }
  const allRows = reactions.flatMap(r =>
    r.user_ids.map(uid => ({ user: resolveUser(uid), emoji: r.emoji }))
  );

  const filtered = activeTab === 'all'
    ? allRows
    : allRows.filter(row => row.emoji === activeTab);

  // Sort: self first, then by name
  filtered.sort((a, b) => (b.user.isSelf ? 1 : 0) - (a.user.isSelf ? 1 : 0) || a.user.name.localeCompare(b.user.name));

  const totalCount = reactions.reduce((s, r) => s + r.user_ids.length, 0);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        zIndex: 1300,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '480px',
          background: 'var(--card-bg)',
          borderRadius: '20px 20px 0 0',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.2)',
          maxHeight: '60vh', display: 'flex', flexDirection: 'column',
          animation: 'slideUpSheet 0.22s ease',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
          <div style={{ width: '36px', height: '4px', borderRadius: '2px', background: 'var(--border-color)' }} />
        </div>

        {/* Emoji tabs */}
        <div style={{
          display: 'flex', gap: '4px', padding: '4px 16px 12px',
          overflowX: 'auto', flexShrink: 0,
          borderBottom: '1px solid var(--border-color)',
        }}>
          {/* "All" tab */}
          <button
            onClick={() => setActiveTab('all')}
            style={{
              background: activeTab === 'all' ? 'var(--primary-color)' : 'var(--bg-color)',
              color: activeTab === 'all' ? 'white' : 'var(--text-primary)',
              border: `1.5px solid ${activeTab === 'all' ? 'var(--primary-color)' : 'var(--border-color)'}`,
              borderRadius: '999px', padding: '4px 14px',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              whiteSpace: 'nowrap', flexShrink: 0,
              transition: 'all 0.15s',
            }}
          >
            All {totalCount}
          </button>
          {reactions.map(r => (
            <button
              key={r.emoji}
              onClick={() => setActiveTab(r.emoji)}
              style={{
                background: activeTab === r.emoji ? 'rgba(102,126,234,0.12)' : 'var(--bg-color)',
                color: 'var(--text-primary)',
                border: `1.5px solid ${activeTab === r.emoji ? 'var(--primary-color)' : 'var(--border-color)'}`,
                borderRadius: '999px', padding: '4px 12px',
                fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                whiteSpace: 'nowrap', flexShrink: 0,
                transition: 'all 0.15s',
              }}
            >
              {r.emoji}
              <span style={{ fontSize: '12px', color: activeTab === r.emoji ? 'var(--primary-color)' : 'var(--text-secondary)' }}>
                {r.user_ids.length}
              </span>
            </button>
          ))}
        </div>

        {/* User list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 20px' }}>
          {filtered.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>No reactions yet.</p>
          ) : (
            filtered.map((row, i) => (
              <div
                key={`${row.user.id}-${row.emoji}-${i}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '10px 0',
                  borderBottom: i < filtered.length - 1 ? '1px solid var(--border-color)' : 'none',
                  background: row.user.isSelf ? 'rgba(102,126,234,0.04)' : 'transparent',
                  borderRadius: '8px', paddingLeft: row.user.isSelf ? '8px' : 0,
                }}
              >
                {/* Avatar */}
                <Avatar user={row.user} size={38} />
                {/* Name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    fontSize: '14px', fontWeight: row.user.isSelf ? 700 : 500,
                    color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
                  }}>
                    {row.user.name}
                  </span>
                </div>
                {/* Emoji badge — only shown in "All" tab */}
                {activeTab === 'all' && (
                  <span style={{
                    fontSize: '20px', flexShrink: 0,
                    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.15))',
                  }}>{row.emoji}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Message Info Modal ───────────────────────────────────────────────────────
function MessageInfoModal({ msg, readReceipts, classroomMembers, myId, onClose }) {
  if (!msg) return null;

  const msgTime = new Date(msg.created_at);

  // All members except the current viewer
  const others = classroomMembers.filter(m => m.id !== myId);

  // Seen: last_read_at >= message.created_at
  const seenList = others
    .filter(m => readReceipts[m.id] && new Date(readReceipts[m.id]) >= msgTime)
    .map(m => ({ ...m, readAt: readReceipts[m.id] }))
    .sort((a, b) => new Date(b.readAt) - new Date(a.readAt));

  // Not seen yet: everyone else
  const notSeenList = others.filter(
    m => !readReceipts[m.id] || new Date(readReceipts[m.id]) < msgTime
  );

  const MemberRow = ({ member, readAt }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '9px 0', borderBottom: '1px solid var(--border-color)',
    }}>
      <Avatar user={member} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {member.fullName || member.full_name || member.username}
        </div>
        {member.username && (member.fullName || member.full_name) && (
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>@{member.username}</div>
        )}
      </div>
      {readAt && (
        <span style={{ fontSize: '11px', color: '#9ca3af', flexShrink: 0 }}>
          {formatTime(readAt)}
        </span>
      )}
    </div>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', justifyContent: 'flex-end', zIndex: 1200,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '340px', maxWidth: '90vw', height: '100%',
          background: 'var(--card-bg)', display: 'flex', flexDirection: 'column',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
          animation: 'slideInRight 0.22s ease',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1.5px solid var(--border-color)',
          display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', padding: 0 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>Message Info</span>
        </div>

        {/* Message preview */}
        <div style={{
          margin: '16px 20px', padding: '12px 14px',
          background: 'var(--bg-color)', borderRadius: '12px',
          borderLeft: '3px solid var(--primary-color)', flexShrink: 0,
        }}>
          {msg.deleted_for_everyone ? (
            <span style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: '13px' }}>This message was deleted</span>
          ) : (
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '80px', overflow: 'hidden' }}>
              {msg.text || (msg.file ? `📎 ${msg.file.name || 'File'}` : '')}
            </p>
          )}
          <span style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px', display: 'block' }}>
            Sent at {formatTime(msg.created_at)}
          </span>
        </div>

        {/* Scrollable lists */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px' }}>

          {/* Seen by */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{
              fontSize: '12px', fontWeight: 700, color: 'var(--primary-color)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Seen by ({seenList.length})
            </div>
            {seenList.length === 0 ? (
              <p style={{ fontSize: '12px', color: '#9ca3af', margin: '10px 0 0', fontStyle: 'italic' }}>No one has read this message yet.</p>
            ) : (
              seenList.map(m => <MemberRow key={m.id} member={m} readAt={m.readAt} />)
            )}
          </div>

          {/* Not seen yet */}
          {notSeenList.length > 0 && (
            <div>
              <div style={{
                fontSize: '12px', fontWeight: 700, color: '#9ca3af',
                textTransform: 'uppercase', letterSpacing: '0.06em',
                marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px',
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Not seen yet ({notSeenList.length})
              </div>
              {notSeenList.map(m => <MemberRow key={m.id} member={m} readAt={null} />)}
            </div>
          )}
        </div>
      </div>
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
  const [deleteMenu, setDeleteMenu]       = useState(null); // { msgId, x, y }
  const [replyingTo, setReplyingTo]       = useState(null); // { id, text, username, full_name, has_file }
  const [onlineUsers, setOnlineUsers]     = useState(new Set()); // user_ids currently online
  const [onlineLoaded, setOnlineLoaded]   = useState(false);

  // Typing indicator
  const [typingUsers, setTypingUsers]     = useState(new Map()); // user_id → {username, full_name}
  const typingTimeoutsRef                 = useRef({});          // user_id → timeout id
  const lastTypingEmitRef                 = useRef(0);           // throttle

  // Search
  const [searchOpen, setSearchOpen]       = useState(false);
  const [searchQuery, setSearchQuery]     = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef                    = useRef(null);

  // Poll creation
  const [pollModal, setPollModal]         = useState(false);
  const [pollQuestion, setPollQuestion]   = useState('');
  const [pollOptions, setPollOptions]     = useState(['', '']);
  const [pollCreating, setPollCreating]   = useState(false);

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
  const [kickTarget, setKickTarget]             = useState(null); // { id, name }
  const [kickReason, setKickReason]             = useState('');
  const [kickLoading, setKickLoading]           = useState(false);
  const [removedNotification, setRemovedNotification] = useState(null);

  // @mention autocomplete
  const [classroomMembers, setClassroomMembers]   = useState([]);
  const [mentionDropdown, setMentionDropdown]     = useState({ show: false, query: '', filtered: [] });
  const [mentionActiveIdx, setMentionActiveIdx]   = useState(-1);
  const mentionInsertRef                          = useRef(null); // { start, end }
  const [mentionNotif, setMentionNotif]           = useState(null); // { from }
  const mentionNotifTimerRef                      = useRef(null);

  // Read receipts
  const [readReceipts, setReadReceipts]           = useState({}); // user_id → last_read_at

  // Reaction picker
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState(null);

  // Input bar emoji picker
  const [showInputEmoji, setShowInputEmoji] = useState(false);

  // Reaction tooltip: { msgId, emoji } — which pill is hovered
  const [reactionTooltip, setReactionTooltip] = useState(null);

  // Reaction details modal
  const [reactionDetailsMsg, setReactionDetailsMsg] = useState(null);

  // Message info panel
  const [messageInfoTarget, setMessageInfoTarget] = useState(null); // message object

  const textareaRef           = useRef(null);
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
    classroomAPI.getDetails(classroomId)
      .then(res => setClassroomMembers(res.data.classroom?.members || []))
      .catch(() => {});
  }, [semesterId, classroomId, navigate]);

  // ── Load initial history ───────────────────────────────────────────────────
  useEffect(() => {
    // Reset online state immediately so stale data from previous semester isn't shown
    setOnlineUsers(new Set());
    setOnlineLoaded(false);
    Promise.all([
      chatAPI.getMessages(semesterId, 50),
      chatAPI.markRead(semesterId).catch(() => {}),
      chatAPI.getOnlineMembers(semesterId).catch(() => ({ data: { online_user_ids: [] } })),
      chatAPI.getReadReceipts(semesterId).catch(() => ({ data: { receipts: {} } })),
    ]).then(([msgRes, , onlineRes, receiptsRes]) => {
      const msgs = msgRes.data.messages || [];
      setMessages(msgs);
      setHasMore(msgs.length === 50);
      setOnlineUsers(new Set(onlineRes.data.online_user_ids || []));
      setOnlineLoaded(true);
      setReadReceipts(receiptsRes.data.receipts || {});
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
      setPinnedMessages(prev => {
        const next = prev.filter(m => m.id !== message_id);
        setCurrentPinIdx(i => (next.length === 0 ? 0 : i % next.length));
        return next;
      });
    } else {
      setPinnedMessages([]);
      setCurrentPinIdx(0);
    }
  }, []);

  const handleTombstoned = useCallback(({ message_id }) => {
    setMessages(prev => prev.map(m =>
      m.id === message_id ? { ...m, deleted_for_everyone: true, text: null, file: null } : m
    ));
  }, []);

  const handleUserOnline = useCallback(({ user_id }) => {
    setOnlineUsers(prev => new Set([...prev, user_id]));
  }, []);

  const handleUserOffline = useCallback(({ user_id }) => {
    setOnlineUsers(prev => { const next = new Set(prev); next.delete(user_id); return next; });
  }, []);

  const handleUserTyping = useCallback(({ user_id, username, full_name }) => {
    setTypingUsers(prev => new Map(prev).set(user_id, { username, full_name }));
    // Clear after 3 s of no new typing event from this user
    if (typingTimeoutsRef.current[user_id]) clearTimeout(typingTimeoutsRef.current[user_id]);
    typingTimeoutsRef.current[user_id] = setTimeout(() => {
      setTypingUsers(prev => { const next = new Map(prev); next.delete(user_id); return next; });
      delete typingTimeoutsRef.current[user_id];
    }, 3000);
  }, []);

  // Clear all typing timeouts on unmount to prevent setState on unmounted component
  useEffect(() => {
    return () => {
      Object.values(typingTimeoutsRef.current).forEach(t => clearTimeout(t));
      typingTimeoutsRef.current = {};
    };
  }, []);

  const handlePollUpdated = useCallback((updated) => {
    setMessages(prev => prev.map(m => m.id === updated.id ? updated : m));
  }, []);

  const handleMention = useCallback(({ mentioned_by }) => {
    if (mentionNotifTimerRef.current) clearTimeout(mentionNotifTimerRef.current);
    setMentionNotif({ from: mentioned_by });
    mentionNotifTimerRef.current = setTimeout(() => setMentionNotif(null), 5000);
  }, []);

  const handleReactionUpdated = useCallback(({ id, reactions }) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, reactions } : m));
    // Keep reaction details modal in sync if it's open for this message
    setReactionDetailsMsg(prev => prev?.id === id ? { ...prev, reactions } : prev);
  }, []);

  const handleReadReceipt = useCallback(({ user_id, last_read_at }) => {
    setReadReceipts(prev => ({ ...prev, [user_id]: last_read_at }));
  }, []);

  // #7 + #16 — useSocket hook (replaces manual socket setup, exposes connected)
  const { socketRef, connected } = useSocket(semesterId, {
    onMessage:  handleMessage,
    onDeleted:  handleDeleted,
    onWarn:     handleWarnSocket,
    onPinned:     handlePinned,
    onUnpinned:   handleUnpinned,
    onTombstoned: handleTombstoned,
    onMemberRemoved: (data) => setRemovedNotification(data),
    onUserOnline:  handleUserOnline,
    onUserOffline: handleUserOffline,
    onUserTyping:  handleUserTyping,
    onPollUpdated: handlePollUpdated,
    onMention:         handleMention,
    onReactionUpdated: handleReactionUpdated,
    onReadReceipt:     handleReadReceipt,
  });

  // ── Search ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchOpen) { setSearchResults([]); return; }
    if (searchQuery.trim().length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await chatAPI.searchMessages(semesterId, searchQuery.trim());
        setSearchResults(res.data.messages || []);
      } catch (err) { setSearchResults([]); setError(err.response?.data?.error || 'Search failed'); }
      finally { setSearchLoading(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [searchQuery, searchOpen, semesterId]);

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
    else { setSearchQuery(''); setSearchResults([]); }
  }, [searchOpen]);

  // ── Poll creation ──────────────────────────────────────────────────────────
  const submitPoll = async () => {
    const opts = pollOptions.map(o => o.trim()).filter(Boolean);
    if (!pollQuestion.trim() || opts.length < 2) return;
    setPollCreating(true);
    try {
      await chatAPI.createPoll(semesterId, pollQuestion.trim(), opts);
      setPollModal(false);
      setPollQuestion('');
      setPollOptions(['', '']);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create poll');
    } finally { setPollCreating(false); }
  };

  // ── Close input emoji picker on outside click ─────────────────────────────
  useEffect(() => {
    if (!showInputEmoji) return;
    const handler = () => setShowInputEmoji(false);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showInputEmoji]);

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

  // ── Close delete context menu on outside click ─────────────────────────────
  useEffect(() => {
    if (!deleteMenu) return;
    const handler = () => setDeleteMenu(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [deleteMenu]);

  // ── Close reaction picker on outside click ─────────────────────────────────
  useEffect(() => {
    if (!reactionPickerMsgId) return;
    const handler = () => setReactionPickerMsgId(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [reactionPickerMsgId]);

  const handleDeleteWithMode = async (msgId, mode) => {
    setDeleteMenu(null);
    if (mode === 'for_everyone') {
      if (!window.confirm('Delete this message for everyone? This cannot be undone.')) return;
    }
    try {
      await chatAPI.deleteMessage(semesterId, msgId, mode);
      if (mode === 'for_me') {
        setMessages(prev => prev.filter(m => m.id !== msgId));
      }
      // 'for_everyone' is handled by the socket 'message_tombstoned' event
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete message');
    }
  };

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
    } else {
      setError('Original message not loaded — click "Load earlier messages" to find it.');
      setTimeout(() => setError(''), 3000);
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
      const replyId = replyingTo?.id || null;
      setPendingChatFile(null);
      setText('');
      setReplyingTo(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploading(true);
      setError('');
      try {
        await chatAPI.uploadFile(semesterId, file, caption || undefined, replyId);
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
      reply_to: replyingTo ? { ...replyingTo } : undefined,
    };
    setMessages(prev => [...prev, optimistic]);

    socketRef.current.emit('send_message', {
      semester_id: semesterId,
      text: trimmed,
      local_id: localId,
      ...(replyingTo ? { reply_to_id: replyingTo.id } : {}),
    });
    setText('');
    setReplyingTo(null);
    setSending(false);
  }, [text, pendingChatFile, semesterId, sending, user, socketRef, replyingTo]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    } else if (e.key === 'Escape' && replyingTo) {
      setReplyingTo(null);
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

  // ── @mention insertion ─────────────────────────────────────────────────────
  const insertMention = (member) => {
    if (!mentionInsertRef.current) return;
    const { start, end } = mentionInsertRef.current;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const newText = before + '@' + member.username + ' ' + after;
    setText(newText);
    setMentionDropdown({ show: false, query: '', filtered: [] });
    setMentionActiveIdx(-1);
    mentionInsertRef.current = null;
    setTimeout(() => {
      if (textareaRef.current) {
        const pos = before.length + member.username.length + 2;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(pos, pos);
      }
    }, 10);
  };

  // ── Kick ───────────────────────────────────────────────────────────────────
  const handleKickUser = (targetUserId, targetName) => {
    setKickTarget({ id: targetUserId, name: targetName });
    setKickReason('');
  };

  const handleConfirmKick = async () => {
    if (!kickTarget) return;
    setKickLoading(true);
    try {
      await classroomAPI.removeMember(classroomId, kickTarget.id, kickReason.trim());
      setKickTarget(null);
      setKickReason('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove user');
    } finally {
      setKickLoading(false);
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

    if (msg.deleted_for_everyone) {
      return (
        <span style={{ color: isMe ? 'rgba(255,255,255,0.55)' : '#9ca3af', fontStyle: 'italic', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <EyeOff size={13} strokeWidth={1.75} /> This message was deleted
        </span>
      );
    }

    if (msg.type === 'poll' && msg.poll) {
      const poll = msg.poll;
      const totalVotes = poll.options.reduce((s, o) => s + (o.voters?.length || 0), 0);
      const userVotedIdx = poll.options.findIndex(o => o.voters?.includes(user?.id));
      const isCrOrMod = semester?.is_user_cr || semester?.is_user_mod;
      return (
        <div style={{ minWidth: '220px' }}>
          <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '10px', color: isMe ? 'white' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <BarChart2 size={15} strokeWidth={2} style={{ flexShrink: 0 }} />{poll.question}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {poll.options.map((opt, idx) => {
              const count = opt.voters?.length || 0;
              const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
              const voted = idx === userVotedIdx;
              return (
                <button
                  key={idx}
                  onClick={() => !poll.is_closed && chatAPI.votePoll(semesterId, msg.id, idx).catch(err => setError(err.response?.data?.error || 'Failed to vote'))}
                  disabled={poll.is_closed}
                  style={{
                    position: 'relative', overflow: 'hidden',
                    padding: '7px 12px', borderRadius: '8px', border: 'none',
                    background: isMe
                      ? (voted ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)')
                      : (voted ? 'var(--primary-subtle)' : 'var(--bg-color)'),
                    color: isMe ? 'white' : 'var(--text-primary)',
                    cursor: poll.is_closed ? 'default' : 'pointer',
                    textAlign: 'left', fontSize: '13px', fontWeight: voted ? 700 : 400,
                    outline: voted ? `2px solid ${isMe ? 'rgba(255,255,255,0.7)' : 'var(--primary-color)'}` : 'none',
                    transition: 'background 0.15s',
                  }}
                >
                  {/* Progress fill */}
                  <span style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: `${pct}%`, background: isMe ? 'rgba(255,255,255,0.1)' : 'var(--primary-faint)',
                    transition: 'width 0.3s', pointerEvents: 'none',
                  }} />
                  <span style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                    <span>{opt.text}</span>
                    <span style={{ fontSize: '11px', opacity: 0.75 }}>{count > 0 ? `${pct}%` : ''}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px', fontSize: '11px', opacity: 0.7, color: isMe ? 'white' : 'var(--text-secondary)' }}>
            <span>{totalVotes} vote{totalVotes !== 1 ? 's' : ''}{poll.is_closed ? ' · Closed' : ''}</span>
            {isCrOrMod && !poll.is_closed && (
              <button
                onClick={() => chatAPI.closePoll(semesterId, msg.id).catch(err => setError(err.response?.data?.error || 'Failed to close poll'))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', color: isMe ? 'rgba(255,255,255,0.8)' : 'var(--danger-color)', fontWeight: 600, padding: 0 }}
              >Close poll</button>
            )}
          </div>
        </div>
      );
    }

    if (!msg.file) {
      return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderMentions(msg.text, user?.username)}</span>;
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
            onError={(e) => { e.target.style.display = 'none'; e.target.onclick = null; }}
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
          <FileTypeIcon mime={mime_type} size={18} />
          <span style={{ wordBreak: 'break-all' }}>{name}{size ? ` · ${sizeLabel(size)}` : ''}</span>
        </a>
      </div>
    );
  };

  // ── Periodically refresh read receipts (fallback if socket event missed) ──
  useEffect(() => {
    if (!semesterId) return;
    const interval = setInterval(() => {
      chatAPI.getReadReceipts(semesterId)
        .then(res => {
          const fresh = res.data.receipts || {};
          setReadReceipts(prev => {
            const prevKeys = Object.keys(prev);
            const freshKeys = Object.keys(fresh);
            if (prevKeys.length === freshKeys.length && freshKeys.every(k => prev[k] === fresh[k])) return prev;
            return fresh;
          });
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [semesterId]);

  // ── Read receipt: who has seen the last own message ──────────────────────
  const lastOwnMsg = useMemo(() =>
    [...messages].reverse().find(m => m.user_id === user?.id && !m.pending),
  [messages, user?.id]);

  const seenBy = useMemo(() => {
    if (!lastOwnMsg) return [];
    return Object.entries(readReceipts)
      .filter(([uid, at]) => uid !== user?.id && new Date(at) >= new Date(lastOwnMsg.created_at))
      .map(([uid]) => classroomMembers.find(m => m.id === uid))
      .filter(Boolean);
  }, [lastOwnMsg, readReceipts, classroomMembers, user?.id]);

  // Group messages by date dividers
  const grouped = useMemo(() => {
    const result = [];
    let lastDate = null;
    messages.forEach((msg, idx) => {
      const dateLabel = formatDate(msg.created_at);
      if (dateLabel !== lastDate) {
        result.push({ type: 'divider', label: dateLabel, key: `d-${dateLabel}-${idx}` });
        lastDate = dateLabel;
      }
      result.push({ type: 'message', msg, key: msg.id });
    });
    return result;
  }, [messages]);

  const fileCount = messages.filter(m => m.file).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)', background: 'var(--bg-color)' }}>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

      {/* ── Left: Chat column ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Header */}
        <div className="chat-header" style={{
          background: 'var(--card-bg)', borderBottom: '1.5px solid var(--border-color)',
          padding: '14px 24px', display: 'flex', alignItems: 'center',
          gap: '16px', flexShrink: 0,
        }}>
          <Link
            to={`/classroom/${classroomId}/semester/${semesterId}`}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              fontSize: '12px', color: 'var(--text-secondary)', textDecoration: 'none',
              fontWeight: 600, flexShrink: 0,
              padding: '5px 10px', borderRadius: '8px',
              background: 'var(--bg-color)', border: '1px solid var(--border-color)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--border-color)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-color)'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Dashboard
          </Link>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '17px', color: 'var(--text-primary)' }}>
              {semester?.name || 'Chat'}
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af' }}>Semester chat</div>
          </div>

          {/* Inline search autocomplete */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {searchOpen ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--bg-color)', border: '1.5px solid var(--primary-color)', borderRadius: '20px', padding: '4px 10px 4px 12px', minWidth: '200px' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search messages…"
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: '13px', color: 'var(--text-primary)', minWidth: 0 }}
                />
                <button
                  onClick={() => searchQuery ? setSearchQuery('') : setSearchOpen(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: 0, flexShrink: 0 }}
                >
                  <X size={14} strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSearchOpen(true)}
                title="Search messages"
                style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-color)', color: 'var(--primary-color)', border: 'none', borderRadius: '8px', padding: '7px 12px', cursor: 'pointer', flexShrink: 0 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </button>
            )}
            {/* Autocomplete dropdown */}
            {searchOpen && (searchLoading || searchResults.length > 0 || (searchQuery.trim().length >= 2 && !searchLoading)) && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: '320px',
                background: 'var(--card-bg)', border: '1px solid var(--border-color)',
                borderRadius: '12px', boxShadow: 'var(--shadow-lg)', zIndex: 200,
                overflow: 'hidden',
              }}>
                {searchLoading && (
                  <div style={{ padding: '10px 14px', fontSize: '12px', color: 'var(--text-secondary)' }}>Searching…</div>
                )}
                {!searchLoading && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                  <div style={{ padding: '10px 14px', fontSize: '12px', color: 'var(--text-muted)' }}>No results found.</div>
                )}
                {searchResults.length > 0 && (
                  <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
                    {searchResults.map(msg => (
                      <button
                        key={msg.id}
                        onClick={() => { scrollToMessageById(msg.id); setSearchOpen(false); }}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '8px 14px', borderRadius: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%', borderBottom: '1px solid var(--border-color)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <span style={{ fontSize: '11px', color: 'var(--primary-color)', fontWeight: 600 }}>{msg.full_name || msg.username}</span>
                        <span style={{ fontSize: '13px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{msg.text}</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{formatTime(msg.created_at)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => setShowFiles(v => !v)}
            title={showFiles ? 'Hide files panel' : 'Show files & media'}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: showFiles ? 'var(--primary-color)' : 'var(--bg-color)',
              color: showFiles ? 'var(--text-on-primary)' : 'var(--primary-color)',
              border: 'none', borderRadius: '8px',
              padding: '7px 14px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              flexShrink: 0,
            }}
          >
            <Folder size={14} strokeWidth={1.75} style={{ marginRight: '4px' }} /> Files{fileCount > 0 && <span style={{
              background: showFiles ? 'rgba(255,255,255,0.3)' : 'var(--primary-color)',
              color: 'var(--text-on-primary)', borderRadius: '999px', padding: '1px 7px', fontSize: '11px',
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
            <AlertTriangle size={14} strokeWidth={1.75} /> Reconnecting… messages may be delayed.
          </div>
        )}

        {error && (
          <div style={{
            background: '#fef2f2', color: '#dc2626', padding: '8px 24px',
            fontSize: '13px', borderBottom: '1px solid #fecaca', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span>{error}</span>
            <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: '0 4px', display: 'flex', alignItems: 'center' }}><X size={15} strokeWidth={2} /></button>
          </div>
        )}

        {/* Private warning banner */}
        {warnBanner && (
          <div style={{
            background: '#fffbeb', borderBottom: '2px solid #f59e0b',
            padding: '12px 24px', flexShrink: 0,
            display: 'flex', alignItems: 'flex-start', gap: '12px',
          }}>
            <AlertTriangle size={20} strokeWidth={1.75} style={{ flexShrink: 0, color: '#92400e' }} />
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
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#92400e', flexShrink: 0, display: 'flex', alignItems: 'center' }}
            ><X size={16} strokeWidth={2} /></button>
          </div>
        )}

        {/* @mention notification banner */}
        {mentionNotif && (
          <div style={{
            background: 'var(--primary-color)', color: 'white',
            padding: '8px 20px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: '13px',
          }}>
            <span>📣 <strong>{mentionNotif.from}</strong> mentioned you</span>
            <button onClick={() => setMentionNotif(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center' }}>
              <X size={14} strokeWidth={2} />
            </button>
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
              <Pin size={14} strokeWidth={1.75} style={{ flexShrink: 0, color: '#667eea' }} />
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
                  {pm.text || (pm.file ? pm.file.name || 'File' : 'File')}
                </p>
              </div>
              {(semester?.is_user_cr || semester?.is_user_mod) && (
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
                    <Avatar user={avatarUser} size={32} showOnline={onlineLoaded ? onlineUsers.has(msg.user_id) : null} dotBg='var(--bg-color)' />
                  </div>
                )}

                <div style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: isMe ? 'flex-end' : 'flex-start',
                  maxWidth: '65%',
                }}>
                  {!isMe && (
                    <span style={{ fontSize: '12px', color: '#667eea', fontWeight: 600, marginBottom: '3px', marginLeft: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      {msg.full_name || msg.username}
                      {semester?.cr_ids?.includes(msg.user_id) && (
                        <span style={{
                          fontSize: '10px', fontWeight: 700, color: '#fff',
                          background: '#7c3aed', borderRadius: '4px',
                          padding: '1px 5px', letterSpacing: '0.03em',
                          lineHeight: 1.4,
                        }}>CR</span>
                      )}
                    </span>
                  )}
                  <div style={{ position: 'relative' }}>
                    {/* Moderation / pin buttons on hover */}
                    {!msg.pending && hoveredMsgId === msg.id && (
                      <div
                        onMouseEnter={() => setHoveredMsgId(msg.id)}
                        style={{
                          position: 'absolute',
                          top: '50%', transform: 'translateY(-50%)',
                          [isMe ? 'right' : 'left']: 'calc(100% + 6px)',
                          display: 'flex', gap: '2px',
                          background: 'var(--card-bg)', borderRadius: '6px', padding: '4px 8px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.15)', border: '1px solid var(--border-color)',
                          zIndex: 10, whiteSpace: 'nowrap',
                        }}>
                        {/* React button */}
                        {!msg.deleted_for_everyone && (
                          <button
                            onClick={() => setReactionPickerMsgId(prev => prev === msg.id ? null : msg.id)}
                            title="React"
                            style={{ background: reactionPickerMsgId === msg.id ? 'var(--bg-color)' : 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px 5px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                            onMouseLeave={e => { if (reactionPickerMsgId !== msg.id) e.currentTarget.style.background = 'none'; }}
                          ><Smile size={14} strokeWidth={1.75} /></button>
                        )}
                        {/* Info button — only own messages (you can only see who read YOUR messages) */}
                        {!msg.pending && isMe && msg.type !== 'system' && (
                          <button
                            onClick={() => setMessageInfoTarget(msg)}
                            title="Message info"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px 5px', borderRadius: '4px', display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          ><Info size={14} strokeWidth={1.75} /></button>
                        )}
                        {/* Reply button — all messages */}
                        {!msg.deleted_for_everyone && (
                          <button
                            onClick={() => setReplyingTo({ id: msg.id, text: msg.text, username: msg.username, full_name: msg.full_name, has_file: !!msg.file })}
                            title="Reply"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px 5px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          ><CornerUpLeft size={14} strokeWidth={1.75} /></button>
                        )}
                        {/* Copy — all non-deleted messages */}
                        {!msg.deleted_for_everyone && (msg.text || msg.file?.name) && (
                          <button
                            onClick={() => navigator.clipboard.writeText(msg.text || msg.file?.name || '')}
                            title="Copy text"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px 5px', borderRadius: '4px', display: 'flex', alignItems: 'center', color: 'var(--text-secondary)', fontWeight: 700 }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          ><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                        )}
                        {/* #4 — Unpin button if this message is currently pinned */}
                        {isCrOrMod && pinnedMessages.some(p => p.id === msg.id) && (
                          <button
                            onClick={() => handleUnpin(msg.id)}
                            title="Unpin message"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', borderRadius: '4px', display: 'flex', alignItems: 'center', color: '#667eea' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          ><PinOff size={14} strokeWidth={1.75} /></button>
                        )}
                        {/* Pin button (CR/mod only, not already pinned, max 3) */}
                        {isCrOrMod && !pinnedMessages.some(p => p.id === msg.id) && pinnedMessages.length < 3 && (
                          <button
                            onClick={() => handlePin(msg.id)}
                            title="Pin message"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px 5px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          ><Pin size={14} strokeWidth={1.75} /></button>
                        )}
                        {/* #2 — Warn button (CR/mod, other users only) */}
                        {isCrOrMod && !isMe && (
                          <button
                            onClick={() => openWarnModal(msg.user_id, msg.full_name || msg.username, msg.id)}
                            title="Warn user"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', padding: '2px 5px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fef3c7'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          ><AlertTriangle size={14} strokeWidth={1.75} color="#d97706" /></button>
                        )}
                        {/* Kick button (CR only) */}
                        {semester?.is_user_cr && !isMe && (
                          <button
                            onClick={() => handleKickUser(msg.user_id, msg.full_name || msg.username)}
                            title="Remove from classroom"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', padding: '2px 5px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          ><EyeOff size={14} strokeWidth={1.75} color="#dc2626" /></button>
                        )}
                        {/* Delete menu (own message) */}
                        {isMe && !msg.deleted_for_everyone && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteMenu({ msgId: msg.id, x: e.clientX, y: e.clientY });
                            }}
                            title="Delete message"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px 5px', borderRadius: '4px', color: '#9ca3af', display: 'flex', alignItems: 'center' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          ><Trash2 size={14} strokeWidth={1.75} /></button>
                        )}
                        {/* Delete for me (any member on others' messages) */}
                        {!isMe && !isCrOrMod && !msg.deleted_for_everyone && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteWithMode(msg.id, 'for_me');
                            }}
                            title="Hide message"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px 5px', borderRadius: '4px', color: '#9ca3af', display: 'flex', alignItems: 'center' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          ><Trash2 size={14} strokeWidth={1.75} /></button>
                        )}
                        {/* Delete button (CR/mod on others' messages) */}
                        {isCrOrMod && !isMe && !msg.deleted_for_everyone && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteWithMode(msg.id, '');
                            }}
                            title="Delete message (CR)"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px 5px', borderRadius: '4px', color: '#9ca3af', display: 'flex', alignItems: 'center' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          ><Trash2 size={14} strokeWidth={1.75} /></button>
                        )}
                      </div>
                    )}
                    <div style={{
                      padding: msg.reply_to ? '8px 14px 10px' : '10px 14px',
                      borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                      background: isMe
                        ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                        : 'var(--card-bg)',
                      color: isMe ? 'white' : 'var(--text-primary)',
                      boxShadow: isMe
                        ? '0 3px 12px rgba(102,126,234,0.4)'
                        : '0 1px 3px rgba(0,0,0,0.08)',
                      fontSize: '14px', lineHeight: '1.5',
                    }}>
                      {msg.reply_to && (
                        <div
                          onClick={() => scrollToMessageById(msg.reply_to.id)}
                          style={{
                            cursor: 'pointer',
                            marginBottom: '8px',
                            padding: '6px 10px',
                            borderRadius: '8px',
                            borderLeft: `3px solid ${isMe ? 'rgba(255,255,255,0.7)' : '#667eea'}`,
                            background: isMe ? 'rgba(0,0,0,0.2)' : 'var(--bg-color)',
                          }}
                        >
                          <div style={{ fontSize: '11px', fontWeight: 700, color: isMe ? 'rgba(255,255,255,0.95)' : '#667eea', marginBottom: '2px' }}>
                            {msg.reply_to.full_name || msg.reply_to.username}
                          </div>
                          <div style={{
                            fontSize: '12px',
                            color: isMe ? 'rgba(255,255,255,0.8)' : 'var(--text-secondary)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px',
                          }}>
                            {msg.reply_to.text || (msg.reply_to.has_file ? '📎 File' : 'Message')}
                          </div>
                        </div>
                      )}
                      {renderContent(msg)}
                    </div>

                    {/* Emoji reaction picker */}
                    {reactionPickerMsgId === msg.id && (
                      <div style={{
                        position: 'absolute',
                        bottom: 'calc(100% + 4px)',
                        [isMe ? 'right' : 'left']: 0,
                        zIndex: 20,
                      }}>
                        <EmojiPicker
                          isMe={isMe}
                          onSelect={emoji => {
                            setReactionPickerMsgId(null);
                            setMessages(prev => prev.map(m =>
                              m.id === msg.id ? toggleReactionOptimistic(m, emoji, user?.id) : m
                            ));
                            chatAPI.reactToMessage(semesterId, msg.id, emoji).catch(err => {
                              setError(err.response?.data?.error || 'Failed to react');
                              chatAPI.getMessages(semesterId, 50).then(r => setMessages(r.data.messages || [])).catch(() => {});
                            });
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Reactions display — WhatsApp style, max 4 visible + overflow */}
                  {msg.reactions?.some(r => r.user_ids?.length > 0) && (() => {
                    const activeReactions = msg.reactions.filter(r => r.user_ids?.length > 0);
                    const MAX_VISIBLE = 4;
                    const visible = activeReactions.slice(0, MAX_VISIBLE);
                    const overflow = activeReactions.slice(MAX_VISIBLE);
                    const overflowCount = overflow.reduce((s, r) => s + r.user_ids.length, 0);
                    return (
                    <div
                      style={{
                        display: 'flex', flexWrap: 'wrap', gap: '4px',
                        marginTop: '-6px', paddingBottom: '4px',
                        position: 'relative', zIndex: 1,
                      }}
                    >
                      {visible.map(r => {
                        const reacted = r.user_ids?.includes(user?.id);
                        const isTooltipOpen = reactionTooltip?.msgId === msg.id && reactionTooltip?.emoji === r.emoji;

                        // Resolve names for tooltip
                        const reactorNames = r.user_ids.map(uid => {
                          if (uid === user?.id) return 'You';
                          const m = classroomMembers.find(m => m.id === uid);
                          return m ? (m.fullName || m.full_name || m.username) : uid;
                        });

                        return (
                          <div key={r.emoji} style={{ position: 'relative' }}>
                            {/* Who-reacted tooltip */}
                            {isTooltipOpen && (
                              <div style={{
                                position: 'absolute',
                                bottom: 'calc(100% + 6px)',
                                [isMe ? 'right' : 'left']: 0,
                                background: 'rgba(30,30,30,0.93)',
                                color: 'white',
                                borderRadius: '8px',
                                padding: '6px 10px',
                                fontSize: '12px',
                                whiteSpace: 'nowrap',
                                zIndex: 50,
                                pointerEvents: 'none',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                                maxWidth: '200px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}>
                                <span style={{ fontSize: '15px', marginRight: '6px' }}>{r.emoji}</span>
                                {reactorNames.slice(0, 5).join(', ')}
                                {reactorNames.length > 5 && ` +${reactorNames.length - 5}`}
                              </div>
                            )}
                            <button
                              onClick={() => {
                                setReactionTooltip(null);
                                setMessages(prev => prev.map(m =>
                                  m.id === msg.id ? toggleReactionOptimistic(m, r.emoji, user?.id) : m
                                ));
                                chatAPI.reactToMessage(semesterId, msg.id, r.emoji).catch(err => {
                                  setError(err.response?.data?.error || 'Failed to react');
                                  chatAPI.getMessages(semesterId, 50).then(res => setMessages(res.data.messages || [])).catch(() => {});
                                });
                              }}
                              onMouseEnter={e => {
                                e.currentTarget.style.transform = 'scale(1.1)';
                                setReactionTooltip({ msgId: msg.id, emoji: r.emoji });
                              }}
                              onMouseLeave={e => {
                                e.currentTarget.style.transform = 'scale(1)';
                                setReactionTooltip(null);
                              }}
                              style={{
                                background: reacted ? 'rgba(102,126,234,0.12)' : 'var(--card-bg)',
                                border: `1.5px solid ${reacted ? 'var(--primary-color)' : 'var(--border-color)'}`,
                                borderRadius: '12px', padding: '2px 7px',
                                cursor: 'pointer', fontSize: '14px',
                                display: 'inline-flex', alignItems: 'center', gap: '3px',
                                boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                                color: 'var(--text-primary)',
                                transition: 'transform 0.1s',
                              }}
                            >
                              {r.emoji}
                              <span style={{ fontSize: '12px', fontWeight: 700, color: reacted ? 'var(--primary-color)' : 'var(--text-secondary)' }}>
                                {r.user_ids.length}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                      {/* Overflow chip: "+N more" → opens details sheet */}
                      {overflow.length > 0 && (
                        <button
                          onClick={() => setReactionDetailsMsg(msg)}
                          title="See all reactions"
                          style={{
                            background: 'var(--bg-color)', border: '1.5px solid var(--border-color)',
                            borderRadius: '12px', padding: '2px 8px',
                            cursor: 'pointer', fontSize: '12px', fontWeight: 700,
                            color: 'var(--text-secondary)',
                            display: 'inline-flex', alignItems: 'center', gap: '2px',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-color)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                        >
                          {overflow.slice(0, 2).map(r => r.emoji).join('')}
                          <span>+{overflowCount}</span>
                        </button>
                      )}
                      {/* Always show details button when there are reactions */}
                      <button
                        onClick={() => setReactionDetailsMsg(msg)}
                        title="See all reactions"
                        style={{
                          background: 'none', border: 'none',
                          padding: '2px 4px', cursor: 'pointer',
                          fontSize: '13px', color: 'var(--text-secondary)',
                          display: 'inline-flex', alignItems: 'center',
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
                      >···</button>
                    </div>
                    );
                  })()}

                  <span
                    title={msg.pending ? undefined : formatTime(msg.created_at)}
                    style={{ fontSize: '11px', color: '#9ca3af', marginTop: '3px', marginLeft: '4px', marginRight: '4px', cursor: 'default' }}
                  >
                    {msg.pending ? 'Sending…' : relativeTime(msg.created_at)}
                  </span>
                  {/* Seen by — only on last own message */}
                  {isMe && msg.id === lastOwnMsg?.id && seenBy.length > 0 && (
                    <span style={{ fontSize: '11px', color: 'var(--primary-color)', marginTop: '1px', fontStyle: 'italic' }}>
                      Seen by {seenBy.slice(0, 2).map(m => m.fullName || m.full_name || m.username).join(', ')}
                      {seenBy.length > 2 ? ` +${seenBy.length - 2}` : ''}
                    </span>
                  )}
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

        {/* Typing indicator */}
        {typingUsers.size > 0 && (() => {
          const typers = [...typingUsers.values()];
          const names = typers.map(t => t.full_name || t.username);
          const label = names.length === 1
            ? `${names[0]} is typing…`
            : names.length === 2
              ? `${names[0]} and ${names[1]} are typing…`
              : `${names[0]} and ${names.length - 1} others are typing…`;
          return (
            <div style={{
              padding: '4px 24px 4px', flexShrink: 0,
              fontSize: '12px', color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <span style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                {[0,1,2].map(i => (
                  <span key={i} style={{
                    width: '5px', height: '5px', borderRadius: '50%',
                    background: 'var(--primary-color)',
                    animation: `typingDot 1.2s ${i * 0.2}s infinite`,
                    display: 'inline-block',
                  }} />
                ))}
              </span>
              {label}
            </div>
          );
        })()}

        {/* Reply bar */}
        {replyingTo && (
          <div style={{
            padding: '8px 20px', background: 'var(--card-bg)',
            borderTop: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0,
          }}>
            <CornerUpLeft size={16} strokeWidth={1.75} style={{ flexShrink: 0, color: '#667eea' }} />
            <div style={{ flex: 1, minWidth: 0, borderLeft: '3px solid #667eea', paddingLeft: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#667eea' }}>
                {replyingTo.full_name || replyingTo.username}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {replyingTo.text || (replyingTo.has_file ? '📎 File' : 'Message')}
              </div>
            </div>
            <button
              onClick={() => setReplyingTo(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', flexShrink: 0 }}
              title="Cancel reply"
            ><X size={16} strokeWidth={1.75} /></button>
          </div>
        )}

        {/* Staged file preview bar */}
        {pendingChatFile && (
          <div style={{
            padding: '8px 20px', background: 'var(--card-bg)', borderTop: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0,
          }}>
            <Paperclip size={18} strokeWidth={1.75} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
            <span style={{ flex: 1, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
              {pendingChatFile.name}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0 }}>
              {sizeLabel(pendingChatFile.size)}
            </span>
            <button
              onClick={() => setPendingChatFile(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '16px', lineHeight: 1, padding: '2px 4px', display: 'flex', alignItems: 'center' }}
              title="Remove"
            ><X size={16} strokeWidth={1.75} /></button>
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
              {(uploading || attachingDoc) ? <Clock size={18} strokeWidth={1.75} /> : <Paperclip size={18} strokeWidth={1.75} />}
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
                  { icon: <Paperclip size={14} strokeWidth={1.75} />, label: 'From device', action: () => { setShowAttachMenu(false); fileInputRef.current?.click(); } },
                  { icon: <Folder size={14} strokeWidth={1.75} />, label: 'From Files', action: () => { setShowAttachMenu(false); setShowFilePicker(true); } },
                  { icon: <FolderOpen size={14} strokeWidth={1.75} />, label: 'From semester documents', action: openSemDocs },
                  { icon: <Lock size={14} strokeWidth={1.75} />, label: 'From personal documents', action: openPersonalDocs },
                  ...(semester?.is_user_cr || semester?.is_user_mod ? [{ icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12h6M12 9v6"/></svg>, label: 'Create poll', action: () => { setShowAttachMenu(false); setPollModal(true); } }] : []),
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

          {/* Emoji button for input */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setShowInputEmoji(v => !v)}
              title="Insert emoji"
              style={{
                background: showInputEmoji ? 'var(--primary-color)' : 'var(--bg-color)',
                color: showInputEmoji ? 'white' : 'var(--text-secondary)',
                border: 'none', borderRadius: '50%', width: '40px', height: '40px',
                fontSize: '18px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Smile size={18} strokeWidth={1.75} />
            </button>
            {showInputEmoji && (
              <div
                onMouseDown={e => e.stopPropagation()}
                style={{ position: 'absolute', bottom: '48px', left: 0, zIndex: 200, borderRadius: '14px', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}
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
                      setText(newText);
                      setTimeout(() => {
                        ta.focus();
                        ta.setSelectionRange(start + emoji.length, start + emoji.length);
                      }, 10);
                    } else {
                      setText(prev => prev + emoji);
                    }
                  }}
                  theme="auto"
                  previewPosition="none"
                  skinTonePosition="none"
                  maxFrequentRows={2}
                  perLine={9}
                />
              </div>
            )}
          </div>

          <div style={{ flex: 1, position: 'relative' }}>
            {/* @mention autocomplete dropdown */}
            {mentionDropdown.show && mentionDropdown.filtered.length > 0 && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0,
                background: 'var(--card-bg)', border: '1px solid var(--border-color)',
                borderRadius: '10px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                zIndex: 100, overflow: 'hidden',
              }}>
                {mentionDropdown.filtered.map((member, idx) => {
                  const isActive = idx === mentionActiveIdx;
                  return (
                    <button
                      key={member.id}
                      onMouseDown={e => { e.preventDefault(); insertMention(member); }}
                      onMouseEnter={() => setMentionActiveIdx(idx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        width: '100%', padding: '8px 14px',
                        background: isActive ? 'var(--bg-color)' : 'none',
                        border: 'none', cursor: 'pointer',
                        textAlign: 'left',
                        borderBottom: idx < mentionDropdown.filtered.length - 1 ? '1px solid var(--border-color)' : 'none',
                        borderLeft: isActive ? '3px solid var(--primary-color)' : '3px solid transparent',
                        transition: 'background 0.1s',
                      }}
                    >
                      <Avatar user={member} size={26} />
                      <div>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--primary-color)' }}>@{member.username}</span>
                        {(member.fullName || member.full_name) && (
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginLeft: '6px' }}>{member.fullName || member.full_name}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
                <div style={{ padding: '4px 14px', fontSize: '11px', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)', background: 'var(--bg-color)' }}>
                  ↑↓ navigate · Enter or Tab to select · Esc to dismiss
                </div>
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => {
                const val = e.target.value;
                setText(val);
                // Throttled typing emit — at most once every 2 s
                const now = Date.now();
                if (socketRef.current && now - lastTypingEmitRef.current > 2000) {
                  lastTypingEmitRef.current = now;
                  socketRef.current.emit('typing', { semester_id: semesterId });
                }
                // @mention detection
                const pos = e.target.selectionStart;
                const before = val.slice(0, pos);
                const match = before.match(/@([A-Za-z0-9_]*)$/);
                if (match) {
                  const query = match[1].toLowerCase();
                  const filtered = classroomMembers
                    .filter(m => m.id !== user?.id)
                    .filter(m =>
                      (m.username || '').toLowerCase().startsWith(query) ||
                      (m.fullName || m.full_name || '').toLowerCase().includes(query)
                    )
                    .slice(0, 6);
                  mentionInsertRef.current = { start: pos - match[0].length, end: pos };
                  setMentionDropdown({ show: filtered.length > 0, query, filtered });
                  setMentionActiveIdx(filtered.length > 0 ? 0 : -1);
                } else {
                  setMentionDropdown({ show: false, query: '', filtered: [] });
                  setMentionActiveIdx(-1);
                  mentionInsertRef.current = null;
                }
              }}
              onKeyDown={e => {
                if (mentionDropdown.show) {
                  const count = mentionDropdown.filtered.length;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setMentionActiveIdx(i => (i + 1) % count);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setMentionActiveIdx(i => (i - 1 + count) % count);
                    return;
                  }
                  if ((e.key === 'Enter' || e.key === 'Tab') && mentionActiveIdx >= 0) {
                    e.preventDefault();
                    insertMention(mentionDropdown.filtered[mentionActiveIdx]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    setMentionDropdown({ show: false, query: '', filtered: [] });
                    setMentionActiveIdx(-1);
                    mentionInsertRef.current = null;
                    return;
                  }
                }
                handleKeyDown(e);
              }}
              onBlur={() => setTimeout(() => { setMentionDropdown({ show: false, query: '', filtered: [] }); setMentionActiveIdx(-1); }, 150)}
              placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
              rows={1}
              style={{
                width: '100%', boxSizing: 'border-box',
                resize: 'none', border: '1.5px solid var(--border-color)',
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
          </div>

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
          ><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
        </div>
      </div>

      {/* ── Delete context menu ── */}
      {deleteMenu && (
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: Math.min(deleteMenu.y, window.innerHeight - 100),
            left: Math.min(deleteMenu.x, window.innerWidth - 180),
            background: 'var(--card-bg)', borderRadius: '10px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.2)', border: '1px solid var(--border-color)',
            zIndex: 500, overflow: 'hidden', minWidth: '160px',
          }}
        >
          {[
            { label: 'Delete for me', icon: <Eye size={14} strokeWidth={1.75} />, mode: 'for_me', color: 'var(--text-primary)' },
            { label: 'Delete for everyone', icon: <Trash2 size={14} strokeWidth={1.75} />, mode: 'for_everyone', color: '#dc2626' },
          ].map(({ label, icon, mode, color }) => (
            <button
              key={mode}
              onMouseDown={() => handleDeleteWithMode(deleteMenu.msgId, mode)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                width: '100%', padding: '11px 16px', background: 'none',
                border: 'none', cursor: 'pointer', fontSize: '13px',
                color, textAlign: 'left', fontWeight: 500,
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <span>{icon}</span><span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Poll creation modal ── */}
      {pollModal && (
        <div className="modal-overlay" onClick={() => !pollCreating && setPollModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}><BarChart2 size={18} strokeWidth={2} />Create Poll</h3>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Question</label>
              <input
                value={pollQuestion}
                onChange={e => setPollQuestion(e.target.value)}
                placeholder="Ask something…"
                maxLength={200}
                autoFocus
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '8px 12px',
                  border: '1.5px solid var(--border-color)', borderRadius: '8px',
                  fontSize: '14px', background: 'var(--bg-color)', color: 'var(--text-primary)', outline: 'none',
                }}
                onFocus={e => e.target.style.borderColor = 'var(--primary-color)'}
                onBlur={e => e.target.style.borderColor = 'var(--border-color)'}
              />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>Options</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {pollOptions.map((opt, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input
                      value={opt}
                      onChange={e => setPollOptions(prev => prev.map((o, i) => i === idx ? e.target.value : o))}
                      placeholder={`Option ${idx + 1}`}
                      maxLength={100}
                      style={{
                        flex: 1, padding: '7px 12px', border: '1.5px solid var(--border-color)',
                        borderRadius: '8px', fontSize: '13px', background: 'var(--bg-color)',
                        color: 'var(--text-primary)', outline: 'none',
                      }}
                      onFocus={e => e.target.style.borderColor = 'var(--primary-color)'}
                      onBlur={e => e.target.style.borderColor = 'var(--border-color)'}
                    />
                    {pollOptions.length > 2 && (
                      <button
                        onClick={() => setPollOptions(prev => prev.filter((_, i) => i !== idx))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', display: 'flex', alignItems: 'center' }}
                      ><X size={16} strokeWidth={2} /></button>
                    )}
                  </div>
                ))}
              </div>
              {pollOptions.length < 6 && (
                <button
                  onClick={() => setPollOptions(prev => [...prev, ''])}
                  style={{ marginTop: '8px', background: 'none', border: '1.5px dashed var(--border-color)', borderRadius: '8px', padding: '6px 14px', fontSize: '12px', color: 'var(--primary-color)', cursor: 'pointer', width: '100%' }}
                >+ Add option</button>
              )}
            </div>
            <div className="modal-buttons" style={{ marginTop: '16px' }}>
              <button type="button" onClick={() => setPollModal(false)} disabled={pollCreating}>Cancel</button>
              <button
                type="submit"
                onClick={submitPoll}
                disabled={pollCreating || !pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2}
              >{pollCreating ? 'Creating…' : 'Create Poll'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Right: Files & Media panel ── */}
      {showFiles && <FilesPanel messages={messages} />}

      {/* ── Reaction Details modal ── */}
      {reactionDetailsMsg && (
        <ReactionDetailsModal
          msg={reactionDetailsMsg}
          classroomMembers={classroomMembers}
          myId={user?.id}
          onClose={() => setReactionDetailsMsg(null)}
        />
      )}

      {/* ── Message Info panel ── */}
      {messageInfoTarget && (
        <MessageInfoModal
          msg={messageInfoTarget}
          readReceipts={readReceipts}
          classroomMembers={classroomMembers}
          myId={user?.id}
          onClose={() => setMessageInfoTarget(null)}
        />
      )}

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
              cursor: 'pointer', borderRadius: '50%',
              width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          ><X size={20} strokeWidth={2} /></button>
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
                      <FileText size={20} strokeWidth={1.75} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name || doc.filename}</div>
                        {doc.created_at && <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{formatDate(doc.created_at)}</div>}
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
                    style={{ position: 'absolute', right: '8px', top: 'calc(50% - 3px)', transform: 'translateY(-50%)', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '5px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600, padding: '3px 8px', lineHeight: 1.3, userSelect: 'none', display: 'flex', alignItems: 'center' }}
                  ><Eye size={13} strokeWidth={1.75} /></button>
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
                          <Lock size={20} strokeWidth={1.75} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.label || doc.filename}</div>
                            {doc.created_at && <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{formatDate(doc.created_at)}</div>}
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

      {/* Kick member modal */}
      {kickTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setKickTarget(null)}>
          <div style={{ background: 'var(--card-bg)', borderRadius: '12px', padding: '24px', maxWidth: '420px', width: '90%' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <UserX size={18} strokeWidth={2} style={{ color: '#dc2626' }} />
              Remove {kickTarget.name}?
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: '0 0 14px' }}>
              They will lose access immediately and be notified with your reason.
            </p>
            <textarea
              value={kickReason}
              onChange={e => setKickReason(e.target.value)}
              placeholder="Reason for removal (optional but recommended)…"
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', borderRadius: '8px',
                border: '1.5px solid var(--border-color)', padding: '10px 12px',
                fontSize: '13px', background: 'var(--card-bg)', color: 'var(--text-primary)',
                resize: 'vertical', outline: 'none', marginBottom: '16px',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setKickTarget(null)} disabled={kickLoading}
                style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleConfirmKick} disabled={kickLoading}
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#dc2626', color: 'white', fontSize: '13px', fontWeight: 600, cursor: kickLoading ? 'not-allowed' : 'pointer', opacity: kickLoading ? 0.6 : 1 }}>
                {kickLoading ? 'Removing…' : 'Remove Member'}
              </button>
            </div>
          </div>
        </div>
      )}

      <RemovedNotification data={removedNotification} />
    </div>
    </div>
  );
}

export default Chat;
