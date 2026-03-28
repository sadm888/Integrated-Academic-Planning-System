/**
 * Optimistically toggle an emoji reaction for `userId` on a message,
 * enforcing one-reaction-per-user (removes the user from any other emoji first).
 *
 * @param {object} message  - full message object
 * @param {string} emoji    - emoji string being toggled
 * @param {string} userId   - current user's id
 * @returns {object}        - updated message object (new reference)
 */
export function toggleReactionOptimistic(message, emoji, userId) {
  // Remove user from all other emoji reactions (one-reaction-per-user)
  let reactions = (message.reactions || []).map(r =>
    r.emoji !== emoji ? { ...r, user_ids: r.user_ids.filter(id => id !== userId) } : r
  ).filter(r => r.user_ids.length > 0);

  const idx = reactions.findIndex(r => r.emoji === emoji);
  if (idx !== -1) {
    const entry = { ...reactions[idx], user_ids: [...reactions[idx].user_ids] };
    if (entry.user_ids.includes(userId)) {
      entry.user_ids = entry.user_ids.filter(id => id !== userId);
    } else {
      entry.user_ids.push(userId);
    }
    const next = [...reactions];
    if (entry.user_ids.length === 0) next.splice(idx, 1);
    else next[idx] = entry;
    return { ...message, reactions: next };
  }
  return { ...message, reactions: [...reactions, { emoji, user_ids: [userId] }] };
}
