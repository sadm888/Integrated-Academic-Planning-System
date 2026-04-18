import React, { useState, useEffect, useMemo } from 'react';
import { academicAPI, chatAPI, documentAPI, BACKEND_URL } from '../services/api';
import { sizeLabel, FileTypeIcon } from '../utils/fileUtils';
import { Trash2, X, FileText, BookOpen, Calendar, ClipboardList, FolderOpen, MessageSquare, Folder, GraduationCap, FlaskConical } from 'lucide-react';

function getResourceUrl(r) {
  const token = localStorage.getItem('token') || '';
  if (r.source === 'chat_unlinked') return chatAPI.getFileUrl(r.chat_message_id);
  if (r.source === 'document') return `${BACKEND_URL}/api/document/${r.document_id}/download?token=${encodeURIComponent(token)}`;
  return academicAPI.getFileUrl(r.id);
}

const SECTION_ICON_MAP = {
  'PYQ':         FileText,
  'Books':       BookOpen,
  'Schedule':    Calendar,
  'Course Plan': ClipboardList,
  'Documents':   FolderOpen,
  'Chat Files':  MessageSquare,
  'Lab':         FlaskConical,
  'Notes':       GraduationCap,
};

/**
 * FilePickerModal — pick any file from anywhere on the platform.
 * Groups files by section_name (PYQ, Books, Chat Files, Documents, etc.)
 * matching exactly what appears in the Files nav page.
 * onSelect(File) is called with a synthetic File object ready for upload.
 */
export default function FilePickerModal({ onSelect, onClose, user, excludePdf = false }) {
  const [resources,     setResources]     = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');
  const [fetching,      setFetching]      = useState(false);
  const [search,        setSearch]        = useState('');
  const [activeSection, setActiveSection] = useState(null);
  const [deletingId,    setDeletingId]    = useState(null);

  useEffect(() => {
    academicAPI.getAllResources()
      .then(res => setResources(res.data.resources || []))
      .catch(() => setError('Failed to load files'))
      .finally(() => setLoading(false));
  }, []);

  // Group all resources by section_name, preserving insertion order
  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    let all = excludePdf
      ? resources.filter(r => r.mime_type !== 'application/pdf' && !(r.name || '').toLowerCase().endsWith('.pdf'))
      : resources;
    if (q) all = all.filter(r =>
      (r.name || '').toLowerCase().includes(q) ||
      (r.subject_name || '').toLowerCase().includes(q) ||
      (r.classroom_name || '').toLowerCase().includes(q) ||
      (r.semester_name || '').toLowerCase().includes(q) ||
      (r.section_name || '').toLowerCase().includes(q)
    );

    const map = new Map(); // section_name → items[]
    for (const r of all) {
      const key = r.section_name || 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return map;
  }, [resources, search]);

  const handleSelect = async (resource) => {
    setFetching(true);
    try {
      const url = getResourceUrl(resource);
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch file');
      const blob = await res.blob();
      const file = new File([blob], resource.name, {
        type: resource.mime_type || blob.type || 'application/octet-stream',
      });
      onSelect(file);
      onClose();
    } catch {
      setError('Could not load file. Try downloading it manually.');
      setFetching(false);
    }
  };

  const handleDelete = async (resource) => {
    if (!window.confirm(`Delete "${resource.name}"? This cannot be undone.`)) return;
    setDeletingId(resource.id);
    try {
      if (resource.source === 'document') {
        await documentAPI.delete(resource.document_id);
      } else if (resource.source === 'chat_unlinked') {
        await chatAPI.deleteChatFile(resource.chat_message_id);
      } else {
        await academicAPI.deleteResource(resource.semester_id, resource.id);
      }
      setResources(prev => prev.filter(r => r.id !== resource.id));
    } catch {
      setError('Failed to delete file.');
    } finally {
      setDeletingId(null);
    }
  };

  const canDelete = (r) => {
    if (!user) return false;
    const uid = user.id || user._id;
    return r.uploaded_by === uid || r.uploaded_by === String(uid);
  };

  const renderFiles = (files, emptyMsg) => {
    if (files.length === 0)
      return <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '24px 0', fontSize: '13px' }}>{emptyMsg}</p>;
    return files.map(r => (
      <div key={r.id} style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '9px 12px', borderRadius: '8px',
        background: 'var(--card-bg)', border: '1px solid var(--border-color)',
        marginBottom: '6px',
      }}>
        <FileTypeIcon mime={r.mime_type} size={20} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.name}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            {[r.classroom_name, r.semester_name, r.subject_name].filter(Boolean).join(' · ')}
            {r.size ? ` · ${sizeLabel(r.size)}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          {canDelete(r) && (
            <button
              onClick={() => handleDelete(r)}
              disabled={deletingId === r.id}
              title="Delete file"
              style={{
                background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
                borderRadius: '6px', padding: '5px 10px', fontSize: '12px',
                fontWeight: 600, cursor: deletingId === r.id ? 'wait' : 'pointer',
              }}
            >
              {deletingId === r.id ? '…' : <Trash2 size={12} strokeWidth={1.75} />}
            </button>
          )}
          <button
            onClick={() => handleSelect(r)}
            disabled={fetching}
            style={{
              background: '#667eea', color: 'white', border: 'none',
              borderRadius: '6px', padding: '5px 14px', fontSize: '12px',
              fontWeight: 600, cursor: fetching ? 'wait' : 'pointer',
            }}
          >
            {fetching ? '…' : 'Use'}
          </button>
        </div>
      </div>
    ));
  };

  const SectionHeader = ({ id, label, count }) => {
    const IconComp = SECTION_ICON_MAP[label] || Folder;
    const active = activeSection === id;
    return (
      <div
        onClick={() => setActiveSection(active ? null : id)}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '11px 14px', borderRadius: '10px',
          background: active ? 'var(--bg-color)' : 'var(--card-bg)',
          border: `1.5px solid ${active ? '#667eea55' : 'var(--border-color)'}`,
          marginBottom: '8px', cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        <IconComp size={18} strokeWidth={1.75} style={{ color: active ? '#667eea' : 'var(--text-secondary)', flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{count} file{count !== 1 ? 's' : ''}</span>
        <span style={{ fontSize: '14px', color: 'var(--text-secondary)', transition: 'transform 0.2s', transform: active ? 'rotate(90deg)' : 'none' }}>›</span>
      </div>
    );
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 800, padding: '20px' }}
      onClick={onClose}
    >
      <div
        style={{ width: '100%', maxWidth: '520px', maxHeight: '580px', background: 'var(--card-bg)', borderRadius: '16px', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <div style={{ flex: 1, fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>Pick from Files</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px', display: 'flex', alignItems: 'center' }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          <input
            type="text"
            placeholder="Search files, subjects, classrooms…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '7px 12px', borderRadius: '8px',
              border: '1px solid var(--border-color)', background: 'var(--bg-color)',
              color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box', outline: 'none',
            }}
          />
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
          {error && <p style={{ color: '#dc2626', fontSize: '12px', marginBottom: '10px' }}>{error}</p>}
          {loading ? (
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '32px 0' }}>Loading…</p>
          ) : sections.size === 0 ? (
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '32px 0', fontSize: '13px' }}>
              {search ? 'No files match your search.' : 'No files found.'}
            </p>
          ) : (
            Array.from(sections.entries()).map(([label, files]) => (
              <div key={label}>
                <SectionHeader id={label} label={label} count={files.length} />
                {activeSection === label && (
                  <div style={{ marginBottom: '12px', paddingLeft: '4px' }}>
                    {renderFiles(files, `No files in ${label}.`)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
