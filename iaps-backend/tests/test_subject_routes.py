"""Tests for routes/subject_routes.py"""
import pytest
from bson import ObjectId
from tests.helpers import make_classroom, make_subject


class TestCreateSubject:
    def test_cr_can_create_class_subject(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.post('/api/subject/create', json={
            'classroom_id': str(classroom['_id']),
            'semester_id': str(semester['_id']),
            'name': 'Mathematics',
            'code': 'MTH101',
        }, headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data['subject']['name'] == 'Mathematics'
        assert data['subject']['personal'] is False

    def test_non_cr_creates_personal_subject(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        # Add user2 as member (not CR)
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': user2['_id']}}
        )
        resp = client.post('/api/subject/create', json={
            'classroom_id': str(classroom['_id']),
            'semester_id': str(semester['_id']),
            'name': 'Personal Study',
        }, headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 201
        assert resp.get_json()['subject']['personal'] is True

    def test_create_missing_name(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.post('/api/subject/create', json={
            'classroom_id': str(classroom['_id']),
            'semester_id': str(semester['_id']),
        }, headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_duplicate_subject_name_rejected(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        client.post('/api/subject/create', json={
            'classroom_id': str(classroom['_id']),
            'semester_id': str(semester['_id']),
            'name': 'Physics',
        }, headers={'Authorization': f'Bearer {token}'})
        resp = client.post('/api/subject/create', json={
            'classroom_id': str(classroom['_id']),
            'semester_id': str(semester['_id']),
            'name': 'Physics',
        }, headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_non_member_cannot_create(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        resp = client.post('/api/subject/create', json={
            'classroom_id': str(classroom['_id']),
            'semester_id': str(semester['_id']),
            'name': 'Unauthorized',
        }, headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403


class TestListSubjects:
    def test_list_returns_subjects(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        make_subject(db, classroom['_id'], semester['_id'], user['_id'])
        resp = client.get(f'/api/subject/semester/{semester["_id"]}/list',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data['subjects']) == 1

    def test_list_empty_semester(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.get(f'/api/subject/semester/{semester["_id"]}/list',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        assert resp.get_json()['subjects'] == []

    def test_list_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        resp = client.get(f'/api/subject/semester/{semester["_id"]}/list',
                          headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_personal_subjects_isolated(self, client, registered_user, second_user, db):
        """User2 should not see User1's personal subjects."""
        user1, token1 = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': user2['_id']}}
        )
        # User2 creates a personal subject
        client.post('/api/subject/create', json={
            'classroom_id': str(classroom['_id']),
            'semester_id': str(semester['_id']),
            'name': 'My Personal',
        }, headers={'Authorization': f'Bearer {token2}'})
        # User1 should not see it
        resp = client.get(f'/api/subject/semester/{semester["_id"]}/list',
                          headers={'Authorization': f'Bearer {token1}'})
        assert resp.status_code == 200
        names = [s['name'] for s in resp.get_json()['subjects']]
        assert 'My Personal' not in names


class TestDeleteSubject:
    def test_cr_can_delete_class_subject(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        subj = make_subject(db, classroom['_id'], semester['_id'], user['_id'])
        resp = client.delete(f'/api/subject/{subj["_id"]}',
                             headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200

    def test_non_cr_cannot_delete_class_subject(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': user2['_id']}}
        )
        subj = make_subject(db, classroom['_id'], semester['_id'], user1['_id'])
        resp = client.delete(f'/api/subject/{subj["_id"]}',
                             headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_creator_can_delete_personal_subject(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': user2['_id']}}
        )
        subj = make_subject(db, classroom['_id'], semester['_id'], user2['_id'], is_personal=True)
        resp = client.delete(f'/api/subject/{subj["_id"]}',
                             headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 200

    def test_delete_nonexistent_returns_404(self, client, registered_user):
        _, token = registered_user
        resp = client.delete(f'/api/subject/{ObjectId()}',
                             headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 404


class TestUpdateSubject:
    def test_cr_can_update_class_subject(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        subj = make_subject(db, classroom['_id'], semester['_id'], user['_id'])
        resp = client.patch(f'/api/subject/{subj["_id"]}',
                            json={'credits': '3', 'faculties': ['Dr. Jones']},
                            headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200

    def test_update_no_fields_returns_400(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        subj = make_subject(db, classroom['_id'], semester['_id'], user['_id'])
        resp = client.patch(f'/api/subject/{subj["_id"]}',
                            json={},
                            headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_non_cr_cannot_update_class_subject(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': user2['_id']}}
        )
        subj = make_subject(db, classroom['_id'], semester['_id'], user1['_id'])
        resp = client.patch(f'/api/subject/{subj["_id"]}',
                            json={'credits': '5'},
                            headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403
