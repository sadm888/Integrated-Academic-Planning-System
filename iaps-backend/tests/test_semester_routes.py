"""Tests for routes/semester_routes.py"""
import pytest
from bson import ObjectId
from tests.helpers import make_classroom


class TestCreateSemester:
    def test_cr_can_create_new_semester(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.post('/api/semester/create', json={
            'classroom_id': str(classroom['_id']),
            'name': 'Semester 2 (Even)',
            'type': 'even',
            'year': '2025',
            'session': 'Jan-Jun',
        }, headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data['semester']['name'] == 'Semester 2 (Even)'
        assert data['semester']['is_active'] is True

    def test_create_archives_previous_active_semester(self, client, registered_user, db):
        user, token = registered_user
        classroom, old_semester = make_classroom(db, user['_id'])
        assert old_semester['is_active'] is True

        client.post('/api/semester/create', json={
            'classroom_id': str(classroom['_id']),
            'name': 'New Semester',
        }, headers={'Authorization': f'Bearer {token}'})

        # Previous semester should now be inactive
        old = db.semesters.find_one({'_id': old_semester['_id']})
        assert old['is_active'] is False

    def test_non_cr_member_cannot_create(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, _ = make_classroom(db, user1['_id'])
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': user2['_id']}}
        )
        resp = client.post('/api/semester/create', json={
            'classroom_id': str(classroom['_id']),
            'name': 'Unauthorized Semester',
        }, headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_missing_name_returns_400(self, client, registered_user, db):
        user, token = registered_user
        classroom, _ = make_classroom(db, user['_id'])
        resp = client.post('/api/semester/create', json={
            'classroom_id': str(classroom['_id']),
        }, headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_missing_classroom_id_returns_400(self, client, registered_user):
        _, token = registered_user
        resp = client.post('/api/semester/create', json={
            'name': 'No Classroom',
        }, headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_requires_auth(self, client):
        resp = client.post('/api/semester/create', json={'name': 'test'})
        assert resp.status_code == 401


class TestGetSemester:
    def test_member_can_get_semester(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.get(f'/api/semester/{semester["_id"]}',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'semester' in data
        assert data['semester']['id'] == str(semester['_id'])

    def test_nonexistent_semester_returns_404(self, client, registered_user):
        _, token = registered_user
        resp = client.get(f'/api/semester/{ObjectId()}',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 404

    def test_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        resp = client.get(f'/api/semester/{semester["_id"]}',
                          headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_response_includes_is_cr_flag(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.get(f'/api/semester/{semester["_id"]}',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'is_user_cr' in data['semester']
        assert data['semester']['is_user_cr'] is True  # creator is CR


class TestListSemesters:
    def test_list_returns_semesters(self, client, registered_user, db):
        user, token = registered_user
        classroom, _ = make_classroom(db, user['_id'])
        resp = client.get(f'/api/semester/classroom/{classroom["_id"]}/list',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'semesters' in data
        assert len(data['semesters']) >= 1

    def test_list_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, _ = make_classroom(db, user1['_id'])
        resp = client.get(f'/api/semester/classroom/{classroom["_id"]}/list',
                          headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403


class TestNominateCR:
    def test_cr_can_nominate_member(self, client, registered_user, second_user, db):
        user1, token1 = registered_user
        user2, _ = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': user2['_id']}}
        )
        resp = client.post(f'/api/semester/{semester["_id"]}/nominate-cr',
                           json={'user_id': str(user2['_id'])},
                           headers={'Authorization': f'Bearer {token1}'})
        assert resp.status_code in (200, 201)

    def test_non_cr_cannot_nominate(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': user2['_id']}}
        )
        resp = client.post(f'/api/semester/{semester["_id"]}/nominate-cr',
                           json={'user_id': str(user1['_id'])},
                           headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403
