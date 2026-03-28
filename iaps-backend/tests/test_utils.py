"""Unit tests for shared utility helpers."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from utils import toggle_reaction


def test_toggle_reaction_adds_new_emoji():
    reactions = toggle_reaction([], '👍', 'user1')
    assert reactions == [{'emoji': '👍', 'user_ids': ['user1']}]


def test_toggle_reaction_adds_user_to_existing_emoji():
    reactions = toggle_reaction(
        [{'emoji': '👍', 'user_ids': ['user2']}],
        '👍', 'user1'
    )
    entry = next(r for r in reactions if r['emoji'] == '👍')
    assert 'user1' in entry['user_ids']
    assert 'user2' in entry['user_ids']


def test_toggle_reaction_removes_user_on_toggle_off():
    reactions = toggle_reaction(
        [{'emoji': '👍', 'user_ids': ['user1']}],
        '👍', 'user1'
    )
    assert reactions == []


def test_toggle_reaction_one_per_user_removes_other_emojis():
    initial = [
        {'emoji': '👍', 'user_ids': ['user1']},
        {'emoji': '❤️', 'user_ids': ['user2']},
    ]
    reactions = toggle_reaction(initial, '❤️', 'user1')
    # user1 removed from 👍 (entry pruned)
    thumbs = next((r for r in reactions if r['emoji'] == '👍'), None)
    assert thumbs is None
    # user1 added to ❤️, user2 still there
    heart = next(r for r in reactions if r['emoji'] == '❤️')
    assert 'user1' in heart['user_ids']
    assert 'user2' in heart['user_ids']


def test_toggle_reaction_does_not_mutate_input():
    original = [{'emoji': '👍', 'user_ids': ['user1']}]
    import copy
    snapshot = copy.deepcopy(original)
    toggle_reaction(original, '👍', 'user1')
    assert original == snapshot


def test_toggle_reaction_prunes_empty_entries():
    reactions = toggle_reaction(
        [{'emoji': '👍', 'user_ids': ['user1']}],
        '👍', 'user1'
    )
    assert all(len(r['user_ids']) > 0 for r in reactions)
