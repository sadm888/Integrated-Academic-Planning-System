import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { calendarAPI, scheduleAPI, classroomAPI } from '../services/api';
import '../styles/Classroom.css';

function ConsentModal({ onCancel, onAllow }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'var(--card-bg)', borderRadius: '16px', padding: '32px',
          width: '420px', maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginBottom: '12px', color: 'var(--text-primary)', fontSize: '18px' }}>
          Connect Google Calendar
        </h3>
        <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '12px' }}>
          Connecting Google Calendar will allow IAPS to:
        </p>
        <ul style={{ paddingLeft: '20px', color: '#6b7280', fontSize: '14px', lineHeight: '2', marginBottom: '24px' }}>
          <li>View your calendar events</li>
          <li>Create and edit events on your behalf</li>
          <li>Access is only used for schedule sync features</li>
        </ul>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '9px 18px', background: 'transparent', border: '1px solid #d1d5db',
              borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onAllow}
            style={{
              padding: '10px 22px', background: '#667eea', color: 'white',
              border: 'none', borderRadius: '8px', cursor: 'pointer',
              fontSize: '14px', fontWeight: 600,
            }}
          >
            Allow &amp; Connect →
          </button>
        </div>
      </div>
    </div>
  );
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const EVENT_TYPES = ['Lecture', 'Lab', 'Tutorial', 'Assignment', 'Exam', 'Holiday', 'Personal'];

