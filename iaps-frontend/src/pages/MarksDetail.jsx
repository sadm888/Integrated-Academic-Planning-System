import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { semesterAPI, marksAPI, subjectAPI } from '../services/api';
import '../styles/Classroom.css';
import { Edit2, Check, X, Plus, Upload, FileText } from 'lucide-react';

function MarksDetail({ user }) {
  const { classroomId, semesterId, subjectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [semester, setSemester] = useState(null);
  const [subject, setSubject] = useState(location.state?.subject || null);
  const [tab, setTab] = useState(location.state?.tab === 'details' ? 'details' : 'marks');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Personal marks — saved entries (read-only view)
  const [myMarks, setMyMarks] = useState(null);

  // Edit existing marks_obtained only (structural fields locked)
  const [editingMarks, setEditingMarks] = useState(false);
  const [draftEntries, setDraftEntries] = useState([]);

  // Add new row (all fields editable)
  const [addingRow, setAddingRow] = useState(false);
  const [newRow, setNewRow] = useState(emptyRow());

  // Grade — edited independently
  const [editingGrade, setEditingGrade] = useState(false);
  const [draftGrade, setDraftGrade] = useState('');
  const [savingGrade, setSavingGrade] = useState(false);

  // Analytics
  const [analytics, setAnalytics] = useState([]);
  const [uploading, setUploading] = useState(false);

  // Course details editing
  const [editingDetails, setEditingDetails] = useState(false);
  const [draftCode, setDraftCode] = useState('');
  const [draftCredits, setDraftCredits] = useState('');
  const [draftFaculties, setDraftFaculties] = useState('');
  const [draftDetails, setDraftDetails] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const semRes = await semesterAPI.getDetail(semesterId);
        const sem = semRes.data.semester;
        setSemester(sem);
        if (!subject) {
          const found = (sem.subjects || []).find(s => s.id === subjectId);
          setSubject(found || null);
        }
      } catch {
        setError('Failed to load semester');
        setLoading(false);
        return;
      }

      const [mRes, aRes] = await Promise.allSettled([
        marksAPI.getMyMarks(subjectId),
        marksAPI.listAnalytics(subjectId),
      ]);

      if (mRes.status === 'fulfilled') {
        const m = mRes.value.data.marks;
        setMyMarks(m);
      }

      if (aRes.status === 'fulfilled') {
        setAnalytics(aRes.value.data.files || []);
      }

      setLoading(false);
    };
    init();
  }, [semesterId, subjectId]);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 3000); return () => clearTimeout(t); }
  }, [success]);

  const isCr = semester?.is_user_cr;

  function emptyRow() {
    return { name: '', max_marks: '', weightage: '', marks_obtained: '' };
  }

  const scaled = (obt, max, w) =>
    ((parseFloat(obt) || 0) / (parseFloat(max) || 1)) * (parseFloat(w) || 0);

  const existingEntries = myMarks?.entries || [];

  // ── Edit Marks (marks_obtained only) ────────────────────────────────────────
  const startEditMarks = () => {
    setError('');
    setAddingRow(false);
    setDraftEntries(existingEntries.map(e => ({ ...e, marks_obtained: e.marks_obtained ?? '' })));
    setEditingMarks(true);
  };

  const updateObtained = (i, val) => {
    const max = parseFloat(draftEntries[i].max_marks) || 0;
    let num = val === '' ? '' : Math.max(0, parseFloat(val) || 0);
    if (num !== '' && max > 0) num = Math.min(num, max);
    setDraftEntries(p => p.map((e, idx) => idx === i ? { ...e, marks_obtained: num } : e));
  };

  const draftScaledTotal = draftEntries.reduce(
    (s, e) => s + scaled(e.marks_obtained, e.max_marks, e.weightage), 0
  );
  const draftOverflow = draftScaledTotal > 100.01;

  const saveMarks = async () => {
    if (draftOverflow) return;
    try {
      await marksAPI.saveMyMarks(subjectId, { entries: draftEntries, grade: myMarks?.grade || '' });
      const res = await marksAPI.getMyMarks(subjectId);
      setMyMarks(res.data.marks);
      setEditingMarks(false);
      setSuccess('Marks saved');
    } catch (err) { setError(err.response?.data?.error || 'Failed to save'); }
  };

  // ── Add Row ──────────────────────────────────────────────────────────────────
  const startAddRow = () => {
    setError('');
    setEditingMarks(false);
    setNewRow(emptyRow());
    setAddingRow(true);
  };

  const updateNewRowStructure = (field, val) => {
    // Changing structural fields resets marks_obtained
    setNewRow(p => ({ ...p, [field]: val, marks_obtained: '' }));
  };

  const updateNewRowObtained = (val) => {
    const max = parseFloat(newRow.max_marks) || 0;
    let num = val === '' ? '' : Math.max(0, parseFloat(val) || 0);
    if (num !== '' && max > 0) num = Math.min(num, max);
    setNewRow(p => ({ ...p, marks_obtained: num }));
  };

  const newRowScaled = scaled(newRow.marks_obtained, newRow.max_marks, newRow.weightage);
  const existingScaledTotal = existingEntries.reduce(
    (s, e) => s + scaled(e.marks_obtained, e.max_marks, e.weightage), 0
  );
  const newRowTotalWeight = existingEntries.reduce((s, e) => s + (parseFloat(e.weightage) || 0), 0)
    + (parseFloat(newRow.weightage) || 0);
  const newRowOverflow = (existingScaledTotal + newRowScaled) > 100.01 || newRowTotalWeight > 100.01;

  const saveNewRow = async () => {
    if (!newRow.name.trim() || !newRow.max_marks || !newRow.weightage) {
      setError('Fill in Exam Name, Max Marks, and Weightage');
      return;
    }
    if (newRowOverflow) return;
    const updatedEntries = [...existingEntries, newRow];
    try {
      await marksAPI.saveMyMarks(subjectId, { entries: updatedEntries, grade: myMarks?.grade || '' });
      const res = await marksAPI.getMyMarks(subjectId);
      setMyMarks(res.data.marks);
      setAddingRow(false);
      setNewRow(emptyRow());
      setSuccess('Row added');
    } catch (err) { setError(err.response?.data?.error || 'Failed to save'); }
  };

  // ── Delete Row ───────────────────────────────────────────────────────────────
  const [deletingRowIdx, setDeletingRowIdx] = useState(null);
  const deleteRow = async (i) => {
    if (deletingRowIdx !== null) return;
    setDeletingRowIdx(i);
    const updated = existingEntries.filter((_, idx) => idx !== i);
    try {
      await marksAPI.saveMyMarks(subjectId, { entries: updated, grade: myMarks?.grade || '' });
      const res = await marksAPI.getMyMarks(subjectId);
      setMyMarks(res.data.marks);
    } catch (err) { setError(err.response?.data?.error || 'Failed to delete row'); }
    finally { setDeletingRowIdx(null); }
  };

  // ── Grade (separate) ─────────────────────────────────────────────────────────
  const startEditGrade = () => {
    setDraftGrade(myMarks?.grade || '');
    setEditingGrade(true);
  };

  const saveGrade = async () => {
    setSavingGrade(true);
    try {
      await marksAPI.saveMyMarks(subjectId, { entries: existingEntries, grade: draftGrade.trim() });
      const res = await marksAPI.getMyMarks(subjectId);
      setMyMarks(res.data.marks);
      setEditingGrade(false);
      setSuccess('Grade saved');
    } catch (err) { setError(err.response?.data?.error || 'Failed to save grade'); }
    finally { setSavingGrade(false); }
  };

  // ── Analytics ─────────────────────────────────────────────────────────────────
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await marksAPI.uploadAnalytics(subjectId, fd, isCr ? 'public' : 'personal');
      const res = await marksAPI.listAnalytics(subjectId);
      setAnalytics(res.data.files || []);
      setSuccess('File uploaded');
    } catch (err) { setError(err.response?.data?.error || 'Upload failed'); }
    finally { setUploading(false); }
  };

  const handleDeleteAnalytics = async (fileId) => {
    try {
      await marksAPI.deleteAnalytics(subjectId, fileId);
      setAnalytics(p => p.filter(f => f.id !== fileId));
    } catch (err) { setError(err.response?.data?.error || 'Delete failed'); }
  };

  const handleVisibilityChange = async (fileId, newVisibility) => {
    setAnalytics(p => p.map(f => f.id === fileId ? { ...f, visibility: newVisibility } : f));
    try {
      await marksAPI.updateAnalyticsVisibility(subjectId, fileId, newVisibility);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update visibility');
      const res = await marksAPI.listAnalytics(subjectId);
      setAnalytics(res.data.files || []);
    }
  };

  // ── Course Details ────────────────────────────────────────────────────────────
  const startEditDetails = () => {
    setDraftCode(subject?.code || '');
    setDraftCredits(subject?.credits || '');
    setDraftFaculties(subject?.faculties?.join(', ') || '');
    setDraftDetails(subject?.details || '');
    setEditingDetails(true);
  };

  const saveDetails = async () => {
    setSavingDetails(true);
    try {
      const facultiesArr = draftFaculties.split(',').map(f => f.trim()).filter(Boolean);
      await subjectAPI.update(subjectId, {
        code: draftCode.trim(),
        credits: draftCredits !== '' ? parseInt(draftCredits) : null,
        faculties: facultiesArr,
        details: draftDetails.trim(),
      });
      setSubject(prev => ({
        ...prev,
        code: draftCode.trim(),
        credits: draftCredits !== '' ? parseInt(draftCredits) : null,
        faculties: facultiesArr,
        details: draftDetails.trim(),
      }));
      setEditingDetails(false);
      setSuccess('Details saved');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save details');
    } finally {
      setSavingDetails(false);
    }
  };

  // Totals for read-only view
  const viewScaledTotal = existingEntries.reduce(
    (s, e) => s + scaled(e.marks_obtained, e.max_marks, e.weightage), 0
  );
  const viewWeightTotal = existingEntries.reduce((s, e) => s + (parseFloat(e.weightage) || 0), 0);

  if (loading) return <div className="classroom-container"><p style={{ color: 'var(--text-secondary)' }}>Loading...</p></div>;

  return (
    <div className="classroom-container">
      {/* Header */}
      <div style={{ marginBottom: '4px' }}>
        <button
          onClick={() => navigate(`/classroom/${classroomId}/semester/${semesterId}/marks`, { state: { expandedId: subjectId } })}
          style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '13px', marginBottom: '10px', padding: 0 }}
        >
          &larr; Back to Marks
        </button>
        {subject && (
          <div>
            <h1 style={{ margin: 0, fontSize: '20px' }}>
              {subject.code ? `${subject.code} – ` : ''}{subject.name}
            </h1>
            <div style={{ display: 'flex', gap: '16px', marginTop: '4px', flexWrap: 'wrap', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {subject.credits && <span>{subject.credits} credits</span>}
              {subject.faculties?.length > 0 && <span>{subject.faculties.join(', ')}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Main subnav */}
      <div className="page-subnav">
        <Link className="page-subnav-item" to={`/classroom/${classroomId}/semester/${semesterId}`}>Dashboard</Link>
        <button className="page-subnav-item" onClick={() => navigate(`/classroom/${classroomId}/semester/${semesterId}/chat`)}>Chat</button>
        <Link className="page-subnav-item" to={`/classroom/${classroomId}/semester/${semesterId}/files`}>Resources</Link>
        <Link className="page-subnav-item accent" to={`/classroom/${classroomId}/semester/${semesterId}/marks`}>Marks</Link>
        <Link className="page-subnav-item" to={`/classroom/${classroomId}/semester/${semesterId}/timetable`}>Timetable</Link>
        <Link className="page-subnav-item" to={`/classroom/${classroomId}/semester/${semesterId}/academic-calendar`}>Academic Calendar</Link>
      </div>

      {error && (
        <div className="error-message" style={{ marginBottom: '12px' }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: '10px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
        </div>
      )}
      {success && <div className="success-message" style={{ marginBottom: '12px' }}>{success}</div>}

      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', padding: '4px', background: 'var(--bg-color)', borderRadius: '10px', border: '1px solid var(--border-color)', width: 'fit-content' }}>
        {[
          { key: 'marks', label: 'Marks / Cutoffs' },
          { key: 'details', label: 'Course Details' },
          { key: 'analytics', label: 'Previous Year Analytics' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '6px 14px', border: 'none', cursor: 'pointer', borderRadius: '7px',
              fontSize: '13px', fontWeight: tab === key ? 700 : 500,
              background: tab === key ? '#667eea' : 'transparent',
              color: tab === key ? 'white' : 'var(--text-secondary)',
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Marks tab ── */}
      {tab === 'marks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Action bar */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic', flex: 1 }}>
              Enter your own exam details and marks individually.
            </p>
            {!editingMarks && !addingRow && existingEntries.length > 0 && (
              <button onClick={startEditMarks} style={actionBtn}>
                <Edit2 size={12} /> Edit Marks
              </button>
            )}
            {!editingMarks && !addingRow && (
              <button onClick={startAddRow} style={{ ...actionBtn, background: 'var(--bg-color)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                <Plus size={12} /> Add Row
              </button>
            )}
          </div>

          {/* Main table */}
          <div className="classrooms-section" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-color)', borderBottom: '2px solid var(--border-color)' }}>
                    <th style={thStyle}>Exam Name</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Max Marks</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Weightage (%)</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Marks Obtained</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Scaled</th>
                    <th style={{ ...thStyle, width: '36px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {existingEntries.length === 0 && !addingRow ? (
                    <tr>
                      <td colSpan={6} style={{ ...tdStyle, textAlign: 'center', padding: '32px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                        No marks entered yet. Click "Add Row" to get started.
                      </td>
                    </tr>
                  ) : (
                    (editingMarks ? draftEntries : existingEntries).map((entry, i) => {
                      const s = scaled(entry.marks_obtained, entry.max_marks, entry.weightage);
                      const hasObt = entry.marks_obtained !== '' && entry.marks_obtained !== undefined;
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{entry.name || '—'}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>{entry.max_marks || '—'}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>{entry.weightage ? `${entry.weightage}%` : '—'}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            {editingMarks ? (
                              <input
                                type="number" min="0" max={entry.max_marks || undefined}
                                value={entry.marks_obtained === '' ? '' : entry.marks_obtained}
                                onChange={e => updateObtained(i, e.target.value)}
                                style={{ ...inputStyle, width: '80px', textAlign: 'center' }}
                              />
                            ) : hasObt ? (
                              <span style={{ color: '#dc2626', fontWeight: 600 }}>
                                {Number(entry.marks_obtained).toFixed(2)}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>—</span>
                            )}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            {hasObt
                              ? s.toFixed(2)
                              : <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>—</span>}
                          </td>
                          <td style={tdStyle}>
                            {!editingMarks && !addingRow && (
                              <button
                                onClick={() => deleteRow(i)}
                                disabled={deletingRowIdx !== null}
                                style={{ background: 'none', border: 'none', color: deletingRowIdx === i ? '#dc2626' : 'var(--text-secondary)', cursor: deletingRowIdx !== null ? 'not-allowed' : 'pointer', padding: '2px', opacity: deletingRowIdx === i ? 1 : 0.5 }}
                                title="Remove row"
                              >
                                <X size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}

                  {/* New row being added */}
                  {addingRow && (
                    <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(102,126,234,0.04)' }}>
                      <td style={tdStyle}>
                        <input
                          value={newRow.name}
                          onChange={e => updateNewRowStructure('name', e.target.value)}
                          placeholder="Exam name"
                          style={inputStyle}
                          autoFocus
                        />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <input
                          type="number" min="1"
                          value={newRow.max_marks}
                          onChange={e => updateNewRowStructure('max_marks', e.target.value)}
                          style={{ ...inputStyle, width: '80px', textAlign: 'center' }}
                        />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <input
                          type="number" min="0" max="100"
                          value={newRow.weightage}
                          onChange={e => updateNewRowStructure('weightage', e.target.value)}
                          style={{ ...inputStyle, width: '80px', textAlign: 'center' }}
                        />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <input
                          type="number" min="0" max={newRow.max_marks || undefined}
                          value={newRow.marks_obtained}
                          onChange={e => updateNewRowObtained(e.target.value)}
                          style={{ ...inputStyle, width: '80px', textAlign: 'center' }}
                        />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: newRowOverflow ? '#dc2626' : undefined }}>
                        {newRow.marks_obtained !== '' ? newRowScaled.toFixed(2) : '—'}
                      </td>
                      <td style={tdStyle}>
                        <button
                          onClick={() => setAddingRow(false)}
                          style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px' }}
                        >
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                  )}

                  {/* Total row */}
                  {(existingEntries.length > 0 || addingRow) && (
                    <tr style={{ borderTop: '2px solid var(--border-color)', background: 'var(--bg-color)', fontWeight: 800 }}>
                      <td style={tdStyle}>Total</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        {(editingMarks ? draftEntries : existingEntries)
                          .reduce((s, e) => s + (parseFloat(e.max_marks) || 0), 0) || '—'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: (editingMarks
                        ? draftEntries.reduce((s,e)=>s+(parseFloat(e.weightage)||0),0)
                        : addingRow ? newRowTotalWeight : viewWeightTotal) > 100 ? '#dc2626' : undefined }}>
                        {(editingMarks
                          ? draftEntries.reduce((s,e)=>s+(parseFloat(e.weightage)||0),0)
                          : addingRow ? newRowTotalWeight : viewWeightTotal
                        ).toFixed(1)}%
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>—</td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: (editingMarks ? draftScaledTotal : addingRow ? existingScaledTotal + newRowScaled : viewScaledTotal) > 100 ? '#dc2626' : undefined }}>
                        {(editingMarks ? draftScaledTotal : addingRow ? existingScaledTotal + newRowScaled : viewScaledTotal).toFixed(2)}
                      </td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Edit marks footer */}
            {editingMarks && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)' }}>
                {draftOverflow && (
                  <div style={{ padding: '8px 12px', borderRadius: '7px', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', color: '#dc2626', fontSize: '12px', fontWeight: 600, marginBottom: '10px' }}>
                    Total scaled marks ({draftScaledTotal.toFixed(2)}) exceed 100 — cannot save.
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={saveMarks}
                    disabled={draftOverflow}
                    style={{ ...actionBtn, opacity: draftOverflow ? 0.4 : 1, cursor: draftOverflow ? 'not-allowed' : 'pointer' }}
                  >
                    <Check size={12} /> Save
                  </button>
                  <button onClick={() => setEditingMarks(false)} style={{ ...actionBtn, background: 'var(--bg-color)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Add row footer */}
            {addingRow && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)' }}>
                {newRowOverflow && (
                  <div style={{ padding: '8px 12px', borderRadius: '7px', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', color: '#dc2626', fontSize: '12px', fontWeight: 600, marginBottom: '10px' }}>
                    {newRowTotalWeight > 100.01
                      ? `Total weightage (${newRowTotalWeight.toFixed(1)}%) would exceed 100.`
                      : `Total scaled (${(existingScaledTotal + newRowScaled).toFixed(2)}) would exceed 100.`}
                    {' '}Cannot save.
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={saveNewRow}
                    disabled={newRowOverflow}
                    style={{ ...actionBtn, opacity: newRowOverflow ? 0.4 : 1, cursor: newRowOverflow ? 'not-allowed' : 'pointer' }}
                  >
                    <Check size={12} /> Save Row
                  </button>
                  <button onClick={() => setAddingRow(false)} style={{ ...actionBtn, background: 'var(--bg-color)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Grade — separate card */}
          <div className="classrooms-section" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', minWidth: '46px' }}>Grade</span>
            {editingGrade ? (
              <>
                <input
                  value={draftGrade}
                  onChange={e => setDraftGrade(e.target.value)}
                  placeholder="e.g. A+"
                  style={{ ...inputStyle, width: '90px' }}
                  autoFocus
                />
                <button onClick={saveGrade} disabled={savingGrade} style={actionBtn}>
                  <Check size={12} /> {savingGrade ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => setEditingGrade(false)} style={{ ...actionBtn, background: 'var(--bg-color)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span style={{ fontSize: '20px', fontWeight: 800, color: '#667eea' }}>
                  {myMarks?.grade || <span style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 400, fontStyle: 'italic' }}>Not set</span>}
                </span>
                {!editingMarks && !addingRow && (
                  <button onClick={startEditGrade} style={{ background: 'none', border: 'none', color: '#667eea', cursor: 'pointer', fontSize: '12px', padding: 0, fontWeight: 600 }}>
                    <Edit2 size={13} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Course Details tab ── */}
      {tab === 'details' && (
        <div className="classrooms-section">
          {editingDetails ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={labelStyle}>Subject Code</label>
                  <input value={draftCode} onChange={e => setDraftCode(e.target.value)} placeholder="e.g. CS301" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Credits</label>
                  <input type="number" min="1" value={draftCredits} onChange={e => setDraftCredits(e.target.value)} placeholder="e.g. 4" style={inputStyle} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Faculty (comma-separated)</label>
                  <input value={draftFaculties} onChange={e => setDraftFaculties(e.target.value)} placeholder="e.g. Dr. Smith, Prof. Jones" style={inputStyle} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Course Details / Syllabus</label>
                  <textarea
                    value={draftDetails}
                    onChange={e => setDraftDetails(e.target.value)}
                    placeholder="Add syllabus, topics, references, etc."
                    rows={5}
                    style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={saveDetails} disabled={savingDetails} style={actionBtn}>
                  <Check size={12} /> {savingDetails ? 'Saving...' : 'Save Details'}
                </button>
                <button onClick={() => setEditingDetails(false)} style={{ ...actionBtn, background: 'var(--bg-color)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
                {isCr && (
                  <button onClick={startEditDetails} style={actionBtn}>
                    <Edit2 size={12} /> Edit Details
                  </button>
                )}
              </div>
              {!subject?.details && !subject?.credits && !subject?.code && !subject?.faculties?.length ? (
                <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '13px' }}>
                  No course details added yet.{isCr && ' Click "Edit Details" to add them.'}
                </p>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '32px', marginBottom: '16px', flexWrap: 'wrap' }}>
                    {subject.code && (
                      <div>
                        <div style={detailLabel}>Code</div>
                        <div style={{ fontWeight: 700, fontSize: '16px' }}>{subject.code}</div>
                      </div>
                    )}
                    {subject.credits && (
                      <div>
                        <div style={detailLabel}>Credits</div>
                        <div style={{ fontWeight: 700, fontSize: '18px' }}>{subject.credits}</div>
                      </div>
                    )}
                    {subject.faculties?.length > 0 && (
                      <div>
                        <div style={detailLabel}>Faculty</div>
                        <div style={{ fontSize: '14px' }}>{subject.faculties.join(', ')}</div>
                      </div>
                    )}
                  </div>
                  {subject.details && (
                    <div style={{
                      background: 'var(--bg-color)', borderRadius: '8px',
                      padding: '14px 16px', fontSize: '14px', lineHeight: 1.7,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {subject.details}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Analytics tab ── */}
      {tab === 'analytics' && (
        <div className="classrooms-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Previous Year Analytics</h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                {isCr
                  ? 'Upload PYQ papers, mark schemes, or analytics. Uploaded files are public by default — change visibility per file.'
                  : 'Upload your own notes or analytics. Your uploads are only visible to you and your CR.'
                }
              </p>
            </div>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '7px 14px', borderRadius: '8px',
              background: '#667eea', color: 'white', fontSize: '12px',
              fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer',
              opacity: uploading ? 0.6 : 1,
            }}>
              <Upload size={13} />
              {uploading ? 'Uploading...' : 'Upload'}
              <input type="file" onChange={handleUpload} style={{ display: 'none' }} disabled={uploading} />
            </label>
          </div>

          {analytics.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
              <FileText size={32} strokeWidth={1.25} style={{ opacity: 0.3, marginBottom: '8px' }} />
              <p style={{ margin: 0, fontSize: '13px' }}>No files uploaded yet.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {analytics.map(f => (
                <div key={f.id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 14px', background: 'var(--bg-color)',
                  borderRadius: '8px', border: '1px solid var(--border-color)',
                }}>
                  <FileText size={16} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <a
                      href={marksAPI.analyticsFileUrl(f.id)}
                      target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: '13px', color: '#667eea', textDecoration: 'none', fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {f.filename}
                    </a>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', gap: '10px', marginTop: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span>{f.uploaded_by_name}</span>
                      <span>{new Date(f.created_at).toLocaleDateString()}</span>
                      {f.can_delete && isCr && f.visibility !== 'personal' ? (
                        <button
                          onClick={() => handleVisibilityChange(f.id, f.visibility === 'public' ? 'cr_only' : 'public')}
                          title={f.visibility === 'public' ? 'Visible to all — click to make CRs only' : 'CRs only — click to make public'}
                          style={{
                            padding: '2px 8px', borderRadius: '4px', fontWeight: 600,
                            fontSize: '11px', cursor: 'pointer', border: 'none',
                            background: f.visibility === 'public' ? 'rgba(22,163,74,0.15)' : 'rgba(239,68,68,0.15)',
                            color: f.visibility === 'public' ? '#16a34a' : '#dc2626',
                          }}
                        >
                          {f.visibility === 'public' ? 'Public' : 'CRs only'}
                        </button>
                      ) : (
                        <span style={{
                          padding: '1px 6px', borderRadius: '4px', fontWeight: 600,
                          background: f.visibility === 'public' ? 'rgba(22,163,74,0.1)' : f.visibility === 'cr_only' ? 'rgba(239,68,68,0.1)' : 'rgba(102,126,234,0.1)',
                          color: f.visibility === 'public' ? '#16a34a' : f.visibility === 'cr_only' ? '#dc2626' : '#667eea',
                        }}>
                          {f.visibility === 'public' ? 'Public' : f.visibility === 'cr_only' ? 'CRs only' : 'Personal'}
                        </span>
                      )}
                    </div>
                  </div>
                  {f.can_delete && (
                    <button onClick={() => handleDeleteAnalytics(f.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '4px', flexShrink: 0 }}>
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
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
const actionBtn = {
  display: 'inline-flex', alignItems: 'center', gap: '4px',
  padding: '6px 12px', borderRadius: '7px',
  border: 'none', background: '#667eea', color: 'white',
  fontSize: '12px', fontWeight: 600, cursor: 'pointer',
};
const inputStyle = {
  padding: '5px 8px', border: '1px solid var(--border-color)',
  borderRadius: '6px', fontSize: '13px',
  background: 'var(--card-bg)', color: 'var(--text-primary)',
  outline: 'none', width: '100%', boxSizing: 'border-box',
};
const labelStyle = {
  fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)',
  display: 'block', marginBottom: '4px',
};
const detailLabel = {
  fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px',
};

export default MarksDetail;
