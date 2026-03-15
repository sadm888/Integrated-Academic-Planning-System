import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from '../contexts/ToastContext';

function ToastTrigger() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success('Success message')}>success</button>
      <button onClick={() => toast.error('Error message')}>error</button>
      <button onClick={() => toast.info('Info message')}>info</button>
      <button onClick={() => toast.success('Persistent', 0)}>persistent</button>
    </div>
  );
}

describe('ToastContext', () => {
  it('renders children without toasts initially', () => {
    render(<ToastProvider><div>content</div></ToastProvider>);
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('throws if useToast is used outside provider', () => {
    const BadComponent = () => {
      useToast();
      return null;
    };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<BadComponent />)).toThrow('useToast must be used inside ToastProvider');
    consoleSpy.mockRestore();
  });

  it('shows success toast when toast.success() is called', () => {
    render(<ToastProvider><ToastTrigger /></ToastProvider>);
    fireEvent.click(screen.getByText('success'));
    expect(screen.getByText('Success message')).toBeTruthy();
  });

  it('shows error toast when toast.error() is called', () => {
    render(<ToastProvider><ToastTrigger /></ToastProvider>);
    fireEvent.click(screen.getByText('error'));
    expect(screen.getByText('Error message')).toBeTruthy();
  });

  it('shows info toast when toast.info() is called', () => {
    render(<ToastProvider><ToastTrigger /></ToastProvider>);
    fireEvent.click(screen.getByText('info'));
    expect(screen.getByText('Info message')).toBeTruthy();
  });

  it('dismisses toast automatically after default duration', async () => {
    vi.useFakeTimers();
    try {
      render(<ToastProvider><ToastTrigger /></ToastProvider>);
      act(() => { fireEvent.click(screen.getByText('success')); });
      expect(screen.getByText('Success message')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(4100); });
      expect(screen.queryByText('Success message')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-dismiss when duration is 0', async () => {
    vi.useFakeTimers();
    try {
      render(<ToastProvider><ToastTrigger /></ToastProvider>);
      act(() => { fireEvent.click(screen.getByText('persistent')); });
      act(() => { vi.advanceTimersByTime(10000); });
      expect(screen.getByText('Persistent')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('can dismiss toast by clicking the X button', () => {
    render(<ToastProvider><ToastTrigger /></ToastProvider>);
    fireEvent.click(screen.getByText('persistent'));
    expect(screen.getByText('Persistent')).toBeTruthy();

    // The dismiss button is inside ToastItem, find all buttons and pick non-trigger ones
    const allButtons = screen.getAllByRole('button');
    // trigger buttons are: success, error, info, persistent — dismiss is the last one
    const dismissBtn = allButtons[allButtons.length - 1];
    fireEvent.click(dismissBtn);

    expect(screen.queryByText('Persistent')).toBeNull();
  });
});
