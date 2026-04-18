import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { authAPI } from '../services/api';
import '../styles/Auth.css';
import { Eye } from 'lucide-react';

const Signup = ({ onAuthSuccess }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite') || '';

  const [formData, setFormData] = useState({
    email: '',
    username: '',
    fullName: '',
    phone: '',
    college: '',
    department: '',
    password: '',
    confirmPassword: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [inviteInfo, setInviteInfo] = useState(null);
  const pwRef = useRef(null);
  const confirmPwRef = useRef(null);

  const eyeBtnStyle = {
    position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
    background: 'var(--bg-color)', border: '1px solid var(--border-color)',
    borderRadius: '5px', cursor: 'pointer',
    color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600,
    padding: '3px 8px', lineHeight: 1.3, userSelect: 'none',
  };

  // Validate invite token on mount if present
  useEffect(() => {
    if (!inviteToken) return;
    authAPI.checkInvite(inviteToken)
      .then((res) => {
        if (res.data.valid) {
          setInviteInfo({ inviter_name: res.data.inviter_name, invited_email: res.data.invited_email });
          if (res.data.invited_email) {
            setFormData(f => ({ ...f, email: res.data.invited_email }));
          }
        }
      })
      .catch(() => {});
  }, [inviteToken]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.fullName.trim()) { setError('Full name is required'); return; }
    if (!formData.username.trim()) { setError('Username is required'); return; }
    if (!formData.email.trim()) { setError('Email is required'); return; }
    if (!formData.college.trim()) { setError('College is required'); return; }
    if (!formData.department.trim()) { setError('Department is required'); return; }
    if (!formData.password) { setError('Password is required'); return; }
    if (formData.password !== formData.confirmPassword) { setError('Passwords do not match'); return; }
    if (formData.password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (!/[A-Z]/.test(formData.password)) { setError('Password must contain at least one uppercase letter'); return; }
    if (!/[a-z]/.test(formData.password)) { setError('Password must contain at least one lowercase letter'); return; }
    if (!/[0-9]/.test(formData.password)) { setError('Password must contain at least one number'); return; }

    setIsLoading(true);
    try {
      const { confirmPassword, ...signupData } = formData;
      if (inviteToken) signupData.invite_token = inviteToken;
      const response = await authAPI.signup(signupData);
      onAuthSuccess(response.data.user, response.data.token);
      navigate('/classrooms');
    } catch (err) {
      setError(err.response?.data?.error || 'Signup failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card signup-card">
        <h1>Join IAPS</h1>
        <h2>Create Your Account</h2>

        {inviteInfo && (
          <div style={{
            background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8,
            padding: '10px 14px', marginBottom: 16, fontSize: 14, color: '#166534',
          }}>
            You were invited by <strong>{inviteInfo.inviter_name}</strong>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>Full Name *</label>
              <input
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                placeholder="John Doe"
              />
            </div>

            <div className="form-group">
              <label>Username *</label>
              <input
                type="text"
                name="username"
                value={formData.username}
                onChange={handleChange}
                placeholder="johndoe"
              />
              <small className="hint">Must be unique</small>
            </div>
          </div>

          <div className="form-group">
            <label>Email *</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="your@email.com"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>College *</label>
              <input
                type="text"
                name="college"
                value={formData.college}
                onChange={handleChange}
                placeholder="University Name"
              />
            </div>

            <div className="form-group">
              <label>Department *</label>
              <input
                type="text"
                name="department"
                value={formData.department}
                onChange={handleChange}
                placeholder="Computer Science"
              />
            </div>
          </div>

          <div className="form-group">
            <label>Phone (Optional)</label>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              placeholder="+1234567890"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Password *</label>
              <div style={{ position: 'relative' }}>
                <input
                  ref={pwRef}
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
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
                  style={eyeBtnStyle}
                ><Eye size={13} strokeWidth={1.75} /></button>
              </div>
              <small className="hint">
                8+ chars, uppercase, lowercase, number
              </small>
            </div>

            <div className="form-group">
              <label>Confirm Password *</label>
              <div style={{ position: 'relative' }}>
                <input
                  ref={confirmPwRef}
                  type="password"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  placeholder="••••••••"
                  style={{ paddingRight: '52px' }}
                />
                <button
                  type="button"
                  onPointerDown={(e) => { e.preventDefault(); if (confirmPwRef.current) confirmPwRef.current.type = 'text'; }}
                  onPointerUp={() => { if (confirmPwRef.current) confirmPwRef.current.type = 'password'; }}
                  onPointerLeave={() => { if (confirmPwRef.current) confirmPwRef.current.type = 'password'; }}
                  tabIndex={-1}
                  title="Hold to show password"
                  style={eyeBtnStyle}
                ><Eye size={13} strokeWidth={1.75} /></button>
              </div>
            </div>
          </div>

          <button type="submit" disabled={isLoading} className="btn-primary">
            {isLoading ? 'Creating Account...' : 'Sign Up'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link to="/login">Login</Link>
        </p>
      </div>
    </div>
  );
};

export default Signup;
