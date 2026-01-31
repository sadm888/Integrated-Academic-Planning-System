import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { classroomAPI } from '../services/api';
import '../styles/Dashboard.css';

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [classrooms, setClassrooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [newClassroomName, setNewClassroomName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadClassrooms();
  }, []);

  const loadClassrooms = async () => {
    try {
      const response = await classroomAPI.getMyClassrooms();
      setClassrooms(response.data.classrooms);
    } catch (err) {
      setError('Failed to load classrooms');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateClassroom = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    try {
      await classroomAPI.create({ name: newClassroomName });
      setShowCreateModal(false);
      setNewClassroomName('');
      setSuccess('Classroom created successfully!');
      loadClassrooms();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create classroom');
    }
  };

  const handleJoinClassroom = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    try {
      await classroomAPI.join(joinCode);
      setShowJoinModal(false);
      setJoinCode('');
      setSuccess('Join request sent! Waiting for CR approval.');
      loadClassrooms();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join classroom');
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h1>IAPS Dashboard</h1>
        <div className="user-info">
          <span>Welcome, {user?.username}!</span>
          {!user?.isVerified && (
            <span className="verification-badge">Email Not Verified</span>
          )}
          <button onClick={handleLogout} className="btn-secondary">
            Logout
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="actions-bar">
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary"
          >
            Create Classroom
          </button>
          <button
            onClick={() => setShowJoinModal(true)}
            className="btn-primary"
          >
            Join Classroom
          </button>
          <button
            onClick={() => navigate('/about')}
            className="btn-secondary"
          >
            About IAPS
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

        <section className="classrooms-section">
          <h2>My Classrooms</h2>
          {classrooms.length === 0 ? (
            <div className="empty-state">
              <p>No classrooms yet. Create or join one to get started!</p>
            </div>
          ) : (
            <div className="classrooms-grid">
              {classrooms.map((classroom) => (
                <div key={classroom._id} className="classroom-card">
                  <h3>{classroom.name}</h3>
                  <div className="classroom-info">
                    <p>Join Code: <strong>{classroom.joinCode}</strong></p>
                    <p>Members: {classroom.memberCount}</p>
                    {classroom.isCR && <span className="cr-badge">CR</span>}
                  </div>
                  <button
                    onClick={() => navigate(`/classroom/${classroom._id}`)}
                    className="btn-primary"
                  >
                    Open Classroom
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Create Classroom Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Classroom</h2>
            <form onSubmit={handleCreateClassroom}>
              <div className="form-group">
                <label>Classroom Name</label>
                <input
                  type="text"
                  value={newClassroomName}
                  onChange={(e) => setNewClassroomName(e.target.value)}
                  required
                  placeholder="e.g., CS 2024 Section A"
                />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn-primary">
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join Classroom Modal */}
      {showJoinModal && (
        <div className="modal-overlay" onClick={() => setShowJoinModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Join Classroom</h2>
            <form onSubmit={handleJoinClassroom}>
              <div className="form-group">
                <label>Join Code</label>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  required
                  placeholder="ABC123"
                  maxLength={6}
                />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn-primary">
                  Join
                </button>
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;