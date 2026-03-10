import React, { createContext, useContext, useState, useCallback } from 'react';
import { Check, X, Info } from 'lucide-react';

const ToastContext = createContext(null);

const ICONS = { success: <Check size={12} strokeWidth={2.5} />, error: <X size={12} strokeWidth={2.5} />, info: <Info size={12} strokeWidth={2} /> };
const COLORS = {
  success: { bg: '#dcfce7', border: '#86efac', text: '#166534', icon: '#22c55e' },
  error:   { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', icon: '#ef4444' },
  info:    { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af', icon: '#3b82f6' },
};

function ToastItem({ toast, onDismiss }) {
  const c = COLORS[toast.type] || COLORS.info;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      background: c.bg, border: `1px solid ${c.border}`, borderRadius: '10px',
      padding: '12px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      minWidth: '280px', maxWidth: '400px',
      animation: 'toast-in 0.2s ease',
    }}>
      <span style={{
        width: '20px', height: '20px', borderRadius: '50%',
        background: c.icon, color: 'white', fontSize: '12px', fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '1px',
      }}>
        {ICONS[toast.type]}
      </span>
      <span style={{ flex: 1, fontSize: '14px', color: c.text, lineHeight: '1.4' }}>
        {toast.message}
      </span>
      <button
        onClick={() => onDismiss(toast.id)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: c.text, opacity: 0.6, fontSize: '16px', lineHeight: 1,
          padding: '0 2px', flexShrink: 0,
        }}
      >×</button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.slice(-4), { id, message, type }]); // max 5 visible
    if (duration > 0) setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  const toast = {
    success: (msg, dur) => addToast(msg, 'success', dur),
    error:   (msg, dur) => addToast(msg, 'error', dur),
    info:    (msg, dur) => addToast(msg, 'info', dur),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div style={{
        position: 'fixed', bottom: '24px', right: '24px',
        display: 'flex', flexDirection: 'column', gap: '8px',
        zIndex: 9999, pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <ToastItem toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
};
