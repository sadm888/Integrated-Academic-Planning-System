import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SemesterSubnav from '../components/SemesterSubnav';
import { semesterAPI, attendanceAPI } from '../services/api';
import Avatar from '../components/Avatar';
import { formatDate } from '../utils/timeUtils';
import '../styles/Classroom.css';
import {
  CheckSquare, Clock, Settings, ChevronLeft,
  RefreshCw, Info, X, Check, Download, AlertTriangle, Users, Paperclip, Trash2,
} from 'lucide-react';

// ── Zone helpers ──────────────────────────────────────────────────────────────

function zoneColor(zone) {
  return zone === 'green' ? 'var(--attendance-green)'
    : zone === 'yellow' ? 'var(--attendance-yellow)'
    : zone === 'orange' ? 'var(--attendance-orange)'
    : 'var(--attendance-red)';
}

function StatusBadge({ status }) {
  const styles = {
    present:      { bg: 'var(--success-bg)',  color: 'var(--success-text)',  label: 'Present' },
    absent:       { bg: 'var(--error-bg)',    color: 'var(--error-color)',   label: 'Absent' },
    leave:        { bg: 'var(--info-bg)',     color: 'var(--info-text)',     label: 'Medical Leave' },
    college_work: { bg: 'var(--warning-bg)',  color: 'var(--warning-text)',  label: 'College Work' },
  };
  const s = styles[status] || styles.absent;
  return (
    <span style={{
      fontSize: '11px', fontWeight: 700,
      padding: '3px 8px', borderRadius: '6px',
      background: s.bg, color: s.color,
      whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

// ── Subject summary card ──────────────────────────────────────────────────────

function SubjectCard({ subj, onClick }) {
  const color = zoneColor(subj.zone);
  const attendedEff = subj.attended + (subj.leaves_count || 0) + (subj.cw_count || 0);
  const noSessions = subj.total === 0;
  // truly below cutoff = has sessions AND current pct is below threshold
  const belowCutoff = !noSessions && subj.percentage < subj.threshold;
  // cannot reach threshold even attending every remaining class
  const unrecoverable = belowCutoff && subj.recoverable === false;
  // above cutoff but must attend some remaining classes to stay above
  const needsMaintain = !noSessions && !belowCutoff && subj.must_attend > 0;

  return (
    <div
      onClick={() => onClick(subj)}
      style={{
        background: 'var(--bg-color)', border: '1px solid var(--border-color)',
        borderRadius: '10px', padding: '14px 16px 0', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden',
        transition: 'box-shadow 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.12)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', flex: 1, marginRight: '8px' }}>
          {subj.subject}
        </p>
        {subj.mode === 'cr' && (
          <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '5px', background: 'var(--info-bg)', color: 'var(--info-text)', whiteSpace: 'nowrap' }}>
            CR Official
          </span>
        )}
      </div>
      {subj.last_marked_date && (
        <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)' }}>
          Last: {formatDate(subj.last_marked_date)}
        </p>
      )}
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)' }}>
        {attendedEff}/{subj.total} attended
        {subj.leaves_count > 0 && <span style={{ color: 'var(--text-secondary)' }}> · {subj.leaves_count} medical leave</span>}
        {subj.cw_count > 0 && <span style={{ color: 'var(--text-secondary)' }}> · {subj.cw_count} college work</span>}
        {' · '}<span style={{ fontWeight: 700, color }}>{subj.percentage}%</span>
        {subj.pct_delta != null && subj.pct_delta !== 0 && (
          <span style={{ fontSize: '11px', fontWeight: 700, marginLeft: '4px', color: subj.pct_delta > 0 ? 'var(--attendance-green)' : 'var(--attendance-red)' }}>
            {subj.pct_delta > 0 ? '▲' : '▼'}{Math.abs(subj.pct_delta)}%
          </span>
        )}
      </p>
      {/* Primary status line */}
      <p style={{ margin: '2px 0 0', fontSize: '13px', fontWeight: 600,
        color: noSessions ? 'var(--text-secondary)' : belowCutoff ? 'var(--error-color)' : color }}>
        {noSessions
          ? 'No classes yet'
          : unrecoverable
            ? `Cannot reach ${subj.threshold}% this semester`
            : belowCutoff
              ? `Attend ${subj.must_attend} more to recover to ${subj.threshold}%`
              : subj.leaves_left > 0
                ? `${subj.leaves_left} ${subj.leaves_left === 1 ? 'leave' : 'leaves'} left`
                : 'Fully safe'}
      </p>
      {/* Secondary: must-attend count when above threshold but future classes are mandatory */}
      {needsMaintain && (
        <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 500 }}>
          Attend {subj.must_attend} of {subj.remaining} remaining to stay above {subj.threshold}%
        </p>
      )}
      <div style={{ margin: '8px -16px 0', height: '4px', background: 'var(--border-color)' }}>
        <div style={{ width: `${Math.min(100, subj.percentage)}%`, height: '100%', background: color, borderRadius: '0 2px 2px 0', transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

// ── Session history for a subject ─────────────────────────────────────────────

function AttachmentRow({ semesterId, sessionId, attachment, onUpdated }) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await attendanceAPI.uploadAttachment(semesterId, sessionId, file);
      onUpdated(sessionId, res.data.attachment);
    } catch {
      // ignore
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const remove = async (e) => {
    e.stopPropagation();
    try {
      await attendanceAPI.deleteAttachment(semesterId, sessionId);
      onUpdated(sessionId, null);
    } catch {
      // ignore
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }} onClick={e => e.stopPropagation()}>
      {attachment ? (
        <>
          <a
            href={attendanceAPI.proofUrl(attachment.stored_name)}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: '11px', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '3px', textDecoration: 'none' }}
          >
            <Paperclip size={11} />{attachment.original_name}
          </a>
          <button onClick={remove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error-color)', padding: '0 2px', display: 'flex' }}>
            <Trash2 size={11} />
          </button>
        </>
      ) : (
        <>
          <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={upload} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '11px', padding: 0, display: 'flex', alignItems: 'center', gap: '3px' }}
          >
            <Paperclip size={11} />{uploading ? 'Uploading…' : 'Attach proof'}
          </button>
        </>
      )}
    </div>
  );
}

