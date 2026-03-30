/**
 * Tests for timetable-related utilities and API calls.
 * Covers: pushDay, deleteDay, addPersonalSkip, deletePersonalSkip call shapes,
 * displayGrid personal-skip overlay logic, and GCal action guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock axios ────────────────────────────────────────────────────────────────
const mockApi = {
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
};

vi.mock('axios', () => ({
  default: { create: vi.fn(() => mockApi) },
}));
vi.stubEnv('VITE_API_URL', 'http://localhost:5001');

beforeEach(() => {
  vi.clearAllMocks();
});


// ── timetableAPI call shapes ──────────────────────────────────────────────────

describe('timetableAPI.pushDay', () => {
  it('POSTs to push-day with the correct date body', async () => {
    const { timetableAPI } = await import('../services/api');
    mockApi.post.mockResolvedValue({ data: { created: 2 } });

    await timetableAPI.pushDay('sem123', '2026-04-07');

    expect(mockApi.post).toHaveBeenCalledWith(
      '/timetable/semester/sem123/push-day',
      { date: '2026-04-07' }
    );
  });
});

describe('timetableAPI.deleteDay', () => {
  it('DELETEs to push-day with date in request body', async () => {
    const { timetableAPI } = await import('../services/api');
    mockApi.delete.mockResolvedValue({ data: { message: 'removed' } });

    await timetableAPI.deleteDay('sem123', '2026-04-07');

    expect(mockApi.delete).toHaveBeenCalledWith(
      '/timetable/semester/sem123/push-day',
      { data: { date: '2026-04-07' } }
    );
  });
});

describe('timetableAPI.addPersonalSkip', () => {
  it('POSTs to personal-skip with correct body', async () => {
    const { timetableAPI } = await import('../services/api');
    mockApi.post.mockResolvedValue({ data: { id: 'abc123', message: 'Class skipped' } });

    await timetableAPI.addPersonalSkip('sem123', {
      day: 'Mon', slot: '9:00-9:45', date: '2026-04-06', reason: 'Sick',
    });

    expect(mockApi.post).toHaveBeenCalledWith(
      '/timetable/semester/sem123/personal-skip',
      { day: 'Mon', slot: '9:00-9:45', date: '2026-04-06', reason: 'Sick' }
    );
  });
});

describe('timetableAPI.deletePersonalSkip', () => {
  it('DELETEs to personal-skip/<id>', async () => {
    const { timetableAPI } = await import('../services/api');
    mockApi.delete.mockResolvedValue({ data: { message: 'Skip removed' } });

    await timetableAPI.deletePersonalSkip('sem123', 'skip999');

    expect(mockApi.delete).toHaveBeenCalledWith(
      '/timetable/semester/sem123/personal-skip/skip999'
    );
  });
});

describe('timetableAPI.pushThisWeek', () => {
  it('sends date without days when days is null', async () => {
    const { timetableAPI } = await import('../services/api');
    mockApi.post.mockResolvedValue({ data: { created: 5 } });

    await timetableAPI.pushThisWeek('sem123', '2026-04-07', null);

    expect(mockApi.post).toHaveBeenCalledWith(
      '/timetable/semester/sem123/push-this-week',
      { date: '2026-04-07' }
    );
  });

  it('includes days array when provided', async () => {
    const { timetableAPI } = await import('../services/api');
    mockApi.post.mockResolvedValue({ data: { created: 2 } });

    await timetableAPI.pushThisWeek('sem123', '2026-04-07', ['Mon', 'Wed']);

    expect(mockApi.post).toHaveBeenCalledWith(
      '/timetable/semester/sem123/push-this-week',
      { date: '2026-04-07', days: ['Mon', 'Wed'] }
    );
  });
});

// updateDay must not exist (was removed as dead duplicate of pushDay)
describe('timetableAPI.updateDay', () => {
  it('does not exist — was removed as duplicate of pushDay', async () => {
    const { timetableAPI } = await import('../services/api');
    expect(timetableAPI.updateDay).toBeUndefined();
  });
});


// ── displayGrid personal-skip overlay logic ───────────────────────────────────

describe('displayGrid personal-skip overlay', () => {
  /**
   * Replicates the overlay logic from Timetable.jsx:
   *   for (const ps of personalSkips) {
   *     if (grid[ps.day]?.[ps.slot]) {
   *       grid[ps.day] = { ...grid[ps.day], [ps.slot]: { ...cell, personalSkip: true, ... } };
   *     }
   *   }
   */
  function applyPersonalSkipOverlay(weekGrid, personalSkips) {
    if (!personalSkips.length) return weekGrid;
    const grid = { ...weekGrid };
    for (const ps of personalSkips) {
      if (grid[ps.day]?.[ps.slot]) {
        grid[ps.day] = {
          ...grid[ps.day],
          [ps.slot]: {
            ...grid[ps.day][ps.slot],
            personalSkip: true,
            personalSkipId: ps.id,
            personalSkipReason: ps.reason,
          },
        };
      }
    }
    return grid;
  }

  const baseGrid = {
    Mon: {
      '9:00-9:45': { subject: 'IT250', type: 'Lecture', status: 'normal' },
      '9:45-10:30': { subject: 'IT260', type: 'Lab', status: 'normal' },
    },
  };

  it('marks the skipped slot with personalSkip: true', () => {
    const skips = [{ id: 'skip1', day: 'Mon', slot: '9:00-9:45', date: '2026-04-06', reason: 'Sick' }];
    const result = applyPersonalSkipOverlay(baseGrid, skips);
    expect(result.Mon['9:00-9:45'].personalSkip).toBe(true);
    expect(result.Mon['9:00-9:45'].personalSkipId).toBe('skip1');
    expect(result.Mon['9:00-9:45'].personalSkipReason).toBe('Sick');
  });

  it('does not affect non-skipped slots', () => {
    const skips = [{ id: 'skip1', day: 'Mon', slot: '9:00-9:45', date: '2026-04-06', reason: '' }];
    const result = applyPersonalSkipOverlay(baseGrid, skips);
    expect(result.Mon['9:45-10:30'].personalSkip).toBeUndefined();
  });

  it('silently ignores skips for non-existent slots', () => {
    const skips = [{ id: 'skip1', day: 'Mon', slot: '13:00-13:45', date: '2026-04-06', reason: '' }];
    expect(() => applyPersonalSkipOverlay(baseGrid, skips)).not.toThrow();
    const result = applyPersonalSkipOverlay(baseGrid, skips);
    // Original grid unaffected
    expect(Object.keys(result.Mon)).toHaveLength(2);
  });

  it('silently ignores skips for non-existent days', () => {
    const skips = [{ id: 'skip1', day: 'Sat', slot: '9:00-9:45', date: '2026-04-11', reason: '' }];
    expect(() => applyPersonalSkipOverlay(baseGrid, skips)).not.toThrow();
  });

  it('returns original grid reference when no skips', () => {
    const result = applyPersonalSkipOverlay(baseGrid, []);
    expect(result).toBe(baseGrid);
  });

  it('does not mutate the original grid', () => {
    const skips = [{ id: 'skip1', day: 'Mon', slot: '9:00-9:45', date: '2026-04-06', reason: '' }];
    applyPersonalSkipOverlay(baseGrid, skips);
    expect(baseGrid.Mon['9:00-9:45'].personalSkip).toBeUndefined();
  });
});


