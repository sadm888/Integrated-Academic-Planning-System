import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  BookOpen, Upload, Trash2, MessageSquare, FileText,
  Zap, Layers, ChevronRight, ChevronLeft, RotateCw,
  CheckCircle, XCircle, AlertCircle, Loader, Send,
  RefreshCw, Save, Download, Brain, GitBranch,
  FlaskConical, Clock, ClipboardList, CalendarDays,
  BarChart2, FolderOpen, Import, Timer, X, Plus,
  Paperclip, SmilePlus, Image, Search, ListChecks, Lock, Folder, Copy, Check,
} from 'lucide-react';
import EmojiMartPicker from '@emoji-mart/react';
import emojiData from '@emoji-mart/data';
import { aiAPI } from '../services/api';
import FilePickerModal from '../components/FilePickerModal';
import '../styles/Classroom.css';

// ── Design tokens ──────────────────────────────────────────────────────────────

const c = {
  bg:        'var(--card-bg)',
  bgAlt:     'var(--bg-color, #f9fafb)',
  border:    'var(--border-color)',
  textPri:   'var(--text-primary)',
  textSec:   'var(--text-secondary)',
  accent:    '#667eea',
  success:   '#10b981',
  successBg: '#d1fae5',
  successFg: '#065f46',
  warning:   '#f59e0b',
  warningBg: '#fef3c7',
  warningFg: '#92400e',
  danger:    '#ef4444',
  dangerBg:  '#fee2e2',
  dangerFg:  '#dc2626',
  info:      '#0369a1',
  infoBg:    '#f0f9ff',
  infoBorder:'#bae6fd',
};

const card = {
  background: c.bg, borderRadius: '14px',
  border: `1px solid ${c.border}`, padding: '20px 24px',
  boxShadow: 'var(--shadow)',
};

const btn = (variant = 'primary', extra = {}) => ({
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  padding: '8px 16px', borderRadius: '8px', fontSize: '13px',
  fontWeight: 600, cursor: 'pointer', border: 'none',
  transition: 'opacity 0.15s',
  ...(variant === 'primary' && { background: c.accent, color: 'white' }),
  ...(variant === 'danger'  && { background: '#fee2e2', color: '#dc2626' }),
  ...(variant === 'ghost'   && { background: c.bg, color: c.textSec, border: `1px solid ${c.border}` }),
  ...(variant === 'success' && { background: '#d1fae5', color: '#065f46' }),
  ...extra,
});

