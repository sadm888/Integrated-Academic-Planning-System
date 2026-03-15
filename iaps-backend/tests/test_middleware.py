"""Tests for middleware.py"""
import pytest
import jwt
from datetime import datetime, timedelta
from bson import ObjectId
from unittest.mock import MagicMock, patch


SECRET_KEY = 'test-secret-key'


# ---------------------------------------------------------------------------
# token_required decorator
# ---------------------------------------------------------------------------
class TestTokenRequired:
    def test_missing_token_returns_401(self, client):
        response = client.get('/api/auth/verify')
        assert response.status_code == 401
        assert b'Token is missing' in response.data

    def test_invalid_token_returns_401(self, client):
        response = client.get('/api/auth/verify',
                              headers={'Authorization': 'Bearer not.a.valid.token'})
        assert response.status_code == 401
        assert b'Invalid token' in response.data

    def test_expired_token_returns_401(self, client):
        expired_payload = {
            'user_id': str(ObjectId()),
            'email': 'x@x.com',
            'username': 'x',
            'exp': datetime.utcnow() - timedelta(days=1),
        }
        expired_token = jwt.encode(expired_payload, SECRET_KEY, algorithm='HS256')
        response = client.get('/api/auth/verify',
                              headers={'Authorization': f'Bearer {expired_token}'})
        assert response.status_code == 401
        assert b'expired' in response.data.lower()

    def test_valid_token_passes(self, client, registered_user):
        user, token = registered_user
        response = client.get('/api/auth/verify',
                              headers={'Authorization': f'Bearer {token}'})
        # 200 if user exists, not 401
        assert response.status_code != 401

    def test_bearer_prefix_stripped(self, client, registered_user):
        user, token = registered_user
        response = client.get('/api/auth/verify',
                              headers={'Authorization': f'Bearer {token}'})
        assert response.status_code not in (401,)


# ---------------------------------------------------------------------------
# Helper functions (unit tests, no Flask context needed for most)
# ---------------------------------------------------------------------------
class TestHelpers:
    def test_is_member_of_classroom_true(self):
        from middleware import is_member_of_classroom
        user_oid = ObjectId()
        classroom = {'members': [user_oid, ObjectId()]}
        assert is_member_of_classroom(classroom, user_oid) is True

    def test_is_member_of_classroom_false(self):
        from middleware import is_member_of_classroom
        user_oid = ObjectId()
        classroom = {'members': [ObjectId(), ObjectId()]}
        assert is_member_of_classroom(classroom, user_oid) is False

    def test_is_member_of_classroom_with_string_id(self):
        from middleware import is_member_of_classroom
        user_oid = ObjectId()
        classroom = {'members': [user_oid]}
        assert is_member_of_classroom(classroom, str(user_oid)) is True

    def test_is_member_of_classroom_empty(self):
        from middleware import is_member_of_classroom
        classroom = {'members': []}
        assert is_member_of_classroom(classroom, ObjectId()) is False

    def test_is_member_no_members_key(self):
        from middleware import is_member_of_classroom
        classroom = {}
        assert is_member_of_classroom(classroom, ObjectId()) is False

    def test_is_cr_of_semester_true(self, db):
        from middleware import is_cr_of_semester
        user_oid = ObjectId()
        sem_id = ObjectId()
        db.semesters.insert_one({
            '_id': sem_id,
            'cr_ids': [user_oid],
            'is_active': True,
        })
        result, semester = is_cr_of_semester(db, str(sem_id), str(user_oid))
        assert result is True
        assert semester is not None

    def test_is_cr_of_semester_false(self, db):
        from middleware import is_cr_of_semester
        user_oid = ObjectId()
        sem_id = ObjectId()
        db.semesters.insert_one({
            '_id': sem_id,
            'cr_ids': [ObjectId()],
            'is_active': True,
        })
        result, semester = is_cr_of_semester(db, str(sem_id), str(user_oid))
        assert result is False

    def test_is_cr_semester_not_found(self, db):
        from middleware import is_cr_of_semester
        result, semester = is_cr_of_semester(db, str(ObjectId()), str(ObjectId()))
        assert result is False
        assert semester is None

    def test_get_active_semester(self, db):
        from middleware import get_active_semester
        classroom_id = ObjectId()
        sem_id = ObjectId()
        db.semesters.insert_one({
            '_id': sem_id,
            'classroom_id': str(classroom_id),
            'is_active': True,
        })
        result = get_active_semester(db, str(classroom_id))
        assert result is not None
        assert result['_id'] == sem_id

    def test_get_active_semester_none_when_missing(self, db):
        from middleware import get_active_semester
        result = get_active_semester(db, str(ObjectId()))
        assert result is None
