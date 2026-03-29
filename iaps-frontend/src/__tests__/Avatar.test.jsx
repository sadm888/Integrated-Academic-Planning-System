import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Avatar from '../components/Avatar';

// Mock the settingsAPI so we control the avatar URL without a live server
vi.mock('../services/api', () => ({
  settingsAPI: {
    getAvatarUrl: (userId) => `http://localhost/api/settings/avatar/${userId}`,
  },
}));

describe('Avatar component', () => {
  describe('letter fallback', () => {
    it('renders letter avatar when user has no profile_picture', () => {
      const user = { username: 'alice', email: 'alice@example.com', id: 'u1', profile_picture: null };
      const { container } = render(<Avatar user={user} />);
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toContain('A');
    });

    it('renders letter avatar when profile_picture is set but userId is missing', () => {
      // No id/user_id/_id → userId is undefined → no img rendered
      const user = { username: 'bob', email: 'bob@example.com', profile_picture: 'pic.jpg' };
      const { container } = render(<Avatar user={user} />);
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toContain('B');
    });

    it('uses first character of username as letter', () => {
      const user = { username: 'charlie', email: 'c@e.com', id: null, profile_picture: null };
      const { container } = render(<Avatar user={user} />);
      expect(container.textContent).toContain('C');
    });

    it('uses first character of email when no username', () => {
      const user = { email: 'dave@example.com', profile_picture: null };
      const { container } = render(<Avatar user={user} />);
      expect(container.textContent).toContain('D');
    });

    it('shows "?" when user is null', () => {
      const { container } = render(<Avatar user={null} />);
      expect(container.textContent).toContain('?');
    });
  });

  describe('image rendering', () => {
    it('renders img when profile_picture and userId (via id) are both present', () => {
      const user = { username: 'eve', email: 'e@e.com', id: 'user-123', profile_picture: 'pic.jpg' };
      const { container } = render(<Avatar user={user} />);
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img.src).toContain('user-123');
    });

    it('resolves userId from user_id field', () => {
      const user = { username: 'frank', email: 'f@e.com', user_id: 'uid-456', profile_picture: 'pic.jpg' };
      const { container } = render(<Avatar user={user} />);
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img.src).toContain('uid-456');
    });

    it('resolves userId from _id field', () => {
      const user = { username: 'grace', email: 'g@e.com', _id: 'oid-789', profile_picture: 'pic.jpg' };
      const { container } = render(<Avatar user={user} />);
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img.src).toContain('oid-789');
    });

    it('prefers id over user_id over _id when multiple are present', () => {
      const user = {
        username: 'heidi',
        email: 'h@e.com',
        id: 'primary-id',
        user_id: 'secondary-id',
        _id: 'tertiary-id',
        profile_picture: 'pic.jpg',
      };
      const { container } = render(<Avatar user={user} />);
      expect(container.querySelector('img').src).toContain('primary-id');
    });

    it('falls back to letter avatar when img onError fires', () => {
      const user = { username: 'ivan', email: 'i@e.com', id: 'u-err', profile_picture: 'broken.jpg' };
      const { container } = render(<Avatar user={user} />);
      const img = container.querySelector('img');
      expect(img).not.toBeNull();

      fireEvent.error(img);

      // After error the img should be gone and letter should show
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toContain('I');
    });

    it('resets imgFailed when user changes (new userId)', () => {
      const user1 = { username: 'judy', email: 'j@e.com', id: 'u-j', profile_picture: 'j.jpg' };
      const user2 = { username: 'karl', email: 'k@e.com', id: 'u-k', profile_picture: 'k.jpg' };

      const { container, rerender } = render(<Avatar user={user1} />);
      const img1 = container.querySelector('img');
      expect(img1).not.toBeNull();

      // Simulate image load failure for user1
      fireEvent.error(img1);
      expect(container.querySelector('img')).toBeNull();

      // Switch to a different user — imgFailed should reset, img should reappear
      rerender(<Avatar user={user2} />);
      expect(container.querySelector('img')).not.toBeNull();
      expect(container.querySelector('img').src).toContain('u-k');
    });
  });

  describe('color consistency', () => {
    it('renders a coloured background for the letter span', () => {
      const user = { username: 'lena', profile_picture: null };
      const { container } = render(<Avatar user={user} />);
      const letterSpan = container.querySelector('span > span');
      expect(letterSpan.style.background).toBeTruthy();
    });

    it('produces the same color for the same username on repeated renders', () => {
      const user = { username: 'mike', profile_picture: null };
      const { container: c1 } = render(<Avatar user={user} />);
      const { container: c2 } = render(<Avatar user={user} />);
      const color1 = c1.querySelector('span > span').style.background;
      const color2 = c2.querySelector('span > span').style.background;
      expect(color1).toBe(color2);
    });
  });

  describe('online indicator dot', () => {
    it('renders green dot when showOnline=true', () => {
      const user = { username: 'nina', profile_picture: null };
      const { container } = render(<Avatar user={user} showOnline={true} />);
      const dot = container.querySelectorAll('span > span')[1];
      expect(dot).toBeDefined();
      // jsdom normalises hex colours to rgb() in inline styles
      expect(dot.style.background).toMatch(/#22c55e|rgb\(34,\s*197,\s*94\)/);
    });

    it('renders grey dot when showOnline=false', () => {
      const user = { username: 'oliver', profile_picture: null };
      const { container } = render(<Avatar user={user} showOnline={false} />);
      const dot = container.querySelectorAll('span > span')[1];
      expect(dot).toBeDefined();
      // jsdom normalises hex colours to rgb() in inline styles
      expect(dot.style.background).toMatch(/#9ca3af|rgb\(156,\s*163,\s*175\)/);
    });

    it('renders no dot when showOnline is null', () => {
      const user = { username: 'paul', profile_picture: null };
      const { container } = render(<Avatar user={user} showOnline={null} />);
      // Only the letter span should be present, no dot span
      const spans = container.querySelectorAll('span > span');
      expect(spans.length).toBe(1);
    });

    it('renders no dot when showOnline is undefined (default)', () => {
      const user = { username: 'quinn', profile_picture: null };
      const { container } = render(<Avatar user={user} />);
      const spans = container.querySelectorAll('span > span');
      expect(spans.length).toBe(1);
    });

    it('uses dotColor override when provided', () => {
      const user = { username: 'rosa', profile_picture: null };
      const { container } = render(<Avatar user={user} showOnline={true} dotColor="#667eea" />);
      const dot = container.querySelectorAll('span > span')[1];
      // jsdom normalises hex colours to rgb() in inline styles
      expect(dot.style.background).toMatch(/#667eea|rgb\(102,\s*126,\s*234\)/);
    });
  });

  describe('size prop', () => {
    it('applies size to the letter span dimensions', () => {
      const user = { username: 'sam', profile_picture: null };
      const { container } = render(<Avatar user={user} size={48} />);
      const letterSpan = container.querySelector('span > span');
      expect(letterSpan.style.width).toBe('48px');
      expect(letterSpan.style.height).toBe('48px');
    });
  });
});
