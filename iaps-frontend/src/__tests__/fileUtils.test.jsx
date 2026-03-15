import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { sizeLabel, FileTypeIcon } from '../utils/fileUtils';

describe('sizeLabel', () => {
  it('returns empty string for falsy input', () => {
    expect(sizeLabel(0)).toBe('');
    expect(sizeLabel(null)).toBe('');
    expect(sizeLabel(undefined)).toBe('');
  });

  it('returns bytes for values under 1KB', () => {
    expect(sizeLabel(512)).toBe('512 B');
    expect(sizeLabel(1)).toBe('1 B');
    expect(sizeLabel(1023)).toBe('1023 B');
  });

  it('returns KB for values between 1KB and 1MB', () => {
    expect(sizeLabel(1024)).toBe('1 KB');
    expect(sizeLabel(2048)).toBe('2 KB');
    expect(sizeLabel(1024 * 500)).toBe('500 KB');
  });

  it('returns MB for values 1MB and above', () => {
    expect(sizeLabel(1024 * 1024)).toBe('1.0 MB');
    expect(sizeLabel(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });
});

describe('FileTypeIcon', () => {
  it('renders Paperclip for null mime type', () => {
    render(<FileTypeIcon mime={null} />);
    // The icon should render without throwing
    const svg = document.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('renders image icon for image/* mime type', () => {
    const { container } = render(<FileTypeIcon mime="image/png" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders video icon for video/* mime type', () => {
    const { container } = render(<FileTypeIcon mime="video/mp4" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders audio icon for audio/* mime type', () => {
    const { container } = render(<FileTypeIcon mime="audio/mpeg" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders pdf icon for application/pdf mime type', () => {
    const { container } = render(<FileTypeIcon mime="application/pdf" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders generic Paperclip for unknown mime type', () => {
    const { container } = render(<FileTypeIcon mime="application/octet-stream" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('accepts custom size prop', () => {
    const { container } = render(<FileTypeIcon mime="image/jpeg" size={24} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