// ── GCal section guard logic ──────────────────────────────────────────────────

describe('GCal section guard: cell?.subject && cell?.status !== cancelled', () => {
  /**
   * The guard used in OverrideModal:
   *   (onPushDay || onDeleteDay) && cell?.subject && cell?.status !== 'cancelled'
   */
  function shouldShowGcalSection(cell, hasHandlers = true) {
    return hasHandlers && !!cell?.subject && cell?.status !== 'cancelled';
  }

  it('shows for a normal class', () => {
    expect(shouldShowGcalSection({ subject: 'IT250', status: 'normal' })).toBe(true);
  });

  it('shows for a modified/rescheduled class', () => {
    expect(shouldShowGcalSection({ subject: 'IT250', status: 'modified' })).toBe(true);
  });

  it('hides for a cancelled class', () => {
    expect(shouldShowGcalSection({ subject: 'IT250', status: 'cancelled' })).toBe(false);
  });

  it('hides when cell has no subject (Free/empty slot)', () => {
    expect(shouldShowGcalSection({ subject: '', type: 'Free', status: 'normal' })).toBe(false);
    expect(shouldShowGcalSection({ type: 'Free', status: 'normal' })).toBe(false);
  });

  it('hides when handlers are not provided (non-CR user)', () => {
    expect(shouldShowGcalSection({ subject: 'IT250', status: 'normal' }, false)).toBe(false);
  });
});
