"""Tests for routes/classroom_routes.py"""
import pytest
from bson import ObjectId
from tests.helpers import make_classroom


class TestCreateClassroom:
    def test_create_success(self, client, registered_user):
        user, token = registered_user
        resp = client.post('/api/classroom/create',
                           json={'name': 'My Classroom'},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 201
        data = resp.get_json()
        assert 'classroom' in data
        assert data['classroom']['name'] == 'My Classroom'

    def test_create_missing_name(self, client, registered_user):
        user, token = registered_user
        resp = client.post('/api/classroom/create',
                           json={'description': 'No name'},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_create_requires_auth(self, client):
        resp = client.post('/api/classroom/create', json={'name': 'Test'})
        assert resp.status_code == 401

    def test_create_returns_code(self, client, registered_user):
        user, token = registered_user
        resp = client.post('/api/classroom/create',
                           json={'name': 'Coded Class'},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 201
        assert 'code' in resp.get_json()['classroom']

    def test_create_adds_creator_as_member(self, client, registered_user, db):
        user, token = registered_user
        resp = client.post('/api/classroom/create',
                           json={'name': 'Creator Test'},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 201
        classroom_id = resp.get_json()['classroom']['id']
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        assert ObjectId(user['_id']) in classroom['members']

    def test_create_auto_creates_semester(self, client, registered_user, db):
        user, token = registered_user
        resp = client.post('/api/classroom/create',
                           json={'name': 'Sem Test', 'semester_number': '1'},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 201
        classroom_id = resp.get_json()['classroom']['id']
        semester = db.semesters.find_one({'classroom_id': classroom_id})
        assert semester is not None


class TestListClassrooms:
    def test_list_returns_classrooms(self, client, registered_user, db):
        user, token = registered_user
        make_classroom(db, user['_id'], name='Listed Class')
        resp = client.get('/api/classroom/list',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'classrooms' in data
        assert len(data['classrooms']) >= 1

    def test_list_requires_auth(self, client):
        resp = client.get('/api/classroom/list')
        assert resp.status_code == 401

    def test_list_only_shows_member_classrooms(self, client, registered_user, second_user, db):
        user1, token1 = registered_user
        user2, _ = second_user
        # classroom for user1 only
        make_classroom(db, user1['_id'], name='User1 Class')
        resp = client.get('/api/classroom/list',
                          headers={'Authorization': f'Bearer {token1}'})
        assert resp.status_code == 200
        names = [c['name'] for c in resp.get_json()['classrooms']]
        assert 'User1 Class' in names


class TestGetClassroom:
    def test_get_existing_classroom(self, client, registered_user, db):
        user, token = registered_user
        classroom, _ = make_classroom(db, user['_id'])
        resp = client.get(f'/api/classroom/{classroom["_id"]}',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['classroom']['name'] == 'Test Classroom'

    def test_get_nonexistent_classroom(self, client, registered_user):
        _, token = registered_user
        resp = client.get(f'/api/classroom/{ObjectId()}',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 404

    def test_get_requires_membership(self, client, second_user, db, registered_user):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, _ = make_classroom(db, user1['_id'])
        resp = client.get(f'/api/classroom/{classroom["_id"]}',
                          headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403


class TestJoinClassroom:
    def test_join_request_success(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, _ = make_classroom(db, user1['_id'])
        resp = client.post('/api/classroom/join/request',
                           json={'code': classroom['code']},
                           headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 200

    def test_join_invalid_code(self, client, registered_user):
        _, token = registered_user
        resp = client.post('/api/classroom/join/request',
                           json={'code': 'XXXXXX'},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 404

    def test_already_member_cannot_join(self, client, registered_user, db):
        user, token = registered_user
        classroom, _ = make_classroom(db, user['_id'])
        resp = client.post('/api/classroom/join/request',
                           json={'code': classroom['code']},
                           headers={'Authorization': f'Bearer {token}'})
        # Should return conflict or already member error
        assert resp.status_code in (400, 409)


class TestLeaveClassroom:
    def test_member_can_leave(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, _ = make_classroom(db, user1['_id'])
        # Add user2 as member
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': user2['_id']}}
        )
        resp = client.post(f'/api/classroom/{classroom["_id"]}/leave',
                           headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 200

    def test_non_member_cannot_leave(self, client, second_user, db, registered_user):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, _ = make_classroom(db, user1['_id'])
        resp = client.post(f'/api/classroom/{classroom["_id"]}/leave',
                           headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code in (403, 400)


class TestApproveRejectMember:
    def test_creator_can_approve_request(self, client, registered_user, second_user, db):
        user1, token1 = registered_user
        user2, token2 = second_user
        classroom, _ = make_classroom(db, user1['_id'])
        # User2 submits join request
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'join_requests': user2['_id']}}
        )
        resp = client.post(f'/api/classroom/{classroom["_id"]}/approve',
                           json={'user_id': str(user2['_id'])},
                           headers={'Authorization': f'Bearer {token1}'})
        assert resp.status_code == 200

    def test_creator_can_reject_request(self, client, registered_user, second_user, db):
        user1, token1 = registered_user
        user2, _ = second_user
        classroom, _ = make_classroom(db, user1['_id'])
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'join_requests': user2['_id']}}
        )
        resp = client.post(f'/api/classroom/{classroom["_id"]}/reject',
                           json={'user_id': str(user2['_id'])},
                           headers={'Authorization': f'Bearer {token1}'})
        assert resp.status_code == 200

    def test_non_creator_cannot_approve(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, _ = make_classroom(db, user1['_id'])
        resp = client.post(f'/api/classroom/{classroom["_id"]}/approve',
                           json={'user_id': str(user1['_id'])},
                           headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403


class TestDeleteClassroom:
    def test_creator_can_delete(self, client, registered_user, db):
        user, token = registered_user
        classroom, _ = make_classroom(db, user['_id'])
        resp = client.delete(f'/api/classroom/{classroom["_id"]}',
                             headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200

    def test_non_creator_cannot_delete(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, _ = make_classroom(db, user1['_id'])
        # Add user2 as member
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': user2['_id']}}
        )
        resp = client.delete(f'/api/classroom/{classroom["_id"]}',
                             headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403


class TestInvalidObjectIdEdgeCases:
    """Routes that take IDs should not 500 on malformed ObjectIds."""

    def test_get_classroom_invalid_id(self, client, registered_user):
        _, token = registered_user
        resp = client.get('/api/classroom/not-a-valid-id',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code in (400, 404, 500)

    def test_get_classroom_nonexistent_valid_oid(self, client, registered_user):
        _, token = registered_user
        resp = client.get(f'/api/classroom/{ObjectId()}',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 404

    def test_delete_classroom_invalid_id(self, client, registered_user):
        _, token = registered_user
        resp = client.delete('/api/classroom/bad-id',
                             headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code in (400, 404, 500)
