import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for debugging
api.interceptors.request.use(
  (config) => {
    console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
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
      // Unauthorized - redirect to login
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth endpoints
export const authAPI = {
  signup: (data) => api.post('/auth/signup', data),
  login: (data) => api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  verifyEmail: (token) => api.post('/auth/verify-email', { token }),
  resendVerification: (email) => api.post('/auth/resend-verification', { email }),
  getCurrentUser: () => api.get('/auth/me'),
};

// Classroom endpoints
export const classroomAPI = {
  create: (data) => api.post('/classroom/create', data),
  join: (joinCode) => api.post('/classroom/join', { joinCode }),
  getMyClassrooms: () => api.get('/classroom/my-classrooms'),
  getDetails: (classroomId) => api.get(`/classroom/${classroomId}`),
  approveRequest: (classroomId, userId) =>
    api.post(`/classroom/${classroomId}/approve-request`, { userId }),
  rejectRequest: (classroomId, userId) =>
    api.post(`/classroom/${classroomId}/reject-request`, { userId }),
  sendInvite: (classroomId, email) =>
    api.post(`/classroom/${classroomId}/invite`, { email }),
};

// Semester endpoints
export const semesterAPI = {
  create: (data) => api.post('/semester/create', data),
  list: (classroomId) => api.get(`/semester/classroom/${classroomId}/list`),
  get: (semesterId) => api.get(`/semester/${semesterId}`),
  addCR: (semesterId, userId) =>
    api.post(`/semester/${semesterId}/add-cr`, { userId }),
  removeCR: (semesterId, userId) =>
    api.post(`/semester/${semesterId}/remove-cr`, { userId }),
  switchActive: (semesterId) =>
    api.post(`/semester/${semesterId}/switch-active`),
};

// Document endpoints
export const documentAPI = {
  upload: (formData) =>
    api.post('/document/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  list: (semesterId, params) =>
    api.get(`/document/semester/${semesterId}/list`, { params }),
  delete: (documentId) => api.delete(`/document/${documentId}`),
  toggleAI: (documentId) => api.patch(`/document/${documentId}/toggle-ai`),
};

// AI endpoints (stubs)
export const aiAPI = {
  generateSummary: (data) => api.post('/ai/summary', data),
  generateFlashcards: (data) => api.post('/ai/flashcards', data),
  generateQuiz: (data) => api.post('/ai/quiz', data),
  explainConcept: (data) => api.post('/ai/explain', data),
};

export default api;