const sel  = { padding: '8px 12px', borderRadius: '8px', fontSize: '13px', border: `1.5px solid ${c.border}`, background: c.bg, color: c.textPri, cursor: 'pointer' };
const lab  = { fontSize: '13px', fontWeight: 600, color: c.textSec, display: 'block' };
const inp  = { marginTop: '6px', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', border: `1.5px solid ${c.border}`, background: c.bg, color: c.textPri, display: 'block' };
const spin = { animation: 'spin 1s linear infinite' };

const TABS = [
  { key: 'summarize',   label: 'Summarize',    Icon: BookOpen     },
  { key: 'chat',        label: 'ChatBot',      Icon: MessageSquare},
  { key: 'quiz',        label: 'Quiz',         Icon: Zap          },
  { key: 'flashcards',  label: 'Flashcards',   Icon: Layers       },
  { key: 'mindmap',     label: 'Mind Map',     Icon: GitBranch    },
  { key: 'formulas',    label: 'Formulas',     Icon: FlaskConical },
  { key: 'pastpapers',  label: 'Order of Importance', Icon: Clock        },
  { key: 'mocktest',    label: 'Mock Test',    Icon: Timer        },
  { key: 'planner',     label: 'Planner',      Icon: CalendarDays },
  { key: 'performance', label: 'Performance',  Icon: BarChart2    },
];

const QUIZ_TYPES = { mcq: 'MCQ', multi_mcq: 'Multi-MCQ', true_false: 'True/False', fill_blank: 'Fill Blank', short: 'Short' };

function MsgBubble({ msg, accent, textPri, textSec }) {
  const [copied,   setCopied]   = useState(false);
  const [expanded, setExpanded] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(msg.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const isAI = msg.role === 'assistant';
  return (
    <>
      {expanded && (
        <div
          onClick={() => setExpanded(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <button onClick={() => setExpanded(false)} style={{ position: 'absolute', top: '16px', right: '20px', background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '28px', lineHeight: 1 }}>✕</button>
          <img src={msg.attachment.content} alt={msg.attachment.name} style={{ maxWidth: '90vw', maxHeight: '88vh', borderRadius: '10px', objectFit: 'contain' }} onClick={e => e.stopPropagation()} />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: isAI ? 'flex-start' : 'flex-end' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, color: textSec, marginBottom: '4px', paddingLeft: '4px', paddingRight: '4px' }}>
          {isAI ? 'AI' : 'You'}
        </span>
        <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', alignItems: isAI ? 'flex-start' : 'flex-end', gap: '6px' }}>
          {msg.attachment?.type === 'image' && (
            <img
              src={msg.attachment.content}
              alt={msg.attachment.name}
              onClick={() => setExpanded(true)}
              style={{ maxWidth: '220px', maxHeight: '160px', borderRadius: '12px', objectFit: 'cover', cursor: 'zoom-in', border: `1px solid ${accent}40` }}
            />
          )}
          {msg.fileLabel && (
            <div style={{ fontSize: '12px', color: isAI ? textSec : 'rgba(255,255,255,0.8)', fontStyle: 'italic' }}>
              {msg.fileLabel}
            </div>
          )}
          {msg.text && (
            <div style={{ position: 'relative' }}>
              <div style={{
                padding: '12px 16px', fontSize: '13.5px', lineHeight: '1.7',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                borderRadius: isAI ? '18px 18px 18px 4px' : '18px 18px 4px 18px',
                ...(isAI
                  ? { background: `${accent}18`, color: textPri, border: `1px solid ${accent}30`, paddingRight: '40px' }
                  : { background: accent, color: '#fff' }),
              }}>{msg.text}</div>
              {isAI && (
                <button onClick={copy} title="Copy" style={{
                  position: 'absolute', top: '8px', right: '8px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: copied ? '#22c55e' : textSec, padding: '2px', borderRadius: '4px',
                  display: 'flex', alignItems: 'center',
                }}>
                  {copied ? <Check size={13} strokeWidth={2.5} /> : <Copy size={13} strokeWidth={1.75} />}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

// ══════════════════════════════════════════════════════════════════════════════
// Root
// ══════════════════════════════════════════════════════════════════════════════

export default function StudyTools() {
  const [pdfs,        setPdfs]       = useState([]);
  const [selected,    setSelected]   = useState(() => sessionStorage.getItem('st_pdf') || null);
  const [activeTab,   setActiveTab]  = useState(() => sessionStorage.getItem('st_tab') || 'summarize');
  const [loading,     setLoading]    = useState(true);
  const [showImport,  setShowImport] = useState(false);
  const [weakTopics,  setWeakTopics] = useState([]);

  const pickPdf = (id) => { setSelected(id); sessionStorage.setItem('st_pdf', id ?? ''); setWeakTopics([]); };
  const pickTab = (t)  => { setActiveTab(t);  sessionStorage.setItem('st_tab', t); };

  const loadPdfs = useCallback(() => {
    setLoading(true);
    aiAPI.listPdfs()
      .then(r => setPdfs(r.data.pdfs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadPdfs(); }, [loadPdfs]);

  const selectedPdf = pdfs.find(p => p.pdf_id === selected);

  return (
    <div className="classroom-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <Brain size={28} style={{ color: c.accent }} />
        <h1 style={{ margin: 0 }}>AI Study Tools</h1>
      </div>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
        {/* ── Left: PDF sidebar ── */}
        <div style={{ width: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <PdfSidebar
            pdfs={pdfs}
            selected={selected}
            loading={loading}
            onSelect={id => { pickPdf(id); pickTab('summarize'); }}
            onDeleted={id => { setPdfs(ps => ps.filter(p => p.pdf_id !== id)); if (selected === id) pickPdf(null); }}
            onUploaded={loadPdfs}
            showImport={showImport}
            setShowImport={setShowImport}
          />
        </div>

        {/* ── Centre: tab content ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selected ? (
            <div style={{ ...card, textAlign: 'center', padding: '60px 20px', color: c.textSec }}>
              <Brain size={44} strokeWidth={1.25} style={{ opacity: 0.2, marginBottom: '14px' }} />
              <p style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: c.textPri }}>Select a document to get started</p>
              <p style={{ margin: '6px 0 0', fontSize: '13px' }}>Upload a PDF or import from your platform files.</p>
            </div>
          ) : (
            <>
              {/* Active PDF banner */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', padding: '10px 14px', background: `${c.accent}11`, borderRadius: '10px', border: `1px solid ${c.accent}33` }}>
                <FileText size={16} style={{ color: c.accent, flexShrink: 0 }} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: c.textPri, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedPdf?.filename ?? selected}
                </span>
                {selectedPdf && !selectedPdf.indexed && (
                  <span style={{ fontSize: '11px', color: '#f59e0b', fontWeight: 600, flexShrink: 0 }}>
                    <Loader size={11} style={{ ...spin, verticalAlign: 'middle', marginRight: '3px' }} />Indexing…
                  </span>
                )}
              </div>

              {/* Tab content — all mounted, hidden via display:none so state persists */}
              <div key={selected}>
                <div style={{ display: activeTab === 'summarize'   ? 'block' : 'none' }}><SummarizeTab    pdfId={selected} /></div>
                <div style={{ display: activeTab === 'chat'        ? 'block' : 'none' }}><ChatTab         pdfId={selected} /></div>
                <div style={{ display: activeTab === 'quiz'        ? 'block' : 'none' }}><QuizTab         pdfId={selected} onWeakTopics={topics => { setWeakTopics(topics); }} goToPlanner={() => pickTab('planner')} /></div>
                <div style={{ display: activeTab === 'flashcards'  ? 'block' : 'none' }}><FlashcardTab    pdfId={selected} /></div>
                <div style={{ display: activeTab === 'mindmap'     ? 'block' : 'none' }}><MindmapTab      pdfId={selected} /></div>
                <div style={{ display: activeTab === 'formulas'    ? 'block' : 'none' }}><FormulaSheetTab pdfId={selected} /></div>
                <div style={{ display: activeTab === 'pastpapers'  ? 'block' : 'none' }}><PastPapersTab   pdfId={selected} /></div>
                <div style={{ display: activeTab === 'mocktest'    ? 'block' : 'none' }}><MockTab         pdfId={selected} /></div>
                <div style={{ display: activeTab === 'planner'     ? 'block' : 'none' }}><StudyPlannerTab pdfId={selected} prefillTopics={weakTopics} /></div>
                <div style={{ display: activeTab === 'performance' ? 'block' : 'none' }}><PerformanceTab  pdfId={selected} /></div>
              </div>
            </>
          )}
        </div>

        {/* ── Right: vertical tab nav ── */}
        {selected && (
          <div style={{ width: '176px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {TABS.map(({ key, label, Icon }) => {
              const active = activeTab === key;
              return (
                <button key={key} onClick={() => pickTab(key)} title={label} style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '9px 12px', borderRadius: '9px', fontSize: '12px',
                  fontWeight: 600, cursor: 'pointer', textAlign: 'left', width: '100%',
                  overflow: 'hidden',
                  background: active ? `${c.accent}18` : 'transparent',
                  color:      active ? c.accent : c.textSec,
                  border:     active ? `1px solid ${c.accent}44` : '1px solid transparent',
                  transition: 'all 0.15s',
                }}>
                  <Icon size={13} strokeWidth={active ? 2.2 : 1.75} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PDF Sidebar
// ══════════════════════════════════════════════════════════════════════════════

function PdfSidebar({ pdfs, selected, loading, onSelect, onDeleted, onUploaded, showImport, setShowImport }) {
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState('');
  const fileRef = useRef();

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    setUploading(true); setError('');
    try {
      await aiAPI.uploadPdf(fd);
      onUploaded();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file?.name.toLowerCase().endsWith('.pdf')) {
      const dt = new DataTransfer(); dt.items.add(file);
      fileRef.current.files = dt.files;
      handleUpload({ target: fileRef.current });
    }
  };

  const handleDelete = async (pdfId, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this PDF and all its indexes?')) return;
    try {
      await aiAPI.deletePdf(pdfId);
      onDeleted(pdfId);
    } catch { setError('Delete failed'); }
  };

  const handlePickedFile = async (file) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Only PDF files are supported'); return; }
    const fd = new FormData();
    fd.append('file', file);
    setUploading(true); setError('');
    try { await aiAPI.uploadPdf(fd); onUploaded(); }
    catch (err) { setError(err.response?.data?.error ?? 'Upload failed'); }
    finally { setUploading(false); }
  };

  return (
    <>
      {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}

      {/* Upload zone */}
      <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={handleUpload} />
      <div
        onClick={() => !uploading && fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${c.border}`, borderRadius: '10px', padding: '16px',
          textAlign: 'center', cursor: uploading ? 'default' : 'pointer',
          background: c.bg,
        }}
      >
        {uploading
          ? <><Loader size={20} style={{ color: c.accent, ...spin, marginBottom: '6px' }} /><p style={{ margin: 0, fontSize: '12px', color: c.textSec }}>Uploading…</p></>
          : <><Upload size={20} style={{ color: c.accent, marginBottom: '6px' }} /><p style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: c.textPri }}>Upload PDF</p><p style={{ margin: '2px 0 0', fontSize: '11px', color: c.textSec }}>or drag & drop · max 20 MB</p></>
        }
      </div>

      <button onClick={() => setShowImport(true)} style={btn('ghost', { width: '100%', justifyContent: 'center', fontSize: '12px' })}>
        <FolderOpen size={13} /> Import from Files
      </button>

      {showImport && (
        <FilePickerModal
          onSelect={handlePickedFile}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* PDF list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {loading ? (
          <p style={{ fontSize: '12px', color: c.textSec, textAlign: 'center' }}>Loading…</p>
        ) : pdfs.length === 0 ? (
          <p style={{ fontSize: '12px', color: c.textSec, textAlign: 'center', padding: '12px 0' }}>No documents yet.</p>
        ) : pdfs.map(pdf => (
          <div
            key={pdf.pdf_id}
            onClick={() => onSelect(pdf.pdf_id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '10px 12px', borderRadius: '10px', cursor: 'pointer',
              background: selected === pdf.pdf_id ? `${c.accent}15` : c.bg,
              border: `1px solid ${selected === pdf.pdf_id ? c.accent + '44' : c.border}`,
              transition: 'background 0.15s',
            }}
          >
            <FileText size={15} style={{ color: c.accent, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: c.textPri, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pdf.filename}
              </div>
              <div style={{ fontSize: '10px', color: c.textSec }}>
                {fmtBytes(pdf.size)} · {pdf.indexed
                  ? <span style={{ color: '#10b981' }}><CheckCircle size={11} style={{ verticalAlign: 'middle', marginRight: '2px' }} />Ready</span>
                  : <span style={{ color: '#f59e0b' }}><Loader size={11} style={{ ...spin, verticalAlign: 'middle', marginRight: '2px' }} />Indexing</span>
                }
              </div>
            </div>
            <button
              onClick={e => handleDelete(pdf.pdf_id, e)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', padding: '2px', flexShrink: 0, display: 'flex', alignItems: 'center' }}
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Summarize
// ══════════════════════════════════════════════════════════════════════════════

function stripMarkdownSymbols(str) {
  return str.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/`/g, '');
}

function renderMarkdown(text) {
  return text.split('\n').map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return <div key={i} style={{ height: '6px' }} />;

    // heading: ## / # prefix
    if (/^#{1,3}\s/.test(trimmed)) {
      const content = stripMarkdownSymbols(trimmed.replace(/^#{1,3}\s+/, ''));
      return <div key={i} style={{ fontWeight: 700, fontSize: '14px', color: c.accent, marginTop: i === 0 ? 0 : '16px', marginBottom: '4px' }}>{content}</div>;
    }
    // ALL-CAPS heading (topic name)
    if (/^[A-Z][A-Z0-9\s\/\-:]{2,}$/.test(trimmed)) {
      return <div key={i} style={{ fontWeight: 700, fontSize: '14px', color: c.accent, marginTop: i === 0 ? 0 : '16px', marginBottom: '4px' }}>{trimmed}</div>;
    }
    // any bullet: optional whitespace + (* or - or •) + space
    const bulletMatch = line.match(/^(\s*)[\*\-•]\s+(.*)/);
    if (bulletMatch) {
      const indent = bulletMatch[1].length > 0;
      const content = stripMarkdownSymbols(bulletMatch[2]);
      return (
        <div key={i} style={{ display: 'flex', gap: '8px', padding: '2px 0', paddingLeft: indent ? '20px' : '0' }}>
          <span style={{ color: c.accent, flexShrink: 0 }}>{indent ? '◦' : '·'}</span>
          <span>{content}</span>
        </div>
      );
    }
    // normal line
    return <div key={i} style={{ padding: '1px 0' }}>{stripMarkdownSymbols(trimmed)}</div>;
  });
}

function SummarizeTab({ pdfId }) {
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [copied,  setCopied]  = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(summary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const run = async () => {
    setLoading(true); setError(''); setSummary('');
    try {
      const r = await aiAPI.summarize(pdfId);
      setSummary(r.data.summary);
    } catch (err) { setError(err.response?.data?.error ?? 'Failed to summarise'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}
      <div style={card}>
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: c.textSec }}>
          Generates a topic-by-topic summary of the document.
        </p>
        <button onClick={run} disabled={loading} style={btn('primary', { opacity: loading ? 0.6 : 1 })}>
          {loading ? <><Loader size={14} style={spin} /> Summarising…</> : <><BookOpen size={14} /> Summarise</>}
        </button>
      </div>
      {summary && (
        <>
          <div style={{ position: 'sticky', top: '72px', zIndex: 20, display: 'flex', justifyContent: 'flex-end', paddingRight: '8px', pointerEvents: 'none' }}>
            <button
              onClick={copyToClipboard}
              style={{ ...btn(copied ? 'success' : 'ghost'), fontSize: '12px', padding: '5px 12px', boxShadow: '0 2px 10px rgba(0,0,0,0.3)', pointerEvents: 'all' }}
            >
              {copied ? <><CheckCircle size={13} /> Copied!</> : <><Save size={13} /> Copy</>}
            </button>
          </div>
          <div style={{ ...card, fontSize: '14px', lineHeight: '1.8', color: c.textPri }}>
            {renderMarkdown(summary)}
          </div>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Chat / Doubt Solver
// ══════════════════════════════════════════════════════════════════════════════

const INIT_MSG = { role: 'assistant', text: 'Hi! Ask me anything — about the document or the topic in general.' };

function ChatTab({ pdfId }) {
  const storageKey = `st_chat_${pdfId}`;
  const [messages, setMessages] = useState(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : [INIT_MSG];
    } catch { return [INIT_MSG]; }
  });
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const bottomRef = useRef();
  const inputRef  = useRef();

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Persist messages to sessionStorage on every change
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(messages)); } catch {}
  }, [messages, storageKey]);

  const [attachment,   setAttachment]   = useState(null);
  const [deepResearch, setDeepResearch] = useState(false);
  const [planMode,     setPlanMode]     = useState(false);
  const [showPanel,    setShowPanel]    = useState(false);
  const [showEmoji,    setShowEmoji]    = useState(false);
  const [showFilePick, setShowFilePick] = useState(false);
  const fileRef  = useRef();
  const panelRef = useRef();
  const emojiRef = useRef();

  const handleFile = (e, type) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    if (type === 'image' || file.type.startsWith('image/')) {
      reader.onload = ev => setAttachment({ type: 'image', name: file.name, content: ev.target.result });
      reader.readAsDataURL(file);
    } else {
      reader.onload = ev => setAttachment({ type: 'file', name: file.name, content: ev.target.result });
      reader.readAsText(file);
    }
    setShowPanel(false);
    e.target.value = '';
  };

  // Close panel / emoji picker on outside click
  useEffect(() => {
    const handler = e => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setShowPanel(false);
      if (emojiRef.current && !emojiRef.current.contains(e.target)) setShowEmoji(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const Switch = ({ active, onToggle, label, icon: Icon }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-primary)' }}>
        <Icon size={14} style={{ color: active ? c.accent : 'var(--text-secondary)' }} />
        {label}
      </div>
      <div onClick={onToggle} style={{ width: '36px', height: '20px', borderRadius: '10px', background: active ? c.accent : 'var(--border-color)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: '2px', left: active ? '18px' : '2px', width: '16px', height: '16px', borderRadius: '50%', background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
      </div>
    </div>
  );

  const send = async () => {
    const q = input.trim();
    if (!q && !attachment) return;
    if (loading) return;
    const history = messages.filter((_, i) => i > 0).map(m => ({ role: m.role, content: m.text || (m.attachment ? `[${m.attachment.name}]` : '') }));
    setMessages(m => [...m, { role: 'user', text: q, attachment: attachment?.type === 'image' ? attachment : null, fileLabel: attachment?.type !== 'image' ? attachment?.name : null }]);
    setInput(''); setError(''); setLoading(true);
    const att = attachment;
    setAttachment(null);
    try {
      const r = await aiAPI.chat(pdfId, q, history, {
        attachment: att,
        deep_research: deepResearch,
        plan_mode: planMode,
      });
      setMessages(m => [...m, { role: 'assistant', text: r.data.answer }]);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to get answer');
      setMessages(m => m.slice(0, -1));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const clearChat = () => {
    setMessages([INIT_MSG]);
    sessionStorage.removeItem(storageKey);
    setError(''); setInput(''); setAttachment(null);
  };

  const ToggleChip = ({ active, onClick, children }) => (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: '5px',
      padding: '5px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700,
      cursor: 'pointer', border: `1.5px solid ${active ? c.accent : c.border}`,
      background: active ? `${c.accent}20` : 'transparent',
      color: active ? c.accent : c.textSec, transition: 'all 0.15s',
    }}>{children}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '560px', ...card, padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '8px 12px', borderBottom: `1px solid ${c.border}` }}>
        <button onClick={clearChat} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.textSec, display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', padding: '4px 8px', borderRadius: '6px' }}>
          <RefreshCw size={13} /> New chat
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}
        {messages.map((msg, i) => (
          <MsgBubble key={i} msg={msg} accent={c.accent} textPri={c.textPri} textSec={c.textSec} />
        ))}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: c.textSec, marginBottom: '4px', paddingLeft: '4px' }}>AI</span>
            <div style={{ padding: '12px 16px', borderRadius: '18px 18px 18px 4px', background: `${c.accent}18`, border: `1px solid ${c.accent}30`, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Loader size={14} style={{ color: c.accent, ...spin }} />
              <span style={{ fontSize: '13px', color: c.textSec }}>Thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Attachment preview */}
      {attachment && (
        <div style={{ padding: '6px 14px', borderTop: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', gap: '8px', background: `${c.accent}10` }}>
          {attachment.type === 'image'
            ? <img src={attachment.content} alt={attachment.name} style={{ height: '36px', borderRadius: '4px', objectFit: 'cover' }} />
            : <FileText size={14} style={{ color: c.accent }} />}
          <span style={{ fontSize: '12px', color: c.textPri, flex: 1 }}>{attachment.name}</span>
          <button onClick={() => setAttachment(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.textSec }}><X size={14} /></button>
        </div>
      )}

      {/* Input bar */}
      <div style={{ borderTop: `1px solid ${c.border}`, padding: '10px 12px', background: c.bg, position: 'relative' }}>
        <input ref={fileRef} type="file" accept=".txt,.md,.csv,image/*" style={{ display: 'none' }} onChange={e => handleFile(e, 'file')} />

        {/* Attach popup */}
        {showPanel && (
          <div ref={panelRef} style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', left: '12px',
            background: 'var(--card-bg)', border: `1px solid ${c.border}`,
            borderRadius: '14px', padding: '8px', minWidth: '200px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)', zIndex: 50,
          }}>
            {[
              { icon: Paperclip, label: 'From device', action: () => { fileRef.current?.click(); setShowPanel(false); } },
              { icon: Folder,    label: 'From Files',  action: () => { setShowFilePick(true);   setShowPanel(false); } },
            ].map(({ icon: Icon, label, action }) => (
              <button key={label} onClick={action} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                width: '100%', padding: '10px 14px', background: 'none', border: 'none',
                cursor: 'pointer', color: 'var(--text-primary)', fontSize: '13px',
                borderRadius: '8px', textAlign: 'left',
              }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-color)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <Icon size={15} strokeWidth={1.75} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                {label}
              </button>
            ))}
            <div style={{ borderTop: `1px solid ${c.border}`, margin: '6px 8px' }} />
            <div style={{ padding: '4px 14px 6px' }}>
              <Switch active={deepResearch} onToggle={() => setDeepResearch(v => !v)} label="Deep Research" icon={Search} />
              <Switch active={planMode}     onToggle={() => setPlanMode(v => !v)}     label="Plan Mode"      icon={ListChecks} />
            </div>
          </div>
        )}

        {/* Emoji picker */}
        {showEmoji && (
          <div ref={emojiRef} style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '52px', zIndex: 50 }}>
            <EmojiMartPicker
              data={emojiData}
              onEmojiSelect={e => { setInput(v => v + e.native); setShowEmoji(false); inputRef.current?.focus(); }}
              theme="auto"
              previewPosition="none"
              skinTonePosition="none"
              maxFrequentRows={2}
              perLine={9}
            />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => { setShowPanel(v => !v); setShowEmoji(false); }}
            style={{ ...btn('ghost', { padding: '7px', borderRadius: '50%', flexShrink: 0 }), background: showPanel ? `${c.accent}20` : 'transparent', color: showPanel ? c.accent : c.textSec }}
          >
            <Paperclip size={16} />
          </button>
          <button
            onClick={() => { setShowEmoji(v => !v); setShowPanel(false); }}
            style={{ ...btn('ghost', { padding: '7px', borderRadius: '50%', flexShrink: 0 }), background: showEmoji ? `${c.accent}20` : 'transparent', color: showEmoji ? c.accent : c.textSec }}
          >
            <SmilePlus size={16} />
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={planMode ? 'Describe what you want to plan…' : deepResearch ? 'Ask anything — deep research mode…' : 'Ask anything about this topic…'}
            style={{ flex: 1, padding: '10px 14px', borderRadius: '24px', fontSize: '13px', border: `1.5px solid ${c.border}`, background: c.bg, color: c.textPri, outline: 'none' }}
          />
          <button onClick={send} disabled={(!input.trim() && !attachment) || loading}
            style={btn('primary', { borderRadius: '50%', width: '40px', height: '40px', padding: 0, justifyContent: 'center', flexShrink: 0, opacity: ((!input.trim() && !attachment) || loading) ? 0.5 : 1 })}>
            <Send size={15} />
          </button>
        </div>
      </div>

      {showFilePick && (
        <FilePickerModal
          excludePdf
          onSelect={file => {
            const reader = new FileReader();
            if (file.type.startsWith('image/')) {
              reader.onload = ev => setAttachment({ type: 'image', name: file.name, content: ev.target.result });
              reader.readAsDataURL(file);
            } else {
              reader.onload = ev => setAttachment({ type: 'file', name: file.name, content: ev.target.result });
              reader.readAsText(file);
            }
            setShowFilePick(false);
          }}
          onClose={() => setShowFilePick(false)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Quiz
// ══════════════════════════════════════════════════════════════════════════════

function QuizTab({ pdfId, onWeakTopics, goToPlanner }) {
  const [phase,     setPhase]     = useState('config');
  const [config,    setConfig]    = useState({ num_questions: 10, types: ['mcq', 'true_false'], difficulty: 'mixed' });
  const [questions, setQuestions] = useState([]);
  const [current,   setCurrent]   = useState(0);
  const [answers,   setAnswers]   = useState({});
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [aiGrades,  setAiGrades]  = useState(null);
  const [grading,   setGrading]   = useState(false);

  const toggleType = t =>
    setConfig(c => ({ ...c, types: c.types.includes(t) ? c.types.filter(x => x !== t) : [...c.types, t] }));

  const generate = async () => {
    if (!config.types.length) { setError('Select at least one question type'); return; }
    setLoading(true); setError('');
    try {
      const r = await aiAPI.generateQuiz(pdfId, config);
      setQuestions(r.data.questions ?? []);
      setAnswers({}); setCurrent(0); setPhase('taking');
    } catch (err) { setError(err.response?.data?.error ?? 'Failed to generate quiz'); }
    finally { setLoading(false); }
  };

  const calcScore = () => {
    let correct = 0;
    questions.forEach((q, i) => {
      const a = answers[i];
      if (q.type === 'short') return;
      if (q.type === 'multi_mcq') {
        const ans = Array.isArray(q.answer) ? q.answer : [q.answer];
        const given = Array.isArray(a) ? a : [];
        if (JSON.stringify([...ans].sort()) === JSON.stringify([...given].sort())) correct++;
      } else {
        if (String(a ?? '').trim().toLowerCase() === String(q.answer).trim().toLowerCase()) correct++;
      }
    });
    return correct;
  };

  const finish = async () => {
    setPhase('results');
    const shortQs = questions
      .map((q, i) => ({ ...q, idx: i }))
      .filter(q => q.type === 'short' || q.type === 'fill_blank');
    if (shortQs.length > 0) {
      setGrading(true);
      try {
        const payload = shortQs.map(q => ({
          question: q.question,
          model_answer: q.answer || q.model_answer || '',
          student_answer: answers[q.idx] || '',
          marks: 1,
        }));
        const r = await aiAPI.gradeQuiz(pdfId, payload);
        const gradeMap = {};
        (r.data.grades || []).forEach((g, i) => { gradeMap[shortQs[i].idx] = g; });
        setAiGrades(gradeMap);
      } catch { /* grading failed silently */ }
      finally { setGrading(false); }
    }
    const s = calcScore();
    const auto = questions.filter(q => q.type !== 'short' && q.type !== 'fill_blank').length;
    const weakTopics = questions.filter((q, i) => {
      const a = answers[i];
      if (q.type === 'short' || q.type === 'fill_blank') return false;
      if (q.type === 'multi_mcq') {
        const ans = Array.isArray(q.answer) ? q.answer : [q.answer];
        const given = Array.isArray(a) ? a : [];
        return JSON.stringify([...ans].sort()) !== JSON.stringify([...given].sort());
      }
      return String(a ?? '').trim().toLowerCase() !== String(q.answer).trim().toLowerCase();
    }).map(q => q.topic).filter(Boolean);
    const uniqueWeak = [...new Set(weakTopics)];
    aiAPI.saveQuizResult(pdfId, { score: s, total: auto, question_count: questions.length, types_used: config.types, weak_topics: uniqueWeak }).catch(() => {});
    if (onWeakTopics) onWeakTopics(uniqueWeak);
  };

  if (phase === 'config') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}
      <div style={card}>
        <SecTitle>Quiz Settings</SecTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={lab}>Questions</label>
            <input type="number" min={1} max={50} value={config.num_questions}
              onChange={e => setConfig(c => ({ ...c, num_questions: Math.min(50, Math.max(1, +e.target.value)) }))}
              style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={lab}>Difficulty</label>
            <select value={config.difficulty} onChange={e => setConfig(c => ({ ...c, difficulty: e.target.value }))} style={{ ...sel, marginTop: '6px', width: '100%' }}>
              <option value="mixed">Mixed</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        </div>
        <label style={lab}>Question types</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px', marginBottom: '20px' }}>
          {Object.entries(QUIZ_TYPES).map(([key, label]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', color: c.textPri, padding: '6px 12px', borderRadius: '8px', border: `1.5px solid ${config.types.includes(key) ? c.accent : c.border}`, background: config.types.includes(key) ? `${c.accent}11` : 'transparent' }}>
              <input type="checkbox" checked={config.types.includes(key)} onChange={() => toggleType(key)} style={{ display: 'none' }} />
              {label}
            </label>
          ))}
        </div>
        <button onClick={generate} disabled={loading} style={btn('primary', { opacity: loading ? 0.6 : 1 })}>
          {loading ? <><Loader size={14} style={spin} /> Generating…</> : <><Zap size={14} /> Generate Quiz</>}
        </button>
      </div>
    </div>
  );

  if (phase === 'taking') {
    const q = questions[current];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: c.textSec, fontWeight: 600 }}>
            Q {current + 1} / {questions.length}
            {q.difficulty && <DiffBadge d={q.difficulty} />}
          </span>
          <button onClick={finish} style={btn('ghost', { fontSize: '12px' })}>Finish Early</button>
        </div>
        <ProgressBar pct={((current + 1) / questions.length) * 100} />
        <div style={card}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: c.accent, textTransform: 'uppercase', marginBottom: '8px' }}>{QUIZ_TYPES[q.type] ?? q.type}</div>
          <p style={{ fontSize: '15px', fontWeight: 600, color: c.textPri, margin: '0 0 20px', lineHeight: '1.5' }}>{q.question}</p>
          <QuestionInput q={q} value={answers[current]} onChange={v => setAnswers(a => ({ ...a, [current]: v }))} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '24px' }}>
            <button onClick={() => setCurrent(x => x - 1)} disabled={current === 0} style={btn('ghost', { opacity: current === 0 ? 0.4 : 1 })}><ChevronLeft size={15} /> Prev</button>
            {current < questions.length - 1
              ? <button onClick={() => setCurrent(x => x + 1)} style={btn('primary')}>Next <ChevronRight size={15} /></button>
              : <button onClick={finish} style={btn('success')}><CheckCircle size={15} /> Submit</button>
            }
          </div>
        </div>
      </div>
    );
  }

  const finalScore = calcScore();
  const autoGraded = questions.filter(q => q.type !== 'short' && q.type !== 'fill_blank').length;
  const aiScore = aiGrades ? Object.values(aiGrades).reduce((s, g) => s + (g.score || 0), 0) : 0;
  const totalQ = questions.length;
  const totalScore = parseFloat((finalScore + aiScore).toFixed(2));
  const pct = totalQ > 0 ? Math.round((totalScore / totalQ) * 100) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: '48px', fontWeight: 800, color: pct >= 70 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444' }}>
          {totalScore}/{totalQ}
        </div>
        <p style={{ color: c.textSec, fontSize: '14px', margin: '4px 0 4px' }}>{pct}%</p>
        {grading && <p style={{ color: c.textSec, fontSize: '12px', margin: '0 0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}><Loader size={12} style={spin} /> AI grading short answers…</p>}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => { setPhase('config'); setQuestions([]); setAiGrades(null); }} style={btn('primary')}><RefreshCw size={14} /> New Quiz</button>
          {goToPlanner && pct < 100 && (
            <button onClick={goToPlanner} style={btn('ghost')}><CalendarDays size={14} /> Study Weak Topics</button>
          )}
        </div>
      </div>
      {questions.map((q, i) => {
        const given = answers[i];
        const isShort = q.type === 'short' || q.type === 'fill_blank';
        const aiG = aiGrades?.[i];
        let borderColor, icon;
        if (isShort) {
          const s = aiG?.score ?? null;
          borderColor = s === null ? c.accent : s >= 0.8 ? '#10b981' : s >= 0.4 ? '#f59e0b' : '#ef4444';
          icon = s === null ? <AlertCircle size={16} style={{ color: c.accent, flexShrink: 0, marginTop: '2px' }} /> : s >= 0.8 ? <CheckCircle size={16} style={{ color: '#10b981', flexShrink: 0, marginTop: '2px' }} /> : <XCircle size={16} style={{ color: borderColor, flexShrink: 0, marginTop: '2px' }} />;
        } else {
          const correct = q.type === 'multi_mcq'
            ? JSON.stringify([...(Array.isArray(q.answer) ? q.answer : [q.answer])].sort()) === JSON.stringify([...(Array.isArray(given) ? given : [])].sort())
            : String(given ?? '').trim().toLowerCase() === String(q.answer).trim().toLowerCase();
          borderColor = correct ? '#10b981' : '#ef4444';
          icon = correct ? <CheckCircle size={16} style={{ color: '#10b981', flexShrink: 0, marginTop: '2px' }} /> : <XCircle size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />;
        }
        return (
          <div key={i} style={{ ...card, borderLeft: `4px solid ${borderColor}` }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              {icon}
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 6px', fontWeight: 600, fontSize: '14px', color: c.textPri }}>{q.question}</p>
                {given != null && <p style={{ margin: '0 0 4px', fontSize: '13px', color: c.textSec }}>Your: <strong style={{ color: c.textPri }}>{Array.isArray(given) ? given.join(', ') : String(given)}</strong></p>}
                {isShort && aiG && (
                  <div style={{ margin: '6px 0 0', padding: '8px 12px', borderRadius: '8px', background: aiG.score >= 0.8 ? '#d1fae5' : aiG.score >= 0.4 ? '#fef3c7' : '#fee2e2', fontSize: '12px' }}>
                    <strong>AI Grade: {Math.round(aiG.score * 100)}%</strong> — {aiG.feedback}
                  </div>
                )}
                {isShort && q.answer && <p style={{ margin: '6px 0 0', fontSize: '12px', color: c.textSec }}><strong>Model answer:</strong> {q.answer}</p>}
                {!isShort && String(given ?? '').trim().toLowerCase() !== String(q.answer).trim().toLowerCase() && q.answer != null && <p style={{ margin: '0 0 4px', fontSize: '13px', color: '#10b981' }}>Correct: <strong>{String(q.answer)}</strong></p>}
                {q.explanation && <p style={{ margin: '6px 0 0', fontSize: '12px', color: c.textSec, fontStyle: 'italic' }}>{q.explanation}</p>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QuestionInput({ q, value, onChange }) {
  if (q.type === 'true_false') {
    const opts = (q.options?.length ? q.options : ['True', 'False']);
    return (
      <div style={{ display: 'flex', gap: '10px' }}>
        {opts.map((opt, i) => (
          <button key={i} onClick={() => onChange(opt)} style={{ flex: 1, padding: '12px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', border: `2px solid ${value === opt ? c.accent : c.border}`, background: value === opt ? `${c.accent}18` : 'transparent', color: value === opt ? c.accent : c.textPri, transition: 'all 0.15s' }}>
            {opt}
          </button>
        ))}
      </div>
    );
  }
  if (q.type === 'mcq') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {(q.options ?? []).map((opt, i) => (
        <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: c.textPri, border: `2px solid ${value === opt ? c.accent : c.border}`, background: value === opt ? `${c.accent}11` : 'transparent' }}>
          <input type="radio" checked={value === opt} onChange={() => onChange(opt)} style={{ display: 'none' }} />
          <span style={{ width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0, border: `2px solid ${value === opt ? c.accent : c.border}`, background: value === opt ? c.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {value === opt && <span style={{ width: '5px', height: '5px', background: 'white', borderRadius: '50%' }} />}
          </span>
          {opt}
        </label>
      ))}
    </div>
  );
  if (q.type === 'multi_mcq') {
    const sel2 = Array.isArray(value) ? value : [];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <p style={{ margin: '0 0 6px', fontSize: '12px', color: c.textSec }}>Select all that apply</p>
        {(q.options ?? []).map((opt, i) => {
          const chk = sel2.includes(opt);
          return (
            <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: c.textPri, border: `2px solid ${chk ? c.accent : c.border}`, background: chk ? `${c.accent}11` : 'transparent' }}>
              <input type="checkbox" checked={chk} onChange={() => onChange(chk ? sel2.filter(x => x !== opt) : [...sel2, opt])} style={{ display: 'none' }} />
              <span style={{ width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0, border: `2px solid ${chk ? c.accent : c.border}`, background: chk ? c.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {chk && <span style={{ color: 'white', fontSize: '10px', fontWeight: 700 }}>✓</span>}
              </span>
              {opt}
            </label>
          );
        })}
      </div>
    );
  }
  return (
    <textarea value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder="Type your answer…" rows={3}
      style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', border: `1.5px solid ${c.border}`, background: c.bg, color: c.textPri, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
    />
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Flashcards (SM-2)
// ══════════════════════════════════════════════════════════════════════════════

function FlashcardTab({ pdfId }) {
  const [phase,    setPhase]    = useState('config');
  const [numCards, setNumCards] = useState(20);
  const [deck,     setDeck]     = useState([]);
  const [current,  setCurrent]  = useState(0);
  const [flipped,  setFlipped]  = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [error,    setError]    = useState('');

  const generate = async () => {
    setLoading(true); setError('');
    try {
      const r = await aiAPI.generateFlashcards(pdfId, { num_cards: numCards });
      setDeck(r.data.cards ?? []); setCurrent(0); setFlipped(false); setHasSaved(false); setPhase('review');
    } catch (err) { setError(err.response?.data?.error ?? 'Failed to generate'); }
    finally { setLoading(false); }
  };

  const loadSaved = async () => {
    setLoading(true); setError('');
    try {
      const r = await aiAPI.getDeck(pdfId);
      const cards = r.data.cards ?? [];
      if (!cards.length) { setError('No saved deck. Generate one first.'); setLoading(false); return; }
      setDeck(cards); setCurrent(0); setFlipped(false); setPhase('review');
    } catch { setError('Failed to load deck'); }
    finally { setLoading(false); }
  };

  const saveDeck = async () => {
    setSaving(true);
    try { await aiAPI.saveDeck(pdfId, deck); setHasSaved(true); }
    catch { setError('Failed to save'); }
    finally { setSaving(false); }
  };

  const rate = (q) => {
    const card = { ...deck[current] };
    let { ease, interval, repetitions } = card;
    if (q === 0) { repetitions = 0; interval = 1; }
    else {
      ease = Math.max(1.3, ease + 0.1 - (2 - q) * (0.08 + (2 - q) * 0.02));
      interval = repetitions === 0 ? 1 : repetitions === 1 ? 6 : Math.round(interval * ease);
      repetitions += 1;
    }
    const next = new Date(); next.setDate(next.getDate() + interval);
    const nd = deck.map((x, i) => i === current ? { ...card, ease, interval, repetitions, next_review: next.toISOString() } : x);
    setDeck(nd); setFlipped(false);
    if (current < deck.length - 1) setCurrent(x => x + 1);
    else setPhase('done');
  };

  if (phase === 'config') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}
      <div style={card}>
        <SecTitle>Flashcard Settings</SecTitle>
        <label style={lab}>Number of cards (max 40)</label>
        <input type="number" min={1} max={40} value={numCards}
          onChange={e => setNumCards(Math.min(40, Math.max(1, +e.target.value)))} style={{ ...inp, width: '120px' }} />
        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button onClick={generate} disabled={loading} style={btn('primary', { opacity: loading ? 0.6 : 1 })}>
            {loading ? <><Loader size={14} style={spin} /> Generating…</> : <><Zap size={14} /> Generate</>}
          </button>
          <button onClick={loadSaved} disabled={loading} style={btn('ghost')}>
            <Download size={14} /> Load Saved
          </button>
        </div>
      </div>
    </div>
  );

  if (phase === 'done') return (
    <div style={{ ...card, textAlign: 'center', padding: '40px' }}>
      <CheckCircle size={40} style={{ color: '#10b981', marginBottom: '12px' }} />
      <h3 style={{ margin: '0 0 8px' }}>Deck complete!</h3>
      <p style={{ color: c.textSec, fontSize: '14px', margin: '0 0 20px' }}>{deck.length} cards reviewed.</p>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => { setCurrent(0); setFlipped(false); setPhase('review'); }} style={btn('primary')}><RotateCw size={14} /> Review Again</button>
        <button onClick={() => { setPhase('config'); setDeck([]); }} style={btn('ghost')}>New Deck</button>
        {!hasSaved && <button onClick={saveDeck} disabled={saving} style={btn('success')}><Save size={14} /> {saving ? 'Saving…' : 'Save Deck'}</button>}
      </div>
    </div>
  );

  const cd = deck[current];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', color: c.textSec, fontWeight: 600 }}>Card {current + 1} / {deck.length}</span>
        {!hasSaved
          ? <button onClick={saveDeck} disabled={saving} style={btn('ghost', { fontSize: '12px' })}><Save size={13} /> {saving ? 'Saving…' : 'Save'}</button>
          : <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>✓ Saved</span>
        }
      </div>
      <ProgressBar pct={(current / deck.length) * 100} />
      <div onClick={() => setFlipped(f => !f)} style={{ ...card, minHeight: '200px', cursor: 'pointer', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', background: flipped ? c.accent : c.bg, transition: 'background 0.2s', userSelect: 'none' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.6, color: flipped ? 'white' : c.textSec }}>
          {flipped ? 'Answer' : 'Question — tap to flip'}
        </div>
        <div style={{ fontSize: '16px', fontWeight: 600, lineHeight: '1.55', color: flipped ? 'white' : c.textPri, maxWidth: '560px' }}>
          {flipped ? cd.back : cd.front}
        </div>
      </div>
      {flipped
        ? <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button onClick={() => rate(0)} style={btn('danger',  { flex: 1, maxWidth: '130px', justifyContent: 'center' })}>Hard</button>
            <button onClick={() => rate(1)} style={btn('ghost',   { flex: 1, maxWidth: '130px', justifyContent: 'center' })}>OK</button>
            <button onClick={() => rate(2)} style={btn('success', { flex: 1, maxWidth: '130px', justifyContent: 'center' })}>Easy</button>
          </div>
        : <p style={{ textAlign: 'center', fontSize: '12px', color: c.textSec }}>Click the card to reveal the answer, then rate yourself.</p>
      }
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Mind Map
// ══════════════════════════════════════════════════════════════════════════════

function MindmapSVG({ mindmap }) {
  const branches = mindmap.branches ?? [];
  const n        = branches.length || 1;
  const cx = 500, cy = 360, R1 = 185, R2 = 345, W = 1000, H = 720;
  const trunc  = (s, l = 18) => s && s.length > l ? s.slice(0, l - 1) + '…' : (s || '');
  const colors = [c.accent,'#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899'];

  const bPos = branches.map((_, i) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    return { x: cx + R1 * Math.cos(a), y: cy + R1 * Math.sin(a), a };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minHeight: '340px', display: 'block', borderRadius: '10px' }}>
      <defs>
        <filter id="mm-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="3" stdDeviation="5" floodOpacity="0.22" />
        </filter>
      </defs>

      {/* Explicit background so dark mode has a proper canvas */}
      <rect width={W} height={H} rx="10" style={{ fill: c.bgAlt }} />

      {branches.map((branch, i) => {
        const bp      = bPos[i];
        const col     = colors[i % colors.length];
        const nodes   = branch.subnodes ?? [];
        const spread  = Math.max(0.14 * Math.PI, Math.min(0.42 * Math.PI, 1.4 * Math.PI / n));

        const sPos = nodes.map((_, j) => {
          const off = nodes.length > 1 ? (j / (nodes.length - 1) - 0.5) * spread : 0;
          const a   = bp.a + off;
          return { x: cx + R2 * Math.cos(a), y: cy + R2 * Math.sin(a) };
        });

        return (
          <g key={i}>
            {/* Center → branch line */}
            <line x1={cx} y1={cy} x2={bp.x} y2={bp.y}
              stroke={col} strokeWidth="2.5" strokeOpacity="0.7" />
            {/* Branch → subnode lines */}
            {sPos.map((sp, j) => (
              <line key={j} x1={bp.x} y1={bp.y} x2={sp.x} y2={sp.y}
                stroke={col} strokeWidth="1.6" strokeOpacity="0.55" />
            ))}
            {/* Subnode boxes — semi-transparent colored bg, readable in both modes */}
            {sPos.map((sp, j) => (
              <g key={j}>
                <rect x={sp.x - 55} y={sp.y - 15} width="110" height="30" rx="9"
                  style={{ fill: `${col}28` }} stroke={col} strokeWidth="1.5" />
                <text x={sp.x} y={sp.y + 5} textAnchor="middle"
                  fontSize="10.5" fontWeight="700"
                  style={{ fill: col, fontFamily: 'inherit' }}>
                  {trunc(nodes[j], 23)}
                </text>
              </g>
            ))}
            {/* Branch pill */}
            <rect x={bp.x - 62} y={bp.y - 19} width="124" height="38" rx="19"
              style={{ fill: col }} filter="url(#mm-glow)" />
            <text x={bp.x} y={bp.y + 6} textAnchor="middle"
              fontSize="11.5" fontWeight="700"
              style={{ fill: '#fff', fontFamily: 'inherit' }}>
              {trunc(branch.label, 19)}
            </text>
          </g>
        );
      })}

      {/* Center node */}
      <ellipse cx={cx} cy={cy} rx="86" ry="32" style={{ fill: c.accent }} filter="url(#mm-glow)" />
      <text x={cx} y={cy + 5} textAnchor="middle"
        fontSize="13.5" fontWeight="800"
        style={{ fill: '#fff', fontFamily: 'inherit' }}>
        {trunc(mindmap.center, 24)}
      </text>
    </svg>
  );
}

function MindmapTab({ pdfId }) {
  const [mindmap, setMindmap] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const generate = async () => {
    setLoading(true); setError(''); setMindmap(null);
    try { const r = await aiAPI.generateMindmap(pdfId); setMindmap(r.data); }
    catch (err) { setError(err.response?.data?.error ?? 'Failed to generate mind map'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}
      <div style={card}>
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: c.textSec }}>Generates a visual concept map of all major topics in the document.</p>
        <button onClick={generate} disabled={loading} style={btn('primary', { opacity: loading ? 0.6 : 1 })}>
          {loading ? <><Loader size={14} style={spin} /> Generating…</> : <><GitBranch size={14} /> Generate Mind Map</>}
        </button>
      </div>
      {mindmap && (
        <div style={{ ...card, overflowX: 'auto' }}>
          <MindmapSVG mindmap={mindmap} />
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Formula Sheet
// ══════════════════════════════════════════════════════════════════════════════

function FormulaSheetTab({ pdfId }) {
  const [formulas, setFormulas] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const extract = async () => {
    setLoading(true); setError(''); setFormulas(null);
    try { const r = await aiAPI.extractFormulaSheet(pdfId, {}); setFormulas(r.data.formulas ?? []); }
    catch (err) { setError(err.response?.data?.error ?? 'Failed'); }
    finally { setLoading(false); }
  };

  const grouped = formulas ? formulas.reduce((acc, f) => {
    const t = f.topic || 'General';
    (acc[t] = acc[t] || []).push(f);
    return acc;
  }, {}) : null;

  const printSheet = () => {
    if (!formulas?.length) return;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>Formula Sheet</title>
<style>
  body{font-family:-apple-system,sans-serif;padding:24px;max-width:820px;margin:0 auto;color:#111;}
  h1{font-size:20px;border-bottom:2px solid #667eea;padding-bottom:8px;margin-bottom:20px;}
  h2{font-size:14px;color:#667eea;margin:22px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;text-transform:uppercase;letter-spacing:.05em;}
  .card{margin-bottom:14px;padding:12px 14px;border:1px solid #e5e7eb;border-radius:8px;break-inside:avoid;}
  .name{font-weight:700;font-size:13px;margin-bottom:5px;}
  .formula{font-family:monospace;font-size:15px;font-weight:600;color:#667eea;background:#f3f4f6;padding:7px 10px;border-radius:6px;margin-bottom:5px;}
  .meta{font-size:11px;color:#6b7280;margin-top:3px;}
  @media print{body{padding:12px;}h2{page-break-after:avoid;}}
</style></head><body>
<h1>Formula Sheet</h1>
${Object.entries(grouped).map(([topic, fmls]) => `
<h2>${topic}</h2>
${fmls.map(f => `<div class="card">
  <div class="name">${f.name}</div>
  <div class="formula">${f.formula}</div>
  ${f.variables ? `<div class="meta"><strong>Variables:</strong> ${f.variables}</div>` : ''}
  ${f.context   ? `<div class="meta">${f.context}</div>` : ''}
</div>`).join('')}`).join('')}
</body></html>`);
    win.document.close();
    win.print();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontSize: '13px', color: c.textSec, flex: 1 }}>Extracts all formulas and equations from the document, grouped by topic.</p>
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          {formulas?.length > 0 && (
            <button onClick={printSheet} style={btn('ghost')}>
              <Download size={14} /> Print / Save
            </button>
          )}
          <button onClick={extract} disabled={loading} style={btn('primary', { opacity: loading ? 0.6 : 1 })}>
            {loading ? <><Loader size={14} style={spin} /> Extracting…</> : <><FlaskConical size={14} /> Extract Formulas</>}
          </button>
        </div>
      </div>
      {grouped !== null && (
        Object.keys(grouped).length === 0
          ? <p style={{ fontSize: '13px', color: c.textSec }}>No formulas found.</p>
          : Object.entries(grouped).map(([topic, fmls]) => (
            <div key={topic}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: c.accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px', paddingLeft: '2px' }}>{topic}</div>
              {fmls.map((f, i) => (
                <div key={i} style={{ ...card, padding: '14px 18px', marginBottom: '8px' }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: c.textPri, marginBottom: '7px' }}>{f.name}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '15px', fontWeight: 600, color: c.accent, background: 'var(--bg-secondary, #f3f4f6)', padding: '9px 13px', borderRadius: '8px', marginBottom: '7px', wordBreak: 'break-all' }}>{f.formula}</div>
                  {f.variables && <div style={{ fontSize: '12px', color: c.textSec, marginBottom: '3px' }}><strong>Variables:</strong> {f.variables}</div>}
                  {f.context   && <div style={{ fontSize: '12px', color: c.textSec }}>{f.context}</div>}
                </div>
              ))}
            </div>
          ))
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Past Papers
// ══════════════════════════════════════════════════════════════════════════════

function PastPapersTab({ pdfId }) {
  const [topics,  setTopics]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const analyse = async () => {
    setLoading(true); setError(''); setTopics(null);
    try { const r = await aiAPI.analysePastPapers(pdfId); setTopics(r.data.topics ?? []); }
    catch (err) { setError(err.response?.data?.error ?? 'Failed'); }
    finally { setLoading(false); }
  };

  const maxFreq = topics ? Math.max(...topics.map(t => t.frequency ?? 0), 1) : 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}
      <div style={card}>
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: c.textSec }}>Ranks topics by how frequently they appear in the document, ordered by importance.</p>
        <button onClick={analyse} disabled={loading} style={btn('primary', { opacity: loading ? 0.6 : 1 })}>
          {loading ? <><Loader size={14} style={spin} /> Analysing…</> : <><Clock size={14} /> Analyse Topics</>}
        </button>
      </div>
      {topics !== null && (topics.length === 0 ? <p style={{ fontSize: '13px', color: c.textSec }}>No topics found.</p> : (
        <div style={card}>
          <SecTitle>Topic Frequency</SecTitle>
          {topics.map((t, i) => (
            <div key={i} style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: c.textPri }}>{t.topic}</span>
                <span style={{ fontSize: '11px', color: c.textSec }}>
                  {t.frequency}×{t.importance && <span style={{ marginLeft: '6px', padding: '2px 5px', borderRadius: '4px', fontSize: '10px', background: t.importance === 'high' ? '#fee2e2' : t.importance === 'medium' ? '#fef3c7' : '#d1fae5', color: t.importance === 'high' ? '#dc2626' : t.importance === 'medium' ? '#92400e' : '#065f46' }}>{t.importance}</span>}
                </span>
              </div>
              <div style={{ height: '7px', background: 'var(--bg-secondary, #f3f4f6)', borderRadius: '4px' }}>
                <div style={{ height: '100%', background: c.accent, borderRadius: '4px', width: `${Math.round((t.frequency / maxFreq) * 100)}%`, transition: 'width 0.4s' }} />
              </div>
              {t.subtopics?.length > 0 && <div style={{ marginTop: '3px', fontSize: '11px', color: c.textSec }}>{t.subtopics.join(' · ')}</div>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Mock Test (timed + negative marking)
// ══════════════════════════════════════════════════════════════════════════════

function MockTab({ pdfId }) {
  // mode: 'auto' | 'upload' | 'manual'
  const [mode,      setMode]      = useState('auto');
  // auto settings
  const [cfg,       setCfg]       = useState({ num_questions: 15, marks_each: 1, negative: false, neg_fraction: 0.25, duration: 45 });
  // shared paper settings
  const [title,     setTitle]     = useState('');
  const [duration,  setDuration]  = useState(180);
  const [sections,  setSections]  = useState([
    { name: 'Section A', type: 'mcq',   count: 10, marks_each: 1 },
    { name: 'Section B', type: 'short', count: 5,  marks_each: 4 },
  ]);
  // pattern upload
  const [patternFile,    setPatternFile]    = useState(null);
  const [patternLoading, setPatternLoading] = useState(false);
  const [patternSummary, setPatternSummary] = useState('');
  const [patternError,   setPatternError]   = useState('');
  const patternRef = useRef(null);
  // test state
  const [phase,     setPhase]     = useState('config');
  const [questions, setQuestions] = useState([]);
  const [paper,     setPaper]     = useState(null);
  const [serverCfg, setServerCfg] = useState(null);
  const [current,   setCurrent]   = useState(0);
  const [answers,   setAnswers]   = useState({});
  const [timeLeft,  setTimeLeft]  = useState(0);
  const [showKeys,  setShowKeys]  = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [aiGrades,  setAiGrades]  = useState(null);
  const [grading,   setGrading]   = useState(false);
  const timerRef = useRef(null);

  const handlePatternUpload = async (file) => {
    if (!file) return;
    setPatternFile(file); setPatternLoading(true); setPatternError(''); setPatternSummary('');
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await aiAPI.analysePattern(pdfId, fd);
      const ex = r.data.extracted;
      if (ex.title_hint)       setTitle(ex.title_hint);
      if (ex.duration_minutes) setDuration(ex.duration_minutes);
      if (ex.sections?.length) setSections(ex.sections);
      setPatternSummary(ex.pattern_summary || 'Pattern applied.');
    } catch (err) { setPatternError(err.response?.data?.error ?? 'Failed to analyse pattern'); }
    finally { setPatternLoading(false); }
  };

  const upd = (i, k, v) => setSections(s => s.map((sec, j) => j === i ? { ...sec, [k]: v } : sec));

  const generate = async () => {
    setLoading(true); setError('');
    try {
      if (mode === 'auto') {
        const r = await aiAPI.generateMockTest(pdfId, {
          num_questions: cfg.num_questions, marks_each: cfg.marks_each,
          negative_marking: cfg.negative, negative_fraction: cfg.neg_fraction, duration_minutes: cfg.duration,
        });
        setQuestions(r.data.questions ?? []); setServerCfg(r.data.config ?? {});
        setAnswers({}); setCurrent(0);
        setTimeLeft((r.data.config?.duration_minutes ?? cfg.duration) * 60);
        setPhase('taking');
      } else {
        const r = await aiAPI.generateMockPaper(pdfId, { title, duration_minutes: duration, sections });
        setPaper(r.data.paper); setPhase('paper');
      }
    } catch (err) { setError(err.response?.data?.error ?? 'Failed'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (phase !== 'taking') return;
    timerRef.current = setInterval(() => setTimeLeft(t => {
      if (t <= 1) { clearInterval(timerRef.current); handleSubmit(); return 0; }
      return t - 1;
    }), 1000);
    return () => clearInterval(timerRef.current);
  }, [phase]);

  const handleSubmit = async () => {
    clearInterval(timerRef.current);
    setPhase('results');
    const shortQs = questions.map((q, i) => ({ ...q, idx: i })).filter(q => q.type === 'short');
    if (shortQs.length) {
      setGrading(true);
      try {
        const r = await aiAPI.gradeQuiz(pdfId, shortQs.map(q => ({
          question: q.question, model_answer: q.model_answer || q.answer || '',
          student_answer: answers[q.idx] || '', marks: serverCfg?.marks_each ?? cfg.marks_each,
        })));
        const gmap = {};
        (r.data.grades || []).forEach((g, i) => { gmap[shortQs[i].idx] = g; });
        setAiGrades(gmap);
      } catch {}
      finally { setGrading(false); }
    }
  };

  const calcScore = () => {
    const me = serverCfg?.marks_each ?? cfg.marks_each;
    const nf = serverCfg?.negative_fraction ?? cfg.neg_fraction;
    const useNeg = serverCfg?.negative_marking ?? cfg.negative;
    let score = 0;
    questions.forEach((q, i) => {
      const a = answers[i];
      if (q.type === 'short') {
        score += (aiGrades?.[i]?.score ?? 0) * me;
        return;
      }
      const ok = String(a ?? '').trim().toLowerCase() === String(q.answer).trim().toLowerCase();
      if (ok) score += me;
      else if (useNeg && a != null && a !== '') score -= me * nf;
    });
    return Math.max(0, parseFloat(score.toFixed(2)));
  };

  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const totalSec = (serverCfg?.duration_minutes ?? cfg.duration) * 60;
  const timePct = timeLeft / (totalSec || 1);

  // ── Config ────────────────────────────────────────────────────────────────
  if (phase === 'config') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: '8px' }}>
        {[['auto', 'Auto Generate', Timer], ['upload', 'Upload Pattern', Upload], ['manual', 'Custom Pattern', ClipboardList]].map(([m, label, Icon]) => (
          <button key={m} onClick={() => setMode(m)} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
            padding: '12px 8px', borderRadius: '10px', cursor: 'pointer', border: `2px solid ${mode === m ? c.accent : c.border}`,
            background: mode === m ? `${c.accent}12` : c.bg, color: mode === m ? c.accent : c.textSec,
            fontSize: '12px', fontWeight: 600, transition: 'all 0.15s',
          }}>
            <Icon size={18} strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </div>

      {/* Auto mode */}
      {mode === 'auto' && (
        <div style={card}>
          <SecTitle>Test Settings</SecTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '14px' }}>
            {[['Questions', 'num_questions', 5, 50], ['Marks/Q', 'marks_each', 1, 10], ['Duration (min)', 'duration', 5, 180]].map(([label, key, min, max]) => (
              <div key={key}>
                <label style={lab}>{label}</label>
                <input type="number" min={min} max={max} value={cfg[key]}
                  onChange={e => setCfg(x => ({ ...x, [key]: +e.target.value }))} style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
              </div>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', color: c.textPri, marginBottom: cfg.negative ? '10px' : '20px' }}>
            <input type="checkbox" checked={cfg.negative} onChange={e => setCfg(x => ({ ...x, negative: e.target.checked }))} />
            Negative marking
          </label>
          {cfg.negative && (
            <div style={{ marginBottom: '20px' }}>
              <label style={lab}>Deduction (e.g. 0.25 = ¼ mark)</label>
              <input type="number" min={0.1} max={1} step={0.05} value={cfg.neg_fraction}
                onChange={e => setCfg(x => ({ ...x, neg_fraction: +e.target.value }))} style={{ ...inp, width: '100px' }} />
            </div>
          )}
        </div>
      )}

      {/* Upload pattern */}
      {mode === 'upload' && (
        <div style={{ ...card, borderStyle: 'dashed' }}>
          <SecTitle>Upload Exam Pattern</SecTitle>
          <p style={{ margin: '0 0 12px', fontSize: '12px', color: c.textSec, lineHeight: '1.6' }}>
            Upload a photo or PDF of your exam pattern — AI will extract the structure automatically.
          </p>
          {!patternFile ? (
            <button onClick={() => patternRef.current?.click()}
              style={btn('ghost', { fontSize: '12px', border: `1px dashed ${c.border}`, width: '100%', justifyContent: 'center', padding: '14px', boxSizing: 'border-box' })}>
              <Upload size={13} /> Choose file (PDF or image)
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
              <FileText size={14} style={{ color: c.accent, flexShrink: 0 }} />
              <span style={{ color: c.textPri, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{patternFile.name}</span>
              {patternLoading
                ? <><Loader size={13} style={spin} /><span style={{ color: c.textSec }}>Analysing…</span></>
                : <button onClick={() => { setPatternFile(null); setPatternSummary(''); setPatternError(''); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.textSec, padding: 0 }}><X size={14} /></button>
              }
            </div>
          )}
          {patternError && <div style={{ marginTop: '8px', fontSize: '12px', color: '#dc2626' }}>{patternError}</div>}
          {patternSummary && (
            <div style={{ marginTop: '10px', padding: '8px 12px', background: `${c.accent}10`, border: `1px solid ${c.accent}30`, borderRadius: '8px', fontSize: '12px', color: c.textPri, lineHeight: '1.5' }}>
              <strong style={{ color: c.accent }}>Extracted: </strong>{patternSummary}
            </div>
          )}
          <input ref={patternRef} type="file" accept=".pdf,image/*" style={{ display: 'none' }}
            onChange={e => { if (e.target.files[0]) handlePatternUpload(e.target.files[0]); e.target.value = ''; }} />
          {patternSummary && <div style={{ marginTop: '16px' }}>{renderSectionBuilder()}</div>}
        </div>
      )}

      {/* Manual pattern */}
      {mode === 'manual' && (
        <div style={card}>
          <SecTitle>Paper Configuration</SecTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: '12px', marginBottom: '14px' }}>
            <div>
              <label style={lab}>Paper Title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Unit Test 1"
                style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={lab}>Duration (min)</label>
              <input type="number" min={10} max={360} value={duration}
                onChange={e => setDuration(+e.target.value)} style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
            </div>
          </div>
          {renderSectionBuilder()}
        </div>
      )}

      <button onClick={generate} disabled={loading || (mode === 'upload' && !patternSummary)} style={btn('primary', { opacity: (loading || (mode === 'upload' && !patternSummary)) ? 0.5 : 1 })}>
        {loading ? <><Loader size={14} style={spin} /> Generating…</> : mode === 'auto' ? <><Timer size={14} /> Start Test</> : <><ClipboardList size={14} /> Generate Paper</>}
      </button>
    </div>
  );

  function renderSectionBuilder() {
    return (
      <>
        <SecTitle>Sections</SecTitle>
        {sections.map((sec, i) => (
          <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '10px', padding: '10px 12px', border: `1px solid ${c.border}`, borderRadius: '8px' }}>
            {[['Name', 'name', 'text', '110px'], ['Count', 'count', 'number', '65px'], ['Marks/Q', 'marks_each', 'number', '65px']].map(([label, key, type, width]) => (
              <div key={key}>
                <label style={{ ...lab, fontSize: '11px' }}>{label}</label>
                <input type={type} value={sec[key]} min={1}
                  onChange={e => upd(i, key, type === 'number' ? +e.target.value : e.target.value)}
                  style={{ ...inp, width, marginTop: '4px' }} />
              </div>
            ))}
            <div>
              <label style={{ ...lab, fontSize: '11px' }}>Type</label>
              <select value={sec.type} onChange={e => upd(i, 'type', e.target.value)} style={{ ...sel, marginTop: '4px' }}>
                {Object.entries(QUIZ_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <button onClick={() => setSections(s => s.filter((_, j) => j !== i))} style={btn('danger', { padding: '6px 10px' })}><Trash2 size={12} /></button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button onClick={() => setSections(s => [...s, { name: `Section ${String.fromCharCode(65 + s.length)}`, type: 'mcq', count: 5, marks_each: 2 }])}
            style={btn('ghost', { fontSize: '12px' })}><Plus size={13} /> Add Section</button>
          <span style={{ fontSize: '12px', color: c.textSec }}>Total: {sections.reduce((s, sec) => s + sec.count * sec.marks_each, 0)} marks</span>
        </div>
      </>
    );
  }

  // ── Taking test ───────────────────────────────────────────────────────────
  if (phase === 'taking') {
    const q = questions[current];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ ...card, padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: c.textSec }}>Q {current + 1}/{questions.length}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ height: '6px', width: '100px', background: c.border, borderRadius: '4px' }}>
              <div style={{ height: '100%', background: timePct > 0.3 ? c.accent : '#ef4444', borderRadius: '4px', width: `${timePct * 100}%`, transition: 'width 1s linear' }} />
            </div>
            <span style={{ fontSize: '15px', fontWeight: 700, fontFamily: 'monospace', color: timePct < 0.2 ? '#ef4444' : c.textPri }}>{fmt(timeLeft)}</span>
          </div>
          <button onClick={handleSubmit} style={btn('ghost', { fontSize: '12px' })}>Submit</button>
        </div>
        <div style={card}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: c.accent, textTransform: 'uppercase', marginBottom: '8px' }}>
            {QUIZ_TYPES[q.type] ?? q.type} · {serverCfg?.marks_each ?? cfg.marks_each} mark{(serverCfg?.marks_each ?? cfg.marks_each) > 1 ? 's' : ''}
            {(serverCfg?.negative_marking ?? cfg.negative) && <span style={{ marginLeft: '8px', color: '#ef4444' }}>−{((serverCfg?.marks_each ?? 1) * (serverCfg?.negative_fraction ?? 0.25)).toFixed(2)} wrong</span>}
          </div>
          <p style={{ fontSize: '15px', fontWeight: 600, color: c.textPri, margin: '0 0 20px', lineHeight: '1.5' }}>{q.question}</p>
          <QuestionInput q={q} value={answers[current]} onChange={v => setAnswers(a => ({ ...a, [current]: v }))} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
            <button onClick={() => setCurrent(x => x - 1)} disabled={current === 0} style={btn('ghost', { opacity: current === 0 ? 0.4 : 1 })}><ChevronLeft size={15} /> Prev</button>
            {current < questions.length - 1
              ? <button onClick={() => setCurrent(x => x + 1)} style={btn('primary')}>Next <ChevronRight size={15} /></button>
              : <button onClick={handleSubmit} style={btn('success')}><CheckCircle size={15} /> Submit</button>}
          </div>
        </div>
      </div>
    );
  }

  // ── Paper view ────────────────────────────────────────────────────────────
  if (phase === 'paper') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button onClick={() => { setPhase('config'); setPaper(null); }} style={btn('ghost')}><ChevronLeft size={14} /> New Paper</button>
        <button onClick={() => setShowKeys(k => !k)} style={btn(showKeys ? 'primary' : 'ghost')}>{showKeys ? 'Hide Keys' : 'Show Answer Key'}</button>
        <button onClick={() => window.print()} style={btn('ghost')}><Download size={14} /> Print</button>
      </div>
      <div style={{ ...card, maxWidth: '780px' }}>
        <div style={{ textAlign: 'center', borderBottom: `2px solid ${c.border}`, paddingBottom: '16px', marginBottom: '20px' }}>
          <h2 style={{ margin: '0 0 6px', fontSize: '18px' }}>{paper?.title || title || 'Question Paper'}</h2>
          <div style={{ fontSize: '13px', color: c.textSec }}>Duration: {paper?.duration_minutes ?? duration} min · Total: {paper?.total_marks} marks</div>
          {paper?.instructions && <div style={{ marginTop: '10px', fontSize: '12px', color: c.textSec, textAlign: 'left' }}><strong>Instructions:</strong> {paper.instructions}</div>}
        </div>
        {(paper?.sections ?? []).map((sec, si) => (
          <div key={si} style={{ marginBottom: '28px' }}>
            <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>{sec.name}</div>
            <div style={{ fontSize: '12px', color: c.textSec, marginBottom: '14px' }}>{sec.instructions}</div>
            {(sec.questions ?? []).map((q, qi) => (
              <div key={qi} style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, flexShrink: 0 }}>{q.number ?? qi + 1}.</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: '0 0 6px', fontSize: '13px', lineHeight: '1.5' }}>{q.question}</p>
                    {q.type === 'mcq' && (q.options ?? []).map((opt, oi) => (
                      <div key={oi} style={{ fontSize: '12px', color: c.textSec, marginBottom: '3px' }}>({String.fromCharCode(65 + oi)}) {opt}</div>
                    ))}
                    {showKeys && q.answer && (
                      <div style={{ marginTop: '6px', padding: '5px 10px', background: '#d1fae5', borderRadius: '6px', fontSize: '12px', color: '#065f46' }}>
                        <strong>Ans:</strong> {q.answer}
                        {q.model_answer && q.model_answer !== q.answer && <div><strong>Model:</strong> {q.model_answer}</div>}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: '11px', color: c.textSec, flexShrink: 0 }}>[{sec.marks_each}]</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  // ── Results ───────────────────────────────────────────────────────────────
  const score = calcScore();
  const total = serverCfg?.total_marks ?? (questions.length * (serverCfg?.marks_each ?? cfg.marks_each));
  const pct   = total > 0 ? Math.round((score / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ fontSize: '48px', fontWeight: 800, color: pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444' }}>{score} / {total}</div>
        <p style={{ color: c.textSec, fontSize: '14px', margin: '4px 0 4px' }}>{pct}%</p>
        {grading && <p style={{ color: c.textSec, fontSize: '12px', margin: '0 0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}><Loader size={12} style={spin} /> AI grading short answers…</p>}
        <button onClick={() => { setPhase('config'); setQuestions([]); setAiGrades(null); }} style={btn('primary')}><RefreshCw size={14} /> New Test</button>
      </div>
      {questions.map((q, i) => {
        const a = answers[i]; const isShort = q.type === 'short';
        const aiG = aiGrades?.[i];
        const ok = !isShort && String(a ?? '').trim().toLowerCase() === String(q.answer).trim().toLowerCase();
        const borderColor = isShort ? (aiG ? (aiG.score >= 0.8 ? '#10b981' : aiG.score >= 0.4 ? '#f59e0b' : '#ef4444') : c.accent) : (ok ? '#10b981' : '#ef4444');
        return (
          <div key={i} style={{ ...card, borderLeft: `4px solid ${borderColor}` }}>
            <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: '14px', color: c.textPri }}>{i + 1}. {q.question}</p>
            {a != null && <p style={{ margin: 0, fontSize: '13px', color: c.textSec }}>Your: <strong style={{ color: c.textPri }}>{String(a)}</strong></p>}
            {isShort && aiG && (
              <div style={{ margin: '6px 0 0', padding: '8px 12px', borderRadius: '8px', background: aiG.score >= 0.8 ? c.successBg : aiG.score >= 0.4 ? c.warningBg : c.dangerBg, fontSize: '12px' }}>
                <strong>AI Grade: {Math.round(aiG.score * 100)}%</strong> — {aiG.feedback}
              </div>
            )}
            {isShort && q.model_answer && <p style={{ margin: '6px 0 0', fontSize: '12px', color: c.textSec }}><strong>Model:</strong> {q.model_answer}</p>}
            {!isShort && !ok && q.answer != null && <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#10b981' }}>Correct: <strong>{String(q.answer)}</strong></p>}
            {q.explanation && <p style={{ margin: '6px 0 0', fontSize: '12px', color: c.textSec, fontStyle: 'italic' }}>{q.explanation}</p>}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Study Planner
// ══════════════════════════════════════════════════════════════════════════════

function StudyPlannerTab({ pdfId, prefillTopics = [] }) {
  const [examDate,    setExamDate]    = useState('');
  const [hoursPerDay, setHoursPerDay] = useState(2);
  const [plan,        setPlan]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');

  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const tomorrowStr = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const generate = async () => {
    if (!examDate) { setError('Exam date is required'); return; }
    const days = Math.ceil((new Date(examDate) - new Date(todayStr)) / 86400000);
    if (days < 1) { setError('Exam date must be at least tomorrow'); return; }
    setLoading(true); setError(''); setPlan(null);
    try {
      const r = await aiAPI.studyPlanner(pdfId, {
        exam_date: examDate, hours_per_day: hoursPerDay, start_date: todayStr,
        ...(prefillTopics.length > 0 && { focus_topics: prefillTopics }),
      });
      setPlan(r.data.plan);
    }
    catch (err) { setError(err.response?.data?.error ?? 'Failed'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {error && <ErrorBanner msg={error} onDismiss={() => setError('')} />}
      {prefillTopics.length > 0 && (
        <div style={{ padding: '10px 14px', borderRadius: '10px', background: c.warningBg, border: `1px solid ${c.warning}44`, fontSize: '13px', color: c.warningFg }}>
          <strong>Weak topics from your quiz:</strong>{' '}
          {prefillTopics.join(', ')} — the plan will prioritise these.
        </div>
      )}
      <div style={card}>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={lab}>Exam Date</label>
            <input type="date" value={examDate} min={tomorrowStr} onChange={e => setExamDate(e.target.value)} style={inp} />
          </div>
          <div>
            <label style={lab}>Hours / day</label>
            <input type="number" min={0.5} max={12} step={0.5} value={hoursPerDay}
              onChange={e => setHoursPerDay(+e.target.value)} style={{ ...inp, width: '80px' }} />
          </div>
          <button onClick={generate} disabled={loading} style={btn('primary', { opacity: loading ? 0.6 : 1, marginBottom: '2px' })}>
            {loading ? <><Loader size={14} style={spin} /> Generating…</> : <><CalendarDays size={14} /> Generate Plan</>}
          </button>
        </div>
      </div>
      {plan && (
        <>
          <div style={card}>
            <p style={{ margin: '0 0 6px', fontSize: '13px', color: c.textSec, lineHeight: '1.6' }}>{plan.subject_overview}</p>
            <p style={{ margin: 0, fontSize: '12px', color: c.textSec }}>{plan.total_days} day{plan.total_days !== 1 ? 's' : ''} · {hoursPerDay}h/day</p>
          </div>
          {(plan.days ?? []).map((day, i) => (
            <div key={i} style={{ ...card, borderLeft: `3px solid ${c.accent}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontWeight: 700, fontSize: '13px', color: c.accent }}>{day.date_label}</span>
                <span style={{ fontSize: '12px', color: c.textSec }}>{day.focus_topic}</span>
              </div>
              {(day.tasks ?? []).map((task, j) => (
                <div key={j} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: c.textPri, padding: '4px 0', borderBottom: j < day.tasks.length - 1 ? `1px solid ${c.border}` : 'none' }}>
                  <span>• {task.task}</span>
                  <span style={{ color: c.textSec, flexShrink: 0, marginLeft: '8px' }}>{task.hours}h</span>
                </div>
              ))}
              {day.tip && <div style={{ marginTop: '8px', fontSize: '12px', color: c.accent, fontStyle: 'italic' }}>Tip: {day.tip}</div>}
            </div>
          ))}
          {plan.revision_strategy && (
            <div style={{ ...card, background: c.infoBg, borderColor: c.infoBorder }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: c.info, marginBottom: '4px' }}>Revision Strategy</div>
              <div style={{ fontSize: '13px', color: c.info }}>{plan.revision_strategy}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Performance Analytics
// ══════════════════════════════════════════════════════════════════════════════

function PerformanceTab({ pdfId }) {
  const [data,       setData]       = useState(null);
  const [ragMetrics, setRagMetrics] = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');

  useEffect(() => {
    Promise.all([
      aiAPI.getPerformance(pdfId),
      aiAPI.getRagMetrics(pdfId).catch(() => null),
    ]).then(([perfRes, ragRes]) => {
      setData(perfRes.data);
      if (ragRes) setRagMetrics(ragRes.data);
    }).catch(() => setError('Failed to load'))
      .finally(() => setLoading(false));
  }, [pdfId]);

  if (loading) return <p style={{ fontSize: '13px', color: c.textSec }}>Loading…</p>;
  if (error)   return <ErrorBanner msg={error} />;
  if (!data?.results?.length) return (
    <div style={{ ...card, textAlign: 'center', padding: '40px' }}>
      <BarChart2 size={36} strokeWidth={1.25} style={{ opacity: 0.2, marginBottom: '12px' }} />
      <p style={{ fontSize: '14px', color: c.textSec, margin: 0 }}>No quiz results yet. Take a quiz to start tracking.</p>
    </div>
  );

  const { trend = [], weak_topics = [], summary, results } = data;
  const maxPct = Math.max(...trend.map(t => t.pct ?? 0), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '10px' }}>
          {[['Quizzes', summary.total_quizzes], ['Avg', `${summary.avg_score_pct}%`], ['Latest', `${summary.latest_pct}%`], ['Change', summary.improvement != null ? `${summary.improvement > 0 ? '+' : ''}${summary.improvement}%` : '—']].map(([label, value], i) => (
            <div key={i} style={{ ...card, textAlign: 'center', padding: '14px' }}>
              <div style={{ fontSize: '22px', fontWeight: 800, color: c.accent }}>{value}</div>
              <div style={{ fontSize: '11px', color: c.textSec, marginTop: '4px' }}>{label}</div>
            </div>
          ))}
        </div>
      )}
      {trend.length > 1 && (
        <div style={card}>
          <SecTitle>Score Trend</SecTitle>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', height: '80px' }}>
            {trend.map((t, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                <div style={{ width: '100%', background: c.accent, borderRadius: '3px 3px 0 0', height: `${Math.round((t.pct / maxPct) * 65)}px`, minHeight: '2px' }} />
                <span style={{ fontSize: '10px', color: c.textSec }}>{t.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {weak_topics.length > 0 && (
        <div style={card}>
          <SecTitle>Weak Areas</SecTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {weak_topics.map((t, i) => <span key={i} style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', background: c.warningBg, color: c.warningFg, fontWeight: 600 }}>{t}</span>)}
          </div>
        </div>
      )}
      <div style={card}>
        <SecTitle>History ({results.length})</SecTitle>
        {results.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: i < results.length - 1 ? `1px solid ${c.border}` : 'none', fontSize: '13px' }}>
            <span style={{ color: c.textSec }}>{new Date(r.created_at).toLocaleDateString()}</span>
            <span style={{ fontWeight: 600 }}>{r.score}/{r.total}</span>
            <span style={{ color: r.total > 0 && (r.score / r.total) >= 0.7 ? c.success : c.warning, fontWeight: 600 }}>{r.total > 0 ? `${Math.round((r.score / r.total) * 100)}%` : '—'}</span>
          </div>
        ))}
      </div>

      {/* RAG Health — evaluation metrics */}
      {ragMetrics?.summary && ragMetrics.summary.total_queries > 0 && (
        <div style={card}>
          <SecTitle>RAG Health</SecTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            {[
              ['Queries',    ragMetrics.summary.total_queries],
              ['Avg latency',`${ragMetrics.summary.avg_latency_ms}ms`],
              ['p95 latency',`${ragMetrics.summary.p95_latency_ms}ms`],
              ['Avg chunks', ragMetrics.summary.avg_chunks_retrieved],
              ['Success',    `${ragMetrics.summary.retrieval_success_pct}%`],
            ].map(([label, value], i) => (
              <div key={i} style={{ textAlign: 'center', padding: '10px', borderRadius: '8px', background: c.bgAlt, border: `1px solid ${c.border}` }}>
                <div style={{ fontSize: '18px', fontWeight: 800, color: c.accent }}>{value}</div>
                <div style={{ fontSize: '10px', color: c.textSec, marginTop: '3px' }}>{label}</div>
              </div>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: '11px', color: c.textSec }}>
            Powered by Hybrid BM25 + Vector search with cross-encoder reranking.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Shared primitives ──────────────────────────────────────────────────────────

function ErrorBanner({ msg, onDismiss }) {
  return (
    <div style={{ background: c.dangerBg, border: `1px solid ${c.danger}55`, borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: c.dangerFg, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      {msg}
      {onDismiss && <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.dangerFg, fontWeight: 700, fontSize: '16px', lineHeight: 1, padding: '0 0 0 8px' }}>×</button>}
    </div>
  );
}

function SecTitle({ children, style }) {
  return <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 700, color: c.textPri, ...style }}>{children}</h3>;
}

function ProgressBar({ pct }) {
  return (
    <div style={{ height: '4px', background: c.border, borderRadius: '4px' }}>
      <div style={{ height: '100%', background: c.accent, borderRadius: '4px', width: `${pct}%`, transition: 'width 0.3s' }} />
    </div>
  );
}

function DiffBadge({ d }) {
  const map = {
    easy:   [c.successBg, c.successFg],
    medium: [c.warningBg, c.warningFg],
    hard:   [c.dangerBg,  c.dangerFg],
  };
  const [bg, fg] = map[d] ?? ['var(--bg-color, #f3f4f6)', c.textSec];
  return <span style={{ marginLeft: '8px', fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: bg, color: fg }}>{d}</span>;
}
