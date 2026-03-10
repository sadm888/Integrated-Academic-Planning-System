import React, { useState, useEffect, useRef } from 'react';
import { settingsAPI, calendarAPI, BACKEND_URL } from '../services/api';
import { useTheme } from '../contexts/ThemeContext';
import Avatar from '../components/Avatar';
import { FileTypeIcon } from '../utils/fileUtils';
import { AlertTriangle, Pencil, Eye, Trash2, Calendar, CheckCircle } from 'lucide-react';

const SECTIONS = ['Profile', 'Security', 'Appearance', 'Personal Documents', 'Connected Services'];

// ─── helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


// Compress an image file using Canvas before uploading (#11)
function compressImage(file, maxDim = 800, quality = 0.85) {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/') || file.size < 300 * 1024) {
      resolve(file); // skip compression for small or non-image files
      return;
    }
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name, { type: 'image/jpeg' })),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });
}

// ─── sub-sections ───────────────────────────────────────────────────────────

function ProfileSection({ user, onProfileUpdate }) {
  const [form, setForm] = useState({
    username: user.username || '',
    fullName: user.fullName || '',
    college: user.college || '',
    department: user.department || '',
    phone: user.phone || '',
    phone_public: user.phone_public || false,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef();

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    setErr('');
    try {
      const res = await settingsAPI.updateProfile(form);
      onProfileUpdate(res.data.user, res.data.token);
      setMsg('Profile updated successfully.');
    } catch (error) {
      setErr(error.response?.data?.error || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setAvatarUploading(true);
    setErr('');
    try {
      const compressed = await compressImage(file);
      const res = await settingsAPI.uploadAvatar(compressed);
      onProfileUpdate(res.data.user, null);
      setMsg('Avatar updated.');
    } catch (error) {
      setErr(error.response?.data?.error || 'Failed to upload avatar.');
    } finally {
      setAvatarUploading(false);
    }
  };

  return (
    <div>
      <h2 style={headingStyle}>Profile</h2>

      {/* Photo removed notice */}
      {user.photo_removed_reason && (
        <div style={{
          background: '#fff7ed', border: '1.5px solid #fed7aa', borderRadius: '10px',
          padding: '12px 16px', marginBottom: '20px',
          display: 'flex', gap: '12px', alignItems: 'flex-start',
        }}>
          <AlertTriangle size={20} strokeWidth={1.75} style={{ flexShrink: 0, color: '#c2410c' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: '#c2410c', fontSize: '14px' }}>Your profile photo was removed</div>
            <div style={{ color: '#9a3412', fontSize: '13px', marginTop: '2px' }}>
              <strong>{user.photo_removed_by}</strong> removed it. Reason: <em>{user.photo_removed_reason}</em>
            </div>
            <div style={{ color: '#9a3412', fontSize: '12px', marginTop: '4px' }}>Upload a new appropriate photo to clear this notice.</div>
          </div>
          <button
            onClick={async () => {
              try { await settingsAPI.acknowledgePhotoRemoval(); } catch {}
              onProfileUpdate({ ...user, photo_removed_reason: null, photo_removed_by: null }, null);
            }}
            style={{
              background: 'none', border: '1px solid #fed7aa', borderRadius: '6px',
              color: '#c2410c', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              padding: '4px 10px', flexShrink: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '28px' }}>
        <div
          onClick={() => fileInputRef.current.click()}
          style={{ cursor: 'pointer', position: 'relative' }}
          title="Click to change avatar"
        >
          <Avatar user={user} size={72} />
          <div style={{
            position: 'absolute', bottom: 0, right: 0,
            background: '#667eea', borderRadius: '50%', width: '22px', height: '22px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '12px', color: 'white', border: '2px solid var(--card-bg)',
          }}><Pencil size={12} strokeWidth={1.75} /></div>
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: '16px', color: 'var(--text-primary)' }}>{user.username}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{user.email}</div>
          <button
            onClick={() => fileInputRef.current.click()}
            disabled={avatarUploading}
            style={{ ...smallBtnStyle, marginTop: '6px' }}
          >
            {avatarUploading ? 'Uploading…' : 'Change photo'}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleAvatarChange}
        />
      </div>

      <form onSubmit={handleSave}>
        {[
          { label: 'Username', key: 'username' },
          { label: 'Full Name', key: 'fullName' },
          { label: 'College', key: 'college' },
          { label: 'Department', key: 'department' },
        ].map(({ label, key }) => (
          <div key={key} style={fieldGroupStyle}>
            <label style={labelStyle}>{label}</label>
            <input
              style={inputStyle}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              placeholder={label}
            />
          </div>
        ))}

        {/* Phone number — optional, with visibility control */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Phone Number <span style={{ color: 'var(--text-secondary)', fontWeight: 400, fontSize: '12px' }}>(optional)</span></label>
          <input
            style={inputStyle}
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="e.g. +91 98765 43210"
          />
          <label style={{
            display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px',
            cursor: 'pointer', userSelect: 'none',
          }}>
            <input
              type="checkbox"
              checked={form.phone_public}
              onChange={(e) => setForm({ ...form, phone_public: e.target.checked })}
              style={{ width: '16px', height: '16px', accentColor: '#667eea', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Make visible to all classroom members
              <span style={{ display: 'block', fontSize: '11px', marginTop: '1px', color: 'var(--text-secondary)', opacity: 0.75 }}>
                If unchecked, only Class Representatives can see your number
              </span>
            </span>
          </label>
        </div>

        {msg && <p style={successMsgStyle}>{msg}</p>}
        {err && <p style={errorMsgStyle}>{err}</p>}

        <button type="submit" disabled={saving} style={primaryBtnStyle}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}

function PwInput({ value, onChange, placeholder = '', required = false, disabled = false }) {
  const inputRef = useRef(null);
  const show = () => { if (inputRef.current) inputRef.current.type = 'text'; };
  const hide = () => { if (inputRef.current) inputRef.current.type = 'password'; };
  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        style={{ ...inputStyle, paddingRight: '52px' }}
        type="password"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoComplete="new-password"
      />
      <button
        type="button"
        onPointerDown={(e) => { e.preventDefault(); show(); }}
        onPointerUp={hide}
        onPointerLeave={hide}
        tabIndex={-1}
        title="Hold to show password"
        style={{
          position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
          background: 'var(--bg-color)', border: '1px solid var(--border-color)',
          borderRadius: '5px', cursor: 'pointer',
          color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600,
          padding: '3px 8px', lineHeight: 1.3,
          userSelect: 'none',
        }}
      >
        <Eye size={13} strokeWidth={1.75} />
      </button>
    </div>
  );
}

function SecuritySection() {
  // ── Change Password ──
  const [pwStep, setPwStep] = useState(1); // 1=send OTP, 2=enter OTP+new pw
  const [pwSending, setPwSending] = useState(false);
  const [pwForm, setPwForm] = useState({ otp: '', current_password: '', new_password: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');

  // ── Change Email ──
  const [emStep, setEmStep] = useState(1); // 1=enter new email, 2=enter OTP
  const [emSending, setEmSending] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emOtp, setEmOtp] = useState('');
  const [emMsg, setEmMsg] = useState('');
  const [emErr, setEmErr] = useState('');

  const sendPasswordOtp = async () => {
    setPwSending(true);
    setPwErr('');
    setPwMsg('');
    try {
      const res = await settingsAPI.changePasswordRequest();
      setPwMsg(res.data.message);
      setPwStep(2);
    } catch (error) {
      setPwErr(error.response?.data?.error || 'Failed to send OTP.');
    } finally {
      setPwSending(false);
    }
  };

  const confirmPassword = async (e) => {
    e.preventDefault();
    if (pwForm.new_password !== pwForm.confirm) {
      setPwErr('New passwords do not match.');
      return;
    }
    setPwSending(true);
    setPwErr('');
    try {
      await settingsAPI.changePasswordConfirm({
        otp: pwForm.otp,
        current_password: pwForm.current_password,
        new_password: pwForm.new_password,
      });
      setPwMsg('Password changed successfully!');
      setPwStep(1);
      setPwForm({ otp: '', current_password: '', new_password: '', confirm: '' });
    } catch (error) {
      setPwErr(error.response?.data?.error || 'Failed to change password.');
    } finally {
      setPwSending(false);
    }
  };

  const sendEmailOtp = async () => {
    if (!newEmail) { setEmErr('Enter a new email address.'); return; }
    setEmSending(true);
    setEmErr('');
    setEmMsg('');
    try {
      const res = await settingsAPI.changeEmailRequest(newEmail);
      setEmMsg(res.data.message);
      setEmStep(2);
    } catch (error) {
      setEmErr(error.response?.data?.error || 'Failed to send OTP.');
    } finally {
      setEmSending(false);
    }
  };

  const confirmEmail = async (e) => {
    e.preventDefault();
    setEmSending(true);
    setEmErr('');
    try {
      await settingsAPI.changeEmailConfirm({ otp: emOtp });
      setEmMsg('Email changed successfully! Please log in again.');
      setEmStep(1);
      setNewEmail('');
      setEmOtp('');
    } catch (error) {
      setEmErr(error.response?.data?.error || 'Failed to change email.');
    } finally {
      setEmSending(false);
    }
  };

  return (
    <div>
      <h2 style={headingStyle}>Security</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

        {/* Change Password card */}
        <div style={cardStyle}>
          <h3 style={cardHeadingStyle}>Change Password</h3>
          {pwStep === 1 ? (
            <>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
                We'll send a 6-digit code to your email to verify the change.
              </p>
              {pwMsg && <p style={successMsgStyle}>{pwMsg}</p>}
              {pwErr && <p style={errorMsgStyle}>{pwErr}</p>}
              <button onClick={sendPasswordOtp} disabled={pwSending} style={primaryBtnStyle}>
                {pwSending ? 'Sending…' : 'Send OTP to my email'}
              </button>
            </>
          ) : (
            <form onSubmit={confirmPassword}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>OTP code</label>
                <input style={inputStyle} type="text" placeholder="6-digit code" value={pwForm.otp}
                  onChange={(e) => setPwForm({ ...pwForm, otp: e.target.value })} required />
              </div>
              {[
                { label: 'Current password', key: 'current_password', placeholder: '' },
                { label: 'New password', key: 'new_password', placeholder: 'Min 8 characters' },
                { label: 'Confirm new password', key: 'confirm', placeholder: '' },
              ].map(({ label, key, placeholder }) => (
                <div key={key} style={fieldGroupStyle}>
                  <label style={labelStyle}>{label}</label>
                  <PwInput
                    value={pwForm[key]}
                    onChange={(e) => setPwForm({ ...pwForm, [key]: e.target.value })}
                    placeholder={placeholder}
                    required
                    disabled={pwSending}
                  />
                </div>
              ))}
              {pwMsg && <p style={successMsgStyle}>{pwMsg}</p>}
              {pwErr && <p style={errorMsgStyle}>{pwErr}</p>}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" onClick={() => { setPwStep(1); setPwErr(''); setPwMsg(''); }} style={ghostBtnStyle}>
                  Back
                </button>
                <button type="submit" disabled={pwSending} style={primaryBtnStyle}>
                  {pwSending ? 'Saving…' : 'Change Password'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Change Email card */}
        <div style={cardStyle}>
          <h3 style={cardHeadingStyle}>Change Email</h3>
          {emStep === 1 ? (
            <>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>New email address</label>
                <input
                  style={inputStyle}
                  type="email"
                  placeholder="new@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
              {emMsg && <p style={successMsgStyle}>{emMsg}</p>}
              {emErr && <p style={errorMsgStyle}>{emErr}</p>}
              <button onClick={sendEmailOtp} disabled={emSending} style={primaryBtnStyle}>
                {emSending ? 'Sending…' : 'Send OTP'}
              </button>
            </>
          ) : (
            <form onSubmit={confirmEmail}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>OTP sent to {newEmail}</label>
                <input
                  style={inputStyle}
                  type="text"
                  placeholder="6-digit code"
                  value={emOtp}
                  onChange={(e) => setEmOtp(e.target.value)}
                  maxLength={6}
                  required
                />
              </div>
              {emMsg && <p style={successMsgStyle}>{emMsg}</p>}
              {emErr && <p style={errorMsgStyle}>{emErr}</p>}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" onClick={() => { setEmStep(1); setEmErr(''); setEmMsg(''); }} style={ghostBtnStyle}>
                  Back
                </button>
                <button type="submit" disabled={emSending} style={primaryBtnStyle}>
                  {emSending ? 'Verifying…' : 'Confirm Email Change'}
                </button>
              </div>
            </form>
          )}
        </div>

      </div>
    </div>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <h2 style={headingStyle}>Appearance</h2>
      <div style={cardStyle}>
        <h3 style={cardHeadingStyle}>Theme</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px' }}>
          Choose between light and dark mode. Your preference is saved across sessions.
        </p>
        <div style={{ display: 'flex', gap: '12px' }}>
          {['light', 'dark'].map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              style={{
                padding: '12px 28px',
                borderRadius: '10px',
                border: `2px solid ${theme === t ? '#667eea' : 'var(--border-color)'}`,
                background: theme === t ? '#667eea' : 'var(--card-bg)',
                color: theme === t ? 'white' : 'var(--text-primary)',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
        <p style={{ marginTop: '16px', color: 'var(--text-secondary)', fontSize: '13px' }}>
          Currently using: <strong style={{ color: 'var(--text-primary)' }}>{theme === 'light' ? 'Light mode' : 'Dark mode'}</strong>
        </p>
      </div>
    </div>
  );
}

function StorageSection() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    settingsAPI.getChatFiles()
      .then((res) => setFiles(res.data.files || []))
      .catch(() => setErr('Failed to load files.'))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (messageId, filename) => {
    if (!window.confirm(`Delete "${filename}"? This cannot be undone.`)) return;
    try {
      await settingsAPI.deleteChatFile(messageId);
      setFiles((prev) => prev.filter((f) => f.message_id !== messageId));
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to delete file.');
    }
  };

  // Group by classroom
  const byClassroom = files.reduce((acc, f) => {
    const key = f.classroom_name || f.classroom_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(f);
    return acc;
  }, {});

  return (
    <div>
      <h2 style={headingStyle}>Storage</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px' }}>
        Files you have uploaded in classroom chats. Deleting a file removes it from the server;
        the chat message text is preserved.
      </p>

      {loading && <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>}
      {err && <p style={errorMsgStyle}>{err}</p>}

      {!loading && files.length === 0 && (
        <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--text-secondary)', padding: '40px' }}>
          No files uploaded yet.
        </div>
      )}

      {Object.entries(byClassroom).map(([classroom, items]) => (
        <div key={classroom} style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px' }}>
            {classroom}
          </h3>
          <div style={cardStyle}>
            {items.map((f) => (
              <div
                key={f.message_id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border-color)',
                }}
              >
                <FileTypeIcon mime={f.mime_type} size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: '14px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.filename}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                    {formatBytes(f.size)} · {f.created_at ? new Date(f.created_at).toLocaleDateString() : ''}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(f.message_id, f.filename)}
                  style={{ ...ghostBtnStyle, color: '#ef4444', borderColor: '#ef4444', padding: '4px 10px', fontSize: '13px' }}
                  title="Delete file"
                >
                  <Trash2 size={14} strokeWidth={1.75} style={{ marginRight: '4px' }} /> Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PersonalDocumentsSection() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [label, setLabel] = useState('');
  const [pendingFile, setPendingFile] = useState(null); // file chosen but not yet uploaded
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    settingsAPI.listPersonalDocs()
      .then(r => setDocs(r.data.docs || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Step 1: file is chosen → hold it in state, don't upload yet
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    if (!label) setLabel(file.name.replace(/\.[^/.]+$/, '')); // pre-fill label from filename
  };

  // Step 2: user clicks Upload button
  const handleUpload = async () => {
    if (!pendingFile) return;
    setUploading(true);
    setErr('');
    try {
      const r = await settingsAPI.uploadPersonalDoc(pendingFile, label.trim() || pendingFile.name);
      setDocs(prev => [r.data.doc, ...prev]);
      setLabel('');
      setPendingFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Upload failed');
    } finally { setUploading(false); }
  };

  const handleDelete = async (docId, lbl) => {
    if (!window.confirm(`Delete "${lbl}"? This cannot be undone.`)) return;
    try {
      await settingsAPI.deletePersonalDoc(docId);
      setDocs(prev => prev.filter(d => d.id !== docId));
    } catch { setErr('Failed to delete'); }
  };

  const mimeIcon = (mime = '') => <FileTypeIcon mime={mime} size={22} />;

  return (
    <div>
      <h2 style={headingStyle}>Personal Documents</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
        Upload your official documents (ID, transcripts, certificates). Only <strong>you</strong> can access these — they are completely private.
      </p>

      {/* Upload card */}
      <div style={cardStyle}>
        <h3 style={cardHeadingStyle}>Upload Document</h3>
        {err && <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '10px' }}>{err}</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Step 1: choose file */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <label style={{
              ...primaryBtnStyle, cursor: 'pointer',
              opacity: uploading ? 0.6 : 1, flexShrink: 0,
            }}>
              Choose File
              <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleFileSelect} disabled={uploading} />
            </label>
            {pendingFile ? (
              <span style={{ fontSize: '13px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pendingFile.name}
              </span>
            ) : (
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Max 20 MB · PDF, images, Office files</span>
            )}
          </div>

          {/* Step 2: label (shown after file is chosen) */}
          {pendingFile && (
            <>
              <input
                style={inputStyle}
                type="text"
                placeholder="Label (e.g. Aadhar Card, Marksheet)"
                value={label}
                onChange={e => setLabel(e.target.value)}
                disabled={uploading}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  style={{ ...primaryBtnStyle, opacity: uploading ? 0.6 : 1 }}
                >
                  {uploading ? 'Uploading…' : 'Upload'}
                </button>
                <button
                  onClick={() => { setPendingFile(null); setLabel(''); if (fileRef.current) fileRef.current.value = ''; }}
                  disabled={uploading}
                  style={ghostBtnStyle}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Docs list */}
      <div style={cardStyle}>
        <h3 style={cardHeadingStyle}>Your Documents</h3>
        {loading ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Loading…</p>
        ) : docs.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>No documents uploaded yet.</p>
        ) : (
          <div>
            {docs.map(doc => (
              <div key={doc.id} style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '10px 0', borderBottom: '1px solid var(--border-color)',
              }}>
                {mimeIcon(doc.mime_type)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.label}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                    {doc.filename !== doc.label && <span>{doc.filename} · </span>}
                    {formatBytes(doc.size)} · {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : ''}
                  </div>
                </div>
                <a
                  href={settingsAPI.getPersonalDocUrl(doc.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ ...ghostBtnStyle, textDecoration: 'none', padding: '4px 10px', fontSize: '13px' }}
                >
                  Open
                </a>
                <button
                  onClick={() => handleDelete(doc.id, doc.label)}
                  style={{ ...ghostBtnStyle, color: '#ef4444', borderColor: '#ef4444', padding: '4px 10px', fontSize: '13px' }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectedServicesSection() {
  const [calStatus, setCalStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showConsent, setShowConsent] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    calendarAPI.getStatus()
      .then((res) => setCalStatus(res.data))
      .catch(() => setCalStatus(null))
      .finally(() => setLoading(false));
  }, []);

  const handleConnect = async () => {
    try {
      const res = await calendarAPI.getAuthUrl();
      window.location.href = res.data.auth_url;
    } catch {
      alert('Failed to get Google Calendar auth URL.');
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Google Calendar?')) return;
    setDisconnecting(true);
    try {
      await calendarAPI.disconnect();
      setCalStatus({ connected: false });
    } catch {
      alert('Failed to disconnect.');
    } finally {
      setDisconnecting(false);
    }
  };

  const isConnected = calStatus?.connected;

  return (
    <div>
      <h2 style={headingStyle}>Connected Services</h2>
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '44px', height: '44px', borderRadius: '10px',
            background: 'rgba(102,126,234,0.1)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: '24px', flexShrink: 0,
          }}>
            <Calendar size={24} strokeWidth={1.75} style={{ color: '#667eea' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Google Calendar</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
              {loading ? 'Checking status…' : isConnected ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><CheckCircle size={13} strokeWidth={1.75} color="#22c55e" /> Connected</span> : 'Not connected'}
            </div>
          </div>
          {!loading && (
            isConnected ? (
              <button onClick={handleDisconnect} disabled={disconnecting} style={ghostBtnStyle}>
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            ) : (
              <button onClick={() => setShowConsent(true)} style={primaryBtnStyle}>
                Connect
              </button>
            )
          )}
        </div>
      </div>

      {/* Consent modal */}
      {showConsent && (
        <div style={modalOverlayStyle} onClick={() => setShowConsent(false)}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: '16px', color: 'var(--text-primary)' }}>Connect Google Calendar</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
              Connecting Google Calendar will allow IAPS to:
            </p>
            <ul style={{ paddingLeft: '20px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '2', marginBottom: '24px' }}>
              <li>View your calendar events</li>
              <li>Create and edit events on your behalf</li>
              <li>Access is only used for schedule sync features</li>
            </ul>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowConsent(false)} style={ghostBtnStyle}>Cancel</button>
              <button onClick={() => { setShowConsent(false); handleConnect(); }} style={primaryBtnStyle}>
                Allow &amp; Connect →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── main Settings page ──────────────────────────────────────────────────────

function Settings({ user, onLogout, onProfileUpdate }) {
  const [activeSection, setActiveSection] = useState('Profile');
  const [localUser, setLocalUser] = useState(user);

  // Keep localUser in sync if parent updates user (e.g. after avatar upload)
  useEffect(() => { setLocalUser(user); }, [user]);

  const handleProfileUpdate = (updatedUser, newToken) => {
    setLocalUser(updatedUser);
    onProfileUpdate(updatedUser, newToken);
  };

  return (
    <div style={{
      display: 'flex',
      minHeight: 'calc(100vh - 56px)',
      background: 'var(--bg-color)',
    }}>
      {/* Sidebar */}
      <aside style={{
        width: '220px',
        flexShrink: 0,
        borderRight: '1px solid var(--border-color)',
        background: 'var(--card-bg)',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 0',
      }}>
        <div style={{ padding: '0 16px 24px', borderBottom: '1px solid var(--border-color)', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Avatar user={localUser} size={40} />
            <div>
              <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>{localUser.username}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{localUser.email}</div>
            </div>
          </div>
        </div>

        {SECTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '11px 20px',
              background: activeSection === s ? '#667eea15' : 'transparent',
              border: 'none',
              borderLeft: `3px solid ${activeSection === s ? '#667eea' : 'transparent'}`,
              color: activeSection === s ? '#667eea' : 'var(--text-primary)',
              fontWeight: activeSection === s ? 700 : 500,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}

        <div style={{ flex: 1 }} />
        <div style={{ padding: '0 16px' }}>
          <button
            onClick={onLogout}
            style={{
              ...ghostBtnStyle,
              width: '100%',
              justifyContent: 'center',
              color: '#ef4444',
              borderColor: '#ef4444',
            }}
          >
            Log out
          </button>
        </div>
      </aside>

      {/* Content */}
      <main style={{
        flex: 1,
        padding: '36px 40px',
        maxWidth: '800px',
        overflowY: 'auto',
      }}>
        {activeSection === 'Profile' && (
          <ProfileSection user={localUser} onProfileUpdate={handleProfileUpdate} />
        )}
        {activeSection === 'Security' && <SecuritySection />}
        {activeSection === 'Appearance' && <AppearanceSection />}
        {activeSection === 'Personal Documents' && <PersonalDocumentsSection />}
        {activeSection === 'Connected Services' && <ConnectedServicesSection />}
      </main>
    </div>
  );
}

export default Settings;

// ─── shared styles ───────────────────────────────────────────────────────────

const headingStyle = {
  fontSize: '22px',
  fontWeight: 700,
  color: 'var(--text-primary)',
  marginBottom: '24px',
};

const cardStyle = {
  background: 'var(--card-bg)',
  border: '1px solid var(--border-color)',
  borderRadius: '12px',
  padding: '20px',
  marginBottom: '20px',
};

const cardHeadingStyle = {
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: '12px',
};

const fieldGroupStyle = {
  marginBottom: '16px',
};

const labelStyle = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: '6px',
};

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: '8px',
  border: '1px solid var(--border-color)',
  background: 'var(--bg-color)',
  color: 'var(--text-primary)',
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box',
};

const primaryBtnStyle = {
  padding: '10px 22px',
  background: '#667eea',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  fontWeight: 600,
  fontSize: '14px',
  cursor: 'pointer',
};

const ghostBtnStyle = {
  padding: '9px 18px',
  background: 'transparent',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: '8px',
  fontWeight: 500,
  fontSize: '14px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
};

const smallBtnStyle = {
  padding: '5px 12px',
  background: 'transparent',
  color: '#667eea',
  border: '1px solid #667eea',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
};

const successMsgStyle = {
  color: '#10b981',
  fontSize: '13px',
  marginBottom: '10px',
};

const errorMsgStyle = {
  color: '#ef4444',
  fontSize: '13px',
  marginBottom: '10px',
};

const modalOverlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modalContentStyle = {
  background: 'var(--card-bg)',
  border: '1px solid var(--border-color)',
  borderRadius: '16px',
  padding: '32px',
  width: '420px',
  maxWidth: '90vw',
};
