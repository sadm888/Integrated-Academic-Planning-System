import React, { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authAPI } from '../services/api';
import '../styles/Auth.css';
import { Eye } from 'lucide-react';

const Login = ({ onAuthSuccess }) => {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pwRef = useRef(null);

  const handleChange = e => { setForm(f => ({ ...f, [e.target.name]: e.target.value })); };
  const pw = type => { if (pwRef.current) pwRef.current.type = type; };

  const handleSubmit = async e => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await authAPI.login(form);
      onAuthSuccess(res.data.user, res.data.token);
      navigate('/classrooms');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>Welcome to IAPS</h1>
        <h2>Login</h2>
        {error && <div className="error-message">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email or Username</label>
            <input type="text" name="email" value={form.email} onChange={handleChange} required placeholder="your@email.com or username" />
          </div>
          <div className="form-group">
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input ref={pwRef} type="password" name="password" value={form.password} onChange={handleChange} required placeholder="••••••••" style={{ paddingRight: '52px' }} />
              <button
                type="button" tabIndex={-1} title="Hold to show password"
                onPointerDown={e => { e.preventDefault(); pw('text'); }}
                onPointerUp={() => pw('password')} onPointerLeave={() => pw('password')}
                style={{
                  position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                  background: 'var(--bg-color)', border: '1px solid var(--border-color)',
                  borderRadius: '5px', cursor: 'pointer', color: 'var(--text-secondary)',
                  padding: '3px 8px', lineHeight: 1.3, userSelect: 'none', display: 'flex', alignItems: 'center',
                }}
              ><Eye size={13} strokeWidth={1.75} /></button>
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        <p className="auth-footer">Don't have an account? <Link to="/signup">Sign up</Link></p>
      </div>
    </div>
  );
};

export default Login;
