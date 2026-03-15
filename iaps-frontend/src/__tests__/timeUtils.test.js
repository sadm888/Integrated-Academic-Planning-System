import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatTime, relativeTime, formatDate } from '../utils/timeUtils';

describe('timeUtils', () => {
  describe('formatTime', () => {
    it('returns a time string for a valid ISO date', () => {
      const iso = '2024-01-15T14:30:00.000Z';
      const result = formatTime(iso);
      // locale-dependent, just check it's a non-empty string with colon
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });

    it('handles midnight', () => {
      const iso = '2024-01-15T00:00:00.000Z';
      const result = formatTime(iso);
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });

  describe('relativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "just now" for times less than 1 minute ago', () => {
      const now = new Date('2024-01-15T12:00:00.000Z');
      vi.setSystemTime(now);
      const thirtySecondsAgo = new Date(now.getTime() - 30000).toISOString();
      expect(relativeTime(thirtySecondsAgo)).toBe('just now');
    });

    it('returns minutes for times less than 1 hour ago', () => {
      const now = new Date('2024-01-15T12:00:00.000Z');
      vi.setSystemTime(now);
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
      expect(relativeTime(fiveMinutesAgo)).toBe('5m');
    });

    it('returns hours for times less than 24 hours ago', () => {
      const now = new Date('2024-01-15T12:00:00.000Z');
      vi.setSystemTime(now);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
      expect(relativeTime(twoHoursAgo)).toBe('2h');
    });

    it('returns "Yesterday" for times exactly 1 day ago', () => {
      const now = new Date('2024-01-15T12:00:00.000Z');
      vi.setSystemTime(now);
      const oneDayAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
      expect(relativeTime(oneDayAgo)).toBe('Yesterday');
    });

    it('returns days for times 2-6 days ago', () => {
      const now = new Date('2024-01-15T12:00:00.000Z');
      vi.setSystemTime(now);
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
      expect(relativeTime(threeDaysAgo)).toBe('3d');
    });

    it('returns a date string for times older than 7 days', () => {
      const now = new Date('2024-01-15T12:00:00.000Z');
      vi.setSystemTime(now);
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const result = relativeTime(tenDaysAgo);
      // Should be a locale date string (e.g. "Jan 5")
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('formatDate', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns "Today" for today\'s date', () => {
      const now = new Date('2024-01-15T10:00:00.000Z');
      vi.setSystemTime(now);
      expect(formatDate(now.toISOString())).toBe('Today');
    });

    it('returns "Yesterday" for yesterday\'s date', () => {
      const now = new Date('2024-01-15T10:00:00.000Z');
      vi.setSystemTime(now);
      const yesterday = new Date('2024-01-14T10:00:00.000Z');
      expect(formatDate(yesterday.toISOString())).toBe('Yesterday');
    });

    it('returns a formatted date string for older dates', () => {
      const now = new Date('2024-01-15T10:00:00.000Z');
      vi.setSystemTime(now);
      const older = new Date('2024-01-01T10:00:00.000Z');
      const result = formatDate(older.toISOString());
      expect(typeof result).toBe('string');
      expect(result).not.toBe('Today');
      expect(result).not.toBe('Yesterday');
    });
  });
});
