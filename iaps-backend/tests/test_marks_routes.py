"""Tests for routes/marks_routes.py"""
import pytest
from bson import ObjectId
from tests.helpers import make_classroom, make_subject


# ── helpers ──────────────────────────────────────────────────────────────────

def _auth(token):
    return {'Authorization': f'Bearer {token}'}


def _make_class_and_subject(db, user_id, personal=False):
    classroom, semester = make_classroom(db, user_id)
    subject = make_subject(db, classroom['_id'], semester['_id'], user_id, is_personal=personal)
    return classroom, semester, subject


# ── Exam Structure ────────────────────────────────────────────────────────────

class TestGetExamStructure:
    def test_member_gets_none_when_no_structure(self, client, registered_user, db):
        user, token = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        resp = client.get(f'/api/marks/structure/{subject["_id"]}', headers=_auth(token))
        assert resp.status_code == 200
        assert resp.get_json()['structure'] is None

    def test_member_gets_existing_structure(self, client, registered_user, db):
        user, token = registered_user
        _, semester, subject = _make_class_and_subject(db, user['_id'])
        sid = str(subject['_id'])
        db.exam_structures.insert_one({
            'subject_id': sid,
            'semester_id': str(semester['_id']),
            'exams': [{'name': 'Mid', 'max_marks': 50.0, 'weightage': 40.0}],
            'updated_by': str(user['_id']),
            'updated_at': __import__('datetime').datetime.now(__import__('datetime').timezone.utc),
        })
        resp = client.get(f'/api/marks/structure/{sid}', headers=_auth(token))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['structure'] is not None
        assert data['structure']['exams'][0]['name'] == 'Mid'

    def test_non_member_denied(self, client, second_user, registered_user, db):
        user1, _ = registered_user
        _, token2 = second_user
        _, _, subject = _make_class_and_subject(db, user1['_id'])
        resp = client.get(f'/api/marks/structure/{subject["_id"]}', headers=_auth(token2))
        assert resp.status_code == 403

    def test_requires_auth(self, client, registered_user, db):
        user, _ = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        resp = client.get(f'/api/marks/structure/{subject["_id"]}')
        assert resp.status_code == 401


