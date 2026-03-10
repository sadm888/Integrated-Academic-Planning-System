import React from 'react';
import { Image, Video, Music, FileText, Paperclip } from 'lucide-react';

export function sizeLabel(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileTypeIcon({ mime, size = 16 }) {
  const props = { size, strokeWidth: 1.75, style: { flexShrink: 0, color: 'var(--text-secondary)' } };
  if (!mime) return <Paperclip {...props} />;
  if (mime.startsWith('image/')) return <Image {...props} style={{ ...props.style, color: '#6366f1' }} />;
  if (mime.startsWith('video/')) return <Video {...props} style={{ ...props.style, color: '#ec4899' }} />;
  if (mime.startsWith('audio/')) return <Music {...props} style={{ ...props.style, color: '#8b5cf6' }} />;
  if (mime === 'application/pdf') return <FileText {...props} style={{ ...props.style, color: '#ef4444' }} />;
  return <Paperclip {...props} />;
}
