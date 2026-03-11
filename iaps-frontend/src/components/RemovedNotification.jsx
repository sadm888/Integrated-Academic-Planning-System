import React from 'react';
import { XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function RemovedNotification({ data }) {
  const navigate = useNavigate();
  if (!data) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
    }}>
      <div style={{
        background: 'var(--card-bg)', borderRadius: '16px', padding: '32px 28px',
        maxWidth: '400px', width: '90%', textAlign: 'center',
      }}>
        <XCircle size={48} strokeWidth={1.5} style={{ color: '#dc2626', marginBottom: '12px' }} />
        <h2 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700 }}>You've been removed</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '0 0 8px' }}>
          Removed from <strong>{data.classroom_name}</strong> by {data.removed_by}.
        </p>
        {data.reason && (
          <p style={{
            fontSize: '13px', color: 'var(--text-secondary)', background: 'var(--bg-color)',
            padding: '10px 14px', borderRadius: '8px', margin: '0 0 20px', fontStyle: 'italic',
          }}>
            "{data.reason}"
          </p>
        )}
        <button
          onClick={() => navigate('/')}
          style={{
            background: '#667eea', color: 'white', border: 'none', borderRadius: '8px',
            padding: '10px 28px', fontSize: '14px', cursor: 'pointer', fontWeight: 600,
          }}
        >
          Go to Home
        </button>
      </div>
    </div>
  );
}
