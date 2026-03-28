import React from 'react';
import { settingsAPI } from '../services/api';

const COLORS = ['#667eea', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

const dotSize = (size) => Math.max(8, Math.round(size * 0.28));

// showOnline: true = green dot, false = grey dot, null/undefined = no dot
// dotBg: background colour of the surface the avatar sits on (for the dot border halo)
// dotColor: override the dot colour entirely (e.g. '#667eea' for hidden/invisible mode)
function Avatar({ user, size = 36, showOnline = null, dotBg = 'var(--card-bg)', dotColor = null }) {
  const str = user?.username || user?.email || '';
  const hash = str.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  const colorIdx = Math.abs(hash) % COLORS.length;
  const letter = ((user?.username || user?.email || '?')[0] || '?').toUpperCase();

  const dot = showOnline !== null && showOnline !== undefined ? (
    <span style={{
      position: 'absolute',
      bottom: 0,
      right: 0,
      width: dotSize(size),
      height: dotSize(size),
      borderRadius: '50%',
      background: dotColor || (showOnline ? '#22c55e' : '#9ca3af'),
      border: `2px solid ${dotBg}`,
    }} />
  ) : null;

  if (user?.profile_picture) {
    return (
      <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
        <img
          src={settingsAPI.getAvatarUrl(user.id)}
          alt={user.username}
          style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }}
        />
        {dot}
      </span>
    );
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: COLORS[colorIdx],
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontWeight: 700,
          fontSize: Math.round(size * 0.42) + 'px',
          userSelect: 'none',
        }}
      >
        {letter}
      </span>
      {dot}
    </span>
  );
}

export default Avatar;
