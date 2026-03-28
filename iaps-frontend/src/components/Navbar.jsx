import React, { useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import Avatar from './Avatar';

// Regex for any deep classroom/semester page
const CLASSROOM_RE = /^\/classroom\//;

function Navbar({ user, onLogout, dmUnreadCount = 0 }) {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  // Save last classroom URL so we can restore it when navigating back
  useEffect(() => {
    if (CLASSROOM_RE.test(location.pathname)) {
      localStorage.setItem('last_classroom_url', location.pathname);
    }
  }, [location.pathname]);

  // "My Classrooms" smart destination:
  // - When already inside a classroom page → go to /classrooms list
  // - When outside (Settings, Calendar, etc.) → return to last visited classroom page
  const classroomsHref = CLASSROOM_RE.test(location.pathname)
    ? '/classrooms'
    : (localStorage.getItem('last_classroom_url') || '/classrooms');

  return (
    <nav style={{
      background: '#667eea',
      padding: '0 32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: '56px',
      boxShadow: '0 2px 8px rgba(102,126,234,0.3)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      {/* Brand */}
      <span
        onClick={() => navigate('/classrooms')}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          cursor: 'pointer', userSelect: 'none',
          transition: 'transform 0.15s ease, opacity 0.15s ease',
        }}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        {/* Graduation cap — white on transparent (navbar bg is already purple) */}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="28" height="28" style={{ flexShrink: 0, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }}>
          <polygon points="16,5 30,11.5 16,18 2,11.5" fill="white"/>
          <path d="M10,14.5 L10,21.5 Q16,25 22,21.5 L22,14.5 L16,18 Z" fill="rgba(255,255,255,0.85)"/>
          <line x1="30" y1="11.5" x2="30" y2="20" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          <circle cx="30" cy="21.5" r="2" fill="white"/>
        </svg>
        <span style={{ color: 'white', fontWeight: 800, fontSize: '20px', letterSpacing: '0.5px' }}>
          IAPS
        </span>
      </span>

      {/* Nav links */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <NavLink
            to={classroomsHref}
            label="My Classrooms"
            active={isActive('/classrooms') || isActive('/classroom')}
          />
          {dmUnreadCount > 0 && (
            <span style={{
              position: 'absolute', top: '2px', right: '2px',
              background: '#ef4444', color: 'white',
              borderRadius: '50%', minWidth: '16px', height: '16px',
              fontSize: '10px', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 3px', pointerEvents: 'none',
              border: '1.5px solid #667eea',
            }}>
              {dmUnreadCount > 99 ? '99+' : dmUnreadCount}
            </span>
          )}
        </div>
        <NavLink
          to="/files"
          label="Files"
          active={isActive('/files')}
        />
        <NavLink
          to="/calendar"
          label="Calendar"
          active={isActive('/calendar')}
        />
        <NavLink
          to="/settings"
          label="Settings"
          active={isActive('/settings')}
        />
      </div>

      {/* Right: avatar + username link + logout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {user && (
          <Link
            to="/settings"
            style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}
          >
            <Avatar user={user} size={30} />
            <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '14px' }}>
              {user.username}
            </span>
          </Link>
        )}
        <button
          onClick={onLogout}
          style={{
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.4)',
            color: 'white',
            borderRadius: '6px',
            padding: '6px 16px',
            fontSize: '14px',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Logout
        </button>
      </div>
    </nav>
  );
}

function NavLink({ to, label, active }) {
  return (
    <Link
      to={to}
      style={{
        color: active ? 'white' : 'rgba(255,255,255,0.75)',
        textDecoration: 'none',
        padding: '6px 16px',
        borderRadius: '6px',
        fontSize: '15px',
        fontWeight: active ? 700 : 500,
        background: active ? 'rgba(255,255,255,0.18)' : 'transparent',
        borderBottom: active ? '2px solid white' : '2px solid transparent',
      }}
    >
      {label}
    </Link>
  );
}

export default Navbar;
