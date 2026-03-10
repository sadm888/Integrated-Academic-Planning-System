import React, { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authAPI } from '../services/api';
import '../styles/Auth.css';
import { Eye } from 'lucide-react';

const Login = ({ onAuthSuccess }) => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const pwRef = useRef(null);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await authAPI.login(formData);
      onAuthSuccess(response.data.user, response.data.token);
      navigate('/classrooms');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
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
            <input
              type="text"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              placeholder="your@email.com or username"
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                ref={pwRef}
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
                placeholder="••••••••"
                style={{ paddingRight: '52px' }}
              />
              <button
                type="button"
                onPointerDown={(e) => { e.preventDefault(); if (pwRef.current) pwRef.current.type = 'text'; }}
                onPointerUp={() => { if (pwRef.current) pwRef.current.type = 'password'; }}
                onPointerLeave={() => { if (pwRef.current) pwRef.current.type = 'password'; }}
                tabIndex={-1}
                title="Hold to show password"
                style={{
                  position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                  background: 'var(--bg-color)', border: '1px solid var(--border-color)',
                  borderRadius: '5px', cursor: 'pointer',
                  color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600,
                  padding: '3px 8px', lineHeight: 1.3, userSelect: 'none', display: 'flex', alignItems: 'center',
                }}
              ><Eye size={13} strokeWidth={1.75} /></button>
            </div>
          </div>

          <button type="submit" disabled={isLoading} className="btn-primary">
            {isLoading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p className="auth-footer">
          Don't have an account? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
