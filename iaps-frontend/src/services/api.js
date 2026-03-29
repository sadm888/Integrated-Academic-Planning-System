import axios from 'axios';

export const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const API_BASE_URL = BACKEND_URL + '/api';

/** Build an authenticated file URL (token passed as query param for direct browser fetch). */
function fileUrl(path) {
  const token = localStorage.getItem('token') || '';
  return `${BACKEND_URL}/api/${path}?token=${encodeURIComponent(token)}`;
}

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
    // Only force-logout on 401 when the user is already logged in (has a token).
    // Never redirect on auth endpoints like /login or /signup — those legitimately return 401.
    const isAuthEndpoint = error.config?.url?.includes('/auth/');
    if (error.response?.status === 401 && !isAuthEndpoint && localStorage.getItem('token')) {
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
  leave: (classroomId) => api.post(`/classroom/${classroomId}/leave`),
  list: () => api.get('/classroom/list'),
  getDetails: (classroomId) => api.get(`/classroom/${classroomId}`),
  removeMember: (classroomId, userId, reason = '') => api.post(`/classroom/${classroomId}/remove-member`, { user_id: userId, reason }),
  removeMemberAvatar: (classroomId, userId, reason) => api.post(`/classroom/${classroomId}/remove-member-avatar`, { user_id: userId, reason }),
  flagMemberName: (classroomId, userId, reason) => api.post(`/classroom/${classroomId}/flag-member-name`, { user_id: userId, reason }),
  flagMemberBio: (classroomId, userId, reason) => api.post(`/classroom/${classroomId}/flag-member-bio`, { user_id: userId, reason }),
  delete: (classroomId) => api.delete(`/classroom/${classroomId}`),
  getActivity: (classroomId) => api.get(`/classroom/${classroomId}/activity`),
  quitCr: (classroomId, semesterId) => api.post(`/classroom/${classroomId}/semester/${semesterId}/quit-cr`),
  getCrNotifications: (classroomId) => api.get(`/classroom/${classroomId}/cr-notifications`),
  getPendingNominations: (classroomId) => api.get(`/classroom/${classroomId}/pending-nominations`),
};

// Semester endpoints
export const semesterAPI = {
  create: (data) => api.post('/semester/create', data),
  list: (classroomId) => api.get(`/semester/classroom/${classroomId}/list`),
  getDetail: (semesterId) => api.get(`/semester/${semesterId}`),
  delete: (semesterId) => api.delete(`/semester/${semesterId}`),
  addCR: (semesterId, userId) => api.post(`/semester/${semesterId}/add-cr`, { user_id: userId }),
  removeCR: (semesterId, userId) => api.post(`/semester/${semesterId}/remove-cr`, { user_id: userId }),
  nominateCr: (semesterId, userId) => api.post(`/semester/${semesterId}/nominate-cr`, { user_id: userId }),
  nominateAddCr: (semesterId, userId) => api.post(`/semester/${semesterId}/nominate-add-cr`, { user_id: userId }),
  acceptCr: (semesterId) => api.post(`/semester/${semesterId}/accept-cr`),
  declineCr: (semesterId) => api.post(`/semester/${semesterId}/decline-cr`),
  getCrNotifications: (semesterId) => api.get(`/semester/${semesterId}/cr-notifications`),
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
  update: (subjectId, data) => api.patch(`/subject/${subjectId}`, data),
  syncFromTimetable: (semesterId) => api.post(`/subject/semester/${semesterId}/sync-from-timetable`),
};

