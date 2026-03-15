"""Tests for routes/todo_routes.py"""
import pytest
from bson import ObjectId
from tests.helpers import make_classroom


class TestCreateTodo:
    def test_create_success(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.post('/api/todo/create', json={
            'classroom_id': str(classroom['_id']),
            'semester_id': str(semester['_id']),
            'text': 'Study for exam',
        }, headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data['todo']['text'] == 'Study for exam'
        assert data['todo']['completed'] is False

    def test_create_missing_text(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.post('/api/todo/create', json={
            'classroom_id': str(classroom['_id']),
            'semester_id': str(semester['_id']),
        }, headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_create_requires_auth(self, client):
        resp = client.post('/api/todo/create', json={'text': 'Test'})
        assert resp.status_code == 401

    def test_create_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        resp = client.post('/api/todo/create', json={
            'classroom_id': str(classroom['_id']),
            'semester_id': str(semester['_id']),
            'text': 'Unauthorized todo',
        }, headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_create_with_due_date(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.post('/api/todo/create', json={
            'classroom_id': str(classroom['_id']),
            'semester_id': str(semester['_id']),
            'text': 'Due soon',
            'due_date': '2024-12-31',
        }, headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 201
        assert resp.get_json()['todo']['due_date'] == '2024-12-31'


class TestListTodos:
    def test_list_todos_empty(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.get(f'/api/todo/semester/{semester["_id"]}/list',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        assert resp.get_json()['todos'] == []

    def test_list_todos_returns_own_todos(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        # Create a todo first
        client.post('/api/todo/create', json={
            'classroom_id': str(classroom['_id']),
            'semester_id': str(semester['_id']),
            'text': 'My todo',
        }, headers={'Authorization': f'Bearer {token}'})
        resp = client.get(f'/api/todo/semester/{semester["_id"]}/list',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        assert len(resp.get_json()['todos']) == 1

    def test_list_requires_membership(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        resp = client.get(f'/api/todo/semester/{semester["_id"]}/list',
                          headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_list_nonexistent_semester(self, client, registered_user):
        _, token = registered_user
        resp = client.get(f'/api/todo/semester/{ObjectId()}',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 404


class TestToggleTodo:
    def _create_todo(self, client, token, classroom, semester):
        resp = client.post('/api/todo/create', json={
            'classroom_id': str(classroom['_id']),
            'semester_id': str(semester['_id']),
            'text': 'Toggle me',
        }, headers={'Authorization': f'Bearer {token}'})
        return resp.get_json()['todo']['id']

    def test_toggle_completes_todo(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        todo_id = self._create_todo(client, token, classroom, semester)
        resp = client.patch(f'/api/todo/{todo_id}/toggle',
                            headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        assert resp.get_json()['completed'] is True

    def test_toggle_twice_uncompletes(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        todo_id = self._create_todo(client, token, classroom, semester)
        client.patch(f'/api/todo/{todo_id}/toggle',
                     headers={'Authorization': f'Bearer {token}'})
        resp = client.patch(f'/api/todo/{todo_id}/toggle',
                            headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        assert resp.get_json()['completed'] is False

    def test_toggle_other_users_todo_denied(self, client, registered_user, second_user, db):
        user1, token1 = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        # Add user2 as member
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': user2['_id']}}
        )
        todo_id = self._create_todo(client, token1, classroom, semester)
        resp = client.patch(f'/api/todo/{todo_id}/toggle',
                            headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_toggle_nonexistent_returns_404(self, client, registered_user):
        _, token = registered_user
        resp = client.patch(f'/api/todo/{ObjectId()}/toggle',
                            headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 404


class TestDeleteTodo:
    def _create_todo(self, client, token, classroom, semester):
        resp = client.post('/api/todo/create', json={
            'classroom_id': str(classroom['_id']),
            'semester_id': str(semester['_id']),
            'text': 'Delete me',
        }, headers={'Authorization': f'Bearer {token}'})
        return resp.get_json()['todo']['id']

    def test_creator_can_delete(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        todo_id = self._create_todo(client, token, classroom, semester)
        resp = client.delete(f'/api/todo/{todo_id}',
                             headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200

    def test_other_user_cannot_delete(self, client, registered_user, second_user, db):
        user1, token1 = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': user2['_id']}}
        )
        todo_id = self._create_todo(client, token1, classroom, semester)
        resp = client.delete(f'/api/todo/{todo_id}',
                             headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_delete_nonexistent_returns_404(self, client, registered_user):
        _, token = registered_user
        resp = client.delete(f'/api/todo/{ObjectId()}',
                             headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 404

    def test_deleted_todo_not_in_list(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        todo_id = self._create_todo(client, token, classroom, semester)
        client.delete(f'/api/todo/{todo_id}',
                      headers={'Authorization': f'Bearer {token}'})
        resp = client.get(f'/api/todo/semester/{semester["_id"]}/list',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.get_json()['todos'] == []
