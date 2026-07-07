import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, RefreshCw } from 'lucide-react';
import { academicAPI, timetableAPI } from '../services/api';
import '../styles/Classroom.css';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ABBRS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const EVENT_TYPE_COLORS = {
  Lecture:        { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  Lab:            { bg: '#ede9fe', text: '#5b21b6', border: '#c4b5fd' },
  Tutorial:       { bg: '#ccfbf1', text: '#065f46', border: '#6ee7b7' },
  Holiday:        { bg: '#dcfce7', text: '#166534', border: '#86efac' },
  'Semester Exam':{ bg: '#fecaca', text: '#7f1d1d', border: '#fca5a5' },
  Exam:           { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  Event:          { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  Break:          { bg: '#f3e8ff', text: '#6b21a8', border: '#d8b4fe' },
  Submission:     { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  Other:          { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' },
};
const NON_CLASS_TYPES = ['Free', 'Lunch', 'Library', 'Break', 'Cancelled'];

function eventChipStyle(type) {
  return EVENT_TYPE_COLORS[type] || EVENT_TYPE_COLORS.Other;
}

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function weekdayAbbr(date) {
  const js = date.getDay(); // Sun=0..Sat=6
  return DAY_ABBRS[js === 0 ? 6 : js - 1];
}

function buildAcademicEvMap(events) {
  const evMap = {};
  (events || []).filter(e => e.date).forEach(ev => {
    const [sy, sm, sd] = ev.date.split('-').map(Number);
    const start = new Date(sy, sm - 1, sd);
    const endStr = ev.end_date && ev.end_date !== ev.date ? ev.end_date : ev.date;
    const [ey, em, ed] = endStr.split('-').map(Number);
    const end = new Date(ey, em - 1, ed);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = localDateKey(d);
      if (!evMap[key]) evMap[key] = [];
      evMap[key].push(ev);
    }
  });
  return evMap;
}

function Calendar({ user }) {
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const [semesters, setSemesters] = useState([]);
  const [timetables, setTimetables] = useState([]); // parallel to semesters
  const [acEvMaps, setAcEvMaps] = useState([]);      // parallel to semesters
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      const semRes = await academicAPI.getMySemesters();
      const sems = (semRes.data.semesters || []).filter(s => s.is_active);
      setSemesters(sems);

      const [ttResults, acResults] = await Promise.all([
        Promise.allSettled(sems.map(s => timetableAPI.get(s.semester_id))),
        Promise.allSettled(sems.map(s => timetableAPI.getAcademicCalendar(s.semester_id))),
      ]);

      setTimetables(ttResults.map(res => (res.status === 'fulfilled' ? res.value.data.timetable : null)));
      setAcEvMaps(acResults.map(res => {
        if (res.status !== 'fulfilled') return {};
        const cal = res.value.data.academic_calendar;
        return cal ? buildAcademicEvMap(cal.events) : {};
      }));
    } catch (err) {
      setError('Failed to load calendar.');
    } finally {
      setLoading(false);
    }
  };

  const prevMonth = () => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));

  const getEventsForDay = useCallback((day) => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const date = new Date(year, month, day);
    const dateKey = localDateKey(date);
    const dayAbbr = weekdayAbbr(date);
    const items = [];

    semesters.forEach((sem, i) => {
      const dayEvents = acEvMaps[i]?.[dateKey] || [];
      const holiday = dayEvents.find(ev => ev.type === 'Holiday');
      if (holiday) {
        items.push({ id: `h-${sem.semester_id}`, summary: holiday.title, type: 'Holiday', sem, kind: 'event' });
        return; // holiday cancels classes for this semester on this date
      }
      dayEvents.forEach(ev => items.push({ id: `e-${sem.semester_id}-${ev.title}`, summary: ev.title, type: ev.type, sem, kind: 'event' }));

      const tt = timetables[i];
      if (!tt || !tt.days?.includes(dayAbbr)) return;
      (tt.time_slots || []).forEach(slot => {
        const cell = tt.grid?.[dayAbbr]?.[slot];
        if (cell?.subject && !NON_CLASS_TYPES.includes(cell.type)) {
          items.push({
            id: `c-${sem.semester_id}-${slot}`,
            summary: `${cell.subject_name || cell.subject} · ${sem.classroom_name}`,
            type: cell.type,
            sem, kind: 'class',
          });
        }
      });
    });
    return items;
  }, [currentDate, semesters, timetables, acEvMaps]);

  const handleChipClick = (e, item) => {
    e.stopPropagation();
    if (item.kind === 'class') {
      navigate(`/classroom/${item.sem.classroom_id}/semester/${item.sem.semester_id}/timetable`);
    } else {
      navigate(`/classroom/${item.sem.classroom_id}/semester/${item.sem.semester_id}/academic-calendar`);
    }
  };

  if (loading) {
    return (
      <div className="classroom-container">
        <div style={{ textAlign: 'center', padding: '60px', color: '#667eea' }}>Loading calendar...</div>
      </div>
    );
  }

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="classroom-container">
      {error && <div className="error-message" style={{ marginBottom: '16px' }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <CalendarDays size={22} color="#667eea" />
        <h2 style={{ margin: 0, fontSize: '22px', color: 'var(--text-primary)', fontWeight: 700 }}>My Calendar</h2>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px' }}>
        Timetables and academic calendar events across all your classrooms.
      </p>

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h2 style={{ margin: 0, fontSize: '22px', color: 'var(--text-primary)', fontWeight: 700 }}>
            {MONTH_NAMES[month]} {year}
          </h2>
          <button
            onClick={loadAll}
            title="Refresh"
            style={{
              background: 'none', border: '1.5px solid var(--border-color)', borderRadius: '6px',
              padding: '5px 8px', cursor: 'pointer', color: '#667eea', display: 'flex', alignItems: 'center',
            }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
        {cells.map((day, idx) => {
          if (day === null) return <div key={`e${idx}`} />;
          const dayEvents = getEventsForDay(day);
          const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
          return (
            <div
              key={day}
              style={{
                minHeight: '88px', padding: '6px', borderRadius: '6px',
                border: `1.5px solid ${isToday ? '#667eea' : 'var(--border-color)'}`,
                background: isToday ? 'rgba(102,126,234,0.1)' : 'var(--card-bg)',
              }}
            >
              <div style={{
                fontSize: '13px', fontWeight: isToday ? 700 : 400,
                color: isToday ? '#667eea' : 'var(--text-primary)', marginBottom: '4px'
              }}>
                {day}
              </div>
              {dayEvents.slice(0, 4).map(ev => {
                const chipStyle = eventChipStyle(ev.type);
                return (
                  <div
                    key={ev.id}
                    onClick={(e) => handleChipClick(e, ev)}
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
              {dayEvents.length > 4 && (
                <div style={{ fontSize: '10px', color: '#888' }}>+{dayEvents.length - 4} more</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Calendar;
