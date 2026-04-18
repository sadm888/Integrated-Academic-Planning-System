"""
Tests for the two analytics endpoints added to marks_routes.py:
  GET /api/marks/trend/<classroom_id>
  GET /api/marks/semester-analytics/<semester_id>

Covers: auth, access control, empty data, partial data, full data,
        score calculation correctness, and edge cases.
"""
import pytest
from bson import ObjectId
from datetime import datetime, timezone
from tests.helpers import make_classroom, make_subject
from tests.conftest import make_token, auth_header


# ── shared setup helpers ──────────────────────────────────────────────────────

def _insert_marks(db, subject_id, user_id, entries, grade=''):
    db.subject_marks.replace_one(
        {'subject_id': str(subject_id), 'user_id': str(user_id)},
        {
            'subject_id': str(subject_id),
            'user_id': str(user_id),
            'entries': entries,
            'grade': grade,
            'updated_at': datetime.now(timezone.utc),
        },
        upsert=True,
    )


def _full_entries():
    """50/50 on Mid (weight 40) + 40/50 on End (weight 60) → (1.0×40 + 0.8×60) = 88.0"""
    return [
        {'name': 'Mid',  'max_marks': 50.0, 'marks_obtained': 50.0, 'weightage': 40.0},
        {'name': 'End',  'max_marks': 50.0, 'marks_obtained': 40.0, 'weightage': 60.0},
    ]


# ── GET /api/marks/trend/<classroom_id> ───────────────────────────────────────

