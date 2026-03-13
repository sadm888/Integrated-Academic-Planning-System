import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Upload, Plus, X, AlertTriangle, CheckCircle, RefreshCw, Calendar, Edit2, FileDown, Printer } from 'lucide-react';
import { timetableAPI } from '../services/api';
import '../styles/Classroom.css';

const AC_TYPE_COLORS = {
  Holiday:        { bg: 'var(--cell-holiday-bg)',    text: 'var(--cell-holiday-text)',    border: 'var(--cell-holiday-border)'    },
  'Semester Exam':{ bg: 'var(--cell-semexam-bg)',    text: 'var(--cell-semexam-text)',    border: 'var(--cell-semexam-border)'    },
  Exam:           { bg: 'var(--cell-exam-bg)',        text: 'var(--cell-exam-text)',        border: 'var(--cell-exam-border)'        },
  Event:          { bg: 'var(--cell-event-bg)',       text: 'var(--cell-event-text)',       border: 'var(--cell-event-border)'       },
  Break:          { bg: 'var(--cell-break-bg)',       text: 'var(--cell-break-text)',       border: 'var(--cell-break-border)'       },
  Submission:     { bg: 'var(--cell-submission-bg)',  text: 'var(--cell-submission-text)',  border: 'var(--cell-submission-border)'  },
  Other:          { bg: 'var(--cell-default-bg)',     text: 'var(--cell-default-text)',     border: 'var(--cell-default-border)'     },
};

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildEvMap(events) {
  const evMap = {};
  (events || []).filter(e => e.date).forEach(ev => {
    // Use local date constructor to avoid UTC timezone shift (toISOString gives wrong date in UTC+)
    const [sy, sm, sd] = ev.date.split('-').map(Number);
    const start = new Date(sy, sm - 1, sd);
    const endStr = ev.end_date && ev.end_date !== ev.date ? ev.end_date : ev.date;
    const [ey, em, ed] = endStr.split('-').map(Number);
    const end = new Date(ey, em - 1, ed);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = localDateKey(d);
      if (!evMap[key]) evMap[key] = [];
      if (key === ev.date) evMap[key].push(ev);
      else if (!evMap[key].some(x => x.title === ev.title)) evMap[key].push({ ...ev, _rangeDay: true });
    }
  });
  return evMap;
}

