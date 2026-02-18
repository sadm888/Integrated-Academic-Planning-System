import axios from 'axios';

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000') + '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - attach Bearer token from localStorage
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth endpoints
export const authAPI = {
  signup: (data) => api.post('/auth/signup', data),
  login: (data) => api.post('/auth/login', data),
  verify: () => api.get('/auth/verify'),
};

// Classroom endpoints
export const classroomAPI = {
  create: (data) => api.post('/classroom/create', data),
  join: (code) => api.post('/classroom/join/request', { code }),
  approve: (classroomId, userId) => api.post(`/classroom/${classroomId}/approve`, { user_id: userId }),
  reject: (classroomId, userId) => api.post(`/classroom/${classroomId}/reject`, { user_id: userId }),
  delete: (classroomId) => api.delete(`/classroom/${classroomId}`),
  list: () => api.get('/classroom/list'),
  getDetails: (classroomId) => api.get(`/classroom/${classroomId}`),
  invite: (classroomId, email) => api.post(`/classroom/${classroomId}/invite`, { email }),
  acceptInvite: (token) => api.post('/classroom/accept-invite', { token }),
};

// Semester endpoints
export const semesterAPI = {
  create: (data) => api.post('/semester/create', data),
  list: (classroomId) => api.get(`/semester/classroom/${classroomId}/list`),
  delete: (semesterId) => api.delete(`/semester/${semesterId}`),
  addCR: (semesterId, userId) => api.post(`/semester/${semesterId}/add-cr`, { user_id: userId }),
  removeCR: (semesterId, userId) => api.post(`/semester/${semesterId}/remove-cr`, { user_id: userId }),
};

export default api;
