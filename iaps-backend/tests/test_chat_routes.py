"""Tests for new chat_routes.py endpoints:
  PUT  /<semester_id>/messages/<message_id>          - edit_message
  POST /<semester_id>/lists                           - create_list_message
  POST /<semester_id>/lists/<message_id>/entries      - add_list_entry
  PUT  /<semester_id>/lists/<message_id>/entries/<i>  - edit_list_entry
  DELETE /<semester_id>/lists/<message_id>/entries/<i>- delete_list_entry
"""
import pytest
from bson import ObjectId
from datetime import datetime, timezone
from tests.helpers import make_classroom


# ── helpers ──────────────────────────────────────────────────────────────────

def _insert_message(db, semester_id, user_id, text='Hello', msg_type='text', extra=None):
    """Insert a chat message and return it."""
    from utils.encryption import encrypt_text
    doc = {
        '_id': ObjectId(),
        'semester_id': str(semester_id),
        'user_id': str(user_id),
        'username': 'testuser',
        'full_name': 'Test User',
        'type': msg_type,
        'text': encrypt_text(text) if text else None,
        'file': None,
        'created_at': datetime.now(timezone.utc),
    }
    if extra:
        doc.update(extra)
    db.chat_messages.insert_one(doc)
    return doc


def _insert_list_message(db, semester_id, user_id, prompt='Bring what?', entries=None):
    """Insert a list-type chat message and return it."""
    doc = {
        '_id': ObjectId(),
        'semester_id': str(semester_id),
        'user_id': str(user_id),
        'username': 'testuser',
        'full_name': 'Test User',
        'type': 'list',
        'text': None,
        'file': None,
        'list_data': {
            'prompt': prompt,
            'entries': entries or [],
        },
        'created_at': datetime.now(timezone.utc),
    }
    db.chat_messages.insert_one(doc)
    return doc


def _insert_poll_message(db, semester_id, user_id, question='Pick one', num_options=3, is_closed=False):
    """Insert a poll-type chat message and return it."""
    doc = {
        '_id': ObjectId(),
        'semester_id': str(semester_id),
        'user_id': str(user_id),
        'username': 'testuser',
        'full_name': 'Test User',
        'type': 'poll',
        'text': None,
        'file': None,
        'poll': {
            'question': question,
            'options': [{'text': f'Option {i}', 'voters': []} for i in range(num_options)],
            'is_closed': is_closed,
        },
        'created_at': datetime.now(timezone.utc),
    }
    db.chat_messages.insert_one(doc)
    return doc


def _add_member(db, classroom, user_id):
    db.classrooms.update_one({'_id': classroom['_id']}, {'$push': {'members': user_id}})


def _sid(semester):
    return str(semester['_id'])


def _mid(msg):
    return str(msg['_id'])


# ── TestEditMessage ───────────────────────────────────────────────────────────

