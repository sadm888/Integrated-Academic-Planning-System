import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

/**
 * Shared subnav bar used by every semester-level page.
 * Pass `active` matching one of the tab keys below.
 * Pass `children` for page-specific extra items (spacer + buttons).
 */
export default function SemesterSubnav({ classroomId, semesterId, active, children }) {
  const navigate = useNavigate();
  const base = `/classroom/${classroomId}/semester/${semesterId}`;
  const attendanceHidden = localStorage.getItem(`attendance_hidden_${semesterId}`) === 'true';
  const resourcesHidden  = localStorage.getItem(`resources_hidden_${semesterId}`)  === 'true';

  const tabs = [
    { key: 'dashboard',  label: 'Dashboard',          to: base },
    { key: 'chat',       label: 'Chat',                to: `${base}/chat`,              isButton: true },
    ...(!resourcesHidden  ? [{ key: 'resources',  label: 'Resources',         to: `${base}/files` }] : []),
    { key: 'marks',      label: 'Marks',               to: `${base}/marks` },
    { key: 'analytics',  label: 'Analytics',           to: `${base}/analytics` },
    { key: 'timetable',  label: 'Timetable',           to: `${base}/timetable` },
    { key: 'calendar',   label: 'Academic Calendar',   to: `${base}/academic-calendar` },
    ...(!attendanceHidden ? [{ key: 'attendance', label: 'Attendance',        to: `${base}/attendance` }] : []),
  ];

  return (
    <div className="page-subnav">
      {tabs.map(tab =>
        tab.isButton ? (
          <button
            key={tab.key}
            className={`page-subnav-item${active === tab.key ? ' accent' : ''}`}
            onClick={() => navigate(tab.to)}
          >
            {tab.label}
          </button>
        ) : (
          <Link
            key={tab.key}
            className={`page-subnav-item${active === tab.key ? ' accent' : ''}`}
            to={tab.to}
          >
            {tab.label}
          </Link>
        )
      )}
      {children}
    </div>
  );
}
