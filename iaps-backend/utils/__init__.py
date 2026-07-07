def toggle_reaction(reactions, emoji, user_id):
    """
    Toggle `emoji` reaction for `user_id`, enforcing one-reaction-per-user.
    Mutates a *copy* of the reactions list and returns the updated list.
    """
    reactions = [dict(r, user_ids=list(r['user_ids'])) for r in reactions]

    # Remove user from every other emoji first
    for r in reactions:
        if r['emoji'] != emoji and user_id in r['user_ids']:
            r['user_ids'].remove(user_id)
    reactions = [r for r in reactions if r['user_ids']]

    entry = next((r for r in reactions if r['emoji'] == emoji), None)
    if entry:
        if user_id in entry['user_ids']:
            entry['user_ids'].remove(user_id)   # toggle off
        else:
            entry['user_ids'].append(user_id)
        if not entry['user_ids']:
            reactions = [r for r in reactions if r['emoji'] != emoji]
    else:
        reactions.append({'emoji': emoji, 'user_ids': [user_id]})

    return reactions


class ConcurrentUpdateError(Exception):
    """Raised when a compare-and-swap update couldn't land after retrying —
    the field kept changing out from under us. Callers should surface this as
    a 409 and let the client retry, rather than silently dropping either side."""


def cas_update_reactions(collection, base_filter, emoji, user_id, max_attempts=5):
    """Toggle a reaction on a document's `reactions` array via compare-and-swap
    instead of read-modify-write, so two people reacting to the same message at
    the same time can't silently clobber each other's reaction. Returns the
    document *before* this update (so callers can still check fields like
    `sender_id` from it) plus the new reactions list — or None if `base_filter`
    doesn't match any document.
    """
    for _ in range(max_attempts):
        doc = collection.find_one(base_filter)
        if doc is None:
            return None, None
        old_reactions = doc.get('reactions', [])
        new_reactions = toggle_reaction(old_reactions, emoji, user_id)
        cas_filter = dict(base_filter)
        if 'reactions' in doc:
            cas_filter['reactions'] = old_reactions
        else:
            cas_filter['reactions'] = {'$exists': False}
        result = collection.update_one(cas_filter, {'$set': {'reactions': new_reactions}})
        if result.matched_count > 0:
            return doc, new_reactions
    raise ConcurrentUpdateError('reactions')
