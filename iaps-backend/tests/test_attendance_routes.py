"""Tests for attendance_routes.py — cr-summary endpoint."""
import pytest
from bson import ObjectId
from datetime import datetime, timezone

from tests.conftest import make_token, auth_header
from tests.helpers import make_classroom


class TestCrSubjectSummary:
    """GET /api/attendance/semester/<id>/subject/<subject>/cr-summary"""

    def _setup(self, db):
        """Create a classroom+semester with two members, the creator is CR."""
        creator_id = ObjectId()
        member_id = ObjectId()

        # Insert users
        db.users.insert_many([
            {
                '_id': creator_id,
                'username': 'cr_user',
                'email': 'cr@example.com',
                'fullName': 'CR User',
                'roll_number': '001',
                'profile_picture': None,
            },
            {
                '_id': member_id,
                'username': 'student',
                'email': 'student@example.com',
                'fullName': 'Student',
                'roll_number': '002',
                'profile_picture': None,
            },
        ])

        classroom_id = ObjectId()
        classroom = {
            '_id': classroom_id,
            'name': 'Test Classroom',
            'code': 'TC001',
            'created_by': creator_id,
            'members': [creator_id, member_id],
            'join_requests': [],
            'created_at': datetime.now(timezone.utc),
        }
        db.classrooms.insert_one(classroom)

        semester_id = ObjectId()
        semester = {
            '_id': semester_id,
            'classroom_id': str(classroom_id),
            'name': 'Sem 1',
            'cr_ids': [creator_id],
            'is_active': True,
            'created_at': datetime.now(timezone.utc),
        }
        db.semesters.insert_one(semester)

        cr_token = make_token(str(creator_id), 'cr@example.com')
        student_token = make_token(str(member_id), 'student@example.com')

        return semester_id, creator_id, member_id, cr_token, student_token

    def _add_session_and_records(self, db, semester_id, subject, student_id, cr_status):
        """Insert one happened session and an attendance record for one student."""
        sess_id = ObjectId()
        db.attendance_sessions.insert_one({
            '_id': sess_id,
            'semester_id': str(semester_id),
            'subject': subject,
            'date': '2026-03-10',
            'slot': '09:00-10:00',
            'status': 'happened',
        })
        db.attendance_records.insert_one({
            'session_id': str(sess_id),
            'semester_id': str(semester_id),
            'subject': subject,
            'student_id': str(student_id),
            'status': cr_status,
        })
        return sess_id

    def test_returns_student_list(self, client, db):
        semester_id, creator_id, member_id, cr_token, _ = self._setup(db)
        self._add_session_and_records(db, semester_id, 'Math', member_id, 'present')

        resp = client.get(
            f'/api/attendance/semester/{semester_id}/subject/Math/cr-summary',
            headers=auth_header(cr_token),
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'students' in data
        assert data['total_sessions'] == 1
        students = {s['user_id']: s for s in data['students']}
        assert str(member_id) in students
        st = students[str(member_id)]
        assert st['attended'] == 1
        assert st['total'] == 1
        assert st['percentage'] == 100.0

    def test_absent_student(self, client, db):
        semester_id, creator_id, member_id, cr_token, _ = self._setup(db)
        self._add_session_and_records(db, semester_id, 'Math', member_id, 'absent')

        resp = client.get(
            f'/api/attendance/semester/{semester_id}/subject/Math/cr-summary',
            headers=auth_header(cr_token),
        )
        assert resp.status_code == 200
        data = resp.get_json()
        students = {s['user_id']: s for s in data['students']}
        st = students[str(member_id)]
        assert st['attended'] == 0
        assert st['percentage'] == 0.0
        assert st['below_threshold'] is True

    def test_leave_counts_as_attended(self, client, db):
        semester_id, creator_id, member_id, cr_token, _ = self._setup(db)
        self._add_session_and_records(db, semester_id, 'Math', member_id, 'leave')

        resp = client.get(
            f'/api/attendance/semester/{semester_id}/subject/Math/cr-summary',
            headers=auth_header(cr_token),
        )
        assert resp.status_code == 200
        students = {s['user_id']: s for s in resp.get_json()['students']}
        st = students[str(member_id)]
        assert st['attended'] == 1
        assert st['percentage'] == 100.0

    def test_college_work_counts_as_attended(self, client, db):
        semester_id, creator_id, member_id, cr_token, _ = self._setup(db)
        self._add_session_and_records(db, semester_id, 'Math', member_id, 'college_work')

        resp = client.get(
            f'/api/attendance/semester/{semester_id}/subject/Math/cr-summary',
            headers=auth_header(cr_token),
        )
        assert resp.status_code == 200
        students = {s['user_id']: s for s in resp.get_json()['students']}
        assert students[str(member_id)]['attended'] == 1

    def test_no_sessions_returns_null_percentage(self, client, db):
        semester_id, _, member_id, cr_token, _ = self._setup(db)

        resp = client.get(
            f'/api/attendance/semester/{semester_id}/subject/Math/cr-summary',
            headers=auth_header(cr_token),
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['total_sessions'] == 0
        for s in data['students']:
            assert s['percentage'] is None

    def test_non_cr_member_forbidden(self, client, db):
        semester_id, _, _, _, student_token = self._setup(db)

        resp = client.get(
            f'/api/attendance/semester/{semester_id}/subject/Math/cr-summary',
            headers=auth_header(student_token),
        )
        assert resp.status_code == 403

    def test_unauthenticated_forbidden(self, client, db):
        semester_id, _, _, _, _ = self._setup(db)

        resp = client.get(
            f'/api/attendance/semester/{semester_id}/subject/Math/cr-summary',
        )
        assert resp.status_code == 401

    def test_invalid_semester_id_forbidden(self, client, db):
        _, _, _, cr_token, _ = self._setup(db)
        fake_id = str(ObjectId())

        resp = client.get(
            f'/api/attendance/semester/{fake_id}/subject/Math/cr-summary',
            headers=auth_header(cr_token),
        )
        assert resp.status_code == 403
