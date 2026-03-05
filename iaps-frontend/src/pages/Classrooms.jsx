import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { classroomAPI } from '../services/api';
import '../styles/Classroom.css';

function Classrooms({ user }) {
  const navigate = useNavigate();
  const [classrooms, setClassrooms] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, name }
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [newClassroom, setNewClassroom] = useState({
    name: '',
    description: '',
    semester_number: '',
    semester_type: 'odd',
    year: '',
    session: '',
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
      const res = await classroomAPI.list();
      setClassrooms(res.data.classrooms || []);
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
      setNewClassroom({ name: '', description: '', semester_number: '', semester_type: 'odd', year: '', session: '' });
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

  const handleDeleteClassroom = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await classroomAPI.delete(deleteTarget.id);
      setDeleteTarget(null);
      fetchClassrooms();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete classroom');
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
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
                  placeholder="e.g., CSE 2nd Year Section A"
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newClassroom.description}
                  onChange={(e) => setNewClassroom({ ...newClassroom, description: e.target.value })}
                  placeholder="Brief description of the classroom"
                  rows="3"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Semester Number</label>
                <input
                  type="number"
                  min="1"
                  value={newClassroom.semester_number}
                  onChange={(e) => setNewClassroom({ ...newClassroom, semester_number: e.target.value })}
                  placeholder="e.g., 1"
                  disabled={loading}
                />
                <small>Which semester is this? (1st, 2nd, 3rd...)</small>
              </div>

              <div className="form-group">
                <label>First Semester Type *</label>
                <select
                  value={newClassroom.semester_type}
                  onChange={(e) => setNewClassroom({ ...newClassroom, semester_type: e.target.value })}
                  disabled={loading}
                >
                  <option value="odd">Odd</option>
                  <option value="even">Even</option>
                </select>
              </div>

              <div className="form-group">
                <label>Year</label>
                <input
                  type="text"
                  value={newClassroom.year}
                  onChange={(e) => setNewClassroom({ ...newClassroom, year: e.target.value })}
                  placeholder="e.g., 2024-2025"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Session</label>
                <input
                  type="text"
                  value={newClassroom.session}
                  onChange={(e) => setNewClassroom({ ...newClassroom, session: e.target.value })}
                  placeholder="e.g., Jul-Dec"
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

      {/* Delete Classroom Confirmation Modal */}
      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Classroom</h2>
            <p style={{ margin: '12px 0 20px', color: 'var(--text-secondary)' }}>
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>?
              This will permanently remove all semesters, subjects, messages, files, and other data.
              This cannot be undone.
            </p>
            <div className="modal-buttons">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteClassroom}
                disabled={deleteLoading}
                style={{ background: '#ef4444', color: 'white', border: 'none' }}
              >
                {deleteLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
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
