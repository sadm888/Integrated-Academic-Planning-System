import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import SemesterSubnav from '../components/SemesterSubnav';
import { semesterAPI } from '../services/api';
import '../styles/Classroom.css';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';

function Marks({ user }) {
  const { classroomId, semesterId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [semester, setSemester] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(location.state?.expandedId || null);

  useEffect(() => {
    semesterAPI.getDetail(semesterId)
      .then(res => setSemester(res.data.semester))
      .catch(() => setError('Failed to load semester'))
      .finally(() => setLoading(false));
  }, [semesterId]);

  if (loading) return <div className="classroom-container"><p style={{ color: 'var(--text-secondary)' }}>Loading...</p></div>;
  if (!semester) return <div className="classroom-container"><p style={{ color: '#dc2626' }}>{error}</p></div>;

  const subjects = semester.subjects || [];
  const isCr = semester.is_user_cr;

  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id);

  return (
    <div className="classroom-container">
      <div style={{ marginBottom: '4px' }}>
        <button onClick={() => navigate(`/classroom/${classroomId}`)} style={{
          background: 'none', border: 'none', color: '#667eea',
          cursor: 'pointer', fontSize: '13px', marginBottom: '10px', padding: 0,
        }}>
          &larr; Back to Classroom
        </button>
        <h1 style={{ margin: 0 }}>{semester.name}</h1>
        <p style={{ color: '#888', margin: '4px 0 0', fontSize: '14px' }}>
          {semester.type} · {semester.year}{semester.session && ` · ${semester.session}`}
        </p>
      </div>

      <SemesterSubnav active="marks" classroomId={classroomId} semesterId={semesterId} />

      {subjects.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-secondary)' }}>
          <BookOpen size={40} strokeWidth={1.25} style={{ opacity: 0.3, marginBottom: '12px' }} />
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>No subjects yet</p>
          <p style={{ margin: '6px 0 0', fontSize: '13px', opacity: 0.7 }}>
            {isCr ? 'Add subjects from the Dashboard.' : 'Your CR hasn\'t added subjects yet.'}
          </p>
          <Link to={`/classroom/${classroomId}/semester/${semesterId}`} style={{
            display: 'inline-block', marginTop: '16px', padding: '8px 20px',
            background: '#667eea', color: 'white', borderRadius: '8px',
            textDecoration: 'none', fontSize: '13px', fontWeight: 600,
          }}>Go to Dashboard</Link>
        </div>
      ) : (
        <div className="classrooms-section" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-color)', borderBottom: '2px solid var(--border-color)' }}>
                <th style={{ ...thStyle, width: '28px' }}></th>
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Name</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Credits</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Internal Marks and Cutoffs</th>
                <th style={thStyle}>Faculties</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Marks / Grade</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map(sub => {
                const isOpen = expandedId === sub.id;
                const hasDetails = sub.details || sub.code || sub.credits || sub.faculties?.length;
                return (
                  <React.Fragment key={sub.id}>
                    <tr
                      onClick={() => toggleExpand(sub.id)}
                      style={{
                        borderBottom: isOpen ? 'none' : '1px solid var(--border-color)',
                        background: isOpen ? 'var(--bg-color)' : 'var(--card-bg)',
                        cursor: 'pointer',
                      }}
                    >
                      <td style={{ ...tdStyle, padding: '10px 8px 10px 14px', color: 'var(--text-secondary)' }}>
                        {isOpen
                          ? <ChevronDown size={14} strokeWidth={2} />
                          : <ChevronRight size={14} strokeWidth={2} />
                        }
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {sub.code || '—'}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 600 }}>{sub.name}</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{sub.credits || '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => navigate(`/classroom/${classroomId}/semester/${semesterId}/marks/${sub.id}`, { state: { subject: sub } })}
                          style={btnStyle('#4f46e5')}
                        >
                          Marks/Cutoffs
                        </button>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {sub.faculties?.length ? sub.faculties.join(', ') : '—'}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                          Not yet assigned
                        </span>
                        &nbsp;–
                      </td>
                    </tr>

                    {isOpen && (
                      <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-color)' }}>
                        <td colSpan={7} style={{ padding: '0 16px 16px 48px' }}>
                          {!hasDetails ? (
                            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                              No course details added yet.{isCr && (
                                <> <button
                                  onClick={e => { e.stopPropagation(); navigate(`/classroom/${classroomId}/semester/${semesterId}/marks/${sub.id}`, { state: { subject: sub, tab: 'details' } }); }}
                                  style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '13px', padding: 0, fontStyle: 'normal', fontWeight: 600 }}
                                >Add details →</button></>
                              )}
                            </p>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap' }}>
                                {sub.code && (
                                  <div>
                                    <div style={detailLabel}>Code</div>
                                    <div style={{ fontWeight: 700, fontSize: '14px' }}>{sub.code}</div>
                                  </div>
                                )}
                                {sub.credits && (
                                  <div>
                                    <div style={detailLabel}>Credits</div>
                                    <div style={{ fontWeight: 700, fontSize: '14px' }}>{sub.credits}</div>
                                  </div>
                                )}
                                {sub.faculties?.length > 0 && (
                                  <div>
                                    <div style={detailLabel}>Faculty</div>
                                    <div style={{ fontSize: '13px' }}>{sub.faculties.join(', ')}</div>
                                  </div>
                                )}
                              </div>
                              {sub.details && (
                                <div style={{
                                  background: 'var(--card-bg)', borderRadius: '8px',
                                  padding: '12px 14px', fontSize: '13px', lineHeight: 1.7,
                                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                  border: '1px solid var(--border-color)',
                                }}>
                                  {sub.details}
                                </div>
                              )}
                              <div>
                                <button
                                  onClick={e => { e.stopPropagation(); navigate(`/classroom/${classroomId}/semester/${semesterId}/marks/${sub.id}`, { state: { subject: sub, tab: 'details' } }); }}
                                  style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '12px', padding: 0, fontWeight: 600 }}
                                >
                                  Edit in full view →
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle = {
  padding: '10px 14px', textAlign: 'left', fontWeight: 700,
  fontSize: '12px', color: 'var(--text-secondary)',
  textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
};
const tdStyle = { padding: '10px 14px', verticalAlign: 'middle', color: 'var(--text-primary)' };
const btnStyle = (bg) => ({
  padding: '5px 14px', borderRadius: '6px', border: 'none',
  background: bg, color: 'white', fontSize: '12px', fontWeight: 600,
  cursor: 'pointer', whiteSpace: 'nowrap',
});
const detailLabel = {
  fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px',
};

export default Marks;
