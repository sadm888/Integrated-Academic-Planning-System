import React from 'react';
import { settingsAPI } from '../services/api';

const COLORS = ['#667eea', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

function Avatar({ user, size = 36 }) {
  const colorIdx = ((user?.username || '').charCodeAt(0) || 0) % COLORS.length;
  const letter = ((user?.username || user?.email || '?')[0] || '?').toUpperCase();

  if (user?.profile_picture) {
    return (
      <img
        src={settingsAPI.getAvatarUrl(user.id)}
        alt={user.username}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
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
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {letter}
    </div>
  );
}

export default Avatar;
