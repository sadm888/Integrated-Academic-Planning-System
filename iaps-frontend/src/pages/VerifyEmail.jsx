import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import '../styles/Auth.css';

const VerifyEmail = ({ onAuthSuccess }) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('loading'); // 'loading' | 'success' | 'error'
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('No verification token found in the link. Please check your email and try again.');
      return;
    }

    authAPI.verifyEmail(token)
      .then((res) => {
        setStatus('success');
        setMessage(res.data.message || 'Email verified successfully!');
        // Auto-login the user
        if (res.data.token && res.data.user) {
          onAuthSuccess(res.data.user, res.data.token);
          setTimeout(() => navigate('/classrooms'), 2000);
        }
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.response?.data?.error || 'Verification failed. The link may have expired.');
      });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="auth-container">
      <div className="auth-card" style={{ textAlign: 'center', maxWidth: 440 }}>
        {status === 'loading' && (
          <>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: '#f3f4f6',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Loader2 size={36} color="#6c63ff" strokeWidth={1.5} style={{ animation: 'spin 1s linear infinite' }} />
              </div>
            </div>
            <h2>Verifying your email…</h2>
            <p style={{ color: 'var(--text-secondary)' }}>Please wait a moment.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: '#f0fdf4',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <CheckCircle2 size={36} color="#16a34a" strokeWidth={1.5} />
              </div>
            </div>
            <h2 style={{ color: '#16a34a' }}>Email Verified!</h2>
            <p style={{ color: 'var(--text-secondary)' }}>{message}</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              Redirecting you to your classrooms…
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: '#fef2f2',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <XCircle size={36} color="#dc2626" strokeWidth={1.5} />
              </div>
            </div>
            <h2 style={{ color: '#dc2626' }}>Verification Failed</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>{message}</p>
            <button
              className="btn-primary"
              onClick={() => navigate('/signup')}
            >
              Back to Sign Up
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;
