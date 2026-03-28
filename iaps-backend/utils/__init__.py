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
