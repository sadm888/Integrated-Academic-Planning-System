import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { semesterAPI, academicAPI, todoAPI, subjectAPI } from '../services/api';
import { useSocket } from '../hooks/useSocket';
import FilePickerModal from '../components/FilePickerModal';
import { sizeLabel, FileTypeIcon } from '../utils/fileUtils';
import {
  Calendar, ClipboardList, GraduationCap, BookMarked, Folder,
  Lock, Unlock, Eye, EyeOff, X,
  FileText, Link2,
} from 'lucide-react';

const SECTION_ICON_MAP = {
  schedule: Calendar,
  course_plan: ClipboardList,
  pyq: GraduationCap,
  books: BookMarked,
};

function SectionIcon({ id, name, size = 14 }) {
  const Icon = SECTION_ICON_MAP[id]
    || (name && /notes?|class notes?/i.test(name) ? FileText : null)
    || (name && /links?|meet|class link/i.test(name) ? Link2 : null)
    || Folder;
  return <Icon size={size} strokeWidth={1.75} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />;
}

// ── File row ────────────────────────────────────────────────────────────────

function FileRow({ resource, onDelete, onDragStart, canDelete, isCr, semesterId, onTogglePublic, onHide, userId, folderName }) {
  const url = academicAPI.getFileUrl(resource.id);
  const isPyqOrBooks = resource.category === 'pyq' || resource.category === 'books';
  const isPublic = resource.is_public !== false; // default true
  // Members (non-CR) can hide CR's public PYQ/Books files from their own view
  const canHide = !isCr && isPyqOrBooks && isPublic && resource.uploaded_by !== userId && !!onHide;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, resource)}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 12px', borderRadius: '8px', background: 'var(--card-bg)',
        border: `1px solid ${isPyqOrBooks && !isPublic ? 'rgba(156,163,175,0.4)' : 'var(--border-color)'}`,
        cursor: 'grab',
        opacity: isPyqOrBooks && !isPublic ? 0.75 : 1,
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      <span style={{ color: 'var(--text-secondary)', opacity: 0.35, fontSize: '13px', flexShrink: 0, userSelect: 'none', letterSpacing: '-1px' }} title="Drag to move between folders">⠿⠿</span>
      <FileTypeIcon mime={resource.mime_type} size={18} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)',
            textDecoration: 'none', display: 'block',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
          title={resource.name}
        >
          {resource.name}
        </a>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '1px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {resource.uploaded_by_name}
          {resource.size ? ` · ${sizeLabel(resource.size)}` : ''}
          {resource.source === 'chat' && (
            <span style={{ color: '#667eea', fontWeight: 600 }}>from chat</span>
          )}
          {folderName && (
            <span style={{ padding: '1px 6px', borderRadius: '10px', fontSize: '10px', fontWeight: 600, background: 'rgba(102,126,234,0.12)', color: '#667eea', border: '1px solid rgba(102,126,234,0.2)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              <Folder size={9} strokeWidth={2} />{folderName}
            </span>
          )}
          {/* Visibility badge for PYQ/Books */}
          {isPyqOrBooks && (
            <span style={{
              padding: '1px 6px', borderRadius: '999px', fontSize: '10px', fontWeight: 700,
              background: isPublic ? 'rgba(16,185,129,0.12)' : 'rgba(156,163,175,0.15)',
              color: isPublic ? '#059669' : 'var(--text-secondary)',
            }}>
              {isPublic ? 'Public' : 'Private'}
            </span>
          )}
        </div>
      </div>
      {/* CR toggle public/private on PYQ/Books — toggle switch */}
      {isCr && isPyqOrBooks && onTogglePublic && (
        <button
          onClick={() => onTogglePublic(resource.id)}
          title={isPublic ? 'Make private' : 'Make public'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '2px 4px', flexShrink: 0,
          }}
        >
          <span style={{
            display: 'inline-flex', alignItems: 'center',
            width: '28px', height: '16px', borderRadius: '8px',
            background: isPublic ? '#059669' : '#d1d5db',
            position: 'relative', transition: 'background 0.2s', flexShrink: 0,
          }}>
            <span style={{
              position: 'absolute', left: isPublic ? '14px' : '2px',
              width: '12px', height: '12px', borderRadius: '50%',
              background: 'white', transition: 'left 0.2s',
            }} />
          </span>
          <span style={{ fontSize: '10px', fontWeight: 600, color: isPublic ? '#059669' : 'var(--text-secondary)' }}>
            {isPublic ? 'Public' : 'Private'}
          </span>
        </button>
      )}
      {canHide && (
        <button
          onClick={() => onHide(resource.id)}
          title="Remove from my view (won't affect others)"
          style={{
            background: 'none', border: '1px solid var(--border-color)', cursor: 'pointer',
            color: 'var(--text-secondary)', fontSize: '11px', fontWeight: 600,
            padding: '2px 7px', borderRadius: '4px', flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#dc2626'; e.currentTarget.style.borderColor = '#fecaca'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
        >Remove</button>
      )}
      {canDelete && (
        <button
          onClick={() => onDelete(resource.id)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#dc2626', fontSize: '14px', padding: '2px 6px', borderRadius: '4px', flexShrink: 0,
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        ><X size={14} strokeWidth={2} /></button>
      )}
    </div>
  );
}

// ── Section panel ────────────────────────────────────────────────────────────

function SectionPanel({ section, files, semesterId, subjectId, onDelete, onDrop, uploading, uploadProgress, onUpload, isCr, userId, onTogglePublic, onHide, folders, user }) {
  const [dragOver, setDragOver] = useState(false);
  const [pendingFile, setPendingFile] = useState(null); // staged file waiting for confirm
  const [showFilePicker, setShowFilePicker] = useState(false);
  const inputRef = useRef(null);
  const canUpload = !section.cr_only || isCr;
  const isPyqOrBooks = section.id === 'pyq' || section.id === 'books';

  const cancelPending = () => { setPendingFile(null); if (inputRef.current) inputRef.current.value = ''; };
  const confirmUpload = () => { if (pendingFile) { onUpload(pendingFile, true); setPendingFile(null); if (inputRef.current) inputRef.current.value = ''; } };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: uploading ? '6px' : '10px', flexWrap: 'wrap' }}>
        <SectionIcon id={section.id} size={16} />
        <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>{section.name}</span>
        {section.cr_only && (
          <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '999px', background: '#fef3c7', color: '#92400e' }}>
            CR only
          </span>
        )}
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {files.length} file{files.length !== 1 ? 's' : ''}
        </span>
        {canUpload && (
          <>
            <input
              ref={inputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files[0]) setPendingFile(e.target.files[0]); }}
            />
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading || !!pendingFile}
              style={{
                background: 'rgba(102,126,234,0.1)', color: '#667eea', border: 'none',
                borderRadius: '6px', padding: '4px 10px', fontSize: '12px',
                fontWeight: 600, cursor: (uploading || pendingFile) ? 'not-allowed' : 'pointer',
                opacity: (uploading || pendingFile) ? 0.5 : 1,
              }}
            >
              {uploading ? `${uploadProgress}%` : '+ Upload'}
            </button>
            <button
              onClick={() => setShowFilePicker(true)}
              disabled={uploading || !!pendingFile}
              title="Pick from Files"
              style={{
                background: 'rgba(102,126,234,0.08)', color: '#667eea', border: '1px solid rgba(102,126,234,0.3)',
                borderRadius: '6px', padding: '4px 10px', fontSize: '12px',
                fontWeight: 600, cursor: (uploading || pendingFile) ? 'not-allowed' : 'pointer',
                opacity: (uploading || pendingFile) ? 0.5 : 1,
              }}
            >
              Files
            </button>
            {showFilePicker && (
              <FilePickerModal
                onSelect={file => { setShowFilePicker(false); onUpload(file, true); }}
                onClose={() => setShowFilePicker(false)}
                user={user}
              />
            )}
          </>
        )}
      </div>

      {/* Staged file confirmation row */}
      {pendingFile && !uploading && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px',
          padding: '8px 12px', borderRadius: '8px',
          background: 'rgba(102,126,234,0.06)', border: '1.5px solid rgba(102,126,234,0.25)',
          flexWrap: 'wrap',
        }}>
          <FileTypeIcon mime={pendingFile.type} size={16} />
          <span style={{ flex: 1, fontSize: '13px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {pendingFile.name}
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0 }}>
            {sizeLabel(pendingFile.size)}
          </span>
          <button
            onClick={confirmUpload}
            style={{
              background: '#667eea', color: 'white', border: 'none',
              borderRadius: '6px', padding: '4px 12px', fontSize: '12px',
              fontWeight: 700, cursor: 'pointer', flexShrink: 0,
            }}
          >Upload</button>
          <button
            onClick={cancelPending}
            style={{
              background: 'none', border: '1px solid var(--border-color)',
              borderRadius: '6px', padding: '4px 8px', fontSize: '12px',
              cursor: 'pointer', color: 'var(--text-secondary)', flexShrink: 0,
            }}
          >Cancel</button>
        </div>
      )}

      {uploading && (
        <div style={{ height: '3px', background: '#e5e7eb', borderRadius: '2px', marginBottom: '10px', overflow: 'hidden' }}>
          <div style={{ height: '100%', background: '#667eea', borderRadius: '2px', width: `${uploadProgress}%`, transition: 'width 0.2s ease' }} />
        </div>
      )}

      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault(); setDragOver(false);
          // If a real file is dragged in from outside (not a resource move), stage it
          if (e.dataTransfer.files?.length > 0) {
            setPendingFile(e.dataTransfer.files[0]);
          } else {
            onDrop(e, section.id);
          }
        }}
        style={{
          minHeight: '56px', borderRadius: '8px',
          border: `2px dashed ${dragOver ? '#667eea' : 'var(--border-color)'}`,
          background: dragOver ? 'rgba(102,126,234,0.1)' : 'transparent',
          padding: files.length ? '8px' : '0',
          display: 'flex', flexDirection: 'column', gap: '6px',
          transition: 'all 0.15s',
        }}
      >
        {files.length === 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '52px', color: 'var(--text-secondary)', fontSize: '12px',
          }}>
            {canUpload ? 'Drop files here or click Upload' : 'No files yet'}
          </div>
        )}
        {files.map(r => (
          <FileRow
            key={r.id}
            resource={r}
            onDelete={onDelete}
            canDelete={isCr || r.uploaded_by === userId}
            onDragStart={(e, res) => e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'resource', id: res.id }))}
            isCr={isCr}
            userId={userId}
            semesterId={semesterId}
            onTogglePublic={onTogglePublic}
            onHide={onHide}
            folderName={r.folder_id && folders?.length ? (folders.find(f => f.id === r.folder_id)?.name || null) : null}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function Academics({ user }) {
  const { classroomId, semesterId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [semester, setSemester] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore state from localStorage on mount
  const _savedState = (() => {
    try { return JSON.parse(localStorage.getItem(`acad_state_${semesterId}`) || 'null'); } catch { return null; }
  })();

  // Sidebar state: 'subjects' | 'sections'
  const [viewLevel, setViewLevel] = useState(_savedState?.viewLevel || 'subjects');
  const [activeSubjectId, setActiveSubjectId] = useState(_savedState?.activeSubjectId || null);
  const [activeSubjectName, setActiveSubjectName] = useState(_savedState?.activeSubjectName || '');

  const [sections, setSections] = useState([]);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState(_savedState?.activeSectionId || null);

  const [resources, setResources] = useState([]);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');

  // Add section form
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [sectionLoading, setSectionLoading] = useState(false);

  // Folders within a section
  const [folders, setFolders] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState(_savedState?.activeFolderId ?? null); // null = all / uncategorized
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderLoading, setFolderLoading] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState(undefined); // undefined = none, null = 'All' tab

  // Subject management (CR only)
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectCode, setNewSubjectCode] = useState('');
  const [subjectLoading, setSubjectLoading] = useState(false);

  // Subject todos
  const [todos, setTodos] = useState([]);
  const [newTodoText, setNewTodoText] = useState('');
  const [todoLoading, setTodoLoading] = useState(false);
  const pendingRestoreFolderRef = useRef(undefined); // sentinel for folder restore on navigation back

  // Remove chat-linked resources when the underlying message is deleted/tombstoned
  const handleChatDeleted = useCallback(({ message_id }) => {
    if (!message_id) return;
    setResources(prev => prev.filter(r => !(r.source === 'chat' && r.chat_message_id === message_id)));
  }, []);

  useSocket(semesterId, {
    onDeleted: handleChatDeleted,
    onTombstoned: handleChatDeleted,
  });

  const reloadSemester = () =>
    semesterAPI.getDetail(semesterId).then(res => setSemester(res.data.semester));

  useEffect(() => {
    semesterAPI.getDetail(semesterId)
      .then(res => setSemester(res.data.semester))
      .catch(() => setError('Failed to load semester'))
      .finally(() => setLoading(false));
  }, [semesterId]);

  // Auto-select subject from ?subject= query param
  // Persist nav state to localStorage whenever key state changes
  useEffect(() => {
    localStorage.setItem(`acad_state_${semesterId}`, JSON.stringify({
      viewLevel, activeSubjectId, activeSubjectName, activeSectionId, activeFolderId,
    }));
  }, [viewLevel, activeSubjectId, activeSubjectName, activeSectionId, activeFolderId, semesterId]);

  // Restore subject data when returning with a saved activeSubjectId
  useEffect(() => {
    if (!semester || !activeSubjectId || viewLevel !== 'sections') return;
    const subject = semester.subjects?.find(s => String(s.id) === String(activeSubjectId));
    if (subject) selectSubject(subject, { restoreSectionId: activeSectionId, restoreFolderId: activeFolderId });
  }, [semester]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!semester) return;
    const subjectId = new URLSearchParams(location.search).get('subject');
    if (!subjectId) return;
    const subject = semester.subjects?.find(s => s.id === subjectId);
    if (subject) selectSubject(subject);
  }, [semester]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectSubject = async (subject, opts = {}) => {
    setActiveSubjectId(subject.id);
    setActiveSubjectName(subject.name);
    setViewLevel('sections');
    setActiveSectionId(null);
    setSectionsLoading(true);
    setResources([]);
    setError('');
    try {
      const [secRes, resRes, todoRes] = await Promise.all([
        academicAPI.getSubjectSections(semesterId, subject.id),
        academicAPI.getResources(semesterId, { subject_id: subject.id }),
        todoAPI.list(semesterId),
      ]);
      const secs = secRes.data.sections || [];
      setSections(secs);
      setResources(resRes.data.resources || []);
      // Restore previously selected section, or default to first
      const restoredSec = opts.restoreSectionId && secs.find(s => String(s.id) === String(opts.restoreSectionId));
      if (opts.restoreFolderId !== undefined) pendingRestoreFolderRef.current = opts.restoreFolderId ?? null;
      setActiveSectionId(restoredSec ? restoredSec.id : secs.length > 0 ? secs[0].id : null);
      // Filter todos for this subject
      const allTodos = todoRes.data.todos || [];
      setTodos(allTodos.filter(t => t.subject_id === subject.id));
    } catch (e) {
      setError('Failed to load subject data');
    } finally {
      setSectionsLoading(false);
    }
  };

  // Load folders whenever section changes
  useEffect(() => {
    if (!activeSectionId || !activeSubjectId) { setFolders([]); setActiveFolderId(null); return; }
    academicAPI.getFolders(semesterId, activeSubjectId, activeSectionId)
      .then(res => setFolders(res.data.folders || []))
      .catch(() => setFolders([]));
    if (pendingRestoreFolderRef.current !== undefined) {
      setActiveFolderId(pendingRestoreFolderRef.current);
      pendingRestoreFolderRef.current = undefined;
    } else {
      setActiveFolderId(null);
    }
  }, [activeSectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const backToSubjects = () => {
    setViewLevel('subjects');
    setActiveSubjectId(null);
    setActiveSubjectName('');
    setActiveSectionId(null);
    setSections([]);
    setResources([]);
    setTodos([]);
    setNewTodoText('');
    setShowAddSection(false);
    setFolders([]);
    setActiveFolderId(null);
  };

  const handleAddFolder = async (e) => {
    e.preventDefault();
    if (!newFolderName.trim() || !activeSectionId) return;
    setFolderLoading(true);
    try {
      const res = await academicAPI.createFolder(semesterId, activeSubjectId, activeSectionId, newFolderName.trim());
      setFolders(prev => [...prev, res.data.folder]);
      setNewFolderName(''); setShowAddFolder(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create folder');
    } finally { setFolderLoading(false); }
  };

  const handleAddSubject = async (e) => {
    e.preventDefault();
    if (!newSubjectName.trim()) return;
    setSubjectLoading(true);
    setError('');
    try {
      await subjectAPI.create({ semester_id: semesterId, classroom_id: classroomId, name: newSubjectName.trim(), code: newSubjectCode.trim() || undefined });
      setNewSubjectName(''); setNewSubjectCode(''); setShowAddSubject(false);
      await reloadSemester();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add subject');
    } finally { setSubjectLoading(false); }
  };

  const handleDeleteSubject = async (subjectId, subjectName) => {
    if (!window.confirm(`Delete "${subjectName}" and all its files? This cannot be undone.`)) return;
    try {
      await subjectAPI.delete(subjectId);
      backToSubjects();
      await reloadSemester();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete subject');
    }
  };

  const handleDeleteFolder = async (folderId) => {
    if (!window.confirm('Delete this folder? Files inside will be moved to the root of this section.')) return;
    try {
      await academicAPI.deleteFolder(semesterId, activeSubjectId, activeSectionId, folderId);
      setFolders(prev => prev.filter(f => f.id !== folderId));
      if (activeFolderId === folderId) setActiveFolderId(null);
      await reloadResources();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete folder');
    }
  };

  const reloadResources = async () => {
    if (!activeSubjectId) return;
    const resRes = await academicAPI.getResources(semesterId, { subject_id: activeSubjectId });
    setResources(resRes.data.resources || []);
  };

  const handleUpload = async (file, sectionId, isPublic = true) => {
    setUploading(true);
    setUploadProgress(0);
    setError('');
    try {
      await academicAPI.upload(semesterId, file, activeSubjectId, sectionId, (event) => {
        if (event.total) setUploadProgress(Math.round((event.loaded / event.total) * 100));
      }, activeFolderId, isPublic);
      await reloadResources();
    } catch (e) {
      setError(e.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleTogglePublic = async (resourceId) => {
    setError('');
    try {
      const res = await academicAPI.toggleResourcePublic(semesterId, resourceId);
      setResources(prev => prev.map(r => r.id === resourceId ? { ...r, is_public: res.data.is_public } : r));
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to update visibility');
    }
  };

  const handleHideResource = async (resourceId) => {
    if (!window.confirm('Remove this file from your view? This only affects you — it stays visible to other members.')) return;
    setError('');
    try {
      await academicAPI.hideResource(semesterId, resourceId);
      setResources(prev => prev.filter(r => r.id !== resourceId));
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to hide resource');
    }
  };

  const handleDelete = async (resourceId) => {
    if (!window.confirm('Delete this file?')) return;
    setError('');
    try {
      await academicAPI.deleteResource(semesterId, resourceId);
      setResources(prev => prev.filter(r => r.id !== resourceId));
    } catch (e) {
      setError(e.response?.data?.error || 'Delete failed');
    }
  };

  const handleDrop = async (e, targetSectionId) => {
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (data.type === 'resource') {
        await academicAPI.moveResource(semesterId, data.id, { category: targetSectionId, subject_id: activeSubjectId });
      } else if (data.type === 'chat') {
        await academicAPI.linkChatFile(semesterId, data.message_id, activeSubjectId, targetSectionId, activeFolderId || undefined);
      }
      await reloadResources();
    } catch (e) {
      setError(e.response?.data?.error || 'Move failed');
    }
  };

  const handleDropOnFolder = async (e, targetFolderId) => {
    e.preventDefault();
    setDragOverFolderId(undefined);
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (data.type === 'resource') {
        // targetFolderId: null = remove from folder (put in All), string = move to that folder
        await academicAPI.moveResource(semesterId, data.id, { folder_id: targetFolderId || '' });
        await reloadResources();
      } else if (data.type === 'chat') {
        // Link chat file into the active section and the dropped-on folder
        await academicAPI.linkChatFile(semesterId, data.message_id, activeSubjectId, activeSectionId, targetFolderId || undefined);
        await reloadResources();
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Move failed');
    }
  };

  const handleAddSection = async (e) => {
    e.preventDefault();
    if (!newSectionName.trim()) return;
    setSectionLoading(true);
    setError('');
    try {
      const res = await academicAPI.createSubjectSection(semesterId, activeSubjectId, newSectionName.trim());
      setSections(prev => [...prev, res.data.section]);
      setActiveSectionId(res.data.section.id);
      setNewSectionName('');
      setShowAddSection(false);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to create section');
    } finally {
      setSectionLoading(false);
    }
  };

  const handleDeleteSection = async (sectionId) => {
    const sec = sections.find(s => s.id === sectionId);
    if (!window.confirm(`Delete "${sec?.name}" and all its files?`)) return;
    try {
      await academicAPI.deleteSubjectSection(semesterId, activeSubjectId, sectionId);
      const remaining = sections.filter(s => s.id !== sectionId);
      setSections(remaining);
      if (activeSectionId === sectionId) setActiveSectionId(remaining.length > 0 ? remaining[0].id : null);
      await reloadResources();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to delete section');
    }
  };

  const handleAddTodo = async (e) => {
    e.preventDefault();
    if (!newTodoText.trim() || !activeSubjectId) return;
    setTodoLoading(true);
    try {
      const res = await todoAPI.create({
        classroom_id: classroomId,
        semester_id: semesterId,
        text: newTodoText.trim(),
        subject_id: activeSubjectId,
      });
      setTodos(prev => [res.data.todo, ...prev]);
      setNewTodoText('');
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to add task');
    } finally { setTodoLoading(false); }
  };

  const handleToggleTodo = async (todoId) => {
    try {
      const res = await todoAPI.toggle(todoId);
      setTodos(prev => prev.map(t => t.id === todoId ? { ...t, completed: res.data.completed } : t));
    } catch {}
  };

  const handleDeleteTodo = async (todoId) => {
    try {
      await todoAPI.delete(todoId);
      setTodos(prev => prev.filter(t => t.id !== todoId));
    } catch {}
  };

  const handleToggleSection = async (sectionId) => {
    if (!activeSubjectId) return;
    try {
      const res = await academicAPI.toggleSection(semesterId, activeSubjectId, sectionId);
      const isNowHidden = res.data.hidden;
      setSections(prev => prev.map(s =>
        s.id === sectionId ? { ...s, hidden: isNowHidden } : s
      ));
      if (activeSectionId === sectionId && isNowHidden) setActiveSectionId(null);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to toggle section');
    }
  };

  // Per-user non-destructive hide/show for PYQ/Books (any member)
  const handleUserHideSection = async (sectionId) => {
    if (!activeSubjectId) return;
    try {
      const res = await academicAPI.userHideSection(semesterId, activeSubjectId, sectionId);
      const isNowHidden = res.data.user_hidden;
      setSections(prev => prev.map(s =>
        s.id === sectionId ? { ...s, user_hidden: isNowHidden } : s
      ));
      if (activeSectionId === sectionId && isNowHidden) setActiveSectionId(null);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to toggle section visibility');
    }
  };

  // Toggle is_private on own custom section
  const handleLockSection = async (sectionId) => {
    if (!activeSubjectId) return;
    try {
      const res = await academicAPI.lockSection(semesterId, activeSubjectId, sectionId);
      setSections(prev => prev.map(s =>
        s.id === sectionId ? { ...s, is_private: res.data.is_private } : s
      ));
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to lock section');
    }
  };

  const isCr = semester?.is_user_cr || false;
  const subjects = semester?.subjects || [];
  // Check if user owns the currently selected personal subject
  const activeSubject = subjects.find(s => s.id === activeSubjectId);
  const isSubjectOwner = Boolean(activeSubject?.personal && activeSubject?.created_by === user?.id);
  const activeSection = sections.find(s => s.id === activeSectionId);
  // Filter resources by section and active folder
  const sectionResources = resources.filter(r => {
    if (r.category !== activeSectionId) return false;
    if (activeFolderId === null) return true; // show all
    return (r.folder_id || null) === activeFolderId;
  });

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#667eea' }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)', overflow: 'hidden' }}>
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

      {/* ── Left sidebar ── */}
      <div style={{
        width: '240px', flexShrink: 0,
        borderRight: '1.5px solid var(--border-color)',
        background: 'var(--card-bg)',
        display: 'flex', flexDirection: 'column',
        overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ padding: '12px 16px 8px' }}>
          <Link
            to={`/classroom/${classroomId}/semester/${semesterId}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '8px',
              fontSize: '11px', color: 'var(--text-secondary)', textDecoration: 'none',
              fontWeight: 600, padding: '4px 8px', borderRadius: '6px',
              background: 'var(--bg-color)', border: '1px solid var(--border-color)',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--border-color)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-color)'}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Dashboard
          </Link>
          <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {semester?.name}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>Resources</div>
        </div>

        <div style={{ height: '1px', background: 'var(--border-color)', margin: '8px 0' }} />

        {/* Subjects view */}
        {viewLevel === 'subjects' && (
          <div style={{ padding: '0 8px', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1 }}>
              {subjects.length === 0 ? (
                <div style={{ padding: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  No subjects yet.{isCr && ' Add one below.'}
                </div>
              ) : (
                subjects.map(sub => (
                  <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: '2px', marginBottom: '2px' }}>
                    <button
                      onClick={() => selectSubject(sub)}
                      style={{
                        flex: 1, textAlign: 'left', padding: '9px 10px',
                        borderRadius: '8px', border: 'none', cursor: 'pointer',
                        fontSize: '13px', fontWeight: 500,
                        background: 'transparent', color: 'var(--text-primary)', minWidth: 0,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--border-color)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sub.code ? `${sub.code} — ` : ''}{sub.name}
                        </span>
                        {sub.personal && (
                          <span style={{ fontSize: '10px', color: '#7e22ce', background: '#fdf4ff', border: '1px solid #e9d5ff', borderRadius: '4px', padding: '1px 5px', flexShrink: 0 }}>
                            mine
                          </span>
                        )}
                      </div>
                    </button>
                    {isCr && !sub.personal && (
                      <button
                        onClick={() => handleDeleteSubject(sub.id, sub.name)}
                        title="Delete subject"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '14px', padding: '4px 5px', borderRadius: '4px', flexShrink: 0 }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#dc2626'; e.currentTarget.style.background = '#fef2f2'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'none'; }}
                      ><X size={13} strokeWidth={2} /></button>
                    )}
                  </div>
                ))
              )}
            </div>
            {/* CR: add subject */}
            {isCr && (
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px', marginTop: '8px' }}>
                {showAddSubject ? (
                  <form onSubmit={handleAddSubject} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <input
                      type="text" value={newSubjectName} onChange={e => setNewSubjectName(e.target.value)}
                      placeholder="Subject name *" required autoFocus disabled={subjectLoading}
                      style={{ padding: '7px 10px', border: '1.5px solid var(--border-color)', borderRadius: '6px', fontSize: '12px', background: 'var(--bg-color)', color: 'var(--text-primary)' }}
                    />
                    <input
                      type="text" value={newSubjectCode} onChange={e => setNewSubjectCode(e.target.value)}
                      placeholder="Code (optional)" disabled={subjectLoading}
                      style={{ padding: '7px 10px', border: '1.5px solid var(--border-color)', borderRadius: '6px', fontSize: '12px', background: 'var(--bg-color)', color: 'var(--text-primary)' }}
                    />
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button type="submit" disabled={subjectLoading || !newSubjectName.trim()} style={{ flex: 1, padding: '6px', background: '#667eea', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                        {subjectLoading ? '…' : 'Add'}
                      </button>
                      <button type="button" onClick={() => { setShowAddSubject(false); setNewSubjectName(''); setNewSubjectCode(''); }} style={{ padding: '6px 10px', background: 'var(--bg-color)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    onClick={() => setShowAddSubject(true)}
                    style={{ width: '100%', padding: '7px', background: 'rgba(102,126,234,0.08)', color: '#667eea', border: '1.5px dashed rgba(102,126,234,0.4)', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                  >+ Add Subject</button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Sections view (when a subject is selected) */}
        {viewLevel === 'sections' && (
          <>
            <div style={{ padding: '0 8px 4px' }}>
              <button
                onClick={backToSubjects}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 12px',
                  borderRadius: '8px', border: 'none', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 700, color: '#667eea',
                  background: 'transparent', display: 'flex', alignItems: 'center', gap: '4px',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(102,126,234,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                ← {activeSubjectName}
              </button>
            </div>

            <div style={{ height: '1px', background: 'var(--border-color)', margin: '2px 0 6px' }} />

            <div style={{ padding: '0 8px', flex: 1 }}>
              {sectionsLoading ? (
                <div style={{ padding: '12px', fontSize: '13px', color: 'var(--text-secondary)' }}>Loading…</div>
              ) : (
                sections.map(sec => (
                  <div key={sec.id} style={{ display: 'flex', alignItems: 'center', gap: '2px', marginBottom: '2px' }}>
                    {(() => {
                      const hiddenFromMe = sec.hidden || sec.user_hidden;
                      const isOwnCustom = !sec.is_default && sec.created_by === user?.id;
                      return (
                        <>
                          <button
                            onClick={() => !hiddenFromMe && setActiveSectionId(sec.id)}
                            style={{
                              flex: 1, textAlign: 'left',
                              padding: activeSectionId === sec.id ? '9px 10px 9px 8px' : '9px 10px',
                              borderRadius: activeSectionId === sec.id ? '0 8px 8px 0' : '8px',
                              border: 'none',
                              borderLeft: activeSectionId === sec.id ? '3px solid #667eea' : '3px solid transparent',
                              cursor: hiddenFromMe ? 'default' : 'pointer',
                              fontSize: '13px',
                              fontWeight: activeSectionId === sec.id ? 700 : 400,
                              background: activeSectionId === sec.id ? 'rgba(102,126,234,0.1)' : 'transparent',
                              color: hiddenFromMe ? 'var(--text-secondary)' : (activeSectionId === sec.id ? '#667eea' : 'var(--text-primary)'),
                              display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden',
                              opacity: hiddenFromMe ? 0.5 : 1,
                            }}
                          >
                            <SectionIcon id={sec.id} name={sec.name} size={13} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: hiddenFromMe ? 'line-through' : 'none' }}>{sec.name}</span>
                            {sec.cr_only && <Lock size={10} strokeWidth={2} style={{ marginLeft: 'auto', flexShrink: 0, color: '#d97706' }} />}
                            {sec.is_private && <Lock size={10} strokeWidth={2} style={{ marginLeft: 'auto', flexShrink: 0, color: '#7e22ce' }} />}
                          </button>

                          {/* CR/owner: global toggle (hide for everyone) on PYQ/Books */}
                          {(isCr || isSubjectOwner) && sec.is_default && !sec.non_deletable && (
                            <button
                              onClick={() => handleToggleSection(sec.id)}
                              title={sec.hidden ? 'Restore section for everyone' : 'Hide section for everyone (CR)'}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px', borderRadius: '4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                            >{sec.hidden ? <Eye size={13} strokeWidth={1.75} /> : <EyeOff size={13} strokeWidth={1.75} />}</button>
                          )}


                          {/* Delete (×) for custom sections: CR, subject owner, OR creator */}
                          {!sec.is_default && (isCr || isSubjectOwner || isOwnCustom) && (
                            <button
                              onClick={() => handleDeleteSection(sec.id)}
                              title="Delete section"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: '4px', borderRadius: '4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                            ><X size={13} strokeWidth={2} /></button>
                          )}

                          {/* Lock/unlock own custom sections (non-CR, non-owner) */}
                          {!sec.is_default && !isCr && !isSubjectOwner && isOwnCustom && (
                            <button
                              onClick={() => handleLockSection(sec.id)}
                              title={sec.is_private ? 'Unlock section (visible to all)' : 'Lock to personal view only'}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: sec.is_private ? '#7e22ce' : 'var(--text-secondary)', padding: '4px', borderRadius: '4px', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                            >{sec.is_private ? <Unlock size={13} strokeWidth={1.75} /> : <Lock size={13} strokeWidth={1.75} />}</button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ))
              )}
            </div>

            {/* Add custom section */}
            <div style={{ padding: '8px 16px 16px' }}>
              {showAddSection ? (
                <form onSubmit={handleAddSection} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <input
                    autoFocus
                    value={newSectionName}
                    onChange={e => setNewSectionName(e.target.value)}
                    placeholder="Section name"
                    required
                    style={{
                      padding: '7px 10px', borderRadius: '6px', border: '1.5px solid var(--border-color)',
                      fontSize: '13px', background: 'var(--bg-color)', color: 'var(--text-primary)',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button type="submit" disabled={sectionLoading} style={{ flex: 1, padding: '6px', background: '#667eea', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Add</button>
                    <button type="button" onClick={() => { setShowAddSection(false); setNewSectionName(''); }} style={{ padding: '6px 10px', background: 'none', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}><X size={13} strokeWidth={2} /></button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setShowAddSection(true)}
                  style={{
                    width: '100%', padding: '7px 12px', borderRadius: '8px',
                    border: '1.5px dashed var(--border-color)', background: 'transparent',
                    color: 'var(--text-secondary)', fontSize: '13px', cursor: 'pointer',
                  }}
                >
                  + Add Section
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Main content + Todo panel ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

      {/* ── Centre (files) ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header bar */}
        <div style={{
          padding: '14px 28px', borderBottom: '1.5px solid var(--border-color)',
          background: 'var(--card-bg)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)' }}>
            {viewLevel === 'subjects'
              ? 'Select a subject'
              : activeSection
                ? activeSection.name
                : activeSubjectName
            }
          </h2>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', color: '#dc2626', padding: '8px 28px', fontSize: '13px', borderBottom: '1px solid #fecaca', flexShrink: 0 }}>
            {error}
          </div>
        )}

        {/* Content area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {viewLevel === 'subjects' ? (
            <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '8px' }}>
              Select a subject from the sidebar to view its files.
            </div>
          ) : !activeSection ? (
            <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '8px' }}>
              Select a section from the sidebar.
            </div>
          ) : (
            <>
              {/* Folder tabs */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  {/* "All" tab — drop here to remove file from any folder */}
                  <button
                    onClick={() => setActiveFolderId(null)}
                    onDragOver={e => { e.preventDefault(); setDragOverFolderId(null); }}
                    onDragLeave={() => setDragOverFolderId(undefined)}
                    onDrop={e => handleDropOnFolder(e, null)}
                    style={{
                      padding: '5px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
                      border: '1.5px solid', cursor: 'pointer',
                      background: dragOverFolderId === null ? 'rgba(102,126,234,0.25)' : activeFolderId === null ? '#667eea' : 'var(--bg-color)',
                      borderColor: dragOverFolderId === null ? '#667eea' : activeFolderId === null ? '#667eea' : 'var(--border-color)',
                      color: activeFolderId === null ? 'white' : 'var(--text-secondary)',
                      outline: dragOverFolderId === null ? '2px solid #667eea' : 'none',
                      transition: 'outline 0.1s',
                    }}
                  >All</button>
                  {folders.map(f => (
                    <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <button
                        onClick={() => setActiveFolderId(f.id)}
                        onDragOver={e => { e.preventDefault(); setDragOverFolderId(f.id); }}
                        onDragLeave={() => setDragOverFolderId(undefined)}
                        onDrop={e => handleDropOnFolder(e, f.id)}
                        style={{
                          padding: '5px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
                          border: '1.5px solid', cursor: 'pointer',
                          background: dragOverFolderId === f.id ? 'rgba(102,126,234,0.25)' : activeFolderId === f.id ? '#667eea' : 'var(--bg-color)',
                          borderColor: dragOverFolderId === f.id ? '#667eea' : activeFolderId === f.id ? '#667eea' : 'var(--border-color)',
                          color: activeFolderId === f.id ? 'white' : 'var(--text-secondary)',
                          outline: dragOverFolderId === f.id ? '2px solid #667eea' : 'none',
                          transition: 'outline 0.1s',
                        }}
                      ><Folder size={11} strokeWidth={1.75} style={{ verticalAlign: 'middle', marginRight: '3px' }} />{f.name}</button>
                      <button onClick={() => handleDeleteFolder(f.id)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: '2px 4px', display: 'flex', alignItems: 'center',
                      }}><X size={12} strokeWidth={2} /></button>
                    </div>
                  ))}
                  {/* Add folder button (any member) */}
                  {!showAddFolder && (
                    <button onClick={() => setShowAddFolder(true)} style={{
                      padding: '5px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
                      border: '1.5px dashed var(--border-color)', background: 'transparent',
                      color: 'var(--text-secondary)', cursor: 'pointer',
                    }}>+ Folder</button>
                  )}
                  {showAddFolder && (
                    <form onSubmit={handleAddFolder} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <input
                        autoFocus value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                        placeholder="Folder name" required
                        style={{
                          padding: '4px 10px', borderRadius: '6px', border: '1.5px solid var(--border-color)',
                          fontSize: '12px', background: 'var(--bg-color)', color: 'var(--text-primary)', outline: 'none',
                        }}
                      />
                      <button type="submit" disabled={folderLoading} style={{ padding: '4px 10px', background: '#667eea', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>Add</button>
                      <button type="button" onClick={() => { setShowAddFolder(false); setNewFolderName(''); }} style={{ padding: '4px 8px', background: 'none', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}><X size={12} strokeWidth={2} /></button>
                    </form>
                  )}
              </div>
              {/* Drag hint — only shown when there are folders */}
              {folders.length > 0 && (
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', opacity: 0.65, marginTop: '-10px', marginBottom: '12px' }}>
                  ⠿⠿ Drag files onto folder tabs to move them · drop on <strong>All</strong> to remove from folder
                </div>
              )}
              <SectionPanel
                section={activeSection}
                files={sectionResources}
                semesterId={semesterId}
                subjectId={activeSubjectId}
                onDelete={handleDelete}
                onDrop={handleDrop}
                uploading={uploading}
                uploadProgress={uploadProgress}
                onUpload={(file, isPublic) => handleUpload(file, activeSectionId, isPublic)}
                isCr={isCr}
                userId={user?.id}
                user={user}
                onTogglePublic={handleTogglePublic}
                onHide={handleHideResource}
                folders={folders}
              />
            </>
          )}
        </div>

      </div>{/* end centre */}

      {/* ── Right: Subject To-Do panel ── */}
      {viewLevel === 'sections' && (
        <div style={{
          width: '240px', flexShrink: 0,
          borderLeft: '1.5px solid var(--border-color)',
          background: 'var(--card-bg)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
          padding: '16px 14px',
        }}>
          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', marginBottom: '12px' }}>
            Tasks — {activeSubjectName}
          </div>

          {/* Add task */}
          {semester?.is_active && (
            <form onSubmit={handleAddTodo} style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
              <input
                value={newTodoText}
                onChange={e => setNewTodoText(e.target.value)}
                placeholder="Add a task…"
                disabled={todoLoading}
                style={{
                  flex: 1, padding: '7px 10px', border: '1.5px solid var(--border-color)',
                  borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit',
                  background: 'var(--bg-color)', color: 'var(--text-primary)', outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={todoLoading || !newTodoText.trim()}
                style={{
                  padding: '7px 11px', background: '#667eea', color: 'white',
                  border: 'none', borderRadius: '6px', fontSize: '14px',
                  cursor: 'pointer', fontWeight: 700,
                  opacity: !newTodoText.trim() ? 0.5 : 1,
                }}
              >+</button>
            </form>
          )}

          {/* Todo list */}
          {todos.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '12px' }}>
              No tasks for this subject yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {todos.map(todo => (
                <div key={todo.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: '8px',
                  padding: '8px 10px', borderRadius: '8px',
                  background: todo.completed ? '#f0fdf4' : 'var(--bg-color)',
                  border: '1px solid', borderColor: todo.completed ? '#bbf7d0' : 'var(--border-color)',
                }}>
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={() => handleToggleTodo(todo.id)}
                    style={{ marginTop: '2px', cursor: 'pointer', accentColor: '#667eea', flexShrink: 0 }}
                  />
                  <p style={{
                    flex: 1, margin: 0, fontSize: '13px', lineHeight: '1.4',
                    wordBreak: 'break-word',
                    textDecoration: todo.completed ? 'line-through' : 'none',
                    color: todo.completed ? 'var(--text-secondary)' : 'var(--text-primary)',
                  }}>{todo.text}</p>
                  <button
                    onClick={() => handleDeleteTodo(todo.id)}
                    style={{
                      background: 'none', border: 'none', color: '#ccc',
                      cursor: 'pointer', padding: '0', lineHeight: 1, flexShrink: 0, display: 'flex',
                    }}
                  ><X size={15} strokeWidth={2} /></button>
                </div>
              ))}
            </div>
          )}

          {todos.length > 0 && (
            <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-secondary)', textAlign: 'right' }}>
              {todos.filter(t => t.completed).length}/{todos.length} done
            </div>
          )}
        </div>
      )}

      </div>{/* end main content + todo panel */}
    </div>{/* end split panel */}
    </div>
  );
}

export default Academics;
