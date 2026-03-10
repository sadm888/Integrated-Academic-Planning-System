import React, { useState, useEffect, useMemo } from 'react';
import { academicAPI, chatAPI, documentAPI, BACKEND_URL } from '../services/api';
import { sizeLabel, FileTypeIcon } from '../utils/fileUtils';
import { Trash2, FileText, MessageSquare } from 'lucide-react';

function getResourceUrl(r) {
  const token = localStorage.getItem('token') || '';
  if (r.source === 'chat_unlinked') return chatAPI.getFileUrl(r.chat_message_id);
  if (r.source === 'document') return `${BACKEND_URL}/api/document/${r.document_id}/download?token=${encodeURIComponent(token)}`;
  return academicAPI.getFileUrl(r.id);
}

/**
 * FilePickerModal — pick an existing file from Documents or Chat Files.
 * onSelect(File) is called with a synthetic File object ready for upload.
 * onClose closes the modal.
 * user — current logged-in user (for delete permissions).
 */
export default function FilePickerModal({ onSelect, onClose, user }) {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetching, setFetching] = useState(false);
  const [search, setSearch] = useState('');
  const [activeSection, setActiveSection] = useState(null); // null | 'docs' | 'chat'
  const [deletingId, setDeletingId] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    academicAPI.getAllResources()
      .then(res => setResources(res.data.resources || []))
      .catch(() => setError('Failed to load files'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const { docFiles, chatFiles } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = q
      ? resources.filter(r => (r.name || '').toLowerCase().includes(q) || (r.uploaded_by_name || '').toLowerCase().includes(q))
      : resources;
    return {
      docFiles: all.filter(r => r.source !== 'chat_unlinked'),
      chatFiles: all.filter(r => r.source === 'chat_unlinked'),
    };
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
    if (files.length === 0) {
      return <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '24px 0', fontSize: '13px' }}>{emptyMsg}</p>;
    }
    return files.map(r => (
      <div key={r.id} style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '9px 12px', borderRadius: '8px',
        background: 'var(--card-bg)', border: '1px solid var(--border-color)',
        marginBottom: '6px',
      }}>
        <FileTypeIcon mime={r.mime_type} size={20} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            {r.uploaded_by_name}{r.classroom_name ? ` · ${r.classroom_name}` : ''}{r.size ? ` · ${sizeLabel(r.size)}` : ''}
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

  const SectionHeader = ({ id, icon, label, count }) => (
    <div
      onClick={() => setActiveSection(activeSection === id ? null : id)}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '11px 14px', borderRadius: '10px',
        background: activeSection === id ? 'var(--bg-color)' : 'var(--card-bg)',
        border: `1.5px solid ${activeSection === id ? '#667eea55' : 'var(--border-color)'}`,
        marginBottom: '8px', cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>
      <span style={{ flex: 1, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{count} file{count !== 1 ? 's' : ''}</span>
      <span style={{ fontSize: '14px', color: 'var(--text-secondary)', transition: 'transform 0.2s', transform: activeSection === id ? 'rotate(90deg)' : 'none' }}>›</span>
    </div>
  );

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
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>Pick from Files</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: 'var(--text-secondary)', lineHeight: 1, padding: '2px 6px' }}>×</button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          <input
            type="text"
            placeholder="Search files…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '7px 12px', borderRadius: '8px',
              border: '1px solid var(--border-color)', background: 'var(--bg-color)',
              color: 'var(--text-primary)', fontSize: '13px', boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
          {loading ? (
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '32px 0' }}>Loading…</p>
          ) : error ? (
            <p style={{ color: '#dc2626', textAlign: 'center', padding: '16px' }}>{error}</p>
          ) : (
            <>
              <SectionHeader id="docs" icon={<FileText size={20} strokeWidth={1.75} />} label="Documents" count={docFiles.length} />
              {activeSection === 'docs' && (
                <div style={{ marginBottom: '12px', paddingLeft: '4px' }}>
                  {renderFiles(docFiles, 'No documents found.')}
                </div>
              )}

              <SectionHeader id="chat" icon={<MessageSquare size={20} strokeWidth={1.75} />} label="Chat Files" count={chatFiles.length} />
              {activeSection === 'chat' && (
                <div style={{ marginBottom: '12px', paddingLeft: '4px' }}>
                  {renderFiles(chatFiles, 'No chat files found.')}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
