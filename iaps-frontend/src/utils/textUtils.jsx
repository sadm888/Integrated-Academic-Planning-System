import React from 'react';

/**
 * Renders text with @mention tokens highlighted.
 * Mentions matching `myUsername` get a stronger highlight.
 *
 * @param {string} text
 * @param {string} myUsername
 * @returns {string | React.ReactNode[]}
 */
export function renderMentions(text, myUsername) {
  if (!text || !text.includes('@')) return text;
  const parts = text.split(/(@[A-Za-z0-9_]+)/g);
  return parts.map((part, i) => {
    if (/^@[A-Za-z0-9_]+$/.test(part)) {
      const isMine = myUsername && part.slice(1).toLowerCase() === myUsername.toLowerCase();
      return (
        <span key={i} style={{
          background: isMine ? 'rgba(102,126,234,0.22)' : 'rgba(102,126,234,0.10)',
          color: 'var(--primary-color)',
          borderRadius: '4px', padding: '0 3px',
          fontWeight: isMine ? 700 : 600,
        }}>{part}</span>
      );
    }
    return part;
  });
}
