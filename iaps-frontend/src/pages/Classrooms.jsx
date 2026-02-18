import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { classroomAPI } from '../services/api';
import '../styles/Classroom.css';

function Classrooms({ user, onLogout }) {
  const navigate = useNavigate();
  const [classrooms, setClassrooms] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [newClassroom, setNewClassroom] = useState({
    name: '',
    description: '',
    subject: ''
  });
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchClassrooms();
  }, []);

  const fetchClassrooms = async () => {
    try {
      const response = await classroomAPI.list();
      setClassrooms(response.data.classrooms || []);
    } catch (err) {
      console.error('Failed to fetch classrooms:', err);
    }
  };

  const handleCreateClassroom = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const response = await classroomAPI.create(newClassroom);
      setSuccess(`Classroom created! Code: ${response.data.classroom.code}`);
      setNewClassroom({ name: '', description: '', subject: '' });
      setShowCreateModal(false);
      fetchClassrooms();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create classroom');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinClassroom = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const response = await classroomAPI.join(joinCode);
      setSuccess(response.data.message || 'Join request sent! A CR will approve your request.');
      setJoinCode('');
      setShowJoinModal(false);
      fetchClassrooms();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send join request');
    } finally {
      setLoading(false);
    }
  };

  const ClassroomCard = ({ classroom }) => (
    <div
      className="classroom-card"
      onClick={() => navigate(`/classroom/${classroom.id}`)}
    >
      <div className="classroom-header">
        <h3>{classroom.name}</h3>
        {classroom.is_cr && (
          <span className="classroom-badge teacher">CR</span>
        )}
      </div>
      {classroom.subject && (
        <p className="classroom-subject">{classroom.subject}</p>
      )}
      {classroom.description && (
        <p className="classroom-description">{classroom.description}</p>
      )}
      <div className="classroom-footer">
        <span className="student-count">
          {classroom.member_count} member{classroom.member_count !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );

  return (
    <div className="classroom-container">
      <div className="classroom-header-section">
        <h1>My Classrooms</h1>
        <div className="action-buttons">
          <button
            className="btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            Create Classroom
          </button>
          <button
            className="btn-secondary"
            onClick={() => setShowJoinModal(true)}
          >
            Join Classroom
          </button>
          <button
            className="btn-secondary"
            onClick={onLogout}
          >
            Logout
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="classrooms-section">
        <div className="classrooms-grid">
          {classrooms.length > 0 ? (
            classrooms.map(classroom => (
              <ClassroomCard
                key={classroom.id}
                classroom={classroom}
              />
            ))
          ) : (
            <p className="no-classrooms">No classrooms yet. Create one or join using a code!</p>
          )}
        </div>
      </div>

      {/* Create Classroom Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Classroom</h2>
            <form onSubmit={handleCreateClassroom}>
              <div className="form-group">
                <label>Classroom Name *</label>
                <input
                  type="text"
                  value={newClassroom.name}
                  onChange={(e) => setNewClassroom({
                    ...newClassroom,
                    name: e.target.value
                  })}
                  placeholder="e.g., Mathematics 101"
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Subject</label>
                <input
                  type="text"
                  value={newClassroom.subject}
                  onChange={(e) => setNewClassroom({
                    ...newClassroom,
                    subject: e.target.value
                  })}
                  placeholder="e.g., Mathematics"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newClassroom.description}
                  onChange={(e) => setNewClassroom({
                    ...newClassroom,
                    description: e.target.value
                  })}
                  placeholder="Brief description of the classroom"
                  rows="3"
                  disabled={loading}
                />
              </div>

              <div className="modal-buttons">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button type="submit" disabled={loading}>
                  {loading ? 'Creating...' : 'Create'}
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
                <label>Classroom Code *</label>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="Enter 6-digit code"
                  maxLength="6"
                  required
                  disabled={loading}
                  style={{ textTransform: 'uppercase' }}
                />
                <small>Ask your CR for the classroom code</small>
              </div>

              <div className="modal-buttons">
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button type="submit" disabled={loading}>
                  {loading ? 'Requesting...' : 'Request to Join'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Classrooms;