// Group sessions on the same date with the same subject into one display unit.
// Returns [{date, sessions: [...], my_status (representative), student_editable}]
function groupSessions(history) {
  const groups = [];
  for (const h of history) {
    const last = groups[groups.length - 1];
    if (last && last.date === h.date && last.subject_variant === h.subject_variant) {
      last.sessions.push(h);
    } else {
      groups.push({ date: h.date, subject_variant: h.subject_variant, sessions: [h] });
    }
  }
  return groups;
}

function HistoryView({ semesterId, subj, onBack }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(null);

  const load = useCallback(() => {
    attendanceAPI.getHistory(semesterId, subj.subject)
      .then(res => setHistory(res.data.history || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [semesterId, subj.subject]);

  useEffect(() => { load(); }, [load]);

  // Cycle: absent → present → leave → college_work → absent
  const CYCLE = { absent: 'present', present: 'leave', leave: 'college_work', college_work: 'absent' };

  const cycleGroup = useCallback(async (group) => {
    if (!group.sessions[0].student_editable || toggling) return;
    const repSession = group.sessions[0];
    setToggling(repSession.session_id);
    const newStatus = CYCLE[repSession.my_status] || 'present';
    try {
      await Promise.all(group.sessions.map(s =>
        attendanceAPI.changeMark(semesterId, s.session_id, newStatus)
      ));
      setHistory(prev => prev.map(s =>
        group.sessions.some(g => g.session_id === s.session_id)
          ? { ...s, my_status: newStatus, marked_by: 'self' }
          : s
      ));
    } catch {
      // backend enforces rules
    } finally {
      setToggling(null);
    }
  }, [semesterId, toggling]);

  const handleAttachmentUpdate = useCallback((sessionId, attachment) => {
    setHistory(prev => prev.map(s =>
      s.session_id === sessionId ? { ...s, attachment } : s
    ));
  }, []);

  const attended   = history.filter(h => h.my_status === 'present').length;
  const leaves     = history.filter(h => h.my_status === 'leave').length;
  const cwCount    = history.filter(h => h.my_status === 'college_work').length;
  const attendedEff = attended + leaves + cwCount;
  const isCrMode   = subj.mode === 'cr';

  const groups = groupSessions(history);

  return (
    <div>
      <button
        onClick={onBack}
        style={{ background: 'none', border: 'none', color: 'var(--primary-color)', cursor: 'pointer', fontSize: '13px', padding: 0, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
      >
        <ChevronLeft size={14} /> Back
      </button>
      <h2 style={{ margin: '0 0 2px', fontSize: '18px' }}>{subj.subject}</h2>
      <p style={{ margin: '0 0 2px', fontSize: '13px', color: 'var(--text-secondary)' }}>
        {attendedEff}/{groups.length} attended · {leaves > 0 && `${leaves} medical leave · `}{cwCount > 0 && `${cwCount} college work · `}{groups.length} total
      </p>
      <p style={{ margin: '0 0 16px', fontSize: '11px', color: 'var(--text-secondary)' }}>
        {isCrMode
          ? `CR marks attendance for this subject${subj.cr_period_start ? ` from ${formatDate(subj.cr_period_start)}` : ''}`
          : 'Tap a row to cycle: Absent → Present → Medical Leave → College Work'}
      </p>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Loading...</p>
      ) : groups.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center', padding: '32px 0' }}>No sessions yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {groups.map((group, i) => {
            const rep = group.sessions[0];
            const isToggling = toggling === rep.session_id;
            const canToggle = rep.student_editable;
            const isMulti = group.sessions.length > 1;
            const slotRange = isMulti
              ? `${rep.slot.split('-')[0]}–${group.sessions[group.sessions.length - 1].slot.split('-')[1]}`
              : rep.slot;
            const showAttachment = rep.my_status === 'leave' || rep.my_status === 'college_work';
            const allConfirmed = group.sessions.every(s => s.status === 'happened');
            const leftColor = rep.my_status === 'present' ? 'var(--attendance-green)'
              : rep.my_status === 'leave' ? 'var(--info-color)'
              : rep.my_status === 'college_work' ? 'var(--warning-text)'
              : 'var(--attendance-red)';
            return (
              <div
                key={i}
                onClick={() => canToggle && cycleGroup(group)}
                style={{
                  padding: '10px 14px',
                  background: 'var(--bg-color)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  borderLeft: `3px solid ${leftColor}`,
                  cursor: canToggle ? 'pointer' : 'default',
                  opacity: isToggling ? 0.5 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {formatDate(rep.date)}
                      {allConfirmed
                        ? <Check size={12} style={{ color: 'var(--attendance-green)', flexShrink: 0 }} />
                        : <Clock size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} title="Not confirmed by CR" />
                      }
                      {isMulti && (
                        <span style={{ fontSize: '10px', fontWeight: 600, padding: '1px 5px', borderRadius: '4px', background: 'var(--border-color)', color: 'var(--text-secondary)' }}>
                          {group.sessions.length}h
                        </span>
                      )}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {slotRange} · {rep.type}
                      {rep.subject_variant && rep.subject_variant !== subj.subject && ` · ${rep.subject_variant}`}
                      {rep.marked_by === 'cr' && ' · marked by CR'}
                      {!canToggle && !rep.marked_by && ' · locked (CR mode)'}
                      {canToggle && ' · tap to cycle'}
                    </p>
                  </div>
                  <StatusBadge status={rep.my_status} />
                </div>
                {showAttachment && (
                  <AttachmentRow
                    semesterId={semesterId}
                    sessionId={rep.session_id}
                    attachment={rep.attachment}
                    onUpdated={handleAttachmentUpdate}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ── CR subject register (member-wise day-by-day for CR Official subjects) ────

function CrSubjectView({ semesterId, subj, onBack }) {
  const [tab, setTab] = useState('students'); // 'students' | 'sessions'
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rollSession, setRollSession] = useState(null);
  const [studentSummary, setStudentSummary] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentsError, setStudentsError] = useState('');

  const loadStudentSummary = useCallback(() => {
    setStudentsLoading(true);
    setStudentsError('');
    attendanceAPI.getCrSubjectSummary(semesterId, subj.subject)
      .then(res => setStudentSummary(res.data.students || []))
      .catch(() => setStudentsError('Failed to load student summary.'))
      .finally(() => setStudentsLoading(false));
  }, [semesterId, subj.subject]);

  useEffect(() => {
    loadStudentSummary();
  }, [loadStudentSummary]);

  const loadSessions = useCallback(() => {
    setLoading(true);
    attendanceAPI.getHistory(semesterId, subj.subject)
      .then(res => {
        const items = res.data.history || [];
        // Group by session_id to compute per-session summary counts
        const bySession = {};
        items.forEach(h => {
          if (!bySession[h.session_id]) {
            bySession[h.session_id] = { session_id: h.session_id, date: h.date, slot: h.slot, subject_variant: h.subject_variant, counts: { present: 0, absent: 0, leave: 0, college_work: 0 }, total: 0 };
          }
          bySession[h.session_id].counts[h.status] = (bySession[h.session_id].counts[h.status] || 0) + 1;
          bySession[h.session_id].total += 1;
        });
        const sorted = Object.values(bySession).sort((a, b) => b.date.localeCompare(a.date));
        setSessions(sorted);
      })
      .finally(() => setLoading(false));
  }, [semesterId, subj.subject]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const tabStyle = (active) => ({
    flex: 1, padding: '7px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600, borderRadius: '7px',
    background: active ? 'var(--primary-color)' : 'transparent',
    color: active ? 'white' : 'var(--text-secondary)',
  });

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--primary-color)', cursor: 'pointer', fontSize: '13px', padding: 0, marginBottom: '14px' }}>
        ← Back
      </button>
      <h2 style={{ margin: '0 0 4px' }}>{subj.subject}</h2>
      <p style={{ margin: '0 0 14px', fontSize: '12px', color: 'var(--text-secondary)' }}>CR Official</p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-secondary)', borderRadius: '9px', padding: '3px', marginBottom: '16px' }}>
        <button style={tabStyle(tab === 'students')} onClick={() => setTab('students')}>Students</button>
        <button style={tabStyle(tab === 'sessions')} onClick={() => setTab('sessions')}>Sessions</button>
      </div>

      {tab === 'students' ? (
        studentsLoading ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Loading…</p>
        ) : studentsError ? (
          <p style={{ color: 'var(--error-color)', fontSize: '13px' }}>{studentsError}</p>
        ) : studentSummary.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No data yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {studentSummary.map(st => (
              <div key={st.user_id} style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '12px 16px', background: 'var(--bg-color)',
                border: `1px solid ${st.below_threshold ? 'var(--error-color)' : 'var(--border-color)'}`,
                borderRadius: '10px',
              }}>
                <Avatar user={{ id: st.user_id, username: st.username, profile_picture: st.profile_picture }} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>{st.full_name || st.username}</p>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {st.roll_number ? `${st.roll_number} · ` : ''}@{st.username}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: st.below_threshold ? 'var(--error-color)' : 'var(--success-text)' }}>
                    {st.percentage !== null ? `${st.percentage}%` : '—'}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {st.attended}/{st.total}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        loading ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Loading…</p>
        ) : sessions.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No sessions yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sessions.map(sess => {
              const { present = 0, absent = 0, leave = 0, college_work = 0 } = sess.counts;
              const marked = sess.total > 0;
              return (
                <div
                  key={sess.session_id}
                  onClick={() => setRollSession({ id: sess.session_id, date: sess.date, slot: sess.subject_variant || sess.slot || '', subject: subj.subject })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '14px',
                    padding: '12px 16px', background: 'var(--bg-color)',
                    border: '1px solid var(--border-color)', borderRadius: '10px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>{formatDate(sess.date)}</p>
                    <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>{sess.subject_variant || sess.slot || ''}</p>
                  </div>
                  {marked ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {present      > 0 && <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 7px', borderRadius: '6px', background: 'var(--success-bg)', color: 'var(--success-text)' }}>{present}P</span>}
                        {absent       > 0 && <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 7px', borderRadius: '6px', background: 'var(--error-bg)', color: 'var(--error-color)' }}>{absent}A</span>}
                        {leave        > 0 && <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 7px', borderRadius: '6px', background: 'var(--info-bg)', color: 'var(--info-text)' }}>{leave}L</span>}
                        {college_work > 0 && <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 7px', borderRadius: '6px', background: 'var(--warning-bg)', color: 'var(--warning-text)' }}>{college_work}CW</span>}
                      </div>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Edit →</span>
                    </div>
                  ) : (
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--primary-color)' }}>Mark →</span>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {rollSession && (
        <CrRollModal
          semesterId={semesterId}
          session={rollSession}
          onClose={() => { setRollSession(null); loadSessions(); loadStudentSummary(); }}
        />
      )}
    </div>
  );
}


// ── CR roll modal ─────────────────────────────────────────────────────────────

function CrRollModal({ semesterId, session, onClose }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [undoQueue, setUndoQueue] = useState({});
  const [localMarks, setLocalMarks] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    attendanceAPI.getCrRoll(semesterId, session.id)
      .then(res => {
        const list = res.data.students || [];
        setStudents(list);
        const marks = {};
        list.forEach(s => { if (s.status !== null) marks[s.user_id] = s.status; });
        setLocalMarks(marks);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [semesterId, session.id]);

  const pendingRef = useRef({});

  const mark = useCallback((studentId, status) => {
    setLocalMarks(prev => ({ ...prev, [studentId]: status }));
    pendingRef.current[studentId] = status;

    // Clear any existing timer for this student (extract from state first to
    // avoid a side-effect inside setState).
    setUndoQueue(prev => {
      if (prev[studentId]) clearTimeout(prev[studentId]);
      const tid = setTimeout(() => {
        // Only auto-save if saveAll hasn't already claimed this entry.
        if (pendingRef.current[studentId] === status) {
          attendanceAPI.crMarkStudent(semesterId, session.id, studentId, status).catch(() => {});
          delete pendingRef.current[studentId];
        }
        setUndoQueue(q => {
          const next = { ...q };
          delete next[studentId];
          return next;
        });
      }, 3000);
      return { ...prev, [studentId]: tid };
    });
  }, [semesterId, session.id]);

  const saveAll = useCallback(async () => {
    if (saving) return;
    setSaving(true);

    // Cancel all pending auto-save timers synchronously before firing requests.
    const timers = { ...undoQueue };
    setUndoQueue({});
    Object.values(timers).forEach(tid => clearTimeout(tid));

    // Snapshot and clear pendingRef so no timer can fire a duplicate save.
    const toSave = { ...pendingRef.current };
    pendingRef.current = {};

    await Promise.allSettled(
      Object.entries(toSave).map(([studentId, status]) =>
        attendanceAPI.crMarkStudent(semesterId, session.id, studentId, status)
      )
    );
    onClose();
  }, [saving, undoQueue, semesterId, session.id, onClose]);

  const undo = useCallback((studentId) => {
    setUndoQueue(prev => {
      if (prev[studentId]) clearTimeout(prev[studentId]);
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
    setLocalMarks(prev => {
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
  }, []);

  const markAll = (status) => {
    students.forEach(s => mark(s.user_id, status));
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    }}>
      <div style={{
        background: 'var(--bg-color)', borderRadius: '14px', width: '100%', maxWidth: '480px',
        maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '15px' }}>{session.subject}</p>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
              {formatDate(session.date)} · {session.slot}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        {/* Quick actions */}
        <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '8px' }}>
          <button onClick={() => markAll('present')} style={{ flex: 1, padding: '6px', borderRadius: '7px', border: 'none', background: 'var(--success-bg)', color: 'var(--success-text)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
            All Present
          </button>
          <button onClick={() => markAll('absent')} style={{ flex: 1, padding: '6px', borderRadius: '7px', border: 'none', background: 'var(--error-bg)', color: 'var(--error-color)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
            All Absent
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '24px', fontSize: '13px' }}>Loading...</p>
          ) : students.map(s => {
            const marked = localMarks[s.user_id];
            const pending = undoQueue[s.user_id] !== undefined;
            return (
              <div key={s.user_id} style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '10px 20px', borderBottom: '1px solid var(--border-color)',
                background: pending ? 'var(--bg-secondary)' : 'transparent',
              }}>
                <Avatar user={{ id: s.user_id, username: s.username, profile_picture: s.profile_picture }} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {s.full_name || s.username}
                  </p>
                  <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {s.roll_number ? `${s.roll_number} · ` : ''}@{s.username}
                  </p>
                </div>

                {pending ? (
                  <button
                    onClick={() => undo(s.user_id)}
                    style={{ fontSize: '11px', color: 'var(--primary-color)', background: 'none', border: '1px solid var(--primary-color)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Undo
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {[
                      { st: 'present',      label: 'P',  active: 'var(--attendance-green)' },
                      { st: 'absent',       label: 'A',  active: 'var(--attendance-red)' },
                      { st: 'leave',        label: 'L',  active: 'var(--info-color)' },
                      { st: 'college_work', label: 'CW', active: 'var(--warning-text)' },
                    ].map(({ st, label, active }) => (
                      <button
                        key={st}
                        onClick={() => mark(s.user_id, st)}
                        style={{
                          padding: '5px 8px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                          background: marked === st ? active : 'var(--border-color)',
                          color: marked === st ? 'white' : 'var(--text-secondary)',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            onClick={saveAll}
            disabled={saving}
            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: 'none', background: 'var(--primary-color)', color: 'white', fontSize: '13px', fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : 'Save & Close'}
          </button>
          <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)', textAlign: 'center' }}>
            P = Present · A = Absent · L = Medical Leave · CW = College Work
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Subject mode selector (CR settings) ──────────────────────────────────────

const MODE_LABELS = { off: 'Off', self: 'Self', cr: 'CR Official' };
const MODE_COLORS = {
  off:  { bg: 'var(--border-color)',  text: 'var(--text-secondary)' },
  self: { bg: 'var(--success-bg)',    text: 'var(--success-text)'   },
  cr:   { bg: 'var(--info-bg)',       text: 'var(--info-text)'      },
};

function SubjectModeRow({ semesterId, subject, config, semThreshold, onUpdated }) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [crDate, setCrDate] = useState(new Date().toISOString().split('T')[0]);
  const [confirmOff, setConfirmOff] = useState(false);
  const [threshold, setThreshold] = useState(config?.required_pct != null ? String(config.required_pct) : '');

  const mode = config?.tracking_mode || 'self';
  const modeColor = MODE_COLORS[mode];
  const isLocked = config?.locked === true;

  const toggleLock = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await attendanceAPI.updateSubjectConfig(semesterId, subject, { locked: !isLocked });
      onUpdated(subject, res.data.config);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  // Valid next modes based on state machine
  const nextModes = {
    off:  ['self', 'cr'],
    self: ['off', 'cr'],
    cr:   ['off'],        // cr→self blocked
  }[mode] || [];

  const transition = async (newMode, extra = {}) => {
    setSaving(true);
    setError('');
    try {
      const payload = { tracking_mode: newMode, ...extra };
      if (newMode === 'cr') payload.cr_period_start = crDate;
      const res = await attendanceAPI.updateSubjectConfig(semesterId, subject, payload);
      onUpdated(subject, res.data.config);
      setExpanded(false);
      setConfirmOff(false);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const saveThreshold = async () => {
    setSaving(true);
    setError('');
    try {
      const val = threshold === '' ? null : parseFloat(threshold);
      const res = await attendanceAPI.updateSubjectConfig(semesterId, subject, { required_pct: val });
      onUpdated(subject, res.data.config);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const downloadExcel = () => {
    window.location.href = attendanceAPI.exportSubjectExcel(semesterId, subject);
  };

  const effectiveThreshold = config?.required_pct != null ? config.required_pct : semThreshold;

  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: '9px', overflow: 'hidden' }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', cursor: 'pointer', background: 'var(--bg-color)' }}
      >
        <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, flex: 1 }}>{subject}</p>
        {isLocked && <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--error-color)' }}>LOCKED</span>}
        <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '5px', background: modeColor.bg, color: modeColor.text }}>
          {MODE_LABELS[mode]}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{effectiveThreshold}%{config?.required_pct != null ? ' ★' : ''}</span>
      </div>

      {expanded && (
        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--bg-secondary)' }}>

          {/* Lock student marking */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: isLocked ? 'var(--error-color)' : 'var(--text-primary)' }}>
                {isLocked ? '🔒 Students locked out' : 'Student marking'}
              </p>
              <p style={{ margin: '1px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                {isLocked ? 'Only CR can mark this subject' : 'Students can mark their own attendance'}
              </p>
            </div>
            <button
              onClick={toggleLock}
              disabled={saving}
              style={{
                width: '40px', height: '22px', borderRadius: '11px', border: 'none',
                cursor: saving ? 'not-allowed' : 'pointer',
                background: isLocked ? 'var(--attendance-red)' : 'var(--border-color)',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              }}
            >
              <div style={{
                position: 'absolute', top: '3px', width: '16px', height: '16px',
                borderRadius: '50%', background: 'white',
                left: isLocked ? '21px' : '3px', transition: 'left 0.2s',
              }} />
            </button>
          </div>

          {/* Mode transition */}
          {nextModes.length > 0 && (
            <div>
              <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>CHANGE MODE</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {nextModes.map(nm => {
                  if (nm === 'off') {
                    return confirmOff ? (
                      <div key="off" style={{ background: 'var(--error-bg)', borderRadius: '8px', padding: '10px' }}>
                        <p style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--error-color)', fontWeight: 600 }}>
                          ⚠ Export first. This will archive the current CR period. Students will see read-only records.
                        </p>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={downloadExcel} style={{ padding: '5px 12px', borderRadius: '7px', border: 'none', background: 'var(--primary-color)', color: 'white', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Download size={12} /> Export Excel
                          </button>
                          <button onClick={() => transition('off')} disabled={saving} style={{ padding: '5px 12px', borderRadius: '7px', border: 'none', background: 'var(--attendance-red)', color: 'white', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                            {saving ? 'Archiving…' : 'Archive & Disable'}
                          </button>
                          <button onClick={() => setConfirmOff(false)} style={{ padding: '5px 10px', borderRadius: '7px', border: 'none', background: 'var(--border-color)', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button key="off" onClick={() => setConfirmOff(true)} style={{ padding: '7px 14px', borderRadius: '7px', border: '1px solid var(--attendance-red)', background: 'none', color: 'var(--attendance-red)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
                        → Off (teacher taking over / retire tracking)
                      </button>
                    );
                  }
                  if (nm === 'cr') {
                    return (
                      <div key="cr" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="date"
                          value={crDate}
                          onChange={e => setCrDate(e.target.value)}
                          style={{ padding: '6px 8px', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-primary)', fontSize: '12px' }}
                        />
                        <button onClick={() => transition('cr')} disabled={saving} style={{ padding: '7px 14px', borderRadius: '7px', border: 'none', background: 'var(--info-color)', color: 'white', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                          {saving ? '…' : '→ CR Official (from date)'}
                        </button>
                      </div>
                    );
                  }
                  return (
                    <button key={nm} onClick={() => transition(nm)} disabled={saving} style={{ padding: '7px 14px', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'none', color: 'var(--text-primary)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
                      {saving ? '…' : `→ ${MODE_LABELS[nm]}`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Per-subject threshold */}
          <div>
            <p style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>REQUIRED % (leave blank to use semester default of {semThreshold}%)</p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="number" min="50" max="100" step="1"
                placeholder={String(semThreshold)}
                value={threshold}
                onChange={e => setThreshold(e.target.value)}
                style={{ width: '80px', padding: '6px 8px', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-primary)', fontSize: '13px' }}
              />
              <button onClick={saveThreshold} disabled={saving} style={{ padding: '6px 14px', borderRadius: '7px', border: 'none', background: 'var(--primary-color)', color: 'var(--text-on-primary)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                {saving ? '…' : 'Save'}
              </button>
              {config?.required_pct != null && (
                <button onClick={() => { setThreshold(''); saveThreshold(); }} style={{ padding: '6px 10px', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'none', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer' }}>
                  Reset to default
                </button>
              )}
            </div>
          </div>

          {/* Export (CR mode only) */}
          {mode === 'cr' && (
            <div>
              <p style={{ margin: '0 0 6px', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>EXPORT</p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={downloadExcel} style={{ padding: '7px 14px', borderRadius: '7px', border: 'none', background: 'var(--primary-color)', color: 'white', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Download size={12} /> Download Excel
                </button>
              </div>
              {config?.last_exported_at && (
                <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>Last exported: {formatDate(config.last_exported_at)}</p>
              )}
              {config?.archived_periods?.length > 0 && (
                <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {config.archived_periods.length} archived period(s)
                </p>
              )}
            </div>
          )}

          {error && <p style={{ margin: 0, fontSize: '12px', color: 'var(--error-color)' }}>{error}</p>}
        </div>
      )}
    </div>
  );
}

// ── Settings panel ────────────────────────────────────────────────────────────

function SettingsPanel({ semesterId, settings, subjectConfigs, semThreshold, isCr, subjects, onClose, onSaved, onConfigUpdated }) {
  const [threshold, setThreshold] = useState(String(settings.threshold ?? 75));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const saveThreshold = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await attendanceAPI.updateSettings(semesterId, {
        threshold: parseFloat(threshold),
        version: settings.version ?? 0,
      });
      onSaved(res.data.settings);
    } catch (e) {
      setError(e.response?.data?.error || (e.response ? `Server error ${e.response.status}` : 'Cannot reach server'));
    } finally {
      setSaving(false);
    }
  };


  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    }}>
      <div style={{
        background: 'var(--bg-color)', borderRadius: '14px', width: '100%', maxWidth: '460px',
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: '15px' }}>Attendance Settings</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>


          {/* Semester threshold */}
          {isCr && (
            <div>
              <p style={{ margin: '0 0 6px', fontSize: '13px', fontWeight: 600 }}>Semester attendance threshold (%)</p>
              <p style={{ margin: '0 0 8px', fontSize: '11px', color: 'var(--text-secondary)' }}>Default for all subjects — override per subject below</p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="number" min="50" max="100" step="1"
                  value={threshold}
                  onChange={e => setThreshold(e.target.value)}
                  style={{ flex: 1, padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-primary)', fontSize: '14px' }}
                />
                <button onClick={saveThreshold} disabled={saving} style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: 'var(--primary-color)', color: 'var(--text-on-primary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
              {settings.threshold_log?.length > 0 && (
                <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>
                  Last changed: {settings.threshold_log[settings.threshold_log.length - 1].from}% → {settings.threshold_log[settings.threshold_log.length - 1].to}%
                </p>
              )}
            </div>
          )}

          {/* Per-subject controls (CR only) */}
          {isCr && subjects.length > 0 && (
            <div>
              <p style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 600 }}>Per-subject tracking mode</p>
              <p style={{ margin: '0 0 10px', fontSize: '11px', color: 'var(--text-secondary)' }}>Click a subject to toggle CR/self/off, set threshold, or export Excel</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {subjects.map(subj => (
                  <SubjectModeRow
                    key={subj}
                    semesterId={semesterId}
                    subject={subj}
                    config={subjectConfigs[subj]}
                    semThreshold={semThreshold}
                    onUpdated={onConfigUpdated}
                  />
                ))}
              </div>
              <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => { window.location.href = attendanceAPI.exportAllExcel(semesterId); }}
                  style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'none', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Download size={14} /> Export all subjects (Excel)
                </button>
                <button
                  onClick={() => { window.location.href = attendanceAPI.exportDefaultersExcel(semesterId); }}
                  style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'none', color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Download size={14} /> Export Defaulter Report (Excel)
                </button>
              </div>
            </div>
          )}

          {error && <p style={{ margin: 0, color: 'var(--error-color)', fontSize: '12px' }}>{error}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Defaulters panel ──────────────────────────────────────────────────────────

function DefaultersPanel({ semesterId, onClose }) {
  const [report, setReport] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    attendanceAPI.getDefaulters(semesterId)
      .then(res => setReport(res.data.report || {}))
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false));
  }, [semesterId]);

  const subjects = Object.keys(report);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    }}>
      <div style={{
        background: 'var(--bg-color)', borderRadius: '14px', width: '100%', maxWidth: '520px',
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: '15px' }}>Defaulter Report</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px' }}>
          {loading ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Loading...</p>
          ) : error ? (
            <p style={{ color: 'var(--error-color)', fontSize: '13px' }}>{error}</p>
          ) : subjects.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-secondary)' }}>
              <Check size={32} strokeWidth={1.5} style={{ marginBottom: '8px', color: 'var(--attendance-green)' }} />
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>All students are safe</p>
              <p style={{ margin: '4px 0 0', fontSize: '12px' }}>Nobody is below or near the threshold.</p>
            </div>
          ) : subjects.map(subj => {
            const { threshold, defaulters, at_risk } = report[subj];
            return (
              <div key={subj} style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                  <p style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>{subj}</p>
                  <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)' }}>Required: {threshold}%</p>
                </div>

                {defaulters.length > 0 && (
                  <>
                    <p style={{ margin: '0 0 6px', fontSize: '11px', fontWeight: 600, color: 'var(--error-color)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Below threshold ({defaulters.length})
                    </p>
                    {defaulters.map(s => (
                      <div key={s.user_id} style={{ display: 'flex', alignItems: 'center', padding: '7px 10px', marginBottom: '4px', borderRadius: '7px', background: 'var(--error-bg)', border: '1px solid var(--attendance-red)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>{s.full_name || s.username}</p>
                          <p style={{ margin: '1px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>@{s.username} · {s.attended}/{s.total} · {s.percentage}%</p>
                        </div>
                        <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: 'var(--error-color)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          Attend {s.must_attend} more
                        </p>
                      </div>
                    ))}
                  </>
                )}

                {at_risk.length > 0 && (
                  <>
                    <p style={{ margin: '8px 0 6px', fontSize: '11px', fontWeight: 600, color: 'var(--attendance-orange)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      At risk ({at_risk.length})
                    </p>
                    {at_risk.map(s => (
                      <div key={s.user_id} style={{ display: 'flex', alignItems: 'center', padding: '7px 10px', marginBottom: '4px', borderRadius: '7px', background: 'var(--bg-color)', border: '1px solid var(--attendance-orange)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>{s.full_name || s.username}</p>
                          <p style={{ margin: '1px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>@{s.username} · {s.attended}/{s.total} · {s.percentage}%</p>
                        </div>
                        <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: 'var(--attendance-orange)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {s.leaves_left} {s.leaves_left === 1 ? 'leave' : 'leaves'} left
                        </p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main Attendance page ──────────────────────────────────────────────────────

function Attendance({ user }) {
  const { classroomId, semesterId } = useParams();
  const navigate = useNavigate();

  const [semester, setSemester] = useState(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [subjects, setSubjects] = useState([]);
  const [threshold, setThreshold] = useState(75.0);
  const [thresholdLog, setThresholdLog] = useState([]);
  const [settings, setSettings] = useState({ threshold: 75.0, threshold_log: [], version: 0 });
  const [subjectConfigs, setSubjectConfigs] = useState({});
  const [showThresholdBanner, setShowThresholdBanner] = useState(true);
  const [error, setError] = useState('');

  const [historySubject, setHistorySubject] = useState(null); // full subj object
  const [showSettings, setShowSettings] = useState(false);
  const [showDefaulters, setShowDefaulters] = useState(false);

  const [todaySessions, setTodaySessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [markingSession, setMarkingSession] = useState(null);
  const [crRollSession, setCrRollSession] = useState(null);
  const [pendingSessions, setPendingSessions] = useState([]);
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().split('T')[0]);

  const isCr = semester?.is_user_cr;

  useEffect(() => {
    semesterAPI.getDetail(semesterId)
      .then(res => setSemester(res.data.semester))
      .catch(() => setError('Failed to load semester'))
      .finally(() => setLoading(false));
  }, [semesterId]);

  const loadSummary = useCallback(() => {
    setSummaryLoading(true);
    Promise.all([
      attendanceAPI.getSummary(semesterId),
      attendanceAPI.getSubjectConfigs(semesterId),
    ]).then(([sumRes, cfgRes]) => {
      setSubjects(sumRes.data.subjects || []);
      setThreshold(sumRes.data.threshold || 75.0);
      setThresholdLog(sumRes.data.threshold_log || []);
      setSettings(sumRes.data.settings || {});
      setSubjectConfigs(cfgRes.data.configs || {});
    }).catch(() => {})
      .finally(() => setSummaryLoading(false));
  }, [semesterId]);

  const loadTodaySessions = useCallback((dateStr) => {
    setSessionsLoading(true);
    const target = dateStr || new Date().toISOString().split('T')[0];
    attendanceAPI.getSessions(semesterId, target)
      .then(res => {
        const all = res.data.sessions || [];
        if (res.data.is_cr) {
          setPendingSessions(all.filter(s => s.status === 'pending'));
          setTodaySessions(all.filter(s => s.status === 'happened'));
        } else {
          setTodaySessions(all);
        }
      })
      .catch(() => {})
      .finally(() => setSessionsLoading(false));
  }, [semesterId]);

  useEffect(() => {
    loadSummary();
    loadTodaySessions();
  }, [loadSummary, loadTodaySessions]);

  const markSelf = useCallback(async (session, status) => {
    setMarkingSession(session.id);
    try {
      if (session.my_record !== null) {
        await attendanceAPI.changeMark(semesterId, session.id, status);
      } else {
        await attendanceAPI.markSelf(semesterId, session.id, status);
      }
      setTodaySessions(prev => prev.map(s =>
        s.id === session.id ? { ...s, my_record: { status, marked_by: 'self' } } : s
      ));
      loadSummary();
    } catch {
      // silently fail
    } finally {
      setMarkingSession(null);
    }
  }, [semesterId, loadSummary]);

  const markSessionStatus = useCallback(async (session, status) => {
    try {
      await attendanceAPI.markSession(semesterId, session.id, status);
      setPendingSessions(prev => prev.filter(s => s.id !== session.id));
      if (status === 'happened') {
        setTodaySessions(prev => [...prev, { ...session, status: 'happened' }]);
      }
      loadSummary();
    } catch {}
  }, [semesterId, loadSummary]);

  // Confirm session happened then open roll modal in one click
  const takeRoll = useCallback(async (session) => {
    if (session.status === 'pending') {
      try {
        await attendanceAPI.markSession(semesterId, session.id, 'happened');
        setPendingSessions(prev => prev.filter(s => s.id !== session.id));
        setTodaySessions(prev => [...prev, { ...session, status: 'happened' }]);
        setCrRollSession({ ...session, status: 'happened' });
      } catch {}
    } else {
      setCrRollSession(session);
    }
  }, [semesterId]);

  const handleConfigUpdated = useCallback((subject, newConfig) => {
    setSubjectConfigs(prev => ({ ...prev, [subject]: newConfig }));
    loadSummary();
  }, [loadSummary]);

  if (loading) return <div className="classroom-container"><p style={{ color: 'var(--text-secondary)' }}>Loading…</p></div>;
  if (!semester) return <div className="classroom-container"><p style={{ color: 'var(--error-color)' }}>{error || 'Semester not found'}</p></div>;

  const isHidden = localStorage.getItem(`attendance_hidden_${semesterId}`) === 'true';
  if (isHidden) {
    return (
      <div className="classroom-container">
        <button onClick={() => navigate(`/classroom/${classroomId}/semester/${semesterId}`)} style={{ background: 'none', border: 'none', color: 'var(--primary-color)', cursor: 'pointer', fontSize: '13px', marginBottom: '10px', padding: 0 }}>
          &larr; Back
        </button>
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-secondary)' }}>
          <p style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Attendance tab is hidden</p>
          <p style={{ margin: '6px 0 16px', fontSize: '13px' }}>You hid this tab from your view.</p>
          <button
            onClick={() => { localStorage.removeItem(`attendance_hidden_${semesterId}`); window.location.reload(); }}
            style={{ padding: '8px 20px', borderRadius: '8px', background: 'var(--primary-color)', color: 'white', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
          >
            Show again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="classroom-container">
      <div style={{ marginBottom: '4px' }}>
        <button onClick={() => navigate(`/classroom/${classroomId}`)} style={{ background: 'none', border: 'none', color: 'var(--primary-color)', cursor: 'pointer', fontSize: '13px', marginBottom: '10px', padding: 0 }}>
          &larr; Back to Classroom
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: 0 }}>{semester.name}</h1>
            <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0', fontSize: '14px' }}>
              {semester.type} · {semester.year}{semester.session && ` · ${semester.session}`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {isCr && (
              <button
                onClick={() => setShowDefaulters(true)}
                style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '7px 10px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}
              >
                <Users size={14} /> Defaulters
              </button>
            )}
            <button
              onClick={() => setShowSettings(true)}
              style={{ background: 'none', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '7px 12px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}
            >
              <Settings size={14} /> {isCr ? 'Manage' : 'Settings'}
            </button>
          </div>
        </div>
      </div>

      <SemesterSubnav active="attendance" classroomId={classroomId} semesterId={semesterId} />

      {/* Threshold change banner — students only, once per page visit */}
      {showThresholdBanner && !isCr && thresholdLog.length > 0 && (() => {
        const last = thresholdLog[thresholdLog.length - 1];
        return (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '10px 14px', background: 'var(--info-bg)', border: '1px solid var(--info-border)', borderRadius: '8px', marginBottom: '16px', fontSize: '12px', color: 'var(--info-text)' }}>
            <Info size={14} style={{ flexShrink: 0, color: 'var(--info-color)' }} />
            <span style={{ flex: 1 }}>Attendance threshold changed to {last.to}% on {formatDate(last.changed_at)} by {last.changed_by_name}</span>
            <button onClick={() => setShowThresholdBanner(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--info-text)', padding: '0 2px', lineHeight: 1 }}>
              <X size={14} />
            </button>
          </div>
        );
      })()}

      {/* Drill-in: CR Official subject → member-wise register; others → personal history */}
      {historySubject ? (
        isCr && historySubject.mode === 'cr' ? (
          <CrSubjectView
            semesterId={semesterId}
            subj={historySubject}
            onBack={() => setHistorySubject(null)}
          />
        ) : (
          <HistoryView
            semesterId={semesterId}
            subj={historySubject}
            onBack={() => setHistorySubject(null)}
          />
        )
      ) : (
        <>

          {/* Sessions */}
          {isCr ? (
            // CR view: one big tappable card per class
            [...pendingSessions, ...todaySessions].length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {sessionDate === new Date().toISOString().split('T')[0] ? "Today's classes" : `Classes · ${sessionDate}`}
                  </h3>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[...pendingSessions, ...todaySessions].map(sess => (
                    <div
                      key={sess.id}
                      onClick={() => takeRoll(sess)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '14px',
                        padding: '14px 16px', background: 'var(--bg-color)',
                        border: '1px solid var(--border-color)', borderRadius: '10px',
                        cursor: 'pointer', transition: 'box-shadow 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.1)'}
                      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{sess.subject}</p>
                        <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>{sess.slot} · {sess.type}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--primary-color)' }}>Mark Attendance →</span>
                        <button
                          onClick={e => { e.stopPropagation(); markSessionStatus(sess, 'cancelled'); }}
                          style={{ fontSize: '11px', color: 'var(--text-secondary)', background: 'none', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '3px 8px', cursor: 'pointer' }}
                        >
                          Didn't happen
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            // Student view
            todaySessions.length > 0 && (
              <div className="classrooms-section" style={{ marginBottom: '16px' }}>
                <h3 style={{ margin: '0 0 10px', fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Today's classes
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {todaySessions.map(sess => {
                    const rec = sess.my_record;
                    const curStatus = rec?.status;
                    const isMarking = markingSession === sess.id;
                    return (
                      <div key={sess.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>{sess.subject}</p>
                          <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-secondary)' }}>{sess.slot} · {sess.type}</p>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {sess.student_editable ? (
                            ['present', 'absent', 'leave'].map(st => (
                              <button
                                key={st}
                                disabled={isMarking}
                                onClick={() => markSelf(sess, st)}
                                style={{
                                  padding: '5px 10px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                                  background: curStatus === st
                                    ? st === 'present' ? 'var(--attendance-green)' : st === 'leave' ? 'var(--info-color)' : 'var(--attendance-red)'
                                    : 'var(--border-color)',
                                  color: curStatus === st ? 'white' : 'var(--text-secondary)',
                                }}
                              >
                                {st === 'present' ? '✓ P' : st === 'absent' ? '✗ A' : '~ L'}
                              </button>
                            ))
                          ) : (
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>CR is marking</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          )}

          {/* Subject cards */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Subjects
            </h3>
            <button onClick={loadSummary} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>
              <RefreshCw size={13} />
            </button>
          </div>

          {summaryLoading ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Loading…</p>
          ) : subjects.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-secondary)' }}>
              <CheckSquare size={36} strokeWidth={1.25} style={{ opacity: 0.3, marginBottom: '10px' }} />
              <p style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>No attendance data yet</p>
              <p style={{ margin: '6px 0 0', fontSize: '13px' }}>Sessions are generated from the timetable daily.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
              {subjects.map(s => (
                <SubjectCard key={s.subject} subj={s} onClick={setHistorySubject} />
              ))}
            </div>
          )}
        </>
      )}

      {crRollSession && (
        <CrRollModal
          semesterId={semesterId}
          session={crRollSession}
          onClose={() => { setCrRollSession(null); loadSummary(); }}
        />
      )}

      {showSettings && (
        <SettingsPanel
          semesterId={semesterId}
          settings={settings}
          subjectConfigs={subjectConfigs}
          semThreshold={threshold}
          isCr={isCr}
          subjects={subjects.map(s => s.subject)}
          onClose={() => setShowSettings(false)}
          onSaved={newSettings => { setSettings(newSettings); setThreshold(newSettings.threshold); }}
          onConfigUpdated={handleConfigUpdated}
        />
      )}

      {showDefaulters && (
        <DefaultersPanel
          semesterId={semesterId}
          onClose={() => setShowDefaulters(false)}
        />
      )}
    </div>
  );
}

export default Attendance;
