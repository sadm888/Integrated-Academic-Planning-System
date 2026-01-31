import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './Classroom.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

function Classroom() {
  const [classrooms, setClassrooms] = useState({
    teacher: [],
    student: []
  });
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

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };
  };

  useEffect(() => {
    fetchClassrooms();
  }, []);

  const fetchClassrooms = async () => {
    try {
      const response = await axios.get(
        `${API_URL}/api/classroom/list`,
        getAuthHeaders()
      );
      setClassrooms({
        teacher: response.data.teacher_classrooms,
        student: response.data.student_classrooms
      });
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
      const response = await axios.post(
        `${API_URL}/api/classroom/create`,
        newClassroom,
        getAuthHeaders()
      );

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
      await axios.post(
        `${API_URL}/api/classroom/join`,
        { code: joinCode },
        getAuthHeaders()
      );

      setSuccess('Successfully joined classroom!');
      setJoinCode('');
      setShowJoinModal(false);
      fetchClassrooms();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join classroom');
    } finally {
      setLoading(false);
    }
  };

  const ClassroomCard = ({ classroom, isTeacher }) => (
    <div className="classroom-card">
      <div className="classroom-header">
        <h3>{classroom.name}</h3>
        {isTeacher && (
          <span className="classroom-badge teacher">Teacher</span>
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
          {classroom.student_count} student{classroom.student_count !== 1 ? 's' : ''}
        </span>
        {isTeacher && classroom.code && (
          <span className="classroom-code">Code: {classroom.code}</span>
        )}
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
        <h2>Teaching</h2>
        <div className="classrooms-grid">
          {classrooms.teacher.length > 0 ? (
            classrooms.teacher.map(classroom => (
              <ClassroomCard 
                key={classroom.id} 
                classroom={classroom} 
                isTeacher={true}
              />
            ))
          ) : (
            <p className="no-classrooms">No classrooms yet. Create one to get started!</p>
          )}
        </div>
      </div>

      <div className="classrooms-section">
        <h2>Enrolled</h2>
        <div className="classrooms-grid">
          {classrooms.student.length > 0 ? (
            classrooms.student.map(classroom => (
              <ClassroomCard 
                key={classroom.id} 
                classroom={classroom} 
                isTeacher={false}
              />
            ))
          ) : (
            <p className="no-classrooms">Not enrolled in any classrooms. Join one using a code!</p>
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
                <small>Ask your teacher for the classroom code</small>
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
                  {loading ? 'Joining...' : 'Join'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Classroom;