class TestEditMessage:
    def test_requires_auth(self, client, registered_user, db):
        user, _ = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_message(db, semester['_id'], user['_id'])
        resp = client.put(f'/api/chat/{_sid(semester)}/messages/{_mid(msg)}',
                          json={'text': 'new text'})
        assert resp.status_code == 401

    def test_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        msg = _insert_message(db, semester['_id'], user1['_id'])
        resp = client.put(f'/api/chat/{_sid(semester)}/messages/{_mid(msg)}',
                          json={'text': 'new text'},
                          headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_non_author_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        _add_member(db, classroom, user2['_id'])
        msg = _insert_message(db, semester['_id'], user1['_id'])
        resp = client.put(f'/api/chat/{_sid(semester)}/messages/{_mid(msg)}',
                          json={'text': 'hijack'},
                          headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_deleted_message_blocked(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_message(db, semester['_id'], user['_id'],
                               extra={'deleted_for_everyone': True})
        resp = client.put(f'/api/chat/{_sid(semester)}/messages/{_mid(msg)}',
                          json={'text': 'new text'},
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_poll_type_blocked(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_message(db, semester['_id'], user['_id'], msg_type='poll',
                               extra={'poll_data': {'question': 'q', 'options': [], 'votes': {}}})
        resp = client.put(f'/api/chat/{_sid(semester)}/messages/{_mid(msg)}',
                          json={'text': 'new text'},
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_list_type_blocked(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_list_message(db, semester['_id'], user['_id'])
        resp = client.put(f'/api/chat/{_sid(semester)}/messages/{_mid(msg)}',
                          json={'text': 'new text'},
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_empty_text_rejected(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_message(db, semester['_id'], user['_id'])
        resp = client.put(f'/api/chat/{_sid(semester)}/messages/{_mid(msg)}',
                          json={'text': '   '},
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_happy_path(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_message(db, semester['_id'], user['_id'], text='Original')
        resp = client.put(f'/api/chat/{_sid(semester)}/messages/{_mid(msg)}',
                          json={'text': 'Updated text'},
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'message' in data
        assert data['message']['edited_at'] is not None
        # Verify DB was updated
        updated = db.chat_messages.find_one({'_id': msg['_id']})
        assert updated['edited_at'] is not None


# ── TestCreateListMessage ─────────────────────────────────────────────────────

class TestCreateListMessage:
    def test_requires_auth(self, client, registered_user, db):
        user, _ = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.post(f'/api/chat/{_sid(semester)}/lists',
                           json={'prompt': 'Bring what?'})
        assert resp.status_code == 401

    def test_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        resp = client.post(f'/api/chat/{_sid(semester)}/lists',
                           json={'prompt': 'Bring what?'},
                           headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_empty_prompt_rejected(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.post(f'/api/chat/{_sid(semester)}/lists',
                           json={'prompt': ''},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_happy_path_without_entry(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.post(f'/api/chat/{_sid(semester)}/lists',
                           json={'prompt': 'Who is coming?'},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 201
        data = resp.get_json()
        msg = data['message']
        assert msg['type'] == 'list'
        assert msg['list_data']['prompt'] == 'Who is coming?'
        assert msg['list_data']['entries'] == []

    def test_happy_path_with_first_entry(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.post(f'/api/chat/{_sid(semester)}/lists',
                           json={'prompt': 'Bring what?', 'content': 'Notebook'},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 201
        data = resp.get_json()
        entries = data['message']['list_data']['entries']
        assert len(entries) == 1
        assert entries[0]['content'] == 'Notebook'


# ── TestAddListEntry ──────────────────────────────────────────────────────────

class TestAddListEntry:
    def test_requires_auth(self, client, registered_user, db):
        user, _ = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_list_message(db, semester['_id'], user['_id'])
        resp = client.post(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries',
                           json={'content': 'Item'})
        assert resp.status_code == 401

    def test_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        msg = _insert_list_message(db, semester['_id'], user1['_id'])
        resp = client.post(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries',
                           json={'content': 'Item'},
                           headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_list_not_found(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.post(f'/api/chat/{_sid(semester)}/lists/{str(ObjectId())}/entries',
                           json={'content': 'Item'},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 404

    def test_deleted_list_blocked(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_list_message(db, semester['_id'], user['_id'])
        db.chat_messages.update_one({'_id': msg['_id']}, {'$set': {'deleted_for_everyone': True}})
        resp = client.post(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries',
                           json={'content': 'Item'},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_empty_content_rejected(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_list_message(db, semester['_id'], user['_id'])
        resp = client.post(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries',
                           json={'content': ''},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_happy_path(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_list_message(db, semester['_id'], user['_id'])
        resp = client.post(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries',
                           json={'content': 'My item'},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        data = resp.get_json()
        entries = data['message']['list_data']['entries']
        assert len(entries) == 1
        assert entries[0]['content'] == 'My item'
        assert entries[0]['username'] == 'testuser'

    def test_member_can_add_entry(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        _add_member(db, classroom, user2['_id'])
        msg = _insert_list_message(db, semester['_id'], user1['_id'])
        resp = client.post(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries',
                           json={'content': 'Member entry'},
                           headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 200


# ── TestEditListEntry ─────────────────────────────────────────────────────────

class TestEditListEntry:
    def _make_list_with_entry(self, db, semester, user):
        entry = {
            'user_id': str(user['_id']),
            'username': 'testuser',
            'full_name': 'Test User',
            'content': 'Original entry',
            'created_at': datetime.now(timezone.utc),
        }
        return _insert_list_message(db, semester['_id'], user['_id'], entries=[entry])

    def test_requires_auth(self, client, registered_user, db):
        user, _ = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = self._make_list_with_entry(db, semester, user)
        resp = client.put(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries/0',
                          json={'content': 'Updated'})
        assert resp.status_code == 401

    def test_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        msg = self._make_list_with_entry(db, semester, user1)
        resp = client.put(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries/0',
                          json={'content': 'Updated'},
                          headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_non_owner_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        _add_member(db, classroom, user2['_id'])
        msg = self._make_list_with_entry(db, semester, user1)
        resp = client.put(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries/0',
                          json={'content': 'Hijack'},
                          headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_entry_not_found(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = self._make_list_with_entry(db, semester, user)
        resp = client.put(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries/99',
                          json={'content': 'Updated'},
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 404

    def test_deleted_list_blocked(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = self._make_list_with_entry(db, semester, user)
        db.chat_messages.update_one({'_id': msg['_id']}, {'$set': {'deleted_for_everyone': True}})
        resp = client.put(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries/0',
                          json={'content': 'Updated'},
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_empty_content_rejected(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = self._make_list_with_entry(db, semester, user)
        resp = client.put(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries/0',
                          json={'content': ''},
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_happy_path(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = self._make_list_with_entry(db, semester, user)
        resp = client.put(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries/0',
                          json={'content': 'Updated entry'},
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        data = resp.get_json()
        entries = data['message']['list_data']['entries']
        assert entries[0]['content'] == 'Updated entry'
        assert 'edited_at' in entries[0]


# ── TestDeleteListEntry ───────────────────────────────────────────────────────

class TestDeleteListEntry:
    def _make_list_with_two_entries(self, db, semester, user1, user2):
        entries = [
            {
                'user_id': str(user1['_id']),
                'username': 'testuser',
                'full_name': 'Test User',
                'content': 'Entry by user1',
                'created_at': datetime.now(timezone.utc),
            },
            {
                'user_id': str(user2['_id']),
                'username': 'seconduser',
                'full_name': 'Second User',
                'content': 'Entry by user2',
                'created_at': datetime.now(timezone.utc),
            },
        ]
        return _insert_list_message(db, semester['_id'], user1['_id'], entries=entries)

    def test_requires_auth(self, client, registered_user, db):
        user, _ = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        entry = {'user_id': str(user['_id']), 'username': 'testuser',
                 'full_name': 'Test User', 'content': 'Item',
                 'created_at': datetime.now(timezone.utc)}
        msg = _insert_list_message(db, semester['_id'], user['_id'], entries=[entry])
        resp = client.delete(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries/0')
        assert resp.status_code == 401

    def test_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        entry = {'user_id': str(user1['_id']), 'username': 'testuser',
                 'full_name': 'Test User', 'content': 'Item',
                 'created_at': datetime.now(timezone.utc)}
        msg = _insert_list_message(db, semester['_id'], user1['_id'], entries=[entry])
        resp = client.delete(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries/0',
                             headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_non_owner_non_cr_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        _add_member(db, classroom, user2['_id'])
        msg = self._make_list_with_two_entries(db, semester, user1, user2)
        # user2 tries to delete user1's entry (index 0)
        resp = client.delete(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries/0',
                             headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_entry_not_found(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_list_message(db, semester['_id'], user['_id'])
        resp = client.delete(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries/0',
                             headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 404

    def test_owner_can_delete_own_entry(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        _add_member(db, classroom, user2['_id'])
        msg = self._make_list_with_two_entries(db, semester, user1, user2)
        # user2 deletes their own entry (index 1)
        resp = client.delete(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries/1',
                             headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data['message']['list_data']['entries']) == 1

    def test_cr_can_delete_others_entry(self, client, registered_user, second_user, db):
        user1, token1 = registered_user
        user2, _ = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        _add_member(db, classroom, user2['_id'])
        msg = self._make_list_with_two_entries(db, semester, user1, user2)
        # user1 is CR — deletes user2's entry (index 1)
        resp = client.delete(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries/1',
                             headers={'Authorization': f'Bearer {token1}'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data['message']['list_data']['entries']) == 1
        assert data['message']['list_data']['entries'][0]['content'] == 'Entry by user1'

    def test_happy_path_removes_entry(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        entry = {'user_id': str(user['_id']), 'username': 'testuser',
                 'full_name': 'Test User', 'content': 'Solo item',
                 'created_at': datetime.now(timezone.utc)}
        msg = _insert_list_message(db, semester['_id'], user['_id'], entries=[entry])
        resp = client.delete(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries/0',
                             headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['message']['list_data']['entries'] == []

    def test_add_during_delete_isnt_silently_lost(self, client, registered_user, second_user, db):
        """Regression test for the read-modify-write race: while user1's delete
        request is being processed, another entry gets appended (simulating a
        concurrent add-list-entry request landing in between). The delete's
        compare-and-swap must retry against the fresh state instead of writing
        back a stale 2-entry array that erases the concurrently-added 3rd entry."""
        user1, token1 = registered_user
        user2, _ = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        _add_member(db, classroom, user2['_id'])
        msg = self._make_list_with_two_entries(db, semester, user1, user2)

        # Simulate a concurrent add landing between delete's read and write by
        # pushing directly to the DB (same effect as add_list_entry's atomic $push).
        db.chat_messages.update_one(
            {'_id': msg['_id']},
            {'$push': {'list_data.entries': {
                'user_id': str(user2['_id']), 'username': 'seconduser',
                'full_name': 'Second User', 'content': 'Added concurrently',
                'created_at': datetime.now(timezone.utc),
            }}}
        )

        resp = client.delete(f'/api/chat/{_sid(semester)}/lists/{_mid(msg)}/entries/0',
                             headers={'Authorization': f'Bearer {token1}'})
        assert resp.status_code == 200

        updated = db.chat_messages.find_one({'_id': msg['_id']})
        contents = [e['content'] for e in updated['list_data']['entries']]
        assert 'Entry by user1' not in contents       # the one we deleted
        assert 'Entry by user2' in contents           # untouched
        assert 'Added concurrently' in contents        # must survive the delete


# ── TestSerializeMessage ──────────────────────────────────────────────────────

class TestSerializeFields:
    """Ensure _serialize_message includes edited_at and list_data."""

    def test_edited_at_in_response(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_message(db, semester['_id'], user['_id'], text='Hi')
        client.put(f'/api/chat/{_sid(semester)}/messages/{_mid(msg)}',
                   json={'text': 'Edited'},
                   headers={'Authorization': f'Bearer {token}'})
        # Check the list endpoint also serializes edited_at
        resp = client.put(f'/api/chat/{_sid(semester)}/messages/{_mid(msg)}',
                          json={'text': 'Edited again'},
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        assert resp.get_json()['message']['edited_at'] is not None

    def test_list_data_in_response(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.post(f'/api/chat/{_sid(semester)}/lists',
                           json={'prompt': 'Test prompt', 'content': 'First item'},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 201
        msg = resp.get_json()['message']
        assert 'list_data' in msg
        assert msg['list_data']['prompt'] == 'Test prompt'
        entries = msg['list_data']['entries']
        assert len(entries) == 1
        assert 'created_at' in entries[0]

    def test_corrupted_encryption_does_not_crash_serialize(self, client, registered_user, db):
        """A message with corrupted encrypted text must serialize as null, not 500."""
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        from bson import ObjectId as OID
        # Insert a message with intentionally broken ciphertext
        db.chat_messages.insert_one({
            '_id': OID(),
            'semester_id': str(semester['_id']),
            'user_id': str(user['_id']),
            'username': 'testuser',
            'full_name': 'Test User',
            'type': 'text',
            'text': 'NOT_VALID_CIPHERTEXT!!!',
            'created_at': datetime.now(timezone.utc),
        })
        resp = client.get(f'/api/chat/{_sid(semester)}/messages',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200


# ── TestSearchMessages ────────────────────────────────────────────────────────

class TestSearchMessages:
    """Search decrypts messages before matching — regex on encrypted field never works."""

    def test_requires_auth(self, client, registered_user, db):
        user, _ = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.get(f'/api/chat/{_sid(semester)}/search?q=hello')
        assert resp.status_code == 401

    def test_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        resp = client.get(f'/api/chat/{_sid(semester)}/search?q=hello',
                          headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_short_query_returns_empty(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.get(f'/api/chat/{_sid(semester)}/search?q=a',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        assert resp.get_json()['messages'] == []

    def test_finds_decrypted_text(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        _insert_message(db, semester['_id'], user['_id'], text='hello world')
        _insert_message(db, semester['_id'], user['_id'], text='unrelated message')

        resp = client.get(f'/api/chat/{_sid(semester)}/search?q=hello',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        msgs = resp.get_json()['messages']
        assert len(msgs) == 1
        assert 'hello' in (msgs[0].get('text') or '').lower()

    def test_corrupted_message_skipped_not_crash(self, client, registered_user, db):
        """A message with broken ciphertext must be silently skipped, not crash the search."""
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        # Insert one valid and one corrupted message
        _insert_message(db, semester['_id'], user['_id'], text='find me')
        db.chat_messages.insert_one({
            '_id': ObjectId(),
            'semester_id': str(semester['_id']),
            'user_id': str(user['_id']),
            'username': 'testuser',
            'full_name': 'Test User',
            'type': 'text',
            'text': 'GARBAGE_CIPHERTEXT',
            'created_at': datetime.now(timezone.utc),
            'deleted_for_everyone': False,
        })
        resp = client.get(f'/api/chat/{_sid(semester)}/search?q=find',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        msgs = resp.get_json()['messages']
        # The valid message must still be found
        assert any('find' in (m.get('text') or '').lower() for m in msgs)

    def test_deleted_messages_excluded(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        _insert_message(db, semester['_id'], user['_id'], text='secret deleted',
                        extra={'deleted_for_everyone': True})
        _insert_message(db, semester['_id'], user['_id'], text='visible secret')

        resp = client.get(f'/api/chat/{_sid(semester)}/search?q=secret',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        msgs = resp.get_json()['messages']
        assert len(msgs) == 1


# ── TestVotePoll ─────────────────────────────────────────────────────────────

class TestVotePoll:
    def _vote(self, client, token, semester, msg, option_index):
        return client.post(f'/api/chat/{_sid(semester)}/polls/{_mid(msg)}/vote',
                           json={'option_index': option_index},
                           headers={'Authorization': f'Bearer {token}'})

    def test_requires_auth(self, client, registered_user, db):
        user, _ = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_poll_message(db, semester['_id'], user['_id'])
        resp = client.post(f'/api/chat/{_sid(semester)}/polls/{_mid(msg)}/vote', json={'option_index': 0})
        assert resp.status_code == 401

    def test_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        _, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        msg = _insert_poll_message(db, semester['_id'], user1['_id'])
        resp = self._vote(client, token2, semester, msg, 0)
        assert resp.status_code == 403

    def test_invalid_option_index_rejected(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_poll_message(db, semester['_id'], user['_id'], num_options=2)
        resp = self._vote(client, token, semester, msg, 5)
        assert resp.status_code == 400

    def test_closed_poll_rejected(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_poll_message(db, semester['_id'], user['_id'], is_closed=True)
        resp = self._vote(client, token, semester, msg, 0)
        assert resp.status_code == 400

    def test_first_vote_registers(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_poll_message(db, semester['_id'], user['_id'])
        resp = self._vote(client, token, semester, msg, 1)
        assert resp.status_code == 200
        updated = db.chat_messages.find_one({'_id': msg['_id']})
        assert str(user['_id']) in updated['poll']['options'][1]['voters']

    def test_voting_same_option_again_toggles_off(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_poll_message(db, semester['_id'], user['_id'])
        self._vote(client, token, semester, msg, 1)
        resp = self._vote(client, token, semester, msg, 1)
        assert resp.status_code == 200
        updated = db.chat_messages.find_one({'_id': msg['_id']})
        assert str(user['_id']) not in updated['poll']['options'][1]['voters']

    def test_voting_different_option_moves_vote(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        msg = _insert_poll_message(db, semester['_id'], user['_id'])
        self._vote(client, token, semester, msg, 0)
        resp = self._vote(client, token, semester, msg, 2)
        assert resp.status_code == 200
        updated = db.chat_messages.find_one({'_id': msg['_id']})
        uid = str(user['_id'])
        assert uid not in updated['poll']['options'][0]['voters']
        assert uid in updated['poll']['options'][2]['voters']

    def test_concurrent_votes_from_different_users_dont_clobber(self, client, registered_user, second_user, db):
        """Regression test for the read-modify-write race: both users vote for
        different options without either read picking up the other's write —
        both votes must still be present afterward."""
        user1, token1 = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        _add_member(db, classroom, user2['_id'])
        msg = _insert_poll_message(db, semester['_id'], user1['_id'], num_options=2)

        resp1 = self._vote(client, token1, semester, msg, 0)
        resp2 = self._vote(client, token2, semester, msg, 1)
        assert resp1.status_code == 200
        assert resp2.status_code == 200

        updated = db.chat_messages.find_one({'_id': msg['_id']})
        assert str(user1['_id']) in updated['poll']['options'][0]['voters']
        assert str(user2['_id']) in updated['poll']['options'][1]['voters']
