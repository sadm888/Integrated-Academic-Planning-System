import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatTime, relativeTime, formatDate } from '../utils/timeUtils';

describe('timeUtils', () => {
  describe('formatTime', () => {
    it('returns a time string for a valid ISO date', () => {
      const result = formatTime('2024-01-15T14:30:00.000Z');
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('handles midnight', () => {
      const result = formatTime('2024-01-15T00:00:00.000Z');
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('returns empty string for invalid input', () => {
      expect(formatTime('not-a-date')).toBe('');
      expect(formatTime('')).toBe('');
    });
  });

  describe('relativeTime', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('returns "just now" for times less than 1 minute ago', () => {
      const now = new Date('2024-01-15T12:00:00.000Z');
      vi.setSystemTime(now);
      expect(relativeTime(new Date(now.getTime() - 30000).toISOString())).toBe('just now');
    });

    it('returns minutes for times less than 1 hour ago', () => {
      const now = new Date('2024-01-15T12:00:00.000Z');
      vi.setSystemTime(now);
      expect(relativeTime(new Date(now.getTime() - 5 * 60 * 1000).toISOString())).toBe('5m');
    });

    it('returns hours for times less than 24 hours ago', () => {
      const now = new Date('2024-01-15T12:00:00.000Z');
      vi.setSystemTime(now);
      expect(relativeTime(new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString())).toBe('2h');
    });

    it('returns "Yesterday" for times exactly 1 day ago', () => {
      const now = new Date('2024-01-15T12:00:00.000Z');
      vi.setSystemTime(now);
      expect(relativeTime(new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString())).toBe('Yesterday');
    });

    it('returns days for times 2-6 days ago', () => {
      const now = new Date('2024-01-15T12:00:00.000Z');
      vi.setSystemTime(now);
      expect(relativeTime(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString())).toBe('3d');
    });

    it('returns a date string for times older than 7 days', () => {
      const now = new Date('2024-01-15T12:00:00.000Z');
      vi.setSystemTime(now);
      const result = relativeTime(new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString());
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('formatDate', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('returns "Today" for today\'s date', () => {
      const now = new Date('2024-01-15T10:00:00.000Z');
      vi.setSystemTime(now);
      expect(formatDate(now.toISOString())).toBe('Today');
    });

    it('returns "Yesterday" for yesterday\'s date', () => {
      const now = new Date('2024-01-15T10:00:00.000Z');
      vi.setSystemTime(now);
      expect(formatDate(new Date('2024-01-14T10:00:00.000Z').toISOString())).toBe('Yesterday');
    });

    it('omits year for dates in the current year', () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      vi.setSystemTime(now);
      const result = formatDate(new Date('2024-01-01T10:00:00.000Z').toISOString());
      expect(result).not.toMatch(/2024/);
      expect(result).not.toBe('Today');
      expect(result).not.toBe('Yesterday');
    });

    it('includes year for dates from a previous year', () => {
      const now = new Date('2024-06-15T10:00:00.000Z');
      vi.setSystemTime(now);
      const result = formatDate(new Date('2023-01-01T10:00:00.000Z').toISOString());
      expect(result).toMatch(/2023/);
    });

    it('returns a non-empty string for any valid date', () => {
      const now = new Date('2024-01-15T10:00:00.000Z');
      vi.setSystemTime(now);
      const result = formatDate(new Date('2024-01-10T10:00:00.000Z').toISOString());
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
