import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Classrooms from './pages/Classrooms';
import ClassroomDetail from './pages/ClassroomDetail';
import InviteAccept from './pages/InviteAccept';
import { classroomAPI } from './services/api';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');

    if (token && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  const handleAuthSuccess = async (userData, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);

    // Check for a pending invite token (from email invite link before signup)
    const pendingToken = localStorage.getItem('pendingInviteToken');
    if (pendingToken) {
      localStorage.removeItem('pendingInviteToken');
      try {
        await classroomAPI.acceptInvite(pendingToken);
      } catch (err) {
        console.error('Failed to auto-accept invite:', err);
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '18px',
        color: '#667eea'
      }}>
        Loading...
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route
          path="/login"
          element={
            user ? (
              <Navigate to="/classrooms" replace />
            ) : (
              <Login onAuthSuccess={handleAuthSuccess} />
            )
          }
        />
        <Route
          path="/signup"
          element={
            user ? (
              <Navigate to="/classrooms" replace />
            ) : (
              <Signup onAuthSuccess={handleAuthSuccess} />
            )
          }
        />
        <Route
          path="/invite"
          element={<InviteAccept user={user} />}
        />
        <Route
          path="/classrooms"
          element={
            user ? (
              <Classrooms user={user} onLogout={handleLogout} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/classroom/:classroomId"
          element={
            user ? (
              <ClassroomDetail user={user} onLogout={handleLogout} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/"
          element={<Navigate to={user ? "/classrooms" : "/login"} replace />}
        />
        <Route
          path="*"
          element={<Navigate to={user ? "/classrooms" : "/login"} replace />}
        />
      </Routes>
    </Router>
  );
}

export default App;
