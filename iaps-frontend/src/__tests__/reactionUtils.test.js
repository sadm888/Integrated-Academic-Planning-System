import { describe, it, expect } from 'vitest';
import { toggleReactionOptimistic } from '../utils/reactionUtils';

const userId = 'user1';
const otherId = 'user2';

function msg(reactions = []) {
  return { id: 'm1', reactions };
}

describe('toggleReactionOptimistic', () => {
  it('adds a new reaction when none exist', () => {
    const result = toggleReactionOptimistic(msg(), '👍', userId);
    expect(result.reactions).toEqual([{ emoji: '👍', user_ids: [userId] }]);
  });

  it('adds user to an existing emoji reaction', () => {
    const result = toggleReactionOptimistic(
      msg([{ emoji: '👍', user_ids: [otherId] }]),
      '👍', userId
    );
    expect(result.reactions[0].user_ids).toContain(userId);
    expect(result.reactions[0].user_ids).toContain(otherId);
  });

  it('removes user when they already reacted with that emoji (toggle off)', () => {
    const result = toggleReactionOptimistic(
      msg([{ emoji: '👍', user_ids: [userId] }]),
      '👍', userId
    );
    expect(result.reactions).toEqual([]);
  });

  it('removes user from other emojis (one-reaction-per-user)', () => {
    const result = toggleReactionOptimistic(
      msg([
        { emoji: '👍', user_ids: [userId] },
        { emoji: '❤️', user_ids: [otherId] },
      ]),
      '❤️', userId
    );
    const thumbs = result.reactions.find(r => r.emoji === '👍');
    const heart = result.reactions.find(r => r.emoji === '❤️');
    // user removed from 👍 (entry becomes empty — pruned)
    expect(thumbs).toBeUndefined();
    // user added to ❤️
    expect(heart.user_ids).toContain(userId);
    // other user still in ❤️
    expect(heart.user_ids).toContain(otherId);
  });

  it('does not mutate original message', () => {
    const original = msg([{ emoji: '👍', user_ids: [userId] }]);
    const originalReactions = JSON.stringify(original.reactions);
    toggleReactionOptimistic(original, '👍', userId);
    expect(JSON.stringify(original.reactions)).toBe(originalReactions);
  });

  it('prunes empty reaction entries', () => {
    const result = toggleReactionOptimistic(
      msg([{ emoji: '👍', user_ids: [userId] }]),
      '👍', userId
    );
    expect(result.reactions.every(r => r.user_ids.length > 0)).toBe(true);
  });
});
