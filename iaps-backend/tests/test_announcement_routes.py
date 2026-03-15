"""Tests for routes/announcement_routes.py"""
import pytest
from bson import ObjectId
from tests.helpers import make_classroom


class TestListAnnouncements:
    def test_list_empty(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.get(f'/api/announcement/semester/{semester["_id"]}',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        assert resp.get_json()['announcements'] == []

    def test_list_requires_auth(self, client, registered_user, db):
        user, _ = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.get(f'/api/announcement/semester/{semester["_id"]}')
        assert resp.status_code == 401

    def test_list_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        resp = client.get(f'/api/announcement/semester/{semester["_id"]}',
                          headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403


class TestCreateAnnouncement:
    def test_cr_can_create(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.post(f'/api/announcement/semester/{semester["_id"]}',
                           json={'text': 'Important notice!'},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data['announcement']['text'] == 'Important notice!'

    def test_non_cr_cannot_create(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': user2['_id']}}
        )
        resp = client.post(f'/api/announcement/semester/{semester["_id"]}',
                           json={'text': 'Unauthorized announcement'},
                           headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_empty_text_rejected(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.post(f'/api/announcement/semester/{semester["_id"]}',
                           json={'text': ''},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_text_over_1000_chars_rejected(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.post(f'/api/announcement/semester/{semester["_id"]}',
                           json={'text': 'x' * 1001},
                           headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 400

    def test_announcement_visible_to_members(self, client, registered_user, second_user, db):
        user1, token1 = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': user2['_id']}}
        )
        client.post(f'/api/announcement/semester/{semester["_id"]}',
                    json={'text': 'Visible announcement'},
                    headers={'Authorization': f'Bearer {token1}'})
        resp = client.get(f'/api/announcement/semester/{semester["_id"]}',
                          headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 200
        texts = [a['text'] for a in resp.get_json()['announcements']]
        assert 'Visible announcement' in texts


class TestDeleteAnnouncement:
    def _create_announcement(self, client, token, semester_id, text='Test announcement'):
        resp = client.post(f'/api/announcement/semester/{semester_id}',
                           json={'text': text},
                           headers={'Authorization': f'Bearer {token}'})
        return resp.get_json()['announcement']['id']

    def test_cr_can_delete(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        ann_id = self._create_announcement(client, token, str(semester['_id']))
        resp = client.delete(f'/api/announcement/{ann_id}',
                             headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200

    def test_non_cr_cannot_delete(self, client, registered_user, second_user, db):
        user1, token1 = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'members': user2['_id']}}
        )
        ann_id = self._create_announcement(client, token1, str(semester['_id']))
        resp = client.delete(f'/api/announcement/{ann_id}',
                             headers={'Authorization': f'Bearer {token2}'})
        assert resp.status_code == 403

    def test_delete_nonexistent_returns_404(self, client, registered_user):
        _, token = registered_user
        resp = client.delete(f'/api/announcement/{ObjectId()}',
                             headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 404

    def test_deleted_announcement_not_in_list(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        ann_id = self._create_announcement(client, token, str(semester['_id']))
        client.delete(f'/api/announcement/{ann_id}',
                      headers={'Authorization': f'Bearer {token}'})
        resp = client.get(f'/api/announcement/semester/{semester["_id"]}',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.get_json()['announcements'] == []
