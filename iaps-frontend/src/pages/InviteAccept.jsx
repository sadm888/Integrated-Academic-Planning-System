import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { classroomAPI } from '../services/api';
import '../styles/Auth.css';

function InviteAccept({ user }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [classroomId, setClassroomId] = useState(null);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('No invite token found in the link.');
      return;
    }

    if (!user) {
      // Not logged in - save token and redirect to signup
      localStorage.setItem('pendingInviteToken', token);
      navigate('/signup', { replace: true });
      return;
    }

    // Logged in - accept the invite
    acceptInvite();
  }, [token, user]);

  const acceptInvite = async () => {
    try {
      const response = await classroomAPI.acceptInvite(token);
      setStatus('success');
      setMessage(response.data.message);
      setClassroomId(response.data.classroom_id);
    } catch (err) {
      setStatus('error');
      setMessage(err.response?.data?.error || 'Failed to accept invitation.');
    }
  };

  if (status === 'loading') {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <h1>Joining Classroom...</h1>
          <p style={{ textAlign: 'center', color: '#666' }}>Please wait while we process your invitation.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>{status === 'success' ? 'You\'re In!' : 'Invite Error'}</h1>
        <p style={{
          textAlign: 'center',
          color: status === 'success' ? '#10b981' : '#ef4444',
          fontSize: '16px',
          margin: '20px 0'
        }}>
          {message}
        </p>
        <button
          className="btn-primary"
          style={{ width: '100%' }}
          onClick={() => navigate(classroomId ? `/classroom/${classroomId}` : '/classrooms')}
        >
          {classroomId ? 'Go to Classroom' : 'Go to Classrooms'}
        </button>
      </div>
    </div>
  );
}

export default InviteAccept;
