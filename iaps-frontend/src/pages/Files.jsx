import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { academicAPI, chatAPI, attendanceAPI, BACKEND_URL } from '../services/api';
import { FileTypeIcon, sizeLabel } from '../utils/fileUtils';

function Files({ user }) {
  const [resources, setResources] = useState([]);
  const [proofs, setProofs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    Promise.all([
      academicAPI.getAllResources(),
      attendanceAPI.getMyProofs(),
    ])
      .then(([resRes, proofsRes]) => {
        setResources(resRes.data.resources || []);
        setProofs(proofsRes.data.proofs || []);
      })
      .catch(() => setError('Failed to load files'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = search
    ? resources.filter(r =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.classroom_name?.toLowerCase().includes(search.toLowerCase()) ||
        r.semester_name?.toLowerCase().includes(search.toLowerCase()) ||
        r.subject_name?.toLowerCase().includes(search.toLowerCase())
      )
    : resources;

  // Group: classroom+semester key → subject key → section key → files
  const groups = {};
  filtered.forEach(r => {
    const semKey = `${r.classroom_name || 'Unknown Classroom'} / ${r.semester_name || 'Unknown Semester'}`;
    const semMeta = { classroomId: r.classroom_id, semesterId: r.semester_id };
    if (!groups[semKey]) groups[semKey] = { meta: semMeta, subjects: {} };
    const subKey = r.subject_name || '—';
    if (!groups[semKey].subjects[subKey]) groups[semKey].subjects[subKey] = {};
    const secKey = r.section_name || 'Files';
    if (!groups[semKey].subjects[subKey][secKey]) groups[semKey].subjects[subKey][secKey] = [];
    groups[semKey].subjects[subKey][secKey].push(r);
  });

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <h1 style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: 'var(--text-primary)' }}>Files</h1>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          {filtered.length} file{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginTop: 0, marginBottom: '24px', fontSize: '14px' }}>
        All academic files across your classrooms and semesters.
      </p>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search files, subjects, classrooms…"
        style={{
          width: '100%', padding: '10px 16px', borderRadius: '10px',
          border: '1.5px solid var(--border-color)', fontSize: '14px',
          background: 'var(--card-bg)', color: 'var(--text-primary)',
          outline: 'none', boxSizing: 'border-box', marginBottom: '28px',
        }}
      />

      {loading ? (
        <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0' }}>Loading…</div>
      ) : error ? (
        <div style={{ color: '#dc2626', padding: '12px 16px', background: '#fef2f2', borderRadius: '8px' }}>{error}</div>
      ) : filtered.length === 0 && proofs.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '40px 0', fontSize: '15px' }}>
          {search ? 'No files match your search.' : 'No files uploaded yet.'}
        </div>
      ) : (
        <>
        {proofs.length > 0 && (
          <div style={{ marginBottom: '36px' }}>
            <div style={{ fontWeight: 800, fontSize: '17px', color: 'var(--text-primary)', marginBottom: '14px' }}>
              My Attendance Proofs
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {proofs
                .filter(p => !search || p.original_name?.toLowerCase().includes(search.toLowerCase()) || p.subject?.toLowerCase().includes(search.toLowerCase()))
                .map((p, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '8px 12px', borderRadius: '8px',
                  background: 'var(--card-bg)', border: '1px solid var(--border-color)',
                }}>
                  <FileTypeIcon mime={null} size={18} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <a
                      href={attendanceAPI.proofUrl(p.stored_name)}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)',
                        textDecoration: 'none', display: 'block',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {p.original_name}
                    </a>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                      {p.subject} · {p.date}
                      <span style={{ marginLeft: '6px', fontWeight: 600, color: p.status === 'leave' ? 'var(--info-text)' : 'var(--warning-text)' }}>
                        {p.status === 'leave' ? 'Medical Leave' : 'College Work'}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {Object.entries(groups).map(([semKey, { meta, subjects }]) => (
          <div key={semKey} style={{ marginBottom: '36px' }}>
            {/* Semester header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: '14px',
            }}>
              <div>
                <div style={{
                  fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.6px', color: 'var(--text-secondary)', marginBottom: '2px',
                }}>
                  {semKey.split(' / ')[0]}
                </div>
                <div style={{ fontWeight: 800, fontSize: '17px', color: 'var(--text-primary)' }}>
                  {semKey.split(' / ')[1]}
                </div>
              </div>
              {meta.classroomId && meta.semesterId && (
                <Link
                  to={`/classroom/${meta.classroomId}/semester/${meta.semesterId}/files`}
                  style={{
                    fontSize: '12px', color: '#667eea', fontWeight: 600,
                    textDecoration: 'none', padding: '4px 10px',
                    borderRadius: '6px', border: '1px solid #c7d2fe',
                    background: 'rgba(102,126,234,0.1)',
                  }}
                >
                  Open Files →
                </Link>
              )}
            </div>

            {/* Subjects */}
            {Object.entries(subjects).map(([subName, sections]) => (
              <div key={subName} style={{ marginBottom: '16px', paddingLeft: '12px', borderLeft: '3px solid var(--border-color)' }}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)', marginBottom: '10px' }}>
                  {subName}
                </div>

                {/* Sections */}
                {Object.entries(sections).map(([secName, files]) => (
                  <div key={secName} style={{ marginBottom: '12px' }}>
                    <div style={{
                      fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
                      letterSpacing: '0.5px', color: 'var(--text-secondary)',
                      marginBottom: '6px',
                    }}>
                      {secName}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {files.map(r => {
                        const token = localStorage.getItem('token') || '';
                        const url = r.source === 'chat_unlinked'
                          ? chatAPI.getFileUrl(r.chat_message_id)
                          : r.source === 'document'
                          ? `${BACKEND_URL}/api/document/${r.document_id}/download?token=${encodeURIComponent(token)}`
                          : academicAPI.getFileUrl(r.id);
                        return (
                          <div key={r.id} style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '8px 12px', borderRadius: '8px',
                            background: 'var(--card-bg)', border: '1px solid var(--border-color)',
                          }}>
                            <FileTypeIcon mime={r.mime_type} size={18} />
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
                                title={r.name}
                              >
                                {r.name}
                              </a>
                              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                                {r.uploaded_by_name}
                                {r.size ? ` · ${sizeLabel(r.size)}` : ''}
                                {(r.source === 'chat' || r.source === 'chat_unlinked') && (
                                  <span style={{ marginLeft: '6px', color: '#667eea', fontWeight: 600 }}>from chat</span>
                                )}
                                {r.source === 'document' && (
                                  <span style={{ marginLeft: '6px', color: '#059669', fontWeight: 600 }}>semester doc</span>
                                )}
                              </div>
                            </div>
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flexShrink: 0 }}>
                              {r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
        </>
      )}
    </div>
  );
}

export default Files;
