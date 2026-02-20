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
  removeMember: (classroomId, userId) => api.post(`/classroom/${classroomId}/remove-member`, { user_id: userId }),
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

// Document endpoints
export const documentAPI = {
  upload: (formData) => api.post('/document/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  list: (semesterId, params) => api.get(`/document/semester/${semesterId}/list`, { params }),
  delete: (documentId) => api.delete(`/document/${documentId}`),
  toggleAI: (documentId) => api.patch(`/document/${documentId}/toggle-ai`),
};

// Todo endpoints
export const todoAPI = {
  create: (data) => api.post('/todo/create', data),
  list: (semesterId) => api.get(`/todo/semester/${semesterId}/list`),
  toggle: (todoId) => api.patch(`/todo/${todoId}/toggle`),
  delete: (todoId) => api.delete(`/todo/${todoId}`),
};

// Subject endpoints
export const subjectAPI = {
  create: (data) => api.post('/subject/create', data),
  list: (semesterId) => api.get(`/subject/semester/${semesterId}/list`),
  delete: (subjectId) => api.delete(`/subject/${subjectId}`),
};

// AI endpoints (stubs)
export const aiAPI = {
  summary: (data) => api.post('/ai/summary', data),
  flashcards: (data) => api.post('/ai/flashcards', data),
  quiz: (data) => api.post('/ai/quiz', data),
  explain: (data) => api.post('/ai/explain', data),
};

export default api;
