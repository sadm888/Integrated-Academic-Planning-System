"""Shared test helpers for creating test data."""
from bson import ObjectId
from datetime import datetime, timezone


def make_classroom(db, creator_oid, name='Test Classroom'):
    """Create a classroom and auto-semester, return (classroom, semester) dicts."""
    classroom_id = ObjectId()
    classroom = {
        '_id': classroom_id,
        'name': name,
        'description': 'Test classroom',
        'code': 'TST001',
        'created_by': creator_oid,
        'members': [creator_oid],
        'join_requests': [],
        'created_at': datetime.now(timezone.utc),
        'updated_at': datetime.now(timezone.utc),
    }
    db.classrooms.insert_one(classroom)

    semester_id = ObjectId()
    semester = {
        '_id': semester_id,
        'classroom_id': str(classroom_id),
        'name': 'Semester 1 (Odd)',
        'type': 'odd',
        'number': '1',
        'year': '2024',
        'session': 'Jul-Dec',
        'cr_ids': [creator_oid],
        'is_active': True,
        'created_at': datetime.now(timezone.utc),
    }
    db.semesters.insert_one(semester)

    return classroom, semester


def make_subject(db, classroom_id, semester_id, creator_id, name='Math', is_personal=False):
    """Insert and return a subject document."""
    subj = {
        '_id': ObjectId(),
        'classroom_id': str(classroom_id),
        'semester_id': str(semester_id),
        'name': name,
        'code': 'MTH101',
        'credits': '4',
        'faculties': ['Dr. Smith'],
        'details': '',
        'personal': is_personal,
        'created_by': str(creator_id),
        'created_at': datetime.now(timezone.utc),
    }
    db.subjects.insert_one(subj)
    return subj