const EVENT_TYPE_COLORS = {
  Lecture:    { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  Lab:        { bg: '#ede9fe', text: '#5b21b6', border: '#c4b5fd' },
  Tutorial:   { bg: '#ccfbf1', text: '#065f46', border: '#6ee7b7' },
  Assignment: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  Exam:       { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  Holiday:    { bg: '#dcfce7', text: '#166534', border: '#86efac' },
  Personal:   { bg: '#f3e8ff', text: '#6b21a8', border: '#d8b4fe' },
};

function getEventTypeFromGCal(ev) {
  // Check IAPS extended property first
  const iapsType = ev.extendedProperties?.private?.iaps_type;
  if (iapsType) return iapsType;
  // Fallback: infer from colorId
  const colorMap = { '7': 'Lecture', '3': 'Lab', '2': 'Tutorial', '6': 'Assignment', '11': 'Exam', '10': 'Holiday' };
  return colorMap[ev.colorId] || 'Personal';
}

function eventChipStyle(ev) {
  const type = getEventTypeFromGCal(ev);
  return EVENT_TYPE_COLORS[type] || EVENT_TYPE_COLORS.Personal;
}

function Calendar({ user }) {
  const [searchParams] = useSearchParams();

  // Connection
  const [connected, setConnected] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [connectLoading, setConnectLoading] = useState(false);

  // Calendar navigation (first day of displayed month)
  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // Events from Google Calendar
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  // Classrooms + schedule requests sidebar
  const [classrooms, setClassrooms] = useState([]);
  const [scheduleRequests, setScheduleRequests] = useState({});

  // Add event modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    title: '', start_datetime: '', end_datetime: '', description: '', location: '', event_type: 'Personal'
  });
  const [addLoading, setAddLoading] = useState(false);

  // View/edit event modal
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [editForm, setEditForm] = useState({
    title: '', start_datetime: '', end_datetime: '', description: '', location: '', event_type: 'Personal'
  });
  const [editLoading, setEditLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showConsent, setShowConsent] = useState(false);

  // ── Handle OAuth redirect query params ──────────────────────────────
  useEffect(() => {
    const connectedParam = searchParams.get('connected');
    const errorParam = searchParams.get('error');
    if (connectedParam === 'true') {
      setSuccess('Google Calendar connected successfully!');
      window.history.replaceState({}, '', '/calendar');
    } else if (errorParam) {
      const errMap = {
        session_expired: 'Your session expired. Please log in again.',
        oauth_failed: 'Google authorization failed. Please try again.',
        invalid_token: 'Authentication error. Please log in again.',
        missing_params: 'OAuth response was incomplete. Please try again.',
      };
      setError(errMap[errorParam] || 'Google Calendar connection failed.');
      window.history.replaceState({}, '', '/calendar');
    }
  }, [searchParams]);

  // ── Check connection on mount ────────────────────────────────────────
  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    setStatusLoading(true);
    try {
      const res = await calendarAPI.getStatus();
      setConnected(res.data.connected);
      if (res.data.connected) {
        loadClassroomsAndSchedules();
      }
    } catch (err) {
      console.error('Status check failed:', err);
    } finally {
      setStatusLoading(false);
    }
  };

  // ── Fetch events when month changes ─────────────────────────────────
  const fetchEventsForMonth = useCallback(async (date) => {
    setEventsLoading(true);
    try {
      const year = date.getFullYear();
      const month = date.getMonth();
      const firstDay = new Date(Date.UTC(year, month, 1));
      const lastDay = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));
      const res = await calendarAPI.listEvents(firstDay.toISOString(), lastDay.toISOString());
      setEvents(res.data.events || []);
    } catch (err) {
      if (err.response?.data?.not_connected) {
        setConnected(false);
      } else {
        setError('Failed to load calendar events.');
      }
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connected) {
      fetchEventsForMonth(currentDate);
    }
  }, [connected, currentDate, fetchEventsForMonth]);

  // ── Load classrooms + their schedule requests ────────────────────────
  const loadClassroomsAndSchedules = async () => {
    try {
      const classRes = await classroomAPI.list();
      const list = classRes.data.classrooms || [];
      setClassrooms(list);

      const reqMap = {};
      await Promise.all(
        list.map(async (c) => {
          try {
            const r = await scheduleAPI.listForClassroom(c.id);
            reqMap[c.id] = r.data.schedule_requests || [];
          } catch {
            reqMap[c.id] = [];
          }
        })
      );
      setScheduleRequests(reqMap);
    } catch (err) {
      console.error('Failed to load classrooms/schedules:', err);
    }
  };

  // ── Connect Google Calendar ──────────────────────────────────────────
  const handleConnect = async () => {
    setConnectLoading(true);
    setError('');
    try {
      const res = await calendarAPI.getAuthUrl();
      window.open(res.data.auth_url, '_blank');
      setConnectLoading(false);
    } catch (err) {
      setError('Failed to initiate Google Calendar connection.');
      setConnectLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Google Calendar? Your existing events will not be deleted.')) return;
    try {
      await calendarAPI.disconnect();
      setConnected(false);
      setEvents([]);
      setSuccess('Google Calendar disconnected.');
    } catch (err) {
      setError('Failed to disconnect.');
    }
  };

  // ── Calendar grid helpers ────────────────────────────────────────────
  const getEventsForDay = (day) => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    return events.filter(ev => {
      const dt = new Date(ev.start?.dateTime || ev.start?.date);
      return dt.getFullYear() === year && dt.getMonth() === month && dt.getDate() === day;
    });
  };

  const prevMonth = () => {
    setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  };
  const nextMonth = () => {
    setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  };

  const padDateStr = (y, m, d) =>
    `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const handleDayClick = (day) => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    setAddForm({
      title: '',
      start_datetime: `${padDateStr(y, m, day)}T09:00`,
      end_datetime: `${padDateStr(y, m, day)}T10:00`,
      description: '',
      location: '',
      event_type: 'Personal',
    });
    setShowAddModal(true);
    setError('');
  };

  const handleEventChipClick = (e, ev) => {
    e.stopPropagation();
    setSelectedEvent(ev);
    const toLocal = (iso) => iso ? new Date(iso).toISOString().slice(0, 16) : '';
    setEditForm({
      title: ev.summary || '',
      start_datetime: toLocal(ev.start?.dateTime),
      end_datetime: toLocal(ev.end?.dateTime),
      description: ev.description || '',
      location: ev.location || '',
      event_type: getEventTypeFromGCal(ev),
    });
    setIsEditing(false);
    setShowEventModal(true);
    setError('');
  };

  // ── Add event ────────────────────────────────────────────────────────
  const handleAddEvent = async (e) => {
    e.preventDefault();
    setAddLoading(true);
    setError('');
    try {
      await calendarAPI.createEvent({
        title: addForm.title,
        start_datetime: new Date(addForm.start_datetime).toISOString(),
        end_datetime: new Date(addForm.end_datetime).toISOString(),
        description: addForm.description,
        location: addForm.location,
        event_type: addForm.event_type,
      });
      setShowAddModal(false);
      setSuccess('Event added to Google Calendar!');
      fetchEventsForMonth(currentDate);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create event.');
    } finally {
      setAddLoading(false);
    }
  };

  // ── Edit event ───────────────────────────────────────────────────────
  const handleUpdateEvent = async (e) => {
    e.preventDefault();
    setEditLoading(true);
    setError('');
    try {
      await calendarAPI.updateEvent(selectedEvent.id, {
        title: editForm.title,
        start_datetime: new Date(editForm.start_datetime).toISOString(),
        end_datetime: new Date(editForm.end_datetime).toISOString(),
        description: editForm.description,
        location: editForm.location,
        event_type: editForm.event_type,
      });
      setShowEventModal(false);
      setSuccess('Event updated!');
      fetchEventsForMonth(currentDate);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update event.');
    } finally {
      setEditLoading(false);
    }
  };

  // ── Delete event ─────────────────────────────────────────────────────
  const handleDeleteEvent = async () => {
    if (!window.confirm('Delete this event from Google Calendar?')) return;
    setEditLoading(true);
    setError('');
    try {
      await calendarAPI.deleteEvent(selectedEvent.id);
      setShowEventModal(false);
      setSuccess('Event deleted.');
      fetchEventsForMonth(currentDate);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete event.');
    } finally {
      setEditLoading(false);
    }
  };

  // ── Pull schedule request ────────────────────────────────────────────
  const handlePullRequest = async (requestId, classroomId) => {
    setError('');
    try {
      const res = await scheduleAPI.pullRequest(requestId);
      setSuccess(res.data.message);
      const updated = await scheduleAPI.listForClassroom(classroomId);
      setScheduleRequests(prev => ({ ...prev, [classroomId]: updated.data.schedule_requests || [] }));
      fetchEventsForMonth(currentDate);
    } catch (err) {
      if (err.response?.data?.not_connected) {
        setError('Connect your Google Calendar first to pull events.');
      } else {
        setError(err.response?.data?.error || 'Failed to pull schedule.');
      }
    }
  };

  const handlePullAll = async (classroomId) => {
    setError('');
    try {
      const res = await scheduleAPI.pullAll(classroomId);
      setSuccess(res.data.message);
      const updated = await scheduleAPI.listForClassroom(classroomId);
      setScheduleRequests(prev => ({ ...prev, [classroomId]: updated.data.schedule_requests || [] }));
      fetchEventsForMonth(currentDate);
    } catch (err) {
      if (err.response?.data?.not_connected) {
        setError('Connect your Google Calendar first to pull events.');
      } else {
        setError(err.response?.data?.error || 'Failed to pull schedules.');
      }
    }
  };

  // ── Loading state ────────────────────────────────────────────────────
  if (statusLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: '#667eea', fontSize: '18px' }}>
        Loading...
      </div>
    );
  }

  // ── Not connected state ──────────────────────────────────────────────
  if (!connected) {
    return (
      <div className="classroom-container">
        {error && <div className="error-message">{error}</div>}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '80px 20px', textAlign: 'center'
        }}>
          <div style={{ marginBottom: '20px' }}><CalendarDays size={72} strokeWidth={1.25} color="#667eea" /></div>
          <h2 style={{ fontSize: '26px', color: '#333', marginBottom: '12px' }}>My Calendar</h2>
          <p style={{ color: '#666', maxWidth: '420px', marginBottom: '32px', lineHeight: 1.7 }}>
            Connect your Google Calendar to view your schedule, add personal events,
            and pull class schedules posted by your CRs.
          </p>
          <button
            className="btn-primary"
            onClick={() => setShowConsent(true)}
            disabled={connectLoading}
            style={{ fontSize: '16px', padding: '14px 36px' }}
          >
            {connectLoading ? 'Redirecting to Google...' : 'Connect Google Calendar'}
          </button>
        </div>

        {showConsent && <ConsentModal onCancel={() => setShowConsent(false)} onAllow={() => { setShowConsent(false); handleConnect(); }} />}
      </div>
    );
  }

  // ── Build calendar grid ──────────────────────────────────────────────
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const pendingClassrooms = classrooms.filter(c =>
    (scheduleRequests[c.id] || []).some(r => !r.already_pulled)
  );

  return (
    <div className="classroom-container">
      {error && <div className="error-message" style={{ marginBottom: '16px' }}>{error}</div>}
      {success && <div className="success-message" style={{ marginBottom: '16px' }}>{success}</div>}

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>

        {/* ── Left: calendar ───────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Month nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <button
              onClick={prevMonth}
              style={{
                background: 'var(--card-bg)', border: '1.5px solid #667eea', color: '#667eea',
                borderRadius: '6px', padding: '6px 16px', cursor: 'pointer', fontWeight: 600, fontSize: '14px'
              }}
            >
              ← Prev
            </button>
            <h2 style={{ margin: 0, fontSize: '22px', color: '#333', fontWeight: 700 }}>
              {MONTH_NAMES[month]} {year}
            </h2>
            <button
              onClick={nextMonth}
              style={{
                background: 'var(--card-bg)', border: '1.5px solid #667eea', color: '#667eea',
                borderRadius: '6px', padding: '6px 16px', cursor: 'pointer', fontWeight: 600, fontSize: '14px'
              }}
            >
              Next →
            </button>
          </div>

          {/* Day header row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '4px' }}>
            {DAY_NAMES.map(d => (
              <div key={d} style={{ textAlign: 'center', fontWeight: 600, color: '#888', padding: '6px 0', fontSize: '13px' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          {eventsLoading ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#667eea' }}>Loading events...</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
              {cells.map((day, idx) => {
                if (day === null) return <div key={`e${idx}`} />;
                const dayEvents = getEventsForDay(day);
                const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
                return (
                  <div
                    key={day}
                    onClick={() => handleDayClick(day)}
                    style={{
                      minHeight: '88px', padding: '6px', borderRadius: '6px',
                      border: `1.5px solid ${isToday ? '#667eea' : 'var(--border-color)'}`,
                      background: isToday ? 'rgba(102,126,234,0.1)' : 'var(--card-bg)',
                      cursor: 'pointer',
                      transition: 'background 0.15s'
                    }}
                  >
                    <div style={{
                      fontSize: '13px', fontWeight: isToday ? 700 : 400,
                      color: isToday ? '#667eea' : '#333', marginBottom: '4px'
                    }}>
                      {day}
                    </div>
                    {dayEvents.slice(0, 3).map(ev => {
                      const chipStyle = eventChipStyle(ev);
                      return (
                        <div
                          key={ev.id}
                          onClick={(e) => handleEventChipClick(e, ev)}
                          title={ev.summary}
                          style={{
                            background: chipStyle.bg, color: chipStyle.text,
                            border: `1px solid ${chipStyle.border}`,
                            borderRadius: '3px', padding: '2px 5px', fontSize: '11px',
                            marginBottom: '2px', overflow: 'hidden', whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis', cursor: 'pointer', fontWeight: 500,
                          }}
                        >
                          {ev.summary}
                        </div>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <div style={{ fontSize: '10px', color: '#888' }}>+{dayEvents.length - 3} more</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Disconnect link */}
          <div style={{ marginTop: '20px', textAlign: 'right' }}>
            <button
              onClick={handleDisconnect}
              style={{
                background: 'none', border: 'none', color: '#dc2626',
                cursor: 'pointer', fontSize: '13px', textDecoration: 'underline'
              }}
            >
              Disconnect Google Calendar
            </button>
          </div>
        </div>

        {/* ── Right: pending schedules sidebar ─────────────────────── */}
        <div style={{
          width: '300px', flexShrink: 0, background: 'var(--card-bg)', borderRadius: '12px',
          border: '1.5px solid var(--border-color)', padding: '20px',
          position: 'sticky', top: '76px',
          maxHeight: 'calc(100vh - 96px)', overflowY: 'auto'
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700, color: '#333' }}>
            Pending Class Schedules
          </h3>

          {pendingClassrooms.length === 0 ? (
            <p style={{ color: '#999', fontSize: '13px', textAlign: 'center', marginTop: '20px' }}>
              No pending schedule requests.
            </p>
          ) : (
            pendingClassrooms.map(classroom => {
              const pending = (scheduleRequests[classroom.id] || []).filter(r => !r.already_pulled);
              return (
                <div key={classroom.id} style={{ marginBottom: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <strong style={{ fontSize: '13px', color: '#333' }}>{classroom.name}</strong>
                    <button
                      onClick={() => handlePullAll(classroom.id)}
                      style={{
                        background: '#667eea', color: 'white', border: 'none',
                        borderRadius: '6px', padding: '4px 10px', fontSize: '11px',
                        cursor: 'pointer', fontWeight: 600
                      }}
                    >
                      Pull All
                    </button>
                  </div>
                  {pending.map(req => (
                    <div key={req.id} style={{
                      background: 'var(--bg-color)', borderRadius: '8px', padding: '10px',
                      marginBottom: '8px', border: '1px solid var(--border-color)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0, marginRight: '8px' }}>
                          <p style={{ margin: 0, fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                            {req.title}
                          </p>
                          <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#888' }}>
                            {req.events.length} event{req.events.length !== 1 ? 's' : ''}
                          </p>
                          {req.description && (
                            <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#666' }}>{req.description}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handlePullRequest(req.id, classroom.id)}
                          style={{
                            background: '#4338ca', color: 'white', border: 'none',
                            borderRadius: '6px', padding: '5px 10px', fontSize: '11px',
                            cursor: 'pointer', fontWeight: 600, flexShrink: 0
                          }}
                        >
                          Pull
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Add Event Modal ──────────────────────────────────────────── */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Add Event</h2>
            <form onSubmit={handleAddEvent}>
              <div className="form-group">
                <label>Title *</label>
                <input
                  type="text"
                  value={addForm.title}
                  onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
                  placeholder="Event title"
                  required
                  disabled={addLoading}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Start *</label>
                <input
                  type="datetime-local"
                  value={addForm.start_datetime}
                  onChange={(e) => setAddForm({ ...addForm, start_datetime: e.target.value })}
                  required
                  disabled={addLoading}
                />
              </div>
              <div className="form-group">
                <label>End *</label>
                <input
                  type="datetime-local"
                  value={addForm.end_datetime}
                  onChange={(e) => setAddForm({ ...addForm, end_datetime: e.target.value })}
                  required
                  disabled={addLoading}
                />
              </div>
              <div className="form-group">
                <label>Location</label>
                <input
                  type="text"
                  value={addForm.location}
                  onChange={(e) => setAddForm({ ...addForm, location: e.target.value })}
                  placeholder="Optional"
                  disabled={addLoading}
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={addForm.description}
                  onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                  rows="2"
                  placeholder="Optional notes"
                  disabled={addLoading}
                />
              </div>
              <div className="form-group">
                <label>Event Type</label>
                <select
                  value={addForm.event_type}
                  onChange={(e) => setAddForm({ ...addForm, event_type: e.target.value })}
                  disabled={addLoading}
                  style={{ width: '100%', padding: '8px 12px', border: '1.5px solid var(--border-color)', borderRadius: '6px', fontSize: '14px', fontFamily: 'inherit', background: 'var(--bg-color)', color: 'var(--text-primary)', outline: 'none' }}
                >
                  {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="modal-buttons">
                <button type="button" onClick={() => setShowAddModal(false)} disabled={addLoading}>Cancel</button>
                <button type="submit" disabled={addLoading}>
                  {addLoading ? 'Adding...' : 'Add to Google Calendar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── View / Edit / Delete Event Modal ────────────────────────── */}
      {showEventModal && selectedEvent && (
        <div className="modal-overlay" onClick={() => { setShowEventModal(false); setIsEditing(false); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            {isEditing ? (
              <>
                <h2>Edit Event</h2>
                <form onSubmit={handleUpdateEvent}>
                  <div className="form-group">
                    <label>Title *</label>
                    <input
                      type="text"
                      value={editForm.title}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      required
                      disabled={editLoading}
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label>Start *</label>
                    <input
                      type="datetime-local"
                      value={editForm.start_datetime}
                      onChange={(e) => setEditForm({ ...editForm, start_datetime: e.target.value })}
                      required
                      disabled={editLoading}
                    />
                  </div>
                  <div className="form-group">
                    <label>End *</label>
                    <input
                      type="datetime-local"
                      value={editForm.end_datetime}
                      onChange={(e) => setEditForm({ ...editForm, end_datetime: e.target.value })}
                      required
                      disabled={editLoading}
                    />
                  </div>
                  <div className="form-group">
                    <label>Location</label>
                    <input
                      type="text"
                      value={editForm.location}
                      onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                      disabled={editLoading}
                    />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      rows="2"
                      disabled={editLoading}
                    />
                  </div>
                  <div className="form-group">
                    <label>Event Type</label>
                    <select
                      value={editForm.event_type}
                      onChange={(e) => setEditForm({ ...editForm, event_type: e.target.value })}
                      disabled={editLoading}
                      style={{ width: '100%', padding: '8px 12px', border: '1.5px solid var(--border-color)', borderRadius: '6px', fontSize: '14px', fontFamily: 'inherit', background: 'var(--bg-color)', color: 'var(--text-primary)', outline: 'none' }}
                    >
                      {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="modal-buttons">
                    <button type="button" onClick={() => setIsEditing(false)} disabled={editLoading}>Back</button>
                    <button type="submit" disabled={editLoading}>
                      {editLoading ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0 }}>{selectedEvent.summary}</h2>
                  {(() => {
                    const type = getEventTypeFromGCal(selectedEvent);
                    const cs = EVENT_TYPE_COLORS[type] || EVENT_TYPE_COLORS.Personal;
                    return (
                      <span style={{
                        fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '12px',
                        background: cs.bg, color: cs.text, border: `1px solid ${cs.border}`,
                      }}>{type}</span>
                    );
                  })()}
                </div>
                {selectedEvent.start?.dateTime && (
                  <p style={{ color: '#555', marginBottom: '6px', fontSize: '14px' }}>
                    <strong>Start:</strong> {new Date(selectedEvent.start.dateTime).toLocaleString()}
                  </p>
                )}
                {selectedEvent.end?.dateTime && (
                  <p style={{ color: '#555', marginBottom: '6px', fontSize: '14px' }}>
                    <strong>End:</strong> {new Date(selectedEvent.end.dateTime).toLocaleString()}
                  </p>
                )}
                {selectedEvent.location && (
                  <p style={{ color: '#555', marginBottom: '6px', fontSize: '14px' }}>
                    <strong>Location:</strong> {selectedEvent.location}
                  </p>
                )}
                {selectedEvent.description && (
                  <p style={{ color: '#666', marginBottom: '16px', fontSize: '14px' }}>
                    {selectedEvent.description}
                  </p>
                )}
                <div className="modal-buttons">
                  <button
                    type="button"
                    onClick={handleDeleteEvent}
                    disabled={editLoading}
                    style={{ background: '#dc2626', color: 'white', border: 'none' }}
                  >
                    {editLoading ? '...' : 'Delete'}
                  </button>
                  <button type="button" onClick={() => setIsEditing(true)}>
                    Edit
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Calendar;
