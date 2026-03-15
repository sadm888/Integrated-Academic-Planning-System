import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock axios before importing api
vi.mock('axios', () => {
  const instance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };
  return {
    default: {
      create: vi.fn(() => instance),
    },
  };
});

// Mock import.meta.env
vi.stubEnv('VITE_API_URL', 'http://localhost:5001');

describe('API service', () => {
  it('creates axios instance with correct base URL', async () => {
    const axios = (await import('axios')).default;
    await import('../services/api');
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: expect.stringContaining('/api'),
      })
    );
  });

  it('exports authAPI with correct methods', async () => {
    const { authAPI } = await import('../services/api');
    expect(typeof authAPI.signup).toBe('function');
    expect(typeof authAPI.login).toBe('function');
    expect(typeof authAPI.verify).toBe('function');
  });

  it('exports classroomAPI with correct methods', async () => {
    const { classroomAPI } = await import('../services/api');
    expect(typeof classroomAPI.create).toBe('function');
    expect(typeof classroomAPI.join).toBe('function');
    expect(typeof classroomAPI.list).toBe('function');
    expect(typeof classroomAPI.getDetails).toBe('function');
    expect(typeof classroomAPI.approve).toBe('function');
    expect(typeof classroomAPI.reject).toBe('function');
    expect(typeof classroomAPI.leave).toBe('function');
    expect(typeof classroomAPI.delete).toBe('function');
  });

  it('exports semesterAPI with correct methods', async () => {
    const { semesterAPI } = await import('../services/api');
    expect(typeof semesterAPI.create).toBe('function');
    expect(typeof semesterAPI.list).toBe('function');
    expect(typeof semesterAPI.getDetail).toBe('function');
    expect(typeof semesterAPI.delete).toBe('function');
    expect(typeof semesterAPI.addCR).toBe('function');
    expect(typeof semesterAPI.removeCR).toBe('function');
    expect(typeof semesterAPI.acceptCr).toBe('function');
    expect(typeof semesterAPI.declineCr).toBe('function');
  });

  it('exports subjectAPI with correct methods', async () => {
    const { subjectAPI } = await import('../services/api');
    expect(typeof subjectAPI.create).toBe('function');
    expect(typeof subjectAPI.list).toBe('function');
    expect(typeof subjectAPI.delete).toBe('function');
    expect(typeof subjectAPI.update).toBe('function');
  });

  it('exports marksAPI with correct methods', async () => {
    const { marksAPI } = await import('../services/api');
    expect(typeof marksAPI.getStructure).toBe('function');
    expect(typeof marksAPI.saveStructure).toBe('function');
    expect(typeof marksAPI.getMyMarks).toBe('function');
    expect(typeof marksAPI.saveMyMarks).toBe('function');
    expect(typeof marksAPI.listAnalytics).toBe('function');
    expect(typeof marksAPI.uploadAnalytics).toBe('function');
    expect(typeof marksAPI.analyticsFileUrl).toBe('function');
  });

  it('exports todoAPI with correct methods', async () => {
    const { todoAPI } = await import('../services/api');
    expect(typeof todoAPI.create).toBe('function');
    expect(typeof todoAPI.list).toBe('function');
    expect(typeof todoAPI.toggle).toBe('function');
    expect(typeof todoAPI.delete).toBe('function');
  });

  it('exports chatAPI with correct methods', async () => {
    const { chatAPI } = await import('../services/api');
    expect(typeof chatAPI.getMessages).toBe('function');
    expect(typeof chatAPI.uploadFile).toBe('function');
    expect(typeof chatAPI.getFileUrl).toBe('function');
    expect(typeof chatAPI.deleteMessage).toBe('function');
    expect(typeof chatAPI.warnUser).toBe('function');
    expect(typeof chatAPI.getUnreadCounts).toBe('function');
    expect(typeof chatAPI.markRead).toBe('function');
  });

  it('exports timetableAPI with correct methods', async () => {
    const { timetableAPI } = await import('../services/api');
    expect(typeof timetableAPI.get).toBe('function');
    expect(typeof timetableAPI.save).toBe('function');
    expect(typeof timetableAPI.getWeek).toBe('function');
    expect(typeof timetableAPI.getToday).toBe('function');
    expect(typeof timetableAPI.addOverride).toBe('function');
    expect(typeof timetableAPI.deleteOverride).toBe('function');
    expect(typeof timetableAPI.listOverrides).toBe('function');
  });

  it('exports dmAPI with correct methods', async () => {
    const { dmAPI } = await import('../services/api');
    expect(typeof dmAPI.sendMessage).toBe('function');
    expect(typeof dmAPI.getThread).toBe('function');
    expect(typeof dmAPI.markRead).toBe('function');
    expect(typeof dmAPI.getUnreadCount).toBe('function');
    expect(typeof dmAPI.deleteMessage).toBe('function');
  });

  it('exports settingsAPI with correct methods', async () => {
    const { settingsAPI } = await import('../services/api');
    expect(typeof settingsAPI.getMe).toBe('function');
    expect(typeof settingsAPI.updateProfile).toBe('function');
    expect(typeof settingsAPI.uploadAvatar).toBe('function');
    expect(typeof settingsAPI.getAvatarUrl).toBe('function');
    expect(typeof settingsAPI.changePasswordRequest).toBe('function');
    expect(typeof settingsAPI.verifyPassword).toBe('function');
  });

  it('exports academicAPI with correct methods', async () => {
    const { academicAPI } = await import('../services/api');
    expect(typeof academicAPI.getMySemesters).toBe('function');
    expect(typeof academicAPI.getAllResources).toBe('function');
    expect(typeof academicAPI.upload).toBe('function');
    expect(typeof academicAPI.getFileUrl).toBe('function');
    expect(typeof academicAPI.deleteResource).toBe('function');
  });

  it('analyticsFileUrl includes token from localStorage', async () => {
    localStorage.setItem('token', 'test-token-123');
    const { marksAPI } = await import('../services/api');
    const url = marksAPI.analyticsFileUrl('file-id-1');
    expect(url).toContain('test-token-123');
    expect(url).toContain('file-id-1');
  });

  it('getAvatarUrl includes userId in URL', async () => {
    const { settingsAPI } = await import('../services/api');
    const url = settingsAPI.getAvatarUrl('user-abc');
    expect(url).toContain('user-abc');
  });
});
