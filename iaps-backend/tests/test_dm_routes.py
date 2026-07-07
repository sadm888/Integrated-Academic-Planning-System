"""Tests for routes/dm_routes.py — currently just the reaction race-condition fix."""
from datetime import datetime, timezone

from bson import ObjectId

from tests.helpers import make_classroom


def _auth(token):
    return {'Authorization': f'Bearer {token}'}


def _insert_dm(db, classroom_id, sender_id, receiver_id, text='hi'):
    from utils.encryption import encrypt_text
    doc = {
        '_id': ObjectId(),
        'classroom_id': str(classroom_id),
        'sender_id': str(sender_id),
        'receiver_id': str(receiver_id),
        'sender_name': 'Sender',
        'text': encrypt_text(text),
        'file': None,
        'read_by': [],
        'created_at': datetime.now(timezone.utc),
    }
    db.dm_messages.insert_one(doc)
    return doc


class TestReactToDm:
    def _react(self, client, token, classroom_id, msg_id, emoji='👍'):
        return client.post(f'/api/dm/{classroom_id}/messages/{msg_id}/react',
                           json={'emoji': emoji}, headers=_auth(token))

    def test_requires_auth(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, _ = second_user
        classroom, _ = make_classroom(db, user1['_id'])
        db.classrooms.update_one({'_id': classroom['_id']}, {'$push': {'members': user2['_id']}})
        msg = _insert_dm(db, classroom['_id'], user1['_id'], user2['_id'])
        resp = client.post(f'/api/dm/{classroom["_id"]}/messages/{msg["_id"]}/react', json={'emoji': '👍'})
        assert resp.status_code == 401

    def test_non_participant_denied(self, client, registered_user, db):
        """A classroom member who is neither sender nor receiver of this DM can't react to it."""
        user1, token1 = registered_user
        classroom, _ = make_classroom(db, user1['_id'])
        other_a, other_b = ObjectId(), ObjectId()
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': {'$each': [other_a, other_b]}}}
        )
        msg = _insert_dm(db, classroom['_id'], str(other_a), str(other_b))
        resp = self._react(client, token1, classroom['_id'], msg['_id'])
        assert resp.status_code == 403

    def test_first_reaction_registers(self, client, registered_user, second_user, db):
        user1, token1 = registered_user
        user2, _ = second_user
        classroom, _ = make_classroom(db, user1['_id'])
        db.classrooms.update_one({'_id': classroom['_id']}, {'$push': {'members': user2['_id']}})
        msg = _insert_dm(db, classroom['_id'], user1['_id'], user2['_id'])
        resp = self._react(client, token1, classroom['_id'], msg['_id'], '👍')
        assert resp.status_code == 200
        updated = db.dm_messages.find_one({'_id': msg['_id']})
        assert updated['reactions'] == [{'emoji': '👍', 'user_ids': [str(user1['_id'])]}]

    def test_reacting_same_emoji_again_toggles_off(self, client, registered_user, second_user, db):
        user1, token1 = registered_user
        user2, _ = second_user
        classroom, _ = make_classroom(db, user1['_id'])
        db.classrooms.update_one({'_id': classroom['_id']}, {'$push': {'members': user2['_id']}})
        msg = _insert_dm(db, classroom['_id'], user1['_id'], user2['_id'])
        self._react(client, token1, classroom['_id'], msg['_id'], '👍')
        resp = self._react(client, token1, classroom['_id'], msg['_id'], '👍')
        assert resp.status_code == 200
        updated = db.dm_messages.find_one({'_id': msg['_id']})
        assert updated['reactions'] == []

    def test_concurrent_reactions_from_both_participants_dont_clobber(self, client, registered_user, second_user, db):
        """Regression test for the read-modify-write race: sender and receiver
        react with different emoji without either read picking up the other's
        write — both reactions must still be present afterward."""
        user1, token1 = registered_user
        user2, token2 = second_user
        classroom, _ = make_classroom(db, user1['_id'])
        db.classrooms.update_one({'_id': classroom['_id']}, {'$push': {'members': user2['_id']}})
        msg = _insert_dm(db, classroom['_id'], user1['_id'], user2['_id'])

        resp1 = self._react(client, token1, classroom['_id'], msg['_id'], '👍')
        resp2 = self._react(client, token2, classroom['_id'], msg['_id'], '🔥')
        assert resp1.status_code == 200
        assert resp2.status_code == 200

        updated = db.dm_messages.find_one({'_id': msg['_id']})
        by_emoji = {r['emoji']: r['user_ids'] for r in updated['reactions']}
        assert str(user1['_id']) in by_emoji.get('👍', [])
        assert str(user2['_id']) in by_emoji.get('🔥', [])