function EventDetailModal({ event, eventIndex, allEvents, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({ ...event });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const c = AC_TYPE_COLORS[form.type] || AC_TYPE_COLORS.Other;

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = allEvents.map((ev, i) => i === eventIndex ? form : ev);
      await onSave(updated);
      onClose();
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const updated = allEvents.filter((_, i) => i !== eventIndex);
      await onDelete(updated);
      onClose();
    } finally { setDeleting(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: '16px' }}>Edit Event</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '12px' }}>Title</label>
            <input value={form.title || ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Event title" style={{ width: '100%', fontWeight: 600 }} />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <div className="form-group" style={{ margin: 0, flex: 1 }}>
              <label style={{ fontSize: '12px' }}>Start Date</label>
              <input type="date" value={form.date || ''} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="form-group" style={{ margin: 0, flex: 1 }}>
              <label style={{ fontSize: '12px' }}>End Date (optional)</label>
              <input type="date" value={form.end_date || ''} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
            </div>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '12px' }}>Type</label>
            <select
              value={form.type || 'Other'}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              style={{ border: `1.5px solid ${c.border}`, background: c.bg, color: c.text, fontWeight: 600 }}
            >
              {Object.keys(AC_TYPE_COLORS).map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          {(form.type === 'Exam' || form.type === 'Semester Exam') && (
            <div style={{ display: 'flex', gap: '10px' }}>
              <div className="form-group" style={{ margin: 0, flex: 1 }}>
                <label style={{ fontSize: '12px' }}>Start Time</label>
                <input type="time" value={form.start_time || ''} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0, flex: 1 }}>
                <label style={{ fontSize: '12px' }}>End Time</label>
                <input type="time" value={form.end_time || ''} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
              </div>
            </div>
          )}
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '12px' }}>Description (optional)</label>
            <textarea
              value={form.description || ''}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              placeholder="Additional details, notes..."
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '20px', justifyContent: 'space-between' }}>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            style={{ padding: '7px 14px', background: 'var(--danger-color)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={onClose} style={{ padding: '7px 14px', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'transparent', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={saving} style={{ padding: '7px 14px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickAddExamModal({ onSave, onClose }) {
  const [form, setForm] = useState({ title: '', date: '', type: 'Exam', start_time: '', end_time: '' });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.title.trim() || !form.date) return;
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally { setSaving(false); }
  };

  const c = AC_TYPE_COLORS[form.type] || AC_TYPE_COLORS.Other;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: '16px' }}>Add Exam</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '12px' }}>Exam Name</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. MA101 Mid Sem" autoFocus />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '12px' }}>Date</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '12px' }}>Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              style={{ border: `1.5px solid ${c.border}`, background: c.bg, color: c.text, fontWeight: 600 }}>
              <option value="Exam">Exam (Quiz/Test)</option>
              <option value="Semester Exam">Semester Exam (Mid/End Sem)</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <div className="form-group" style={{ margin: 0, flex: 1 }}>
              <label style={{ fontSize: '12px' }}>Start Time (optional)</label>
              <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
            </div>
            <div className="form-group" style={{ margin: 0, flex: 1 }}>
              <label style={{ fontSize: '12px' }}>End Time (optional)</label>
              <input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
            </div>
          </div>
        </div>
        <div className="modal-buttons">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving || !form.title.trim() || !form.date}
            style={{ background: c.bg, color: c.text, border: `1.5px solid ${c.border}` }}>
            {saving ? 'Adding...' : 'Add Exam'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ monthDate, evMap, semStart, semEnd, onEventClick }) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const monthLabel = monthDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const todayKey = localDateKey(new Date());

  const firstDay = new Date(year, month, 1);
  const offset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const gridStart = new Date(firstDay);
  gridStart.setDate(gridStart.getDate() - offset);

  const weeks = [];
  let wStart = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) { week.push(new Date(wStart)); wStart.setDate(wStart.getDate() + 1); }
    if (week.some(d => d.getMonth() === month)) weeks.push(week);
  }

  return (
    <div style={{ marginBottom: '28px' }}>
      <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)', marginBottom: '8px', paddingBottom: '6px', borderBottom: '2px solid var(--border-color)' }}>
        {monthLabel}
      </div>
      <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px', tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ background: 'var(--card-bg)', borderBottom: '2px solid var(--border-color)' }}>
              {DAY_HEADERS.map(dh => (
                <th key={dh} style={{ padding: '8px 4px', fontSize: '11px', fontWeight: 700, color: dh === 'Sat' || dh === 'Sun' ? 'var(--text-secondary)' : 'var(--text-primary)', textAlign: 'center', borderRight: '1px solid var(--border-color)' }}>
                  {dh}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi} style={{ borderBottom: '1px solid var(--border-color)' }}>
                {week.map((day, di) => {
                  const inMonth = day.getMonth() === month;
                  const dateKey = localDateKey(day);
                  const isWeekend = di >= 5;
                  const dayEvents = evMap[dateKey] || [];
                  const isToday = dateKey === todayKey;
                  const isSemBoundary = dateKey === semStart || dateKey === semEnd;
                  return (
                    <td key={di} style={{
                      verticalAlign: 'top', padding: '4px', minHeight: '70px',
                      background: !inMonth || isWeekend ? 'var(--bg-color)' : 'var(--card-bg)',
                      borderRight: '1px solid var(--border-color)',
                      opacity: !inMonth ? 0.4 : 1,
                    }}>
                      <div style={{
                        fontSize: '12px', fontWeight: isToday ? 800 : 600,
                        color: isToday ? 'white' : isWeekend ? 'var(--text-secondary)' : 'var(--text-primary)',
                        background: isToday ? 'var(--primary-color)' : isSemBoundary ? 'var(--primary-color)22' : 'transparent',
                        borderRadius: '50%', width: '22px', height: '22px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        marginBottom: '2px',
                      }}>
                        {day.getDate()}
                      </div>
                      {(dayEvents.some(ev => ev.type === 'Holiday')
                        ? dayEvents.filter(ev => ev.type === 'Holiday')
                        : dayEvents
                      ).map((ev, ei) => {
                        const c = AC_TYPE_COLORS[ev.type] || AC_TYPE_COLORS.Other;
                        return (
                          <div
                            key={ei}
                            title={ev.title}
                            onClick={() => onEventClick && onEventClick(ev)}
                            style={{
                              background: c.bg, color: c.text, border: `1px solid ${c.border}`,
                              borderRadius: '4px', padding: '2px 5px',
                              marginBottom: '2px', lineHeight: 1.3, overflow: 'hidden',
                              opacity: ev._rangeDay ? 0.75 : 1,
                              cursor: onEventClick ? 'pointer' : 'default',
                            }}
                          >
                            <div style={{ fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: c.text, fontWeight: 600 }}>
                              {ev._rangeDay ? '↳ ' : ''}{ev.title}
                            </div>
                            {ev.description && (
                              <div style={{ fontSize: '9px', color: c.text, opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {ev.description}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Reusable event list editor (used in review + edit mode)
function EventEditor({ data, onChange }) {
  const updateEvent = (i, field, value) =>
    onChange(p => { const ev2 = [...p.events]; ev2[i] = { ...ev2[i], [field]: value }; return { ...p, events: ev2 }; });

  return (
    <>
      {/* Semester dates */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ margin: 0, flex: 1, minWidth: '160px' }}>
          <label style={{ fontSize: '12px' }}>Semester Start</label>
          <input type="date" value={data.semester_start || ''} onChange={e => onChange(p => ({ ...p, semester_start: e.target.value }))} />
        </div>
        <div className="form-group" style={{ margin: 0, flex: 1, minWidth: '160px' }}>
          <label style={{ fontSize: '12px' }}>Semester End</label>
          <input type="date" value={data.semester_end || ''} onChange={e => onChange(p => ({ ...p, semester_end: e.target.value }))} />
        </div>
      </div>

      {/* Events list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {(data.events || []).map((ev, i) => {
          const c = AC_TYPE_COLORS[ev.type] || AC_TYPE_COLORS.Other;
          return (
            <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', background: 'var(--subtle-bg)', borderRadius: '8px', padding: '8px 10px', border: '1px solid var(--border-color)', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 500 }}>Start</span>
                <input type="date" value={ev.date || ''} onChange={e => updateEvent(i, 'date', e.target.value)} style={{ border: '1px solid var(--input-border)', borderRadius: '6px', padding: '4px 6px', fontSize: '12px', width: '130px' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 500 }}>End (optional)</span>
                <input type="date" value={ev.end_date || ''} onChange={e => updateEvent(i, 'end_date', e.target.value)} style={{ border: '1px solid var(--input-border)', borderRadius: '6px', padding: '4px 6px', fontSize: '12px', width: '130px' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: '160px' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 500 }}>Title</span>
                <input value={ev.title || ''} onChange={e => updateEvent(i, 'title', e.target.value)} placeholder="Event title" style={{ border: '1px solid var(--input-border)', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', fontWeight: 600, width: '100%' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 500 }}>Type</span>
                <select value={ev.type || 'Other'} onChange={e => updateEvent(i, 'type', e.target.value)} style={{ border: `1.5px solid ${c.border}`, borderRadius: '6px', padding: '4px 8px', fontSize: '12px', background: c.bg, color: c.text, fontWeight: 600 }}>
                  {Object.keys(AC_TYPE_COLORS).map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              {(ev.type === 'Exam' || ev.type === 'Semester Exam') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 500 }}>Start Time</span>
                  <input type="time" value={ev.start_time || ''} onChange={e => updateEvent(i, 'start_time', e.target.value)} style={{ border: '1px solid var(--input-border)', borderRadius: '6px', padding: '4px 6px', fontSize: '12px', width: '110px' }} />
                </div>
              )}
              {(ev.type === 'Exam' || ev.type === 'Semester Exam') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 500 }}>End Time</span>
                  <input type="time" value={ev.end_time || ''} onChange={e => updateEvent(i, 'end_time', e.target.value)} style={{ border: '1px solid var(--input-border)', borderRadius: '6px', padding: '4px 6px', fontSize: '12px', width: '110px' }} />
                </div>
              )}
              <button onClick={() => onChange(p => ({ ...p, events: p.events.filter((_, j) => j !== i) }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)', padding: '2px', alignSelf: 'flex-end', marginBottom: '2px' }}>
                <X size={14} />
              </button>
            </div>
          );
        })}
        <button
          onClick={() => onChange(p => ({ ...p, events: [...(p.events || []), { date: '', end_date: '', title: '', type: 'Event', description: '' }] }))}
          style={{ padding: '7px', border: '1.5px dashed var(--input-border)', borderRadius: '8px', background: 'transparent', cursor: 'pointer', fontSize: '13px', color: 'var(--primary-color)', fontWeight: 600 }}
        >
          + Add Event
        </button>
      </div>
    </>
  );
}

export default function AcademicCalendar({ user }) {
  const { classroomId, semesterId } = useParams();
  const navigate = useNavigate();

  const [academicCal, setAcademicCal] = useState(null);
  const [isCr, setIsCr] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ML extraction flow
  const [extractStep, setExtractStep] = useState('idle'); // idle | extracting | review | saving
  const [extractedData, setExtractedData] = useState(null);
  const [extractError, setExtractError] = useState('');

  // Manual builder
  const [showManualBuilder, setShowManualBuilder] = useState(false);

  // Edit mode (for already-saved calendar)
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState(null);

  // Push
  const [pushLoading, setPushLoading] = useState(false);

  // Event detail modal (click to edit/delete individual event)
  const [editingEvent, setEditingEvent] = useState(null); // { event, index }

  // Quick add exam
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [acRes, baseRes] = await Promise.all([
        timetableAPI.getAcademicCalendar(semesterId),
        timetableAPI.get(semesterId),
      ]);
      setAcademicCal(acRes.data.academic_calendar);
      setIsCr(baseRes.data.is_cr);
    } catch {
      setError('Failed to load academic calendar');
    } finally {
      setLoading(false);
    }
  }, [semesterId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setExtractStep('extracting');
    setExtractError('');
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await timetableAPI.extractAcademicCalendar(semesterId, fd);
      setExtractedData(res.data.extracted);
      setExtractStep('review');
    } catch (err) {
      setExtractError(err.response?.data?.error || 'Extraction failed. Try a clearer image.');
      setExtractStep('idle');
    }
  };

  const handleSaveExtracted = async () => {
    setExtractStep('saving');
    try {
      await timetableAPI.saveAcademicCalendar(semesterId, extractedData);
      setExtractStep('idle');
      setExtractedData(null);
      setSuccess('Academic calendar saved!');
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
      setExtractStep('review');
    }
  };

  const handleStartManual = () => {
    setExtractedData({ semester_start: '', semester_end: '', events: [] });
    setExtractStep('review');
    setShowManualBuilder(false);
  };

  const handleSaveEdit = async () => {
    try {
      await timetableAPI.saveAcademicCalendar(semesterId, editData);
      setEditMode(false);
      setEditData(null);
      setSuccess('Academic calendar updated!');
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
  };

  const handlePush = async () => {
    setPushLoading(true);
    setError('');
    try {
      const res = await timetableAPI.pushAcademicCalendar(semesterId);
      setSuccess(res.data.message);
    } catch (err) {
      if (err.response?.data?.not_connected) {
        setError('Connect Google Calendar first from the /calendar page.');
      } else {
        setError(err.response?.data?.error || 'Failed to push to Google Calendar.');
      }
    } finally {
      setPushLoading(false);
    }
  };

  // ── Event click handlers (edit/delete individual events) ───────────────────

  const handleEventClick = (ev) => {
    const idx = academicCal.events.findIndex(e =>
      e.title === ev.title && e.date === ev.date && e.type === ev.type
    );
    if (idx >= 0) setEditingEvent({ event: ev, index: idx });
  };

  const handleEventSave = async (updatedEvents) => {
    const newCal = { ...academicCal, events: updatedEvents };
    await timetableAPI.saveAcademicCalendar(semesterId, newCal);
    setAcademicCal(newCal);
  };

  const handleEventDelete = async (updatedEvents) => {
    const newCal = { ...academicCal, events: updatedEvents };
    await timetableAPI.saveAcademicCalendar(semesterId, newCal);
    setAcademicCal(newCal);
  };

  const handleQuickAddExam = async (examForm) => {
    // Smart conflict detection
    const existing = (academicCal?.events || []).filter(ev => ev.date === examForm.date);
    if (existing.length > 0) {
      const names = existing.map(e => `${e.type}: ${e.title}`).join(', ');
      if (!window.confirm(`There are already ${existing.length} event(s) on ${examForm.date}:\n${names}\n\nAdd anyway?`)) return;
    }
    const newEvent = { ...examForm, end_date: examForm.end_date || examForm.date };
    const newCal = { ...academicCal, events: [...(academicCal.events || []), newEvent] };
    await timetableAPI.saveAcademicCalendar(semesterId, newCal);
    setAcademicCal(newCal);
  };

  // ── CSV Bulk Import ──────────────────────────────────────────────────────────
  // Expected CSV columns: title, date (YYYY-MM-DD), end_date, type, start_time, end_time, description
  const handleCsvImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { setError('CSV must have a header row + data rows.'); return; }
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
    const get = (row, key) => {
      const idx = headers.indexOf(key);
      return idx >= 0 ? (row[idx] || '').trim().replace(/^"|"$/g, '') : '';
    };
    const newEvents = [];
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(',');
      const title = get(row, 'title');
      const date = get(row, 'date');
      if (!title || !date) continue;
      newEvents.push({
        title,
        date,
        end_date: get(row, 'end_date') || date,
        type: get(row, 'type') || 'Exam',
        start_time: get(row, 'start_time') || '',
        end_time: get(row, 'end_time') || '',
        description: get(row, 'description') || '',
      });
    }
    if (newEvents.length === 0) { setError('No valid events found in CSV.'); return; }
    // Conflict check
    const existingDates = new Set((academicCal?.events || []).map(ev => ev.date));
    const conflicts = newEvents.filter(ev => existingDates.has(ev.date));
    if (conflicts.length > 0 && !window.confirm(`${conflicts.length} event(s) conflict with existing dates. Import all ${newEvents.length} events anyway?`)) return;
    const newCal = { ...academicCal, events: [...(academicCal?.events || []), ...newEvents] };
    try {
      await timetableAPI.saveAcademicCalendar(semesterId, newCal);
      setAcademicCal(newCal);
      setSuccess(`Imported ${newEvents.length} events from CSV.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed');
    }
  };

  // ── Extracting spinner ──────────────────────────────────────────────────────

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '40vh', color: 'var(--primary-color)', fontSize: '16px' }}>Loading...</div>;
  }

  if (extractStep === 'extracting') {
    return (
      <div className="classroom-container">
        <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--primary-color)' }}>
          <RefreshCw size={40} style={{ marginBottom: '16px', animation: 'spin 1s linear infinite' }} />
          <h3>Extracting academic calendar with AI...</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>This usually takes 5–15 seconds</p>
        </div>
      </div>
    );
  }

  // ── Review / Manual entry screen ────────────────────────────────────────────

  if (extractStep === 'review' && extractedData) {
    return (
      <div className="classroom-container">
        {error && <div className="error-message" style={{ marginBottom: '16px' }}>{error}</div>}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: 0 }}>Review Academic Calendar</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: '4px 0 0' }}>
              Edit dates and events before saving. Add or remove entries as needed.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => { setExtractStep('idle'); setExtractedData(null); }} style={{ padding: '8px 16px', border: '1.5px solid var(--border-color)', borderRadius: '8px', background: 'transparent', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
              Discard
            </button>
            <button onClick={handleSaveExtracted} disabled={extractStep === 'saving'} style={{ padding: '8px 18px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
              {extractStep === 'saving' ? 'Saving...' : 'Save Calendar'}
            </button>
          </div>
        </div>
        <EventEditor data={extractedData} onChange={setExtractedData} />
      </div>
    );
  }

  // ── Edit mode (already-saved calendar) ─────────────────────────────────────

  if (editMode && editData) {
    return (
      <div className="classroom-container">
        {error && <div className="error-message" style={{ marginBottom: '16px' }}>{error}</div>}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: 0 }}>Edit Academic Calendar</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: '4px 0 0' }}>Make changes, then save.</p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => { setEditMode(false); setEditData(null); }} style={{ padding: '8px 16px', border: '1.5px solid var(--border-color)', borderRadius: '8px', background: 'transparent', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
              Cancel
            </button>
            <button onClick={handleSaveEdit} style={{ padding: '8px 18px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
              Save Changes
            </button>
          </div>
        </div>
        <EventEditor data={editData} onChange={setEditData} />
      </div>
    );
  }

  // ── No calendar — CR sees upload + manual options ───────────────────────────

  if (!academicCal) {
    return (
      <div className="classroom-container">
        {error && <div className="error-message" style={{ marginBottom: '16px' }}>{error}</div>}
        {extractError && (
          <div className="error-message" style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={16} /><span>{extractError}</span>
            </div>
          </div>
        )}
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Calendar size={64} strokeWidth={1.25} color="var(--primary-color)" style={{ marginBottom: '20px' }} />
          <h2 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>No academic calendar yet</h2>
          {isCr ? (
            <>
              <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', margin: '0 auto 32px', lineHeight: 1.7, fontSize: '14px' }}>
                Upload a photo or PDF of the college academic calendar. AI will extract all holidays, exam dates, and events — or build it manually.
              </p>
              {!showManualBuilder ? (
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <label style={{ padding: '12px 28px', background: 'var(--primary-color)', color: 'white', borderRadius: '10px', cursor: 'pointer', fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Upload size={16} />
                    Upload Calendar Image / PDF
                    <input type="file" accept="image/*,.pdf" onChange={handleFileUpload} style={{ display: 'none' }} />
                  </label>
                  <button
                    onClick={() => setShowManualBuilder(true)}
                    style={{ padding: '12px 28px', background: 'transparent', border: '2px solid var(--primary-color)', color: 'var(--primary-color)', borderRadius: '10px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}
                  >
                    <Plus size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                    Create Manually
                  </button>
                </div>
              ) : (
                <div style={{ maxWidth: '400px', margin: '0 auto', textAlign: 'left', background: 'var(--card-bg)', borderRadius: '12px', padding: '24px', border: '1.5px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ margin: 0 }}>Manual Setup</h3>
                    <button onClick={() => setShowManualBuilder(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px', lineHeight: 1.6 }}>
                    Start with a blank calendar. You'll be taken to the event editor where you can add all your holidays, exams, and events.
                  </p>
                  <button
                    onClick={handleStartManual}
                    style={{ width: '100%', padding: '10px 24px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}
                  >
                    Start with Blank Calendar →
                  </button>
                </div>
              )}
            </>
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>The CR hasn't uploaded the academic calendar yet.</p>
          )}
        </div>
      </div>
    );
  }

  // ── Main calendar view ──────────────────────────────────────────────────────

  const evMap = buildEvMap(academicCal.events);
  const allDates = Object.keys(evMap).sort();
  let months = [];
  const startDate = academicCal.semester_start
    ? new Date(academicCal.semester_start + 'T00:00:00')
    : allDates.length ? new Date(allDates[0] + 'T00:00:00') : new Date();
  const endDate = academicCal.semester_end
    ? new Date(academicCal.semester_end + 'T00:00:00')
    : allDates.length ? new Date(allDates[allDates.length - 1] + 'T00:00:00') : new Date();
  let cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const last = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  while (cur <= last) { months.push(new Date(cur)); cur.setMonth(cur.getMonth() + 1); }

  return (
    <div className="classroom-container">
      {/* Sub-nav */}
      <div className="page-subnav">
        <Link className="page-subnav-item" to={`/classroom/${classroomId}/semester/${semesterId}`}>Dashboard</Link>
        <button className="page-subnav-item" onClick={() => navigate(`/classroom/${classroomId}/semester/${semesterId}/chat`)}>Chat</button>
        <Link className="page-subnav-item" to={`/classroom/${classroomId}/semester/${semesterId}/files`}>Resources</Link>
        <Link className="page-subnav-item" to={`/classroom/${classroomId}/semester/${semesterId}/marks`}>Marks</Link>
        <Link className="page-subnav-item" to={`/classroom/${classroomId}/semester/${semesterId}/timetable`}>Timetable</Link>
        <Link className="page-subnav-item accent" to={`/classroom/${classroomId}/semester/${semesterId}/academic-calendar`}>Academic Calendar</Link>
        <div className="page-subnav-spacer" />
        {isCr && (
          <label className="page-subnav-item" title="Import exams from CSV (columns: title, date, end_date, type, start_time, end_time, description)" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <FileDown size={13} /> Import CSV
            <input type="file" accept=".csv,text/csv" onChange={handleCsvImport} style={{ display: 'none' }} />
          </label>
        )}
        <button className="page-subnav-item" onClick={() => window.print()} title="Print academic calendar" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <Printer size={13} /> Print
        </button>
      </div>

      {error && <div className="error-message" style={{ marginBottom: '12px' }}>{error}</div>}
      {success && <div className="success-message" style={{ marginBottom: '12px' }}>{success}</div>}

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {extractError && (
            <span style={{ fontSize: '12px', color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertTriangle size={13} />{extractError}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {isCr && (
            <>
              <button
                onClick={() => setQuickAddOpen(true)}
                style={{ padding: '7px 14px', background: 'var(--cell-exam-bg)', color: 'var(--cell-exam-text)', border: `1.5px solid var(--cell-exam-border)`, borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px' }}
              >
                + Add Exam
              </button>
              <button
                onClick={() => { setEditData({ semester_start: academicCal.semester_start || '', semester_end: academicCal.semester_end || '', events: JSON.parse(JSON.stringify(academicCal.events || [])) }); setEditMode(true); }}
                style={{ padding: '7px 14px', border: '1.5px solid var(--primary-color)', color: 'var(--primary-color)', borderRadius: '8px', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px' }}
              >
                <Edit2 size={13} /> Edit Calendar
              </button>
              <label style={{ padding: '7px 14px', background: 'var(--primary-color)', color: 'white', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Upload size={13} /> Re-upload
                <input type="file" accept="image/*,.pdf" onChange={handleFileUpload} style={{ display: 'none' }} />
              </label>
              <button
                onClick={handlePush}
                disabled={pushLoading}
                style={{ padding: '7px 14px', background: 'var(--success-color)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px' }}
              >
                <Calendar size={13} /> {pushLoading ? 'Pushing...' : 'Push to GCal'}
              </button>
            </>
          )}
          {!isCr && academicCal && (
            <button onClick={handlePush} disabled={pushLoading} style={{ padding: '7px 14px', background: 'var(--success-color)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Calendar size={13} /> {pushLoading ? 'Pushing...' : 'Push to GCal'}
            </button>
          )}
        </div>
      </div>

      {/* Semester dates bar */}
      {(academicCal.semester_start || academicCal.semester_end) && (
        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', background: 'var(--cell-event-bg)', border: '1px solid var(--cell-event-border)', borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: 'var(--cell-event-text)', flexWrap: 'wrap' }}>
          {academicCal.semester_start && <span><strong>Semester Start:</strong> {academicCal.semester_start}</span>}
          {academicCal.semester_end && <span><strong>Semester End:</strong> {academicCal.semester_end}</span>}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {Object.entries(AC_TYPE_COLORS).map(([type, c]) => (
          <span key={type} style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: '5px', padding: '2px 8px', fontSize: '11px', fontWeight: 600 }}>{type}</span>
        ))}
      </div>

      {/* Monthly grids */}
      {months.length === 0
        ? <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '24px' }}>No events found.</p>
        : months.map((m, i) => (
          <MonthGrid
            key={i}
            monthDate={m}
            evMap={evMap}
            semStart={academicCal.semester_start}
            semEnd={academicCal.semester_end}
            onEventClick={isCr ? handleEventClick : null}
          />
        ))
      }

      {editingEvent && (
        <EventDetailModal
          event={editingEvent.event}
          eventIndex={editingEvent.index}
          allEvents={academicCal.events}
          onSave={handleEventSave}
          onDelete={handleEventDelete}
          onClose={() => setEditingEvent(null)}
        />
      )}

      {quickAddOpen && (
        <QuickAddExamModal
          onSave={handleQuickAddExam}
          onClose={() => setQuickAddOpen(false)}
        />
      )}
    </div>
  );
}
