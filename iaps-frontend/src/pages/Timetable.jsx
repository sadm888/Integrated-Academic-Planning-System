import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Upload, Plus, X, Edit2, AlertTriangle, CheckCircle, RefreshCw, Calendar, ChevronLeft, ChevronRight, Printer, BookOpen, FileDown, GraduationCap } from 'lucide-react';
import { timetableAPI } from '../services/api';
import '../styles/Classroom.css';

// ── Color helpers ─────────────────────────────────────────────────────────────

const TYPE_COLORS = {
  Lecture:   { bg: 'var(--cell-lecture-bg)',  text: 'var(--cell-lecture-text)',  border: 'var(--cell-lecture-border)'  },
  Lab:       { bg: 'var(--cell-lab-bg)',      text: 'var(--cell-lab-text)',      border: 'var(--cell-lab-border)'      },
  Tutorial:  { bg: 'var(--cell-tutorial-bg)', text: 'var(--cell-tutorial-text)', border: 'var(--cell-tutorial-border)' },
  Free:      { bg: 'var(--cell-free-bg)',     text: 'var(--cell-free-text)',     border: 'var(--cell-free-border)'     },
  Lunch:     { bg: 'var(--cell-lunch-bg)',    text: 'var(--cell-lunch-text)',    border: 'var(--cell-lunch-border)'    },
  Library:   { bg: 'var(--cell-library-bg)',  text: 'var(--cell-library-text)',  border: 'var(--cell-library-border)'  },
  Holiday:   { bg: 'var(--cell-holiday-bg)',  text: 'var(--cell-holiday-text)',  border: 'var(--cell-holiday-border)'  },
  Cancelled: { bg: 'var(--cell-cancel-bg)',   text: 'var(--cell-cancel-text)',   border: 'var(--cell-cancel-border)'   },
};

function cellColors(type) {
  return TYPE_COLORS[type] || { bg: 'var(--cell-default-bg)', text: 'var(--cell-default-text)', border: 'var(--cell-default-border)' };
}

// ── Time helpers for exam slot matching ───────────────────────────────────────
const parseMinutes = (t) => {
  if (!t) return 0;
  const parts = t.replace('.', ':').split(':');
  return parseInt(parts[0], 10) * 60 + (parseInt(parts[1], 10) || 0);
};

const slotOverlapsRange = (slotLabel, startTime, endTime) => {
  // slotLabel e.g. "9:00-10:45" or "14:00-15:00"
  const m = slotLabel.match(/(\d{1,2}[:.]\d{2})\s*[-–]\s*(\d{1,2}[:.]\d{2})/);
  if (!m) return false;
  const sStart = parseMinutes(m[1]);
  const sEnd   = parseMinutes(m[2]);
  const eStart = parseMinutes(startTime);
  const eEnd   = parseMinutes(endTime);
  return eStart < sEnd && eEnd > sStart;
};

const STATUS_BADGE = {
  cancelled: { bg: 'var(--cell-cancel-bg)',  text: 'var(--cell-cancel-text)',  label: 'CANCELLED' },
  modified:  { bg: 'var(--cell-holiday-bg)', text: 'var(--cell-holiday-text)', label: 'MODIFIED'  },
  normal:    null,
};


// ── Sub-components ────────────────────────────────────────────────────────────

function CellChip({ cell, slot, day, onClick, isCr }) {
  const permCancelled = cell.type === 'Cancelled';
  const c = cellColors(cell.type);
  const isClass = cell.subject && !['Free', 'Lunch', 'Library', 'Break', 'Cancelled'].includes(cell.type);
  const badge = permCancelled
    ? { bg: 'var(--cell-cancel-bg)', text: 'var(--cell-cancel-text)', label: 'CANCELLED' }
    : STATUS_BADGE[cell.status];

  return (
    <div
      onClick={() => onClick && onClick(day, slot, cell)}
      style={{
        background: (cell.status === 'cancelled' || permCancelled) ? 'var(--cell-cancel-bg)' : c.bg,
        border: `1.5px solid ${(cell.status === 'cancelled' || permCancelled) ? 'var(--cell-cancel-border)' : c.border}`,
        borderRadius: '6px',
        padding: '6px 7px',
        fontSize: '12px',
        cursor: onClick ? 'pointer' : 'default',
        minHeight: '68px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        position: 'relative',
        transition: 'box-shadow 0.15s',
        opacity: (cell.status === 'cancelled' || permCancelled) ? 0.7 : 1,
      }}
    >
      {badge && (
        <span style={{
          fontSize: '9px', fontWeight: 700, background: badge.bg, color: badge.text,
          borderRadius: '3px', padding: '1px 4px', marginBottom: '2px', alignSelf: 'flex-start',
        }}>{badge.label}</span>
      )}
      {cell.subject ? (
        <>
          <span style={{ fontWeight: 700, color: c.text, lineHeight: 1.2, fontSize: '12px', textDecoration: (cell.status === 'cancelled' || permCancelled) ? 'line-through' : 'none' }}>
            {cell.subject}
          </span>
          {cell.teacher && (
            <span style={{ fontSize: '11px', color: 'var(--text-primary)', marginTop: '2px' }}>{cell.teacher}</span>
          )}
          {cell.room && (
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{cell.room}</span>
          )}
          {cell.rescheduled_time && (
            <span style={{ fontSize: '10px', color: 'var(--warning-color)', fontWeight: 600 }}>→ {cell.rescheduled_time}</span>
          )}
          {cell.notes && (
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cell.notes}>· {cell.notes}</span>
          )}
          {cell.link && (
            <a href={cell.link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: '10px', color: 'var(--primary-color)', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>↗ Link</a>
          )}
        </>
      ) : (
        <span style={{ color: 'var(--text-secondary)', fontSize: '11px', fontWeight: 500 }}>
          {cell.type || 'Free'}
        </span>
      )}
      {isCr && isClass && (
        <span style={{
          position: 'absolute', top: '4px', right: '4px',
          opacity: 0, transition: 'opacity 0.15s',
        }} className="cell-edit-icon">
          <Edit2 size={10} color="var(--text-secondary)" />
        </span>
      )}
    </div>
  );
}