class TestSaveExamStructure:
    def _valid_exams(self):
        return [
            {'name': 'Mid Semester', 'max_marks': 50, 'weightage': 40},
            {'name': 'End Semester', 'max_marks': 100, 'weightage': 60},
        ]

    def test_cr_can_save_structure(self, client, registered_user, db):
        user, token = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        resp = client.post(
            f'/api/marks/structure/{subject["_id"]}',
            json={'exams': self._valid_exams()},
            headers=_auth(token),
        )
        assert resp.status_code == 200
        assert resp.get_json()['message'] == 'Exam structure saved'

    def test_saved_structure_is_retrievable(self, client, registered_user, db):
        user, token = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        sid = str(subject['_id'])
        client.post(f'/api/marks/structure/{sid}',
                    json={'exams': self._valid_exams()}, headers=_auth(token))
        resp = client.get(f'/api/marks/structure/{sid}', headers=_auth(token))
        assert resp.status_code == 200
        exams = resp.get_json()['structure']['exams']
        assert len(exams) == 2
        assert exams[0]['name'] == 'Mid Semester'

    def test_non_cr_cannot_save(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester, subject = _make_class_and_subject(db, user1['_id'])
        # Add user2 as member (not CR)
        db.classrooms.update_one({'_id': classroom['_id']}, {'$push': {'members': user2['_id']}})
        resp = client.post(
            f'/api/marks/structure/{subject["_id"]}',
            json={'exams': self._valid_exams()},
            headers=_auth(token2),
        )
        assert resp.status_code == 403

    def test_weightage_over_100_rejected(self, client, registered_user, db):
        user, token = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        resp = client.post(
            f'/api/marks/structure/{subject["_id"]}',
            json={'exams': [
                {'name': 'Mid', 'max_marks': 50, 'weightage': 60},
                {'name': 'End', 'max_marks': 100, 'weightage': 60},
            ]},
            headers=_auth(token),
        )
        assert resp.status_code == 400
        assert 'weightage' in resp.get_json()['error'].lower()

    def test_exam_with_empty_name_rejected(self, client, registered_user, db):
        user, token = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        resp = client.post(
            f'/api/marks/structure/{subject["_id"]}',
            json={'exams': [{'name': '', 'max_marks': 50, 'weightage': 40}]},
            headers=_auth(token),
        )
        assert resp.status_code == 400

    def test_exam_with_zero_max_marks_rejected(self, client, registered_user, db):
        user, token = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        resp = client.post(
            f'/api/marks/structure/{subject["_id"]}',
            json={'exams': [{'name': 'Mid', 'max_marks': 0, 'weightage': 40}]},
            headers=_auth(token),
        )
        assert resp.status_code == 400

    def test_negative_weightage_rejected(self, client, registered_user, db):
        user, token = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        resp = client.post(
            f'/api/marks/structure/{subject["_id"]}',
            json={'exams': [{'name': 'Mid', 'max_marks': 50, 'weightage': -10}]},
            headers=_auth(token),
        )
        assert resp.status_code == 400

    def test_empty_exams_list_is_valid(self, client, registered_user, db):
        """Clearing the structure is allowed."""
        user, token = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        resp = client.post(
            f'/api/marks/structure/{subject["_id"]}',
            json={'exams': []},
            headers=_auth(token),
        )
        assert resp.status_code == 200


# ── Personal Marks ────────────────────────────────────────────────────────────

class TestGetMyMarks:
    def test_returns_none_when_no_marks(self, client, registered_user, db):
        user, token = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        resp = client.get(f'/api/marks/my/{subject["_id"]}', headers=_auth(token))
        assert resp.status_code == 200
        assert resp.get_json()['marks'] is None

    def test_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        _, token2 = second_user
        _, _, subject = _make_class_and_subject(db, user1['_id'])
        resp = client.get(f'/api/marks/my/{subject["_id"]}', headers=_auth(token2))
        assert resp.status_code == 403


class TestSaveMyMarks:
    def _valid_entries(self):
        return [
            {'name': 'Mid', 'max_marks': 50, 'weightage': 40, 'marks_obtained': 35},
            {'name': 'End', 'max_marks': 100, 'weightage': 60, 'marks_obtained': 75},
        ]

    def test_member_can_save_marks(self, client, registered_user, db):
        user, token = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        resp = client.post(
            f'/api/marks/my/{subject["_id"]}',
            json={'entries': self._valid_entries(), 'grade': 'A'},
            headers=_auth(token),
        )
        assert resp.status_code == 200
        assert resp.get_json()['message'] == 'Marks saved'

    def test_saved_marks_are_retrievable(self, client, registered_user, db):
        user, token = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        sid = str(subject['_id'])
        client.post(f'/api/marks/my/{sid}',
                    json={'entries': self._valid_entries(), 'grade': 'A+'},
                    headers=_auth(token))
        resp = client.get(f'/api/marks/my/{sid}', headers=_auth(token))
        assert resp.status_code == 200
        data = resp.get_json()['marks']
        assert data['grade'] == 'A+'
        assert len(data['entries']) == 2

    def test_marks_isolated_between_users(self, client, registered_user, second_user, db):
        user1, token1 = registered_user
        user2, token2 = second_user
        classroom, semester, subject = _make_class_and_subject(db, user1['_id'])
        db.classrooms.update_one({'_id': classroom['_id']}, {'$push': {'members': user2['_id']}})
        sid = str(subject['_id'])

        client.post(f'/api/marks/my/{sid}',
                    json={'entries': [{'name': 'Mid', 'max_marks': 50, 'weightage': 100, 'marks_obtained': 40}]},
                    headers=_auth(token1))
        client.post(f'/api/marks/my/{sid}',
                    json={'entries': [{'name': 'Mid', 'max_marks': 50, 'weightage': 100, 'marks_obtained': 20}]},
                    headers=_auth(token2))

        r1 = client.get(f'/api/marks/my/{sid}', headers=_auth(token1)).get_json()
        r2 = client.get(f'/api/marks/my/{sid}', headers=_auth(token2)).get_json()
        assert r1['marks']['entries'][0]['marks_obtained'] == 40.0
        assert r2['marks']['entries'][0]['marks_obtained'] == 20.0

    def test_empty_name_entry_rejected(self, client, registered_user, db):
        user, token = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        resp = client.post(
            f'/api/marks/my/{subject["_id"]}',
            json={'entries': [{'name': '', 'max_marks': 50, 'weightage': 40, 'marks_obtained': 30}]},
            headers=_auth(token),
        )
        assert resp.status_code == 400

    def test_zero_max_marks_rejected(self, client, registered_user, db):
        user, token = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        resp = client.post(
            f'/api/marks/my/{subject["_id"]}',
            json={'entries': [{'name': 'Mid', 'max_marks': 0, 'weightage': 50, 'marks_obtained': 0}]},
            headers=_auth(token),
        )
        assert resp.status_code == 400

    def test_total_weightage_over_100_rejected(self, client, registered_user, db):
        user, token = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        resp = client.post(
            f'/api/marks/my/{subject["_id"]}',
            json={'entries': [
                {'name': 'A', 'max_marks': 50, 'weightage': 70, 'marks_obtained': 30},
                {'name': 'B', 'max_marks': 50, 'weightage': 50, 'marks_obtained': 30},
            ]},
            headers=_auth(token),
        )
        assert resp.status_code == 400

    def test_scaled_marks_over_100_rejected(self, client, registered_user, db):
        user, token = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        # 110/100 * 100 = 110 scaled — exceeds 100
        resp = client.post(
            f'/api/marks/my/{subject["_id"]}',
            json={'entries': [{'name': 'End', 'max_marks': 100, 'weightage': 100, 'marks_obtained': 110}]},
            headers=_auth(token),
        )
        assert resp.status_code == 400

    def test_non_member_cannot_save(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        _, token2 = second_user
        _, _, subject = _make_class_and_subject(db, user1['_id'])
        resp = client.post(
            f'/api/marks/my/{subject["_id"]}',
            json={'entries': []},
            headers=_auth(token2),
        )
        assert resp.status_code == 403

    def test_requires_auth(self, client, registered_user, db):
        user, _ = registered_user
        _, _, subject = _make_class_and_subject(db, user['_id'])
        resp = client.post(f'/api/marks/my/{subject["_id"]}', json={'entries': []})
        assert resp.status_code == 401