// Marks endpoints
export const marksAPI = {
  getStructure: (subjectId) => api.get(`/marks/structure/${subjectId}`),
  saveStructure: (subjectId, data) => api.post(`/marks/structure/${subjectId}`, data),
  getMyMarks: (subjectId) => api.get(`/marks/my/${subjectId}`),
  saveMyMarks: (subjectId, data) => api.post(`/marks/my/${subjectId}`, data),
  listAnalytics: (subjectId) => api.get(`/marks/analytics/${subjectId}`),
  uploadAnalytics: (subjectId, formData, visibility = 'public') => {
    formData.append('visibility', visibility);
    return api.post(`/marks/analytics/${subjectId}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  deleteAnalytics: (subjectId, fileId) => api.delete(`/marks/analytics/${subjectId}/${fileId}`),
  updateAnalyticsVisibility: (subjectId, fileId, visibility) => api.post(`/marks/analytics/${subjectId}/${fileId}/visibility`, { visibility }),
  analyticsFileUrl: (fileId) => fileUrl(`marks/analytics/file/${fileId}`),
};

// Google Calendar endpoints
export const calendarAPI = {
  getAuthUrl: () => api.get('/calendar/auth-url'),
  getStatus: () => api.get('/calendar/status'),
  disconnect: () => api.delete('/calendar/disconnect'),
  listEvents: (timeMin, timeMax) =>
    api.get('/calendar/events', { params: { time_min: timeMin, time_max: timeMax } }),
  createEvent: (data) => api.post('/calendar/events', data),
  updateEvent: (eventId, data) => api.patch(`/calendar/events/${eventId}`, data),
  deleteEvent: (eventId) => api.delete(`/calendar/events/${eventId}`),
};

// Chat endpoints
export const chatAPI = {
  getMessages: (semesterId, limit = 50, beforeId = null) =>
    api.get(`/chat/${semesterId}/messages`, { params: { limit, ...(beforeId && { before_id: beforeId }) } }),
  uploadFile: (semesterId, file, text = '', replyToId = null) => {
    const fd = new FormData();
    fd.append('file', file);
    if (text) fd.append('text', text);
    if (replyToId) fd.append('reply_to_id', replyToId);
    return api.post(`/chat/${semesterId}/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getFileUrl: (messageId) => fileUrl(`chat/file/${messageId}`),
  deleteMessage: (semesterId, messageId, mode = '') =>
    api.delete(`/chat/${semesterId}/messages/${messageId}`, { params: mode ? { mode } : {} }),
  warnUser: (semesterId, userId, reason, messageId, warnType = 'chat') => api.post(`/chat/${semesterId}/warn`, { user_id: userId, reason, message_id: messageId, warn_type: warnType }),
  getMyWarnings: () => api.get('/chat/my-warnings'),
  dismissWarning: (warningId) => api.post(`/chat/my-warnings/${warningId}/dismiss`),
  pinMessage: (semesterId, messageId) => api.post(`/chat/${semesterId}/pin`, { message_id: messageId }),
  unpinMessage: (semesterId, messageId = null) =>
    api.delete(`/chat/${semesterId}/pin`, { params: messageId ? { message_id: messageId } : {} }),
  getUnreadCounts: () => api.get('/chat/unread-counts'),
  markRead: (semesterId) => api.post(`/chat/${semesterId}/read`),
  getOnlineMembers: (semesterId) => api.get(`/chat/${semesterId}/online-members`),
  getOnlineStatus: (userIds) => api.get('/chat/online-status', { params: { user_ids: userIds } }),
  searchMessages: (semesterId, q) => api.get(`/chat/${semesterId}/search`, { params: { q } }),
  createPoll: (semesterId, question, options) => api.post(`/chat/${semesterId}/polls`, { question, options }),
  votePoll: (semesterId, messageId, optionIndex) => api.post(`/chat/${semesterId}/polls/${messageId}/vote`, { option_index: optionIndex }),
  closePoll: (semesterId, messageId) => api.post(`/chat/${semesterId}/polls/${messageId}/close`),
  reactToMessage: (semesterId, messageId, emoji) => api.post(`/chat/${semesterId}/messages/${messageId}/react`, { emoji }),
  getReadReceipts: (semesterId) => api.get(`/chat/${semesterId}/read-receipts`),
};

// Settings endpoints
export const settingsAPI = {
  getMe: () => api.get('/settings/me'),
  updateProfile: (data) => api.patch('/settings/update-profile', data),
  updatePrivacy: (data) => api.patch('/settings/privacy', data),
  uploadAvatar: (file) => {
    const fd = new FormData();
    fd.append('avatar', file);
    return api.post('/settings/upload-avatar', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getAvatarUrl: (userId) => `${BACKEND_URL}/api/settings/avatar/${userId}`,
  getSignedAvatarUrl: async (userId) => {
    const res = await api.get(`/settings/avatar-token/${userId}`);
    return `${BACKEND_URL}/api/settings/avatar/full/${userId}?sig=${res.data.token}`;
  },
  changePassword: (data) => api.post('/settings/change-password', data),
  getChatFiles: () => api.get('/settings/chat-files'),
  deleteChatFile: (messageId) => api.delete(`/settings/chat-file/${messageId}`),
  acknowledgePhotoRemoval: () => api.post('/settings/acknowledge-photo-removal'),
  listPersonalDocs: () => api.get('/settings/personal-docs'),
  uploadPersonalDoc: (file, label) => {
    const fd = new FormData();
    fd.append('file', file);
    if (label) fd.append('label', label);
    return api.post('/settings/personal-docs/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  getPersonalDocUrl: (docId) => fileUrl(`settings/personal-docs/${docId}`),
  deletePersonalDoc: (docId) => api.delete(`/settings/personal-docs/${docId}`),
  verifyPassword: (password) => api.post('/settings/verify-password', { password }),
  getLoginActivity: () => api.get('/settings/login-activity'),
};

// Links endpoints
export const linksAPI = {
  list: (semesterId) => api.get(`/semester/${semesterId}/links`),
  add: (semesterId, label, url) => api.post(`/semester/${semesterId}/links`, { label, url }),
  delete: (semesterId, linkId) => api.delete(`/semester/${semesterId}/links/${linkId}`),
};

// Announcement endpoints
export const announcementAPI = {
  list: (semesterId) => api.get(`/announcement/semester/${semesterId}`),
  create: (semesterId, text) => api.post(`/announcement/semester/${semesterId}`, { text }),
  delete: (announcementId) => api.delete(`/announcement/${announcementId}`),
};

// Schedule request endpoints
export const scheduleAPI = {
  create: (data) => api.post('/schedule/create', data),
  listForClassroom: (classroomId) => api.get(`/schedule/classroom/${classroomId}`),
  deleteRequest: (requestId) => api.delete(`/schedule/request/${requestId}`),
  pullRequest: (requestId) => api.post(`/schedule/request/${requestId}/pull`),
  pullAll: (classroomId) => api.post(`/schedule/classroom/${classroomId}/pull-all`),
};

// Academic endpoints
export const academicAPI = {
  getMySemesters: () => api.get('/academics/my-semesters'),
  getAllResources: () => api.get('/academics/all-resources'),
  getSubjectSections: (semesterId, subjectId) =>
    api.get(`/academics/${semesterId}/subjects/${subjectId}/sections`),
  createSubjectSection: (semesterId, subjectId, name) =>
    api.post(`/academics/${semesterId}/subjects/${subjectId}/sections`, { name }),
  deleteSubjectSection: (semesterId, subjectId, sectionId) =>
    api.delete(`/academics/${semesterId}/subjects/${subjectId}/sections/${sectionId}`),
  toggleSection: (semesterId, subjectId, sectionId) =>
    api.post(`/academics/${semesterId}/subjects/${subjectId}/sections/${sectionId}/toggle`),
  userHideSection: (semesterId, subjectId, sectionId) =>
    api.post(`/academics/${semesterId}/subjects/${subjectId}/sections/${sectionId}/user-hide`),
  lockSection: (semesterId, subjectId, sectionId) =>
    api.post(`/academics/${semesterId}/subjects/${subjectId}/sections/${sectionId}/lock`),
  getFolders: (semesterId, subjectId, sectionId) =>
    api.get(`/academics/${semesterId}/subjects/${subjectId}/sections/${sectionId}/folders`),
  createFolder: (semesterId, subjectId, sectionId, name) =>
    api.post(`/academics/${semesterId}/subjects/${subjectId}/sections/${sectionId}/folders`, { name }),
  deleteFolder: (semesterId, subjectId, sectionId, folderId) =>
    api.delete(`/academics/${semesterId}/subjects/${subjectId}/sections/${sectionId}/folders/${folderId}`),
  getResources: (semesterId, params) => api.get(`/academics/${semesterId}/resources`, { params }),
  upload: (semesterId, file, subjectId, category, onUploadProgress, folderId, isPublic = true) => {
    const fd = new FormData();
    fd.append('file', file);
    if (subjectId) fd.append('subject_id', subjectId);
    fd.append('category', category);
    if (folderId) fd.append('folder_id', folderId);
    fd.append('is_public', isPublic ? 'true' : 'false');
    return api.post(`/academics/${semesterId}/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    });
  },
  toggleResourcePublic: (semesterId, resourceId) =>
    api.patch(`/academics/${semesterId}/resources/${resourceId}/toggle-public`),
  hideResource: (semesterId, resourceId) =>
    api.post(`/academics/${semesterId}/resources/${resourceId}/hide`),
  linkChatFile: (semesterId, chatMessageId, subjectId, category, folderId) =>
    api.post(`/academics/${semesterId}/link-chat-file`, {
      chat_message_id: chatMessageId,
      subject_id: subjectId || null,
      category,
      ...(folderId ? { folder_id: folderId } : {}),
    }),
  moveResource: (semesterId, resourceId, updates) =>
    api.patch(`/academics/${semesterId}/resources/${resourceId}`, updates),
  deleteResource: (semesterId, resourceId) =>
    api.delete(`/academics/${semesterId}/resources/${resourceId}`),
  getChatFiles: (semesterId) => api.get(`/academics/${semesterId}/chat-files`),
  getFileUrl: (resourceId) => fileUrl(`academics/file/${resourceId}`),
};

// DM (direct message) endpoints
export const dmAPI = {
  sendMessage: (classroomId, toUserId, text, extra = {}) =>
    api.post(`/dm/${classroomId}/send`, { to_user_id: toUserId, text, ...extra }),
  uploadFile: (classroomId, toUserId, file, text = '') => {
    const fd = new FormData();
    fd.append('file', file);
    if (text) fd.append('text', text);
    return api.post(`/dm/${classroomId}/upload/${toUserId}`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getThread: (classroomId, withUserId, limit = 50, beforeId = null) =>
    api.get(`/dm/${classroomId}/thread/${withUserId}`, {
      params: { limit, ...(beforeId && { before_id: beforeId }) },
    }),
  markRead: (classroomId, withUserId) =>
    api.post(`/dm/${classroomId}/thread/${withUserId}/read`),
  getUnreadCount: () => api.get('/dm/unread-count'),
  deleteMessage: (classroomId, messageId, mode = '') =>
    api.delete(`/dm/${classroomId}/messages/${messageId}`, { params: mode ? { mode } : {} }),
  getDmFileUrl: (messageId) => fileUrl(`dm/file/${messageId}`),
  getMemberStats: (classroomId) => api.get(`/dm/${classroomId}/member-stats`),
  getUnreadBySender: (classroomId) => api.get(`/dm/${classroomId}/unread-by-sender`),
  getUnreadByClassroom: () => api.get('/dm/unread-by-classroom'),
  reactToDm: (classroomId, messageId, emoji) => api.post(`/dm/${classroomId}/messages/${messageId}/react`, { emoji }),
  pinDm: (classroomId, messageId) => api.post(`/dm/${classroomId}/messages/${messageId}/pin`),
};

// Timetable endpoints
export const timetableAPI = {
  // Base timetable
  extract: (semesterId, formData) =>
    api.post(`/timetable/semester/${semesterId}/extract`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  save: (semesterId, data) => api.post(`/timetable/semester/${semesterId}`, data),
  get: (semesterId) => api.get(`/timetable/semester/${semesterId}`),
  getWeek: (semesterId, date) =>
    api.get(`/timetable/semester/${semesterId}/week`, { params: date ? { date } : {} }),
  getToday: (semesterId) => api.get(`/timetable/semester/${semesterId}/today`),

  // Overrides
  addOverride: (semesterId, data) => api.post(`/timetable/semester/${semesterId}/override`, data),
  deleteOverride: (semesterId, overrideId) =>
    api.delete(`/timetable/semester/${semesterId}/override/${overrideId}`),
  listOverrides: (semesterId) => api.get(`/timetable/semester/${semesterId}/overrides`),
  pushToCalendar: (semesterId, data) =>
    api.post(`/timetable/semester/${semesterId}/push-to-calendar`, data),

  // Academic calendar
  extractAcademicCalendar: (semesterId, formData) =>
    api.post(`/timetable/semester/${semesterId}/academic-calendar/extract`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  saveAcademicCalendar: (semesterId, data) =>
    api.post(`/timetable/semester/${semesterId}/academic-calendar`, data),
  getAcademicCalendar: (semesterId) =>
    api.get(`/timetable/semester/${semesterId}/academic-calendar`),
  pushAcademicCalendar: (semesterId) =>
    api.post(`/timetable/semester/${semesterId}/academic-calendar/push-to-calendar`),
};

export const attendanceAPI = {
  getSettings: (semesterId) =>
    api.get(`/attendance/semester/${semesterId}/settings`),
  updateSettings: (semesterId, data) =>
    api.patch(`/attendance/semester/${semesterId}/settings`, data),
  getSubjectConfigs: (semesterId) =>
    api.get(`/attendance/semester/${semesterId}/subject-configs`),
  updateSubjectConfig: (semesterId, subject, data) =>
    api.patch(`/attendance/semester/${semesterId}/subject/${encodeURIComponent(subject)}/config`, data),
  getSummary: (semesterId) =>
    api.get(`/attendance/semester/${semesterId}/summary`),
  getSessions: (semesterId, date) =>
    api.get(`/attendance/semester/${semesterId}/sessions`, { params: date ? { date } : {} }),
  markSession: (semesterId, sessionId, status) =>
    api.patch(`/attendance/semester/${semesterId}/sessions/${sessionId}`, { status }),
  markSelf: (semesterId, sessionId, status) =>
    api.post(`/attendance/semester/${semesterId}/mark`, { session_id: sessionId, status }),
  changeMark: (semesterId, sessionId, status) =>
    api.put(`/attendance/semester/${semesterId}/mark/${sessionId}`, { status }),
  getHistory: (semesterId, subject) =>
    api.get(`/attendance/semester/${semesterId}/history/${encodeURIComponent(subject)}`),
  getCrRoll: (semesterId, sessionId) =>
    api.get(`/attendance/semester/${semesterId}/cr-roll/${sessionId}`),
  getCrSubjectSummary: (semesterId, subject) =>
    api.get(`/attendance/semester/${semesterId}/subject/${encodeURIComponent(subject)}/cr-summary`),
  crMarkStudent: (semesterId, sessionId, studentId, status) =>
    api.post(`/attendance/semester/${semesterId}/cr-roll/${sessionId}/${studentId}`, { status }),
  generate: (semesterId) =>
    api.post(`/attendance/semester/${semesterId}/generate`),
  getDefaulters: (semesterId, params = {}) =>
    api.get(`/attendance/semester/${semesterId}/defaulters`, { params }),
  exportSubjectExcel: (semesterId, subject) =>
    fileUrl(`attendance/semester/${semesterId}/subject/${encodeURIComponent(subject)}/export/excel`),
  exportAllExcel: (semesterId) =>
    fileUrl(`attendance/semester/${semesterId}/export/excel`),
  exportDefaultersExcel: (semesterId) =>
    fileUrl(`attendance/semester/${semesterId}/defaulters/export/excel`),
  uploadAttachment: (semesterId, sessionId, file) => {
    const form = new FormData();
    form.append('file', file);
    return api.post(`/attendance/semester/${semesterId}/record/${sessionId}/attachment`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  deleteAttachment: (semesterId, sessionId) =>
    api.delete(`/attendance/semester/${semesterId}/record/${sessionId}/attachment`),
  proofUrl: (storedName) => fileUrl(`attendance/proof/${storedName}`),
  getMyProofs: () => api.get('/attendance/my-proofs'),
};

export default api;