// Cell click → override modal (CR can edit; others see read-only info)
function OverrideModal({ day, slot, cell, onClose, onSave, onDeleteOverride, selectedDate, isDayOverride, isCr }) {
  const [action, setAction] = useState('cancel');
  const [scope, setScope] = useState('this_day');
  const [reason, setReason] = useState('');
  const [changes, setChanges] = useState({
    subject: cell?.subject || '',
    teacher: cell?.teacher || '',
    room: cell?.room || '',
    type: cell?.type || 'Lecture',
    new_time: '',
    link: cell?.link || '',
  });
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      await onSave({ day, slot, action, scope, reason, changes, date: selectedDate });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    setDeleting(true);
    try {
      await onDeleteOverride(cell.override_id);
    } finally {
      setDeleting(false);
    }
  };

  // Non-CRs see read-only info only
  if (!isCr) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" style={{ maxWidth: '380px' }} onClick={e => e.stopPropagation()}>
          <h2 style={{ marginBottom: '8px' }}>{slot} · {day}</h2>
          {cell?.subject ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
              <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>{cell.subject}</p>
              {cell.teacher && <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>{cell.teacher}</p>}
              {cell.room && <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>{cell.room}</p>}
              {cell.status === 'cancelled' && <span style={{ background: 'var(--cell-cancel-bg)', color: 'var(--cell-cancel-text)', border: '1px solid var(--cell-cancel-border)', borderRadius: '5px', padding: '2px 8px', fontSize: '11px', fontWeight: 700, alignSelf: 'flex-start' }}>CANCELLED</span>}
              {cell.status === 'modified' && <span style={{ background: 'var(--cell-holiday-bg)', color: 'var(--cell-holiday-text)', borderRadius: '5px', padding: '2px 8px', fontSize: '11px', fontWeight: 700, alignSelf: 'flex-start' }}>MODIFIED</span>}
              {cell.override_reason && <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Override note: {cell.override_reason}</p>}
              {cell.notes && <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>{cell.notes}</p>}
              {cell.link && <a href={cell.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: 'var(--primary-color)' }}>↗ Open link</a>}
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>No class at this time.</p>
          )}
          <div className="modal-buttons">
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: '4px' }}>Override: {slot} on {day}</h2>
        {cell?.subject && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
            Current: <strong>{cell.subject}</strong> {cell.teacher && `· ${cell.teacher}`} {cell.room && `· ${cell.room}`}
          </p>
        )}

        {/* Action */}
        <div className="form-group">
          <label>Action</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { val: 'cancel', label: 'Cancel Class', color: 'var(--danger-color)' },
              { val: 'reschedule', label: 'Reschedule', color: 'var(--warning-color)' },
              { val: 'edit', label: 'Edit Details', color: 'var(--info-color)' },
            ].map(opt => (
              <button
                key={opt.val}
                type="button"
                onClick={() => setAction(opt.val)}
                style={{
                  padding: '7px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                  border: `2px solid ${action === opt.val ? opt.color : 'var(--border-color)'}`,
                  background: action === opt.val ? opt.color : 'transparent',
                  color: action === opt.val ? 'white' : 'var(--unselected-text)',
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scope */}
        <div className="form-group">
          <label>Applies to</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[
              { val: 'this_day', label: 'Just this day (' + selectedDate + ')' },
              { val: 'all_future', label: 'All future occurrences' },
            ].map(opt => (
              <button
                key={opt.val}
                type="button"
                onClick={() => setScope(opt.val)}
                style={{
                  padding: '7px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                  border: `2px solid ${scope === opt.val ? 'var(--primary-color)' : 'var(--border-color)'}`,
                  background: scope === opt.val ? 'var(--primary-color)' : 'transparent',
                  color: scope === opt.val ? 'white' : 'var(--unselected-text)',
                  cursor: 'pointer', flex: 1,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Details for reschedule/edit */}
        {(action === 'reschedule' || action === 'edit') && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div className="form-group">
                <label>Subject</label>
                <input value={changes.subject} onChange={e => setChanges({ ...changes, subject: e.target.value })} placeholder="Subject name" />
              </div>
              <div className="form-group">
                <label>Teacher</label>
                <input value={changes.teacher} onChange={e => setChanges({ ...changes, teacher: e.target.value })} placeholder="Teacher name" />
              </div>
              <div className="form-group">
                <label>Room</label>
                <input value={changes.room} onChange={e => setChanges({ ...changes, room: e.target.value })} placeholder="Room / Location" />
              </div>
              <div className="form-group">
                <label>Type</label>
                <select value={changes.type} onChange={e => setChanges({ ...changes, type: e.target.value })}>
                  <option>Lecture</option>
                  <option>Lab</option>
                  <option>Tutorial</option>
                  <option>Free</option>
                  <option>Lunch</option>
                  <option>Library</option>
                  <option>Break</option>
                </select>
              </div>
            </div>
            {action === 'reschedule' && (
              <div className="form-group">
                <label>New time slot (e.g. 11:00-12:00)</label>
                <input value={changes.new_time} onChange={e => setChanges({ ...changes, new_time: e.target.value })} placeholder="New time" />
              </div>
            )}
            <div className="form-group">
              <label>Link (optional)</label>
              <input value={changes.link} onChange={e => setChanges({ ...changes, link: e.target.value })} placeholder="https://meet.google.com/..." />
            </div>
          </>
        )}

        {/* Reason */}
        <div className="form-group">
          <label>Reason / Note</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            placeholder="e.g. Faculty unavailable, extra class, room change..."
          />
        </div>

        {cell?.override_id && (
          <div style={{ marginBottom: '12px', padding: '10px 12px', background: isDayOverride ? 'var(--cell-cancel-bg)' : 'var(--cell-holiday-bg)', borderRadius: '8px', border: `1px solid ${isDayOverride ? 'var(--cell-cancel-border)' : 'var(--cell-holiday-border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', color: isDayOverride ? 'var(--cell-cancel-text)' : 'var(--cell-holiday-text)', fontWeight: 500 }}>
              {isDayOverride
                ? `Full day cancelled${cell.override_reason ? `: ${cell.override_reason}` : ''} — remove to restore all classes`
                : `Active override by ${cell.override_by || 'CR'}${cell.override_reason ? `: ${cell.override_reason}` : ''}`
              }
            </span>
            <button
              type="button"
              onClick={handleRemove}
              disabled={deleting}
              style={{ fontSize: '12px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', border: 'none', background: 'var(--danger-color)', color: 'white', cursor: 'pointer' }}
            >
              {deleting ? 'Removing...' : 'Remove Override'}
            </button>
          </div>
        )}

        <div className="modal-buttons">
          <button type="button" onClick={onClose} disabled={loading}>Cancel</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            style={{ background: action === 'cancel' ? 'var(--danger-color)' : 'var(--primary-color)' }}
          >
            {loading ? 'Saving...' : 'Confirm Override'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Cell detail modal for editing the base timetable slot
function SlotEditModal({ day, slot, cell, onClose, onSave }) {
  const [form, setForm] = useState({
    subject: cell?.subject || '',
    teacher: cell?.teacher || '',
    room: cell?.room || '',
    type: cell?.type || 'Free',
    notes: cell?.notes || '',
    link: cell?.link || '',
  });
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      await onSave(day, slot, form);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
        <h2>Edit Slot: {day} · {slot}</h2>
        <div className="form-group">
          <label>Type</label>
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            <option>Lecture</option>
            <option>Lab</option>
            <option>Tutorial</option>
            <option>Free</option>
            <option>Lunch</option>
            <option>Library</option>
            <option>Cancelled</option>
          </select>
        </div>
        <div className="form-group">
          <label>Subject</label>
          <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="e.g. Engineering Mathematics" />
        </div>
        <div className="form-group">
          <label>Teacher</label>
          <input value={form.teacher} onChange={e => setForm({ ...form, teacher: e.target.value })} placeholder="Faculty name" />
        </div>
        <div className="form-group">
          <label>Room / Location</label>
          <input value={form.room} onChange={e => setForm({ ...form, room: e.target.value })} placeholder="Room number or lab name" />
        </div>
        <div className="form-group">
          <label>Class Notes / Info</label>
          <textarea
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            placeholder="Optional: notes, syllabus reference, etc."
            rows={2}
            style={{ resize: 'vertical' }}
          />
        </div>
        <div className="form-group">
          <label>Link (Meet / Slides / etc.)</label>
          <input
            value={form.link}
            onChange={e => setForm({ ...form, link: e.target.value })}
            placeholder="https://..."
            type="url"
          />
        </div>
        <div className="modal-buttons">
          <button type="button" onClick={onClose} disabled={loading}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Manual timetable builder (empty grid)
function ManualBuilder({ onComplete }) {
  const DAY_OPTIONS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const [days, setDays] = useState(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const [slots, setSlots] = useState(['8:00-9:00', '9:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-1:00', '1:00-2:00', '2:00-3:00', '3:00-4:00']);
  const [newSlot, setNewSlot] = useState('');

  const buildEmptyGrid = () => {
    const grid = {};
    for (const d of days) {
      grid[d] = {};
      for (const s of slots) {
        grid[d][s] = { subject: '', teacher: '', room: '', type: 'Free' };
      }
    }
    return grid;
  };

  return (
    <div>
      <h3 style={{ marginBottom: '12px' }}>Configure Timetable Structure</h3>
      <div className="form-group">
        <label>Days</label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {DAY_OPTIONS.map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])}
              style={{
                padding: '6px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                border: `2px solid ${days.includes(d) ? 'var(--primary-color)' : 'var(--border-color)'}`,
                background: days.includes(d) ? 'var(--primary-color)' : 'transparent',
                color: days.includes(d) ? 'white' : 'var(--unselected-text)', cursor: 'pointer',
              }}
            >{d}</button>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label>Time Slots</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto', marginBottom: '8px' }}>
          {slots.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--subtle-bg)', borderRadius: '6px', padding: '6px 10px' }}>
              <span style={{ flex: 1, fontSize: '13px', color: 'var(--text-primary)' }}>{s}</span>
              <button type="button" onClick={() => setSlots(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger-color)' }}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            value={newSlot}
            onChange={e => setNewSlot(e.target.value)}
            placeholder="e.g. 4:00-5:00"
            style={{ flex: 1, padding: '7px 10px', borderRadius: '7px', border: '1px solid var(--input-border)', fontSize: '13px' }}
            onKeyDown={e => {
              if (e.key === 'Enter' && newSlot.trim()) {
                setSlots(prev => [...prev, newSlot.trim()]);
                setNewSlot('');
              }
            }}
          />
          <button
            type="button"
            onClick={() => { if (newSlot.trim()) { setSlots(prev => [...prev, newSlot.trim()]); setNewSlot(''); } }}
            style={{ padding: '7px 14px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
          >
            Add
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onComplete({ days, time_slots: slots, grid: buildEmptyGrid() })}
        style={{ padding: '10px 24px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}
        disabled={days.length === 0 || slots.length === 0}
      >
        Create Empty Timetable →
      </button>
    </div>
  );
}

// Full-day cancel / holiday modal
function DayCancelModal({ day, selectedDate, existing, onClose, onSave, onDelete }) {
  const [reason, setReason] = useState(existing?.reason || '');
  const [scope, setScope] = useState('this_day');
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onSave({ day, slot: 'ALL', action: 'cancel', scope, reason, date: selectedDate });
      onClose();
    } finally { setLoading(false); }
  };

  const handleRemove = async () => {
    setDeleting(true);
    try { await onDelete(existing.override_id); } finally { setDeleting(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '440px' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: '4px' }}>Mark Holiday / Cancel Day</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
          All classes on <strong>{day} ({selectedDate})</strong> will be marked as cancelled.
        </p>

        {existing && (
          <div style={{ marginBottom: '12px', padding: '10px 12px', background: 'var(--cell-cancel-bg)', borderRadius: '8px', border: '1px solid var(--cell-cancel-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', color: 'var(--cell-cancel-text)', fontWeight: 500 }}>
              Full day already cancelled{existing.reason ? `: ${existing.reason}` : ''}
            </span>
            <button onClick={handleRemove} disabled={deleting} style={{ fontSize: '12px', fontWeight: 600, padding: '4px 10px', borderRadius: '6px', border: 'none', background: 'var(--danger-color)', color: 'white', cursor: 'pointer' }}>
              {deleting ? 'Removing...' : 'Remove Override'}
            </button>
          </div>
        )}

        <div className="form-group">
          <label>Applies to</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[
              { val: 'this_day', label: `Just ${selectedDate}` },
              { val: 'all_future', label: 'Every week on this day' },
            ].map(opt => (
              <button key={opt.val} type="button" onClick={() => setScope(opt.val)} style={{
                padding: '7px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                border: `2px solid ${scope === opt.val ? 'var(--primary-color)' : 'var(--border-color)'}`,
                background: scope === opt.val ? 'var(--primary-color)' : 'transparent',
                color: scope === opt.val ? 'white' : 'var(--unselected-text)', flex: 1,
              }}>{opt.label}</button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label>Reason (optional)</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="e.g. Public holiday, institute function, no classes..." />
        </div>

        <div className="modal-buttons">
          <button type="button" onClick={onClose} disabled={loading}>Cancel</button>
          <button type="button" onClick={handleConfirm} disabled={loading} style={{ background: 'var(--danger-color)' }}>
            {loading ? 'Saving...' : 'Mark as Holiday / Cancel Day'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add Exam Modal (saves to Academic Calendar, then reloads week) ──────────
const AC_TYPE_COLORS_TT = {
  Exam:           { bg: 'var(--cell-exam-bg)',     text: 'var(--cell-exam-text)',     border: 'var(--cell-exam-border)'     },
  'Semester Exam':{ bg: 'var(--cell-semexam-bg)',  text: 'var(--cell-semexam-text)',  border: 'var(--cell-semexam-border)'  },
};
function AddExamModalTT({ semesterId, onSave, onClose }) {
  const [form, setForm] = useState({ title: '', date: '', end_date: '', type: 'Exam', start_time: '', end_time: '', description: '' });
  const [saving, setSaving] = useState(false);
  const c = AC_TYPE_COLORS_TT[form.type] || AC_TYPE_COLORS_TT.Exam;
  const handleSave = async () => {
    if (!form.title.trim() || !form.date) return;
    setSaving(true);
    try { await onSave(form); onClose(); } finally { setSaving(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: '16px' }}>Add Exam</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '12px' }}>Exam Name</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. MA101 Mid Sem" autoFocus />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <div className="form-group" style={{ margin: 0, flex: 1 }}>
              <label style={{ fontSize: '12px' }}>Date</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="form-group" style={{ margin: 0, flex: 1 }}>
              <label style={{ fontSize: '12px' }}>End Date (optional)</label>
              <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
            </div>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '12px' }}>Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              style={{ border: `1.5px solid ${c.border}`, background: c.bg, color: c.text, fontWeight: 600 }}>
              <option value="Exam">Exam (Quiz / Test)</option>
              <option value="Semester Exam">Semester Exam (Mid / End Sem)</option>
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
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '12px' }}>Description (optional)</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Syllabus coverage, notes, venue…" rows={2} style={{ resize: 'vertical' }} />
          </div>
        </div>
        <div className="modal-buttons">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving || !form.title.trim() || !form.date}
            style={{ background: c.bg, color: c.text, border: `1.5px solid ${c.border}` }}>
            {saving ? 'Adding…' : 'Add Exam'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Exam detail / edit modal (click exam in week view)
function ExamDetailModal({ exam, onClose, onEdit, onDelete, isCr }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: exam.title || '', date: exam.date || '', end_date: exam.end_date || '', type: exam.type || 'Exam', start_time: exam.start_time || '', end_time: exam.end_time || '', description: exam.description || '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const c = exam.type === 'Semester Exam' ? AC_TYPE_COLORS_TT['Semester Exam'] : AC_TYPE_COLORS_TT.Exam;

  if (editing) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
          <h2 style={{ marginBottom: '16px' }}>Edit Exam</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '12px' }}>Exam Name</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} autoFocus />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '12px' }}>Type</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                <option value="Exam">Exam</option>
                <option value="Semester Exam">Semester Exam</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <div className="form-group" style={{ margin: 0, flex: 1 }}>
                <label style={{ fontSize: '12px' }}>Date</label>
                <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0, flex: 1 }}>
                <label style={{ fontSize: '12px' }}>End Date (optional)</label>
                <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <div className="form-group" style={{ margin: 0, flex: 1 }}>
                <label style={{ fontSize: '12px' }}>Start Time</label>
                <input value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} placeholder="e.g. 10:00" />
              </div>
              <div className="form-group" style={{ margin: 0, flex: 1 }}>
                <label style={{ fontSize: '12px' }}>End Time</label>
                <input value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} placeholder="e.g. 13:00" />
              </div>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '12px' }}>Description (optional)</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Syllabus, venue, instructions..." style={{ resize: 'vertical' }} />
            </div>
          </div>
          <div className="modal-buttons" style={{ marginTop: '16px' }}>
            <button type="button" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
            <button
              type="button"
              onClick={async () => { setSaving(true); try { await onEdit(exam, { ...form, end_date: form.end_date || form.date }); } finally { setSaving(false); } }}
              disabled={saving || !form.title.trim() || !form.date}
              style={{ background: 'var(--primary-color)' }}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
        <div style={{ marginBottom: '16px' }}>
          <span style={{
            fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px',
            background: c.bg, color: c.text, border: `1px solid ${c.border}`,
            borderRadius: '4px', padding: '2px 8px',
          }}>{exam.type}</span>
          <h2 style={{ margin: '8px 0 0', color: 'var(--text-primary)', fontSize: '20px' }}>{exam.title}</h2>
        </div>
        {exam.date && (
          <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: '14px' }}>
            📅 {new Date(exam.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {exam.end_date && exam.end_date !== exam.date
              ? ` — ${new Date(exam.end_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}`
              : ''}
          </p>
        )}
        {(exam.start_time || exam.end_time) && (
          <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: '14px' }}>
            🕐 {exam.start_time}{exam.end_time ? `–${exam.end_time}` : ''}
          </p>
        )}
        {exam.description && (
          <p style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: '14px', lineHeight: 1.5 }}>{exam.description}</p>
        )}
        <div className="modal-buttons" style={{ marginTop: '16px' }}>
          <button type="button" onClick={onClose}>Close</button>
          {isCr && (
            <>
              <button type="button" onClick={() => setEditing(true)} style={{ background: 'var(--primary-color)' }}>Edit</button>
              <button
                type="button"
                disabled={deleting}
                onClick={async () => { setDeleting(true); try { await onDelete(exam); } finally { setDeleting(false); } }}
                style={{ background: 'var(--danger-color)' }}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Timetable Component ──────────────────────────────────────────────────

export default function Timetable({ user }) {
  const { classroomId, semesterId } = useParams();
  const navigate = useNavigate();

  const [timetable, setTimetable] = useState(null);
  const [weekGrid, setWeekGrid] = useState({});
  const [weekStart, setWeekStart] = useState('');
  const [isCr, setIsCr] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // View: 'week' or 'base' — persisted via localStorage so navigation away and back restores state
  const [view, setView] = useState(() => localStorage.getItem(`tt_view_${semesterId}`) || 'week');

  // Edit mode (for base timetable)
  const [editMode, setEditMode] = useState(false);
  const [editGrid, setEditGrid] = useState({});

  // ML extraction state
  const [extractStep, setExtractStep] = useState('idle'); // idle | extracting | review | saving
  const [extractedData, setExtractedData] = useState(null);
  const [showManualBuilder, setShowManualBuilder] = useState(false);
  const [extractError, setExtractError] = useState('');

  // Override modal
  const [overrideModal, setOverrideModal] = useState(null); // { day, slot, cell, selectedDate }

  // Slot edit modal (for base timetable editing)
  const [slotEditModal, setSlotEditModal] = useState(null); // { day, slot, cell }

  // Week navigation offset (number of weeks from today)
  const [weekOffset, setWeekOffset] = useState(() => parseInt(localStorage.getItem(`tt_offset_${semesterId}`) || '0', 10));

  // Persist view and weekOffset to localStorage so navigating away and back restores state
  useEffect(() => {
    localStorage.setItem(`tt_view_${semesterId}`, view);
    localStorage.setItem(`tt_offset_${semesterId}`, String(weekOffset));
  }, [view, weekOffset, semesterId]);

  // Push to Google Calendar modal
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushForm, setPushForm] = useState({ semester_start: '', semester_end: '' });
  const [pushLoading, setPushLoading] = useState(false);

  // Academic calendar events for week view (date → [{type, title}])
  const [acEvents, setAcEvents] = useState({});

  // Day-level overrides (day abbreviation → {override_id, reason, override_by})
  const [dayOverrides, setDayOverrides] = useState({});

  // Day cancel modal
  const [dayCancelModal, setDayCancelModal] = useState(null); // {day, selectedDate, existing}

  // Add Exam modal (week view)
  const [showAddExamTT, setShowAddExamTT] = useState(false);
  const [examModal, setExamModal] = useState(null); // { exam: {...} }

  const getWeekDate = useCallback(() => {
    const today = new Date();
    today.setDate(today.getDate() + weekOffset * 7);
    // Use local date string to avoid UTC timezone shift issues
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [weekOffset]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [weekRes, baseRes] = await Promise.all([
        timetableAPI.getWeek(semesterId, getWeekDate()),
        timetableAPI.get(semesterId),
      ]);
      setTimetable(baseRes.data.timetable);
      setIsCr(baseRes.data.is_cr);
      setWeekGrid(weekRes.data.week_grid || {});
      setWeekStart(weekRes.data.week_start || '');
      setAcEvents(weekRes.data.ac_events || {});
      setDayOverrides(weekRes.data.day_overrides || {});
      if (baseRes.data.timetable) {
        setEditGrid(JSON.parse(JSON.stringify(baseRes.data.timetable.grid)));
      }
    } catch (err) {
      setError('Failed to load timetable');
    } finally {
      setLoading(false);
    }
  }, [semesterId, getWeekDate]);

  useEffect(() => { loadData(); }, [loadData]);


  // ── ML Upload & Extraction ────────────────────────────────────────────────

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
      const res = await timetableAPI.extract(semesterId, fd);
      setExtractedData(res.data.extracted);
      setExtractStep('review');
    } catch (err) {
      setExtractError(err.response?.data?.error || 'Extraction failed. Try a clearer image.');
      setExtractStep('idle');
    }
  };

  const handleExtractedSlotEdit = (day, slot, field, value) => {
    setExtractedData(prev => ({
      ...prev,
      grid: {
        ...prev.grid,
        [day]: {
          ...prev.grid[day],
          [slot]: { ...prev.grid[day][slot], [field]: value },
        },
      },
    }));
  };

  const handleSaveExtracted = async () => {
    setExtractStep('saving');
    try {
      await timetableAPI.save(semesterId, extractedData);
      setExtractStep('idle');
      setExtractedData(null);
      setSuccess('Timetable saved!');
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save timetable');
      setExtractStep('review');
    }
  };

  // ── Base timetable edit ───────────────────────────────────────────────────

  const handleSlotEditSave = async (day, slot, values) => {
    const newGrid = JSON.parse(JSON.stringify(editGrid));
    if (!newGrid[day]) newGrid[day] = {};
    newGrid[day][slot] = values;
    setEditGrid(newGrid);
  };

  const handlePushToCalendar = async () => {
    if (!pushForm.semester_end) { setError('Please enter a semester end date.'); return; }
    setPushLoading(true);
    setError('');
    try {
      const res = await timetableAPI.pushToCalendar(semesterId, pushForm);
      setSuccess(res.data.message);
      setShowPushModal(false);
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


  const handleSaveBase = async () => {
    try {
      // Include days that were in the original timetable OR have been edited in (e.g. Sat/Sun)
      const allDaysOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const usedDays = allDaysOrder.filter(d =>
        timetable.days.includes(d) ||
        Object.values(editGrid[d] || {}).some(c => c.subject)
      );
      await timetableAPI.save(semesterId, {
        days: usedDays,
        time_slots: timetable.time_slots,
        grid: editGrid,
      });
      setEditMode(false);
      setSuccess('Timetable updated!');
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
  };

  // ── Override handling (week view) ─────────────────────────────────────────

  const handleWeekCellClick = (day, slot, cell) => {
    // Non-CRs see a read-only view of the override modal (no actions available)
    // isCr is passed through to the modal to control action visibility
    // Calculate the actual date for this day in the current week
    // Use local Date constructor (not UTC) to avoid timezone-induced date shifts
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dayIdx = dayNames.indexOf(day);
    const [y, mo, d] = weekStart.split('-').map(Number);
    const dt = new Date(y, mo - 1, d + dayIdx); // local date, no UTC shift
    const selectedDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const isDayOverride = !!(dayOverrides[day]?.override_id && dayOverrides[day].override_id === cell.override_id);
    setOverrideModal({ day, slot, cell, selectedDate, isDayOverride });
  };

  const handleOverrideSave = async ({ day, slot, action, scope, reason, changes, date }) => {
    try {
      await timetableAPI.addOverride(semesterId, { day, slot, action, scope, reason, changes, date });
      setSuccess('Override added. Classmates have been notified.');
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add override');
    }
  };

  const handleDeleteOverride = async (overrideId) => {
    try {
      await timetableAPI.deleteOverride(semesterId, overrideId);
      setSuccess('Override removed.');
      setOverrideModal(null);
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove override');
    }
  };

  const handleDayCancelSave = async (data) => {
    try {
      await timetableAPI.addOverride(semesterId, data);
      setSuccess('Day cancelled. Classmates have been notified.');
      setDayCancelModal(null);
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to cancel day');
    }
  };

  const handleAddExamTT = async (examForm) => {
    try {
      const acRes = await timetableAPI.getAcademicCalendar(semesterId);
      const acData = acRes.data.academic_calendar || { semester_start: '', semester_end: '', events: [] };
      const newEvent = { ...examForm, end_date: examForm.end_date || examForm.date };
      const newCal = { ...acData, events: [...(acData.events || []), newEvent] };
      await timetableAPI.saveAcademicCalendar(semesterId, newCal);
      setSuccess('Exam added to Academic Calendar.');
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add exam');
    }
  };

  const handleEditExam = async (originalExam, updatedExam) => {
    try {
      const acRes = await timetableAPI.getAcademicCalendar(semesterId);
      const acData = acRes.data.academic_calendar || { events: [] };
      const events = acData.events || [];
      const idx = events.findIndex(e => e.title === originalExam.title && e.date === originalExam.date && e.type === originalExam.type);
      if (idx === -1) { setError('Exam not found in calendar.'); return; }
      const newEvents = [...events];
      newEvents[idx] = updatedExam;
      await timetableAPI.saveAcademicCalendar(semesterId, { ...acData, events: newEvents });
      setExamModal(null);
      setSuccess('Exam updated.');
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update exam');
    }
  };

  const handleDeleteExam = async (exam) => {
    if (!window.confirm(`Delete "${exam.title}"? This cannot be undone.`)) return;
    try {
      const acRes = await timetableAPI.getAcademicCalendar(semesterId);
      const acData = acRes.data.academic_calendar || { events: [] };
      const events = (acData.events || []).filter(e => !(e.title === exam.title && e.date === exam.date && e.type === exam.type));
      await timetableAPI.saveAcademicCalendar(semesterId, { ...acData, events });
      setExamModal(null);
      setSuccess('Exam deleted.');
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete exam');
    }
  };

  const handleDayCancelRemove = async (overrideId) => {
    try {
      await timetableAPI.deleteOverride(semesterId, overrideId);
      setSuccess('Day override removed.');
      setDayCancelModal(null);
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove override');
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderWeekHeader = () => {
    if (!weekStart) return null;
    const d = new Date(weekStart + 'T00:00:00');
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    const fmt = (dt) => dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    return `${fmt(d)} – ${fmt(end)}`;
  };

  const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const renderGrid = (grid, days, slots, onCellClick, isWeekView = false) => {
    const activeDays = new Set(days);
    const colWidth = Math.max(110, Math.floor((window.innerWidth - 120) / slots.length));
    const isBaseEditMode = !isWeekView && !!onCellClick;
    return (
      <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: `${52 + slots.length * colWidth}px` }}>
          <thead>
            <tr style={{ background: 'var(--card-bg)', borderBottom: '2px solid var(--border-color)' }}>
              <th style={{ width: '52px', minWidth: '52px', padding: '10px 8px', fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'center', borderRight: '1px solid var(--border-color)' }}></th>
              {slots.map(slot => (
                <th key={slot} style={{ width: `${colWidth}px`, padding: '10px 6px', fontSize: '11px', color: 'var(--text-primary)', fontWeight: 600, textAlign: 'center', borderRight: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>{slot}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_DAYS.map((d, di) => {
              const isWeekend = d === 'Sat' || d === 'Sun';
              const hasData = activeDays.has(d);
              const rowBg = isWeekend ? 'var(--bg-color)' : 'var(--card-bg)';

              // Compute AC event banners for this day (week view only)
              let acBanners = [];
              let examOverlays = []; // regular exams to show as chips on time slots
              let dayDate = '';
              if (isWeekView && weekStart) {
                const [wy, wmo, wd] = weekStart.split('-').map(Number);
                const dt = new Date(wy, wmo - 1, wd + di);
                dayDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
                const rawBanners = acEvents[dayDate] || [];
                const hasHol = rawBanners.some(e => e.type === 'Holiday');
                const hasSemExam = !hasHol && rawBanners.some(e => e.type === 'Semester Exam');
                acBanners = hasHol
                  ? rawBanners.filter(e => e.type === 'Holiday')
                  : hasSemExam
                    ? rawBanners.filter(e => e.type === 'Semester Exam')
                    : rawBanners.filter(e => e.type === 'Exam');
                if (!hasHol && !hasSemExam) {
                  examOverlays = rawBanners.filter(e => e.type === 'Exam');
                }
              }

              const dayOverride = isWeekView ? dayOverrides[d] : null;

              // Determine day header pill label
              const acHoliday = acBanners.find(b => b.type === 'Holiday');
              const acSemExam = acBanners.find(b => b.type === 'Semester Exam');
              const pillBanner = dayOverride ? { label: 'HOLIDAY', bg: 'var(--cell-holiday-border)', color: 'var(--cell-holiday-text)' }
                : acHoliday ? { label: 'HOL', bg: 'var(--cell-holiday-border)', color: 'var(--cell-holiday-text)' }
                : acSemExam ? { label: 'SEM EXAM', bg: 'var(--cell-semexam-border)', color: 'var(--cell-semexam-text)' }
                : acBanners.length ? { label: 'QUIZ', bg: 'var(--cell-exam-border)', color: 'var(--cell-exam-text)' }
                : null;

              return (
                <tr key={d} style={{ background: (dayOverride || acHoliday) ? 'var(--cell-holiday-bg)' : rowBg, borderBottom: '1px solid var(--border-color)' }}>
                  <td
                    style={{
                      padding: '8px', fontSize: '12px', fontWeight: 700, textAlign: 'center',
                      color: isWeekend ? 'var(--text-secondary)' : 'var(--text-primary)',
                      borderRight: '2px solid var(--border-color)', verticalAlign: 'middle',
                      background: (dayOverride || acHoliday) ? 'var(--cell-holiday-border)' : (isWeekend ? 'var(--bg-color)' : rowBg),
                      cursor: isCr && isWeekView ? 'pointer' : 'default',
                      userSelect: 'none',
                    }}
                    onClick={() => {
                      if (!isCr || !isWeekView) return;
                      const [wy, wmo, wd2] = weekStart.split('-').map(Number);
                      const dt = new Date(wy, wmo - 1, wd2 + di);
                      const selDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
                      setDayCancelModal({ day: d, selectedDate: selDate, existing: dayOverride || null });
                    }}
                    title={isCr && isWeekView ? 'Click to mark as holiday / cancel day' : undefined}
                  >
                    {d}
                    {pillBanner && (
                      <div style={{ fontSize: '9px', fontWeight: 700, marginTop: '3px', lineHeight: 1.2, background: pillBanner.bg, color: pillBanner.color, borderRadius: '3px', padding: '1px 4px' }}>
                        {pillBanner.label}
                      </div>
                    )}
                  </td>
                  {(() => {
                    // Full-day holiday (manual override OR AC holiday)
                    const isHolidayDay = isWeekView && (dayOverride || acHoliday);
                    if (isHolidayDay) {
                      const holidayName = dayOverride?.reason || acHoliday?.title || 'Holiday';
                      const markedBy = dayOverride?.override_by;
                      return (
                        <td colSpan={slots.length} style={{ padding: '6px', verticalAlign: 'middle' }}>
                          <div style={{
                            background: 'var(--cell-holiday-bg)', border: '2px solid var(--cell-holiday-border)', borderRadius: '10px',
                            padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '12px',
                            minHeight: '68px',
                          }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--cell-holiday-text)', letterSpacing: '0.5px' }}>HOLIDAY</div>
                              {holidayName && <div style={{ fontSize: '12px', color: 'var(--cell-holiday-text)', marginTop: '3px', fontWeight: 500 }}>{holidayName}</div>}
                              {markedBy && <div style={{ fontSize: '11px', color: 'var(--cell-holiday-text)', marginTop: '2px', opacity: 0.8 }}>Marked by {markedBy}</div>}
                            </div>
                            {isCr && dayOverride && (
                              <button
                                onClick={e => { e.stopPropagation(); handleDayCancelRemove(dayOverride.override_id); }}
                                style={{ fontSize: '12px', fontWeight: 600, padding: '6px 14px', borderRadius: '8px', border: 'none', background: 'var(--danger-color)', color: 'white', cursor: 'pointer', whiteSpace: 'nowrap' }}
                              >
                                Remove Override
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    }

                    // Semester Exam: remove all class cells, show exam card spanning matching slots
                    if (isWeekView && acSemExam) {
                      // Find first matching slot index and count consecutive matches
                      let firstMatch = -1, matchSpan = 0;
                      for (let si = 0; si < slots.length; si++) {
                        const matches = acSemExam.start_time && acSemExam.end_time
                          ? slotOverlapsRange(slots[si], acSemExam.start_time, acSemExam.end_time)
                          : si === 0;
                        if (matches) {
                          if (firstMatch === -1) firstMatch = si;
                          matchSpan++;
                        }
                      }
                      if (firstMatch === -1) { firstMatch = 0; matchSpan = slots.length; } // fallback: span all (no time info)
                      const result = [];
                      for (let si = 0; si < slots.length; ) {
                        if (si === firstMatch) {
                          result.push(
                            <td key={slots[si]} colSpan={matchSpan} style={{ padding: '4px', verticalAlign: 'top', borderRight: '1px solid var(--border-color)' }}>
                              <div
                                onClick={() => setExamModal({ exam: acSemExam })}
                                style={{
                                  background: 'var(--cell-semexam-bg)', border: `2px solid var(--cell-semexam-border)`, borderRadius: '8px',
                                  padding: '8px 12px', minHeight: '68px', height: '100%',
                                  display: 'flex', flexDirection: 'column', justifyContent: 'center',
                                  cursor: 'pointer',
                                }}
                              >
                                <div style={{ fontSize: '9px', fontWeight: 800, color: 'var(--cell-semexam-text)', letterSpacing: '1px', marginBottom: '4px', textTransform: 'uppercase' }}>Semester Exam</div>
                                <div style={{ fontWeight: 700, color: 'var(--cell-semexam-text)', fontSize: '13px', lineHeight: 1.2 }}>{acSemExam.title}</div>
                                {acSemExam.start_time && (
                                  <div style={{ fontSize: '11px', color: 'var(--cell-semexam-text)', opacity: 0.8, marginTop: '4px' }}>{acSemExam.start_time}–{acSemExam.end_time || ''}</div>
                                )}
                              </div>
                            </td>
                          );
                          si += matchSpan;
                        } else {
                          result.push(
                            <td key={slots[si]} style={{ padding: '4px', borderRight: '1px solid var(--border-color)' }}>
                              <div style={{ background: 'var(--bg-color)', borderRadius: '6px', minHeight: '68px', opacity: 0.2 }} />
                            </td>
                          );
                          si++;
                        }
                      }
                      return result;
                    }

                    // Helper: render exam card replacing a cell
                    const examCard = (ex) => (
                      <div
                        onClick={() => setExamModal({ exam: ex })}
                        style={{
                          background: 'var(--cell-exam-bg)', border: '2px solid var(--cell-exam-border)',
                          borderRadius: '8px', padding: '8px 12px', minHeight: '68px', height: '100%',
                          display: 'flex', flexDirection: 'column', justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: '9px', fontWeight: 800, color: 'var(--cell-exam-text)', letterSpacing: '1px', marginBottom: '2px', textTransform: 'uppercase' }}>Exam</div>
                        <div style={{ fontWeight: 700, color: 'var(--cell-exam-text)', fontSize: '13px', lineHeight: 1.2 }}>{ex.title}</div>
                        {ex.start_time && <div style={{ fontSize: '11px', color: 'var(--cell-exam-text)', opacity: 0.8, marginTop: '3px' }}>{ex.start_time}{ex.end_time ? `–${ex.end_time}` : ''}</div>}
                        {ex.description && <div style={{ fontSize: '11px', color: 'var(--cell-exam-text)', opacity: 0.75, marginTop: '2px', fontStyle: 'italic' }}>{ex.description}</div>}
                      </div>
                    );

                    if (!hasData) {
                      if (isWeekView || isBaseEditMode) {
                        const shownExams = new Set();
                        const noDataResult = [];
                        let ni = 0;
                        while (ni < slots.length) {
                          const slot = slots[ni];
                          const cell = grid[d]?.[slot] || { subject: '', teacher: '', room: '', type: 'Free', status: 'normal' };
                          const slotExam = examOverlays.find(ex => {
                            if (shownExams.has(ex.title)) return false;
                            return ex.start_time && ex.end_time
                              ? slotOverlapsRange(slot, ex.start_time, ex.end_time)
                              : slot === slots[0];
                          });
                          let span = 1;
                          if (slotExam) {
                            shownExams.add(slotExam.title);
                            if (slotExam.start_time && slotExam.end_time) {
                              while (ni + span < slots.length && slotOverlapsRange(slots[ni + span], slotExam.start_time, slotExam.end_time)) span++;
                            }
                          }
                          noDataResult.push(
                            <td key={slot} colSpan={span} style={{ padding: '4px', verticalAlign: 'top', borderRight: '1px solid var(--border-color)' }}>
                              {slotExam ? examCard(slotExam) : <CellChip cell={cell} slot={slot} day={d} onClick={onCellClick} isCr={isCr} />}
                            </td>
                          );
                          ni += span;
                        }
                        return noDataResult;
                      }
                      return slots.map(slot => (
                        <td key={slot} style={{ padding: '4px', borderRight: '1px solid var(--border-color)' }}>
                          <div style={{ background: 'var(--bg-color)', borderRadius: '6px', minHeight: '68px', opacity: 0.5 }} />
                        </td>
                      ));
                    }

                    const cells = slots.map(s => grid[d]?.[s] || { subject: '', teacher: '', room: '', type: 'Free', status: 'normal' });
                    const rendered = [];
                    const shownExams2 = new Set();
                    let i = 0;
                    while (i < slots.length) {
                      const cell = cells[i];
                      const slotExam = examOverlays.find(ex => {
                        if (shownExams2.has(ex.title)) return false;
                        return ex.start_time && ex.end_time
                          ? slotOverlapsRange(slots[i], ex.start_time, ex.end_time)
                          : slots[i] === slots[0];
                      });
                      let span = 1;
                      if (slotExam) {
                        shownExams2.add(slotExam.title);
                        if (slotExam.start_time && slotExam.end_time) {
                          while (i + span < slots.length && slotOverlapsRange(slots[i + span], slotExam.start_time, slotExam.end_time)) span++;
                        }
                      } else if (cell.subject) {
                        while (
                          i + span < slots.length &&
                          cells[i + span].subject === cell.subject &&
                          cells[i + span].type === cell.type
                        ) span++;
                      }
                      rendered.push(
                        <td key={slots[i]} colSpan={span} style={{ padding: '4px', verticalAlign: 'top', borderRight: '1px solid var(--border-color)' }}>
                          {slotExam ? examCard(slotExam) : <CellChip cell={cell} slot={slots[i]} day={d} onClick={onCellClick} isCr={isCr} />}
                        </td>
                      );
                      i += span;
                    }
                    return rendered;
                  })()}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // ── Loading / no timetable states ─────────────────────────────────────────

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '40vh', color: 'var(--primary-color)', fontSize: '16px' }}>Loading...</div>;
  }

  // ── ML Review Screen ──────────────────────────────────────────────────────

  if (extractStep === 'extracting') {
    return (
      <div className="classroom-container">
        <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--primary-color)' }}>
          <RefreshCw size={40} style={{ marginBottom: '16px', animation: 'spin 1s linear infinite' }} />
          <h3>Extracting timetable with AI...</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>This usually takes 5–15 seconds</p>
        </div>
      </div>
    );
  }

  if (extractStep === 'review' && extractedData) {
    return (
      <div className="classroom-container">
        {error && <div className="error-message" style={{ marginBottom: '16px' }}>{error}</div>}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: 0 }}>Review Extracted Timetable</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: '4px 0 0' }}>
              Click any cell to edit. Verify all details before saving.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => { setExtractStep('idle'); setExtractedData(null); }}
              style={{ padding: '8px 16px', border: '1.5px solid var(--border-color)', borderRadius: '8px', background: 'transparent', cursor: 'pointer', fontSize: '13px' }}
            >
              Discard
            </button>
            <button
              onClick={handleSaveExtracted}
              disabled={extractStep === 'saving'}
              style={{ padding: '8px 18px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
            >
              {extractStep === 'saving' ? 'Saving...' : 'Save Timetable'}
            </button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '4px' }}>
            <thead>
              <tr>
                <th style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'left', width: '70px' }}>Day</th>
                {extractedData.time_slots.map(slot => (
                  <th key={slot} style={{ padding: '8px 6px', fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap' }}>{slot}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {extractedData.days.map(d => (
                <tr key={d}>
                  <td style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--text-primary)', fontWeight: 700, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                    {d}
                  </td>
                  {extractedData.time_slots.map(slot => {
                    const cell = extractedData.grid[d]?.[slot] || {};
                    const c = cellColors(cell.type);
                    return (
                      <td key={slot} style={{ padding: '2px', verticalAlign: 'top' }}>
                        <div style={{ background: c.bg, border: `1.5px solid ${c.border}`, borderRadius: '8px', padding: '4px 6px', minHeight: '52px' }}>
                          <input
                            value={cell.subject || ''}
                            onChange={e => handleExtractedSlotEdit(d, slot, 'subject', e.target.value)}
                            placeholder="Subject"
                            style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '11px', fontWeight: 600, color: c.text, outline: 'none', padding: 0 }}
                          />
                          <input
                            value={cell.teacher || ''}
                            onChange={e => handleExtractedSlotEdit(d, slot, 'teacher', e.target.value)}
                            placeholder="Teacher"
                            style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '10px', color: 'var(--text-secondary)', outline: 'none', padding: 0, marginTop: '2px' }}
                          />
                          <input
                            value={cell.room || ''}
                            onChange={e => handleExtractedSlotEdit(d, slot, 'room', e.target.value)}
                            placeholder="Room"
                            style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '10px', color: 'var(--text-secondary)', outline: 'none', padding: 0 }}
                          />
                          <select
                            value={cell.type || 'Free'}
                            onChange={e => handleExtractedSlotEdit(d, slot, 'type', e.target.value)}
                            style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '10px', color: 'var(--text-secondary)', outline: 'none', padding: 0, marginTop: '2px' }}
                          >
                            <option>Lecture</option><option>Lab</option><option>Tutorial</option>
                            <option>Free</option><option>Lunch</option><option>Library</option><option>Break</option>
                          </select>
                        </div>
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

  // ── No timetable state (CR sees upload prompt) ────────────────────────────

  if (!timetable) {
    return (
      <div className="classroom-container">
        {error && <div className="error-message" style={{ marginBottom: '16px' }}>{error}</div>}
        {extractError && (
          <div className="error-message" style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={16} />
              <span>{extractError}</span>
            </div>
          </div>
        )}
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Calendar size={64} strokeWidth={1.25} color="var(--primary-color)" style={{ marginBottom: '20px' }} />
          <h2 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>No timetable yet</h2>
          {isCr ? (
            <>
              <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', margin: '0 auto 32px', lineHeight: 1.7, fontSize: '14px' }}>
                Upload a photo or PDF of the college timetable. AI will extract it into an editable table, which you can verify before saving.
              </p>
              {!showManualBuilder ? (
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <label style={{
                    padding: '12px 28px', background: 'var(--primary-color)', color: 'white', borderRadius: '10px',
                    cursor: 'pointer', fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px',
                  }}>
                    <Upload size={16} />
                    Upload Timetable Image / PDF
                    <input type="file" accept="image/*,.pdf" onChange={handleFileUpload} style={{ display: 'none' }} />
                  </label>
                  <button
                    onClick={() => setShowManualBuilder(true)}
                    style={{
                      padding: '12px 28px', background: 'transparent', border: '2px solid var(--primary-color)', color: 'var(--primary-color)',
                      borderRadius: '10px', cursor: 'pointer', fontWeight: 600, fontSize: '14px',
                    }}
                  >
                    <Plus size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                    Create Manually
                  </button>
                </div>
              ) : (
                <div style={{ maxWidth: '500px', margin: '0 auto', textAlign: 'left', background: 'var(--card-bg)', borderRadius: '12px', padding: '24px', border: '1.5px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ margin: 0 }}>Manual Setup</h3>
                    <button onClick={() => setShowManualBuilder(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
                  </div>
                  <ManualBuilder onComplete={async (data) => {
                    try {
                      await timetableAPI.save(semesterId, data);
                      setSuccess('Timetable created!');
                      setShowManualBuilder(false);
                      loadData();
                    } catch (err) {
                      setError(err.response?.data?.error || 'Failed to create timetable');
                    }
                  }} />
                </div>
              )}
            </>
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>The CR hasn't uploaded the timetable yet.</p>
          )}
        </div>
      </div>
    );
  }

  // ── Main timetable view ───────────────────────────────────────────────────

  const { days = [], time_slots = [] } = timetable || {};
  const displayGrid = view === 'week' ? weekGrid : (editMode ? editGrid : (timetable?.grid || {}));

  return (
    <div className="classroom-container">
      {/* Sub-nav — same pattern as SemesterDetail */}
      <div className="page-subnav">
        <Link className="page-subnav-item" to={`/classroom/${classroomId}/semester/${semesterId}`}>Dashboard</Link>
        <button className="page-subnav-item" onClick={() => navigate(`/classroom/${classroomId}/semester/${semesterId}/chat`)}>Chat</button>
        <Link className="page-subnav-item" to={`/classroom/${classroomId}/semester/${semesterId}/files`}>Resources</Link>
        <Link className="page-subnav-item" to={`/classroom/${classroomId}/semester/${semesterId}/marks`}>Marks</Link>
        <Link className="page-subnav-item accent" to={`/classroom/${classroomId}/semester/${semesterId}/timetable`}>Timetable</Link>
        <Link className="page-subnav-item" to={`/classroom/${classroomId}/semester/${semesterId}/academic-calendar`}>Academic Calendar</Link>
        <div className="page-subnav-spacer" />
        <button
          className="page-subnav-item"
          onClick={() => window.print()}
          title="Print timetable"
          style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
        >
          <Printer size={13} /> Print
        </button>
      </div>

      {error && <div className="error-message" style={{ marginBottom: '12px' }}>{error}</div>}
      {success && <div className="success-message" style={{ marginBottom: '12px' }}>{success}</div>}

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          {['week', 'base'].map(v => (
            <button
              key={v}
              onClick={() => { setView(v); setEditMode(false); }}
              style={{
                padding: '7px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                border: `1.5px solid ${view === v ? 'var(--primary-color)' : 'var(--border-color)'}`,
                background: view === v ? 'var(--primary-color)' : 'transparent',
                color: view === v ? 'white' : 'var(--unselected-text)',
              }}
            >
              {v === 'week' ? 'This Week' : 'Base Timetable'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {view === 'week' && (
            <>
              <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: 'none', border: '1.5px solid var(--border-color)', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                <ChevronLeft size={14} />
              </button>
              <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>{renderWeekHeader()}</span>
              <button onClick={() => setWeekOffset(w => w + 1)} style={{ background: 'none', border: '1.5px solid var(--border-color)', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', color: 'var(--text-primary)' }}>
                <ChevronRight size={14} />
              </button>
              {weekOffset !== 0 && (
                <button onClick={() => setWeekOffset(0)} style={{ background: 'none', border: '1.5px solid var(--border-color)', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px', color: 'var(--primary-color)', fontWeight: 600 }}>
                  Today
                </button>
              )}
              {isCr && (
                <button
                  onClick={() => setShowAddExamTT(true)}
                  style={{ padding: '5px 12px', background: 'var(--cell-exam-bg)', color: 'var(--cell-exam-text)', border: `1.5px solid var(--cell-exam-border)`, borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <GraduationCap size={13} /> Add Exam
                </button>
              )}
            </>
          )}

          {isCr && view === 'base' && (
            editMode ? (
              <>
                <button onClick={() => { setEditMode(false); setEditGrid(JSON.parse(JSON.stringify(timetable.grid))); }} style={{ padding: '7px 14px', border: '1.5px solid var(--border-color)', borderRadius: '8px', background: 'transparent', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                  Cancel
                </button>
                <button onClick={handleSaveBase} style={{ padding: '7px 14px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
                  Save Changes
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setEditMode(true)} style={{ padding: '7px 14px', border: '1.5px solid var(--primary-color)', color: 'var(--primary-color)', borderRadius: '8px', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Edit2 size={13} /> Edit Timetable
                </button>
                <label style={{ padding: '7px 14px', background: 'var(--primary-color)', color: 'white', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Upload size={13} /> Re-upload
                  <input type="file" accept="image/*,.pdf" onChange={handleFileUpload} style={{ display: 'none' }} />
                </label>
                <button
                  onClick={() => setShowPushModal(true)}
                  style={{ padding: '7px 14px', background: 'var(--success-color)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px' }}
                >
                  <Calendar size={13} /> Push to GCal
                </button>
              </>
            )
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {Object.entries(TYPE_COLORS).filter(([k]) => ['Lecture', 'Lab', 'Tutorial', 'Free', 'Lunch'].includes(k)).map(([type, c]) => (
          <span key={type} style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: '5px', padding: '2px 8px', fontSize: '11px', fontWeight: 600 }}>
            {type}
          </span>
        ))}
        <span style={{ background: 'var(--cell-cancel-bg)', color: 'var(--cell-cancel-text)', border: '1px solid var(--cell-cancel-border)', borderRadius: '5px', padding: '2px 8px', fontSize: '11px', fontWeight: 600 }}>Cancelled</span>
        <span style={{ background: 'var(--cell-holiday-bg)', color: 'var(--cell-holiday-text)', border: '1px solid var(--cell-holiday-border)', borderRadius: '5px', padding: '2px 8px', fontSize: '11px', fontWeight: 600 }}>Modified</span>
      </div>

      {/* CR hint */}
      {isCr && view === 'week' && (
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
          Click any <strong>class cell</strong> to cancel / reschedule / edit for a specific day. Click a <strong>day label</strong> to mark the entire day as holiday. Switch to <strong>Base Timetable</strong> to add notes or links to any slot.
        </p>
      )}

      {/* Grid */}
      {renderGrid(
        displayGrid,
        days,
        time_slots,
        view === 'week'
          ? handleWeekCellClick
          : (isCr ? (day, slot, cell) => { if (!editMode) setEditMode(true); setSlotEditModal({ day, slot, cell }); } : null),
        view === 'week'
      )}

      {/* Day cancel / holiday modal */}
      {dayCancelModal && (
        <DayCancelModal
          day={dayCancelModal.day}
          selectedDate={dayCancelModal.selectedDate}
          existing={dayCancelModal.existing}
          onClose={() => setDayCancelModal(null)}
          onSave={handleDayCancelSave}
          onDelete={handleDayCancelRemove}
        />
      )}

      {/* Override modal */}
      {overrideModal && (
        <OverrideModal
          day={overrideModal.day}
          slot={overrideModal.slot}
          cell={overrideModal.cell}
          selectedDate={overrideModal.selectedDate}
          isDayOverride={overrideModal.isDayOverride}
          isCr={isCr}
          onClose={() => setOverrideModal(null)}
          onSave={handleOverrideSave}
          onDeleteOverride={handleDeleteOverride}
        />
      )}

      {/* Slot edit modal (base timetable) */}
      {slotEditModal && (
        <SlotEditModal
          day={slotEditModal.day}
          slot={slotEditModal.slot}
          cell={slotEditModal.cell}
          onClose={() => setSlotEditModal(null)}
          onSave={handleSlotEditSave}
        />
      )}

      {/* Add Exam modal (week view) */}
      {showAddExamTT && (
        <AddExamModalTT
          semesterId={semesterId}
          onSave={handleAddExamTT}
          onClose={() => setShowAddExamTT(false)}
        />
      )}

      {/* Exam detail/edit modal */}
      {examModal && (
        <ExamDetailModal
          exam={examModal.exam}
          isCr={isCr}
          onClose={() => setExamModal(null)}
          onEdit={handleEditExam}
          onDelete={handleDeleteExam}
        />
      )}

      {/* Push to Google Calendar modal */}
      {showPushModal && (
        <div className="modal-overlay" onClick={() => setShowPushModal(false)}>
          <div className="modal-content" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: '8px' }}>Push to Google Calendar</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px', lineHeight: 1.5 }}>
              This will create <strong>recurring weekly events</strong> in your Google Calendar for every class in the timetable. Events repeat until the semester end date.
            </p>
            <div className="form-group">
              <label>Semester Start Date</label>
              <input
                type="date"
                value={pushForm.semester_start}
                onChange={e => setPushForm({ ...pushForm, semester_start: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Semester End Date *</label>
              <input
                type="date"
                value={pushForm.semester_end}
                onChange={e => setPushForm({ ...pushForm, semester_end: e.target.value })}
                required
              />
            </div>
            <div style={{ background: 'var(--cell-tutorial-bg)', border: '1px solid var(--cell-tutorial-border)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '12px', color: 'var(--cell-tutorial-text)' }}>
              Color coding in Google Calendar: <strong>Blue</strong> = Lectures, <strong>Purple</strong> = Labs, <strong>Green</strong> = Tutorials
            </div>
            <div className="modal-buttons">
              <button type="button" onClick={() => setShowPushModal(false)} disabled={pushLoading}>Cancel</button>
              <button
                type="button"
                onClick={handlePushToCalendar}
                disabled={pushLoading || !pushForm.semester_end}
                style={{ background: 'var(--success-color)' }}
              >
                {pushLoading ? 'Pushing...' : 'Push to Google Calendar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
