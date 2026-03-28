import { describe, it, expect } from 'vitest';
import { renderMentions } from '../utils/textUtils';

describe('renderMentions', () => {
  it('returns plain text unchanged when no @ present', () => {
    expect(renderMentions('hello world', 'alice')).toBe('hello world');
  });

  it('returns null/undefined as-is', () => {
    expect(renderMentions(null, 'alice')).toBe(null);
    expect(renderMentions(undefined, 'alice')).toBe(undefined);
  });

  it('returns an array of parts when @ mention is present', () => {
    const result = renderMentions('hey @alice how are you', 'alice');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(1);
  });

  it('renders a self-mention with stronger highlight', () => {
    const parts = renderMentions('@alice hello', 'alice');
    const mention = parts.find(p => p?.props?.children === '@alice');
    expect(mention).toBeDefined();
    expect(mention.props.style.fontWeight).toBe(700);
  });

  it('renders an other-mention with lighter highlight', () => {
    const parts = renderMentions('@bob hello', 'alice');
    const mention = parts.find(p => p?.props?.children === '@bob');
    expect(mention).toBeDefined();
    expect(mention.props.style.fontWeight).toBe(600);
  });

  it('is case-insensitive for self-mention detection', () => {
    const parts = renderMentions('@Alice hi', 'alice');
    const mention = parts.find(p => p?.props?.children === '@Alice');
    expect(mention.props.style.fontWeight).toBe(700);
  });
});
