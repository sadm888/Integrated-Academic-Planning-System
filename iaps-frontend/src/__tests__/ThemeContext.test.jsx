import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';

function ThemeConsumer() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setTheme('light')}>light</button>
    </div>
  );
}

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to "light" when no stored preference', () => {
    render(<ThemeProvider><ThemeConsumer /></ThemeProvider>);
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });

  it('loads stored theme from localStorage', () => {
    localStorage.setItem('theme_guest', 'dark');
    render(<ThemeProvider><ThemeConsumer /></ThemeProvider>);
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('loads user-specific theme from localStorage', () => {
    localStorage.setItem('theme_user123', 'dark');
    render(<ThemeProvider userId="user123"><ThemeConsumer /></ThemeProvider>);
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('updates theme and persists to localStorage', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><ThemeConsumer /></ThemeProvider>);
    await user.click(screen.getByText('dark'));
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(localStorage.getItem('theme_guest')).toBe('dark');
  });

  it('sets data-theme attribute on document root', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><ThemeConsumer /></ThemeProvider>);
    await user.click(screen.getByText('dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('sets data-theme to light by default', () => {
    render(<ThemeProvider><ThemeConsumer /></ThemeProvider>);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