class TestGetMarksTrend:

    def test_requires_auth(self, client, registered_user, db):
        user, _ = registered_user
        classroom, _ = make_classroom(db, user['_id'])
        resp = client.get(f'/api/marks/trend/{classroom["_id"]}')
        assert resp.status_code == 401

    def test_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        _, token2 = second_user
        classroom, _ = make_classroom(db, user1['_id'])
        resp = client.get(
            f'/api/marks/trend/{classroom["_id"]}',
            headers=auth_header(token2),
        )
        assert resp.status_code == 403

    def test_invalid_classroom_id_returns_500(self, client, registered_user, db):
        _, token = registered_user
        resp = client.get('/api/marks/trend/not-an-objectid', headers=auth_header(token))
        assert resp.status_code == 500

    def test_empty_classroom_returns_empty_semesters(self, client, registered_user, db):
        user, token = registered_user
        classroom, _ = make_classroom(db, user['_id'])
        # delete the auto-created semester so we get a truly empty classroom
        db.semesters.delete_many({'classroom_id': str(classroom['_id'])})
        resp = client.get(f'/api/marks/trend/{classroom["_id"]}', headers=auth_header(token))
        assert resp.status_code == 200
        assert resp.get_json()['semesters'] == []

    def test_semester_with_no_subjects(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        resp = client.get(f'/api/marks/trend/{classroom["_id"]}', headers=auth_header(token))
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data['semesters']) == 1
        sem = data['semesters'][0]
        assert sem['overall_score'] is None
        assert sem['subjects'] == []

    def test_subjects_with_no_marks_score_null(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT250')
        resp = client.get(f'/api/marks/trend/{classroom["_id"]}', headers=auth_header(token))
        assert resp.status_code == 200
        sem = resp.get_json()['semesters'][0]
        assert sem['overall_score'] is None
        assert sem['subjects'][0]['score'] is None

    def test_correct_score_calculation(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        subj = make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT250')
        _insert_marks(db, subj['_id'], user['_id'], _full_entries(), grade='A')

        resp = client.get(f'/api/marks/trend/{classroom["_id"]}', headers=auth_header(token))
        assert resp.status_code == 200
        sem = resp.get_json()['semesters'][0]
        # 50/50 × 40 + 40/50 × 60 = 40 + 48 = 88.0
        assert sem['subjects'][0]['score'] == 88.0
        assert sem['subjects'][0]['grade'] == 'A'
        assert sem['overall_score'] == 88.0

    def test_overall_score_is_average_of_scored_subjects(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        subj1 = make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT250')
        subj2 = make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT251')
        # subj1 → 88.0, subj2 → no marks (score=None, excluded from avg)
        _insert_marks(db, subj1['_id'], user['_id'], _full_entries())

        resp = client.get(f'/api/marks/trend/{classroom["_id"]}', headers=auth_header(token))
        sem = resp.get_json()['semesters'][0]
        # only subj1 has a score → overall = 88.0
        assert sem['overall_score'] == 88.0

    def test_overall_score_averages_multiple_subjects(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        subj1 = make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT250')
        subj2 = make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT251')
        # subj1 → 88.0, subj2 → 60.0 (60/100 × 100 = 60)
        _insert_marks(db, subj1['_id'], user['_id'], _full_entries())
        _insert_marks(db, subj2['_id'], user['_id'], [
            {'name': 'End', 'max_marks': 100.0, 'marks_obtained': 60.0, 'weightage': 100.0},
        ])

        resp = client.get(f'/api/marks/trend/{classroom["_id"]}', headers=auth_header(token))
        sem = resp.get_json()['semesters'][0]
        assert sem['overall_score'] == round((88.0 + 60.0) / 2, 2)

    def test_multiple_semesters_returned_in_order(self, client, registered_user, db):
        user, token = registered_user
        classroom, sem1 = make_classroom(db, user['_id'])
        sem2 = {
            '_id': ObjectId(),
            'classroom_id': str(classroom['_id']),
            'name': 'Semester 2',
            'type': 'even', 'year': '2025', 'session': 'Jan-May',
            'cr_ids': [user['_id']], 'is_active': False,
            'created_at': datetime.now(timezone.utc),
        }
        db.semesters.insert_one(sem2)

        resp = client.get(f'/api/marks/trend/{classroom["_id"]}', headers=auth_header(token))
        assert resp.status_code == 200
        names = [s['semester_name'] for s in resp.get_json()['semesters']]
        # sem1 was inserted first so its _id < sem2._id → sem1 appears first
        assert names[0].startswith(sem1.get('name', 'Semester 1'))
        assert len(names) == 2

    def test_zero_weightage_entries_give_null_score(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        subj = make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT250')
        _insert_marks(db, subj['_id'], user['_id'], [
            {'name': 'Mid', 'max_marks': 50.0, 'marks_obtained': 45.0, 'weightage': 0.0},
        ])
        resp = client.get(f'/api/marks/trend/{classroom["_id"]}', headers=auth_header(token))
        sem = resp.get_json()['semesters'][0]
        assert sem['subjects'][0]['score'] is None
        assert sem['overall_score'] is None

    def test_response_shape(self, client, registered_user, db):
        """Response always contains semesters list with required keys."""
        user, token = registered_user
        classroom, _ = make_classroom(db, user['_id'])
        resp = client.get(f'/api/marks/trend/{classroom["_id"]}', headers=auth_header(token))
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'semesters' in data
        assert isinstance(data['semesters'], list)

    def test_subjects_scoped_to_their_own_semester(self, client, registered_user, db):
        """
        Core isolation guarantee: subjects are unique per semester.
        CS101 added to Sem1 must NOT appear in Sem2's subject list,
        and CS201 added to Sem2 must NOT appear in Sem1's subject list.
        This directly validates the backend filter:
            {'semester_id': sem_id, 'classroom_id': classroom_id}
        """
        user, token = registered_user
        classroom, sem1 = make_classroom(db, user['_id'])

        # Second semester in the same classroom
        sem2 = {
            '_id': ObjectId(),
            'classroom_id': str(classroom['_id']),
            'name': 'Semester 2',
            'type': 'even', 'year': '2025', 'session': 'Jan-May',
            'cr_ids': [user['_id']], 'is_active': False,
            'created_at': datetime.now(timezone.utc),
        }
        db.semesters.insert_one(sem2)

        # Each semester gets its own distinct subject
        make_subject(db, classroom['_id'], sem1['_id'], user['_id'], name='CS101')
        make_subject(db, classroom['_id'], sem2['_id'], user['_id'], name='CS201')

        resp = client.get(f'/api/marks/trend/{classroom["_id"]}', headers=auth_header(token))
        assert resp.status_code == 200
        semesters = resp.get_json()['semesters']
        assert len(semesters) == 2

        # sem1 was inserted first → _id is smaller → appears at index 0
        sem1_subject_names = [s['name'] for s in semesters[0]['subjects']]
        sem2_subject_names = [s['name'] for s in semesters[1]['subjects']]

        # Sem1 must contain ONLY CS101
        assert sem1_subject_names == ['CS101'], (
            f"Sem1 subjects should be ['CS101'], got {sem1_subject_names}"
        )
        # Sem2 must contain ONLY CS201
        assert sem2_subject_names == ['CS201'], (
            f"Sem2 subjects should be ['CS201'], got {sem2_subject_names}"
        )
        # Cross-contamination check (belt-and-suspenders)
        assert 'CS201' not in sem1_subject_names, "CS201 leaked into Sem1"
        assert 'CS101' not in sem2_subject_names, "CS101 leaked into Sem2"


# ── GET /api/marks/semester-analytics/<semester_id> ───────────────────────────

class TestGetSemesterAnalytics:

    def test_requires_auth(self, client, registered_user, db):
        user, _ = registered_user
        _, semester = make_classroom(db, user['_id'])
        resp = client.get(f'/api/marks/semester-analytics/{semester["_id"]}')
        assert resp.status_code == 401

    def test_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        _, token2 = second_user
        _, semester = make_classroom(db, user1['_id'])
        resp = client.get(
            f'/api/marks/semester-analytics/{semester["_id"]}',
            headers=auth_header(token2),
        )
        assert resp.status_code == 403

    def test_nonexistent_semester_returns_404(self, client, registered_user, db):
        _, token = registered_user
        resp = client.get(
            f'/api/marks/semester-analytics/{ObjectId()}',
            headers=auth_header(token),
        )
        assert resp.status_code == 404

    def test_invalid_semester_id_returns_500(self, client, registered_user, db):
        _, token = registered_user
        resp = client.get('/api/marks/semester-analytics/bad-id', headers=auth_header(token))
        assert resp.status_code == 500

    def test_no_subjects_returns_empty_list(self, client, registered_user, db):
        user, token = registered_user
        _, semester = make_classroom(db, user['_id'])
        resp = client.get(
            f'/api/marks/semester-analytics/{semester["_id"]}',
            headers=auth_header(token),
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['subjects'] == []
        assert 'semester_name' in data
        assert 'is_cr' in data

    def test_cr_flag_set_for_cr_user(self, client, registered_user, db):
        user, token = registered_user
        _, semester = make_classroom(db, user['_id'])  # creator is CR
        resp = client.get(
            f'/api/marks/semester-analytics/{semester["_id"]}',
            headers=auth_header(token),
        )
        assert resp.get_json()['is_cr'] is True

    def test_cr_flag_false_for_non_cr(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        # add user2 as member (not CR)
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$addToSet': {'members': user2['_id']}},
        )
        resp = client.get(
            f'/api/marks/semester-analytics/{semester["_id"]}',
            headers=auth_header(token2),
        )
        assert resp.get_json()['is_cr'] is False

    def test_subject_with_no_marks_has_null_score(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT250')
        resp = client.get(
            f'/api/marks/semester-analytics/{semester["_id"]}',
            headers=auth_header(token),
        )
        assert resp.status_code == 200
        subj = resp.get_json()['subjects'][0]
        assert subj['name'] == 'IT250'
        assert subj['score'] is None
        assert subj['entries'] == []
        assert subj['grade'] == ''

    def test_correct_score_and_entries_returned(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        subj = make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT250')
        _insert_marks(db, subj['_id'], user['_id'], _full_entries(), grade='A')

        resp = client.get(
            f'/api/marks/semester-analytics/{semester["_id"]}',
            headers=auth_header(token),
        )
        assert resp.status_code == 200
        s = resp.get_json()['subjects'][0]
        assert s['score'] == 88.0
        assert s['grade'] == 'A'
        assert len(s['entries']) == 2

    def test_only_sees_own_marks(self, client, registered_user, second_user, db):
        """User2 sees their own null marks even though User1 has marks for the same subject."""
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$addToSet': {'members': user2['_id']}},
        )
        subj = make_subject(db, classroom['_id'], semester['_id'], user1['_id'], name='IT250')
        _insert_marks(db, subj['_id'], user1['_id'], _full_entries())

        resp = client.get(
            f'/api/marks/semester-analytics/{semester["_id"]}',
            headers=auth_header(token2),
        )
        assert resp.status_code == 200
        # user2 has no marks → score should be null
        assert resp.get_json()['subjects'][0]['score'] is None

    def test_multiple_subjects_all_returned(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT250')
        make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT251')
        make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT252')

        resp = client.get(
            f'/api/marks/semester-analytics/{semester["_id"]}',
            headers=auth_header(token),
        )
        assert len(resp.get_json()['subjects']) == 3

    def test_semester_label_in_response(self, client, registered_user, db):
        user, token = registered_user
        _, semester = make_classroom(db, user['_id'])
        resp = client.get(
            f'/api/marks/semester-analytics/{semester["_id"]}',
            headers=auth_header(token),
        )
        data = resp.get_json()
        # helpers.py creates semester with name='Semester 1 (Odd)', session='Jul-Dec'
        # _semester_label appends the session so the full label is 'Semester 1 (Odd) · Jul-Dec'
        assert data['semester_name'].startswith('Semester 1 (Odd)')


# ── _compute_weighted_score unit tests (via trend endpoint) ───────────────────

class TestScoreCalculation:
    """
    These exercise _compute_weighted_score indirectly through the trend endpoint.
    Keeps things integration-style without importing the private function.
    """

    def _score_for(self, client, token, db, entries):
        user_doc = db.users.find_one({})
        classroom, semester = make_classroom(db, user_doc['_id'])
        subj = make_subject(db, classroom['_id'], semester['_id'], user_doc['_id'], name='X')
        _insert_marks(db, subj['_id'], user_doc['_id'], entries)
        resp = client.get(f'/api/marks/trend/{classroom["_id"]}', headers=auth_header(token))
        return resp.get_json()['semesters'][0]['subjects'][0]['score']

    def test_perfect_score(self, client, registered_user, db):
        _, token = registered_user
        score = self._score_for(client, token, db, [
            {'name': 'A', 'max_marks': 100.0, 'marks_obtained': 100.0, 'weightage': 100.0},
        ])
        assert score == 100.0

    def test_zero_marks_obtained(self, client, registered_user, db):
        _, token = registered_user
        score = self._score_for(client, token, db, [
            {'name': 'A', 'max_marks': 100.0, 'marks_obtained': 0.0, 'weightage': 100.0},
        ])
        assert score == 0.0

    def test_empty_entries_returns_null(self, client, registered_user, db):
        _, token = registered_user
        score = self._score_for(client, token, db, [])
        assert score is None

    def test_partial_weight_does_not_exceed_actual_contribution(self, client, registered_user, db):
        _, token = registered_user
        # 80/100 on a component worth 50 → contribution = 0.8 × 50 = 40
        score = self._score_for(client, token, db, [
            {'name': 'A', 'max_marks': 100.0, 'marks_obtained': 80.0, 'weightage': 50.0},
        ])
        assert score == 40.0


# ── GET /api/marks/cr-class-average/<semester_id> ─────────────────────────────

class TestCrClassAverage:
    """Tests for the CR-only class-average endpoint."""

    URL = '/api/marks/cr-class-average/{}'

    def _url(self, semester_id):
        return self.URL.format(semester_id)

    def test_requires_auth(self, client, registered_user, db):
        _, semester = make_classroom(db, registered_user[0]['_id'])
        resp = client.get(self._url(semester['_id']))
        assert resp.status_code == 401

    def test_non_cr_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        user2, token2 = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        # Add user2 as a plain member (not CR)
        db.classrooms.update_one({'_id': classroom['_id']}, {'$addToSet': {'members': user2['_id']}})
        resp = client.get(self._url(semester['_id']), headers=auth_header(token2))
        assert resp.status_code == 403

    def test_non_member_denied(self, client, registered_user, second_user, db):
        user1, _ = registered_user
        _, token2 = second_user
        _, semester = make_classroom(db, user1['_id'])
        resp = client.get(self._url(semester['_id']), headers=auth_header(token2))
        assert resp.status_code == 403

    def test_nonexistent_semester_returns_404(self, client, registered_user, db):
        _, token = registered_user
        resp = client.get(self._url(ObjectId()), headers=auth_header(token))
        assert resp.status_code == 404

    def test_no_subjects_returns_empty_list(self, client, registered_user, db):
        user, token = registered_user
        _, semester = make_classroom(db, user['_id'])
        resp = client.get(self._url(semester['_id']), headers=auth_header(token))
        assert resp.status_code == 200
        assert resp.get_json()['subjects'] == []

    def test_no_marks_gives_null_class_avg(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT250')
        resp = client.get(self._url(semester['_id']), headers=auth_header(token))
        assert resp.status_code == 200
        subj = resp.get_json()['subjects'][0]
        assert subj['name'] == 'IT250'
        assert subj['class_avg'] is None
        assert subj['count'] == 0

    def test_single_student_class_avg_equals_their_score(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        subj = make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT250')
        # 50/50 × 40 + 40/50 × 60 = 40 + 48 = 88.0
        _insert_marks(db, subj['_id'], user['_id'], _full_entries())
        resp = client.get(self._url(semester['_id']), headers=auth_header(token))
        assert resp.status_code == 200
        subj_data = resp.get_json()['subjects'][0]
        assert subj_data['class_avg'] == 88.0
        assert subj_data['count'] == 1

    def test_two_students_class_avg_is_mean(self, client, registered_user, second_user, db):
        user1, token1 = registered_user
        user2, _ = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        db.classrooms.update_one({'_id': classroom['_id']}, {'$addToSet': {'members': user2['_id']}})
        subj = make_subject(db, classroom['_id'], semester['_id'], user1['_id'], name='IT250')
        # user1 → 88.0, user2 → 60.0
        _insert_marks(db, subj['_id'], user1['_id'], _full_entries())
        _insert_marks(db, subj['_id'], user2['_id'], [
            {'name': 'End', 'max_marks': 100.0, 'marks_obtained': 60.0, 'weightage': 100.0},
        ])
        resp = client.get(self._url(semester['_id']), headers=auth_header(token1))
        assert resp.status_code == 200
        subj_data = resp.get_json()['subjects'][0]
        assert subj_data['class_avg'] == round((88.0 + 60.0) / 2, 2)
        assert subj_data['count'] == 2

    def test_student_without_marks_excluded_from_avg(self, client, registered_user, second_user, db):
        user1, token1 = registered_user
        user2, _ = second_user
        classroom, semester = make_classroom(db, user1['_id'])
        db.classrooms.update_one({'_id': classroom['_id']}, {'$addToSet': {'members': user2['_id']}})
        subj = make_subject(db, classroom['_id'], semester['_id'], user1['_id'], name='IT250')
        # Only user1 has marks; user2 has none → avg = user1's score
        _insert_marks(db, subj['_id'], user1['_id'], _full_entries())
        resp = client.get(self._url(semester['_id']), headers=auth_header(token1))
        subj_data = resp.get_json()['subjects'][0]
        assert subj_data['class_avg'] == 88.0
        assert subj_data['count'] == 1

    def test_multiple_subjects_all_returned(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT250')
        make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT251')
        resp = client.get(self._url(semester['_id']), headers=auth_header(token))
        assert resp.status_code == 200
        subjects = resp.get_json()['subjects']
        assert len(subjects) == 2
        names = [s['name'] for s in subjects]
        assert 'IT250' in names and 'IT251' in names

    def test_response_contains_required_fields(self, client, registered_user, db):
        user, token = registered_user
        classroom, semester = make_classroom(db, user['_id'])
        make_subject(db, classroom['_id'], semester['_id'], user['_id'], name='IT250')
        resp = client.get(self._url(semester['_id']), headers=auth_header(token))
        assert resp.status_code == 200
        subj = resp.get_json()['subjects'][0]
        for field in ('subject_id', 'name', 'class_avg', 'count'):
            assert field in subj, f"Missing field: {field}"
