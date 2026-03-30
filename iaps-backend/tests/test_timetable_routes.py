"""Tests for timetable_routes.py — helpers, personal-skip endpoints, push-day endpoint."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from bson import ObjectId
from datetime import datetime, date, timezone
from unittest.mock import patch, MagicMock

from tests.conftest import make_token, auth_header
from tests.helpers import make_classroom


# ── Import helpers under test directly ────────────────────────────────────────
from routes.timetable_routes import (
    _parse_time_slot,
    _build_merged_timetable_events,
    _apply_overrides_to_week,
    _build_gcal_event_body,
)


# ── _parse_time_slot ──────────────────────────────────────────────────────────

class TestParseTimeSlot:
    def test_normal_24h(self):
        assert _parse_time_slot('9:00-9:45') == (9, 0, 9, 45)

    def test_noon_slot(self):
        # 12:00-1:00 — parser is numeric-only, returns raw values.
        # Merging uses index position, not time adjacency, so (12,0,1,0) is fine.
        result = _parse_time_slot('12:00-1:00')
        assert result is not None
        sh, sm, eh, em = result
        assert sh == 12 and sm == 0
        assert eh == 1 and em == 0  # raw numeric parse, not 24h conversion

    def test_invalid_returns_none(self):
        assert _parse_time_slot('invalid') is None
        assert _parse_time_slot('') is None


# ── _build_merged_timetable_events ────────────────────────────────────────────

class TestBuildMergedTimetableEvents:
    BASE_GRID = {
        'Mon': {
            '9:00-9:45':  {'subject': 'IT250', 'type': 'Lecture', 'teacher': 'Dr A', 'room': 'R1', 'status': 'normal'},
            '9:45-10:30': {'subject': 'Free', 'type': 'Free', 'teacher': '', 'room': '', 'status': 'normal'},
            '10:30-11:15': {'subject': 'IT260', 'type': 'Lab', 'teacher': 'Dr B', 'room': 'L1', 'status': 'normal'},
            '11:15-12:00': {'subject': 'IT260', 'type': 'Lab', 'teacher': 'Dr B', 'room': 'L1', 'status': 'normal'},
        }
    }
    TIME_SLOTS = ['9:00-9:45', '9:45-10:30', '10:30-11:15', '11:15-12:00']

    def test_basic_lecture(self):
        events = _build_merged_timetable_events(['Mon'], self.TIME_SLOTS, self.BASE_GRID)
        lecture = next(e for e in events if e['subject'] == 'IT250')
        assert lecture['sh'] == 9 and lecture['sm'] == 0
        assert lecture['eh'] == 9 and lecture['em'] == 45
        assert lecture['cell_type'] == 'Lecture'

    def test_lab_slots_merge(self):
        events = _build_merged_timetable_events(['Mon'], self.TIME_SLOTS, self.BASE_GRID)
        lab = next(e for e in events if e['subject'] == 'IT260')
        # Should merge 10:30-11:15 and 11:15-12:00 into one event
        assert lab['sh'] == 10 and lab['sm'] == 30
        assert lab['eh'] == 12 and lab['em'] == 0
        assert lab['slots'] == ['10:30-11:15', '11:15-12:00']

    def test_free_slots_excluded(self):
        events = _build_merged_timetable_events(['Mon'], self.TIME_SLOTS, self.BASE_GRID)
        subjects = [e['subject'] for e in events]
        assert 'Free' not in subjects

    def test_status_passed_through(self):
        grid = {
            'Mon': {
                '9:00-9:45': {'subject': 'IT250', 'type': 'Lecture', 'teacher': '', 'room': '', 'status': 'cancelled', 'override_reason': 'Faculty sick'},
            }
        }
        events = _build_merged_timetable_events(['Mon'], ['9:00-9:45'], grid)
        assert events[0]['status'] == 'cancelled'
        assert events[0]['override_reason'] == 'Faculty sick'

    def test_rescheduled_time_overrides_slot_time(self):
        grid = {
            'Mon': {
                '9:00-9:45': {
                    'subject': 'IT250', 'type': 'Lecture', 'teacher': '', 'room': '',
                    'status': 'modified', 'rescheduled_time': '11:00-11:45', 'override_reason': '',
                },
            }
        }
        events = _build_merged_timetable_events(['Mon'], ['9:00-9:45'], grid)
        assert events[0]['sh'] == 11 and events[0]['sm'] == 0
        assert events[0]['eh'] == 11 and events[0]['em'] == 45

    def test_rescheduled_slot_not_merged_with_adjacent(self):
        """A slot with rescheduled_time should NOT be merged with the next identical slot."""
        grid = {
            'Mon': {
                '10:30-11:15': {
                    'subject': 'IT260', 'type': 'Lab', 'teacher': '', 'room': '',
                    'status': 'modified', 'rescheduled_time': '14:00-15:00', 'override_reason': '',
                },
                '11:15-12:00': {
                    'subject': 'IT260', 'type': 'Lab', 'teacher': '', 'room': '',
                    'status': 'normal', 'override_reason': '',
                },
            }
        }
        events = _build_merged_timetable_events(['Mon'], ['10:30-11:15', '11:15-12:00'], grid)
        # Should be two separate events
        assert len(events) == 2
        reschedule_ev = next(e for e in events if e['sh'] == 14)
        assert reschedule_ev['eh'] == 15 and reschedule_ev['em'] == 0

    def test_empty_grid_returns_no_events(self):
        events = _build_merged_timetable_events(['Mon'], self.TIME_SLOTS, {})
        assert events == []

    def test_slots_field_single(self):
        events = _build_merged_timetable_events(['Mon'], ['9:00-9:45'], {
            'Mon': {'9:00-9:45': {'subject': 'IT250', 'type': 'Lecture', 'teacher': '', 'room': '', 'status': 'normal'}}
        })
        assert events[0]['slots'] == ['9:00-9:45']


# ── _build_gcal_event_body ────────────────────────────────────────────────────

class TestBuildGcalEventBody:
    def test_basic_structure(self):
        ev = {
            'sh': 9, 'sm': 0, 'eh': 9, 'em': 45,
            'subject': 'IT250', 'cell_type': 'Lecture',
            'teacher': 'Dr A', 'room': 'R101',
            'override_reason': '',
        }
        body = _build_gcal_event_body(ev, date(2026, 4, 7), '2026-W14', 'sem123')
        assert body['summary'] == 'IT250'
        assert body['start']['dateTime'] == '2026-04-07T09:00:00'
        assert body['end']['dateTime'] == '2026-04-07T09:45:00'
        assert body['colorId'] == '7'  # Lecture
        assert body['extendedProperties']['private']['iaps_timetable'] == 'true'
        assert body['extendedProperties']['private']['iaps_timetable_date'] == '2026-04-07'
        assert body['extendedProperties']['private']['iaps_semester_id'] == 'sem123'

    def test_description_includes_faculty_and_room(self):
        ev = {'sh': 9, 'sm': 0, 'eh': 10, 'em': 0, 'subject': 'IT260', 'cell_type': 'Lab',
              'teacher': 'Dr B', 'room': 'Lab 3', 'override_reason': 'Extra session'}
        body = _build_gcal_event_body(ev, date(2026, 4, 7), '2026-W14', 'sem123')
        assert 'Faculty: Dr B' in body['description']
        assert 'Room: Lab 3' in body['description']
        assert 'Note: Extra session' in body['description']

    def test_lab_color(self):
        ev = {'sh': 9, 'sm': 0, 'eh': 10, 'em': 0, 'subject': 'IT260', 'cell_type': 'Lab',
              'teacher': '', 'room': '', 'override_reason': ''}
        body = _build_gcal_event_body(ev, date(2026, 4, 7), '2026-W14', 'sem123')
        assert body['colorId'] == '3'

    def test_unknown_type_defaults_to_8(self):
        ev = {'sh': 9, 'sm': 0, 'eh': 10, 'em': 0, 'subject': 'IT260', 'cell_type': 'Unknown',
              'teacher': '', 'room': '', 'override_reason': ''}
        body = _build_gcal_event_body(ev, date(2026, 4, 7), '2026-W14', 'sem123')
        assert body['colorId'] == '8'


# ── Personal skip endpoints ───────────────────────────────────────────────────

class TestPersonalSkipEndpoints:
    def _setup(self, db):
        user_id = ObjectId()
        db.users.insert_one({
            '_id': user_id, 'username': 'u1', 'email': 'u1@test.com', 'fullName': 'U1',
        })
        classroom, semester = make_classroom(db, user_id)
        # Add user as regular member (not CR) of the semester
        db.semesters.update_one({'_id': semester['_id']}, {'$set': {'cr_ids': []}})
        token = make_token(str(user_id))
        return str(user_id), str(semester['_id']), token

    def test_add_personal_skip(self, client, db):
        user_id, sem_id, token = self._setup(db)
        resp = client.post(
            f'/api/timetable/semester/{sem_id}/personal-skip',
            json={'day': 'Mon', 'slot': '9:00-9:45', 'date': '2026-04-07', 'reason': 'Sick'},
            headers=auth_header(token),
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert 'id' in data
        assert db.personal_skips.count_documents({'user_id': user_id, 'semester_id': sem_id}) == 1

    def test_add_skip_missing_fields(self, client, db):
        user_id, sem_id, token = self._setup(db)
        resp = client.post(
            f'/api/timetable/semester/{sem_id}/personal-skip',
            json={'day': 'Mon'},
            headers=auth_header(token),
        )
        assert resp.status_code == 400

    def test_add_skip_upserts(self, client, db):
        """Adding a skip for the same slot+date replaces the old one."""
        user_id, sem_id, token = self._setup(db)
        payload = {'day': 'Mon', 'slot': '9:00-9:45', 'date': '2026-04-07', 'reason': 'First'}
        client.post(f'/api/timetable/semester/{sem_id}/personal-skip', json=payload, headers=auth_header(token))
        payload['reason'] = 'Second'
        resp = client.post(f'/api/timetable/semester/{sem_id}/personal-skip', json=payload, headers=auth_header(token))
        assert resp.status_code == 201
        # Only one skip should exist
        assert db.personal_skips.count_documents({'user_id': user_id, 'semester_id': sem_id}) == 1
        doc = db.personal_skips.find_one({'user_id': user_id})
        assert doc['reason'] == 'Second'

    def test_delete_personal_skip(self, client, db):
        user_id, sem_id, token = self._setup(db)
        result = db.personal_skips.insert_one({
            'user_id': user_id, 'semester_id': sem_id,
            'day': 'Mon', 'slot': '9:00-9:45', 'date': '2026-04-07', 'reason': '',
            'created_at': datetime.now(timezone.utc),
        })
        skip_id = str(result.inserted_id)

        resp = client.delete(
            f'/api/timetable/semester/{sem_id}/personal-skip/{skip_id}',
            headers=auth_header(token),
        )
        assert resp.status_code == 200
        assert db.personal_skips.count_documents({'_id': result.inserted_id}) == 0

    def test_delete_nonexistent_skip_returns_404(self, client, db):
        user_id, sem_id, token = self._setup(db)
        fake_id = str(ObjectId())
        resp = client.delete(
            f'/api/timetable/semester/{sem_id}/personal-skip/{fake_id}',
            headers=auth_header(token),
        )
        assert resp.status_code == 404

    def test_cannot_delete_another_users_skip(self, client, db):
        user_id, sem_id, token = self._setup(db)
        other_id = ObjectId()
        db.users.insert_one({'_id': other_id, 'username': 'u2', 'email': 'u2@test.com', 'fullName': 'U2'})
        result = db.personal_skips.insert_one({
            'user_id': other_id, 'semester_id': sem_id,
            'day': 'Mon', 'slot': '9:00-9:45', 'date': '2026-04-07', 'reason': '',
            'created_at': datetime.now(timezone.utc),
        })
        resp = client.delete(
            f'/api/timetable/semester/{sem_id}/personal-skip/{str(result.inserted_id)}',
            headers=auth_header(token),  # user_id's token, not other_id
        )
        assert resp.status_code == 404  # scope check prevents deletion
        assert db.personal_skips.count_documents({'_id': result.inserted_id}) == 1

    def test_week_view_includes_personal_skips(self, client, db):
        """GET /week response must include personal_skips for the current user."""
        user_id, sem_id, token = self._setup(db)
        now = datetime.now(timezone.utc)
        db.timetables.insert_one({
            'semester_id': sem_id,
            'days': ['Mon'],
            'time_slots': ['9:00-9:45'],
            'grid': {'Mon': {'9:00-9:45': {'subject': 'IT250', 'type': 'Lecture', 'teacher': '', 'room': ''}}},
            'pushed_by': [],
            'created_at': now,
            'updated_at': now,
        })
        db.personal_skips.insert_one({
            'user_id': user_id, 'semester_id': sem_id,
            'day': 'Mon', 'slot': '9:00-9:45', 'date': '2026-04-06', 'reason': 'Sick',
            'created_at': datetime.now(timezone.utc),
        })
        resp = client.get(
            f'/api/timetable/semester/{sem_id}/week?date=2026-04-06',
            headers=auth_header(token),
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'personal_skips' in data
        skips = data['personal_skips']
        assert len(skips) == 1
        assert skips[0]['day'] == 'Mon'
        assert skips[0]['slot'] == '9:00-9:45'

    def test_week_view_skips_are_user_scoped(self, client, db):
        """personal_skips must only contain the requesting user's skips."""
        user_id, sem_id, token = self._setup(db)
        other_id = ObjectId()
        now = datetime.now(timezone.utc)
        db.timetables.insert_one({
            'semester_id': sem_id,
            'days': ['Mon'],
            'time_slots': ['9:00-9:45'],
            'grid': {},
            'pushed_by': [],
            'created_at': now,
            'updated_at': now,
        })
        # Insert a skip for a different user
        db.personal_skips.insert_one({
            'user_id': other_id, 'semester_id': sem_id,
            'day': 'Mon', 'slot': '9:00-9:45', 'date': '2026-04-06', 'reason': '',
            'created_at': datetime.now(timezone.utc),
        })
        resp = client.get(
            f'/api/timetable/semester/{sem_id}/week?date=2026-04-06',
            headers=auth_header(token),
        )
        assert resp.status_code == 200
        assert resp.get_json()['personal_skips'] == []


# ── push-day endpoint ─────────────────────────────────────────────────────────

class TestPushDayEndpoint:
    def _setup(self, db, as_cr=True):
        user_id = ObjectId()
        db.users.insert_one({'_id': user_id, 'username': 'u1', 'email': 'u1@test.com', 'fullName': 'U1'})
        classroom, semester = make_classroom(db, user_id)
        if not as_cr:
            db.semesters.update_one({'_id': semester['_id']}, {'$set': {'cr_ids': []}})
        token = make_token(str(user_id))
        return str(user_id), str(semester['_id']), token

    def test_push_day_no_gcal_token_returns_403(self, client, db):
        user_id, sem_id, token = self._setup(db)
        resp = client.post(
            f'/api/timetable/semester/{sem_id}/push-day',
            json={'date': '2026-04-07'},
            headers=auth_header(token),
        )
        assert resp.status_code == 403
        assert resp.get_json()['not_connected'] is True

    def test_push_day_missing_date_returns_400(self, client, db):
        user_id, sem_id, token = self._setup(db)
        db.google_tokens.insert_one({'user_id': user_id, 'token': 'fake'})
        with patch('utils.google_calendar.get_calendar_service', return_value=MagicMock()):
            resp = client.post(
                f'/api/timetable/semester/{sem_id}/push-day',
                json={},
                headers=auth_header(token),
            )
        assert resp.status_code == 400

    def test_delete_day_no_gcal_returns_403(self, client, db):
        user_id, sem_id, token = self._setup(db)
        resp = client.delete(
            f'/api/timetable/semester/{sem_id}/push-day',
            json={'date': '2026-04-07'},
            headers=auth_header(token),
        )
        assert resp.status_code == 403

    def test_push_day_no_timetable_returns_404(self, client, db):
        user_id, sem_id, token = self._setup(db)
        db.google_tokens.insert_one({'user_id': user_id, 'token': 'fake'})
        mock_service = MagicMock()
        mock_service.events.return_value.list.return_value.execute.return_value = {'items': [], 'nextPageToken': None}
        with patch('utils.google_calendar.get_calendar_service', return_value=mock_service):
            resp = client.post(
                f'/api/timetable/semester/{sem_id}/push-day',
                json={'date': '2026-04-07'},
                headers=auth_header(token),
            )
        assert resp.status_code == 404

    def test_push_day_pushes_classes_and_returns_count(self, client, db):
        user_id, sem_id, token = self._setup(db)
        db.google_tokens.insert_one({'user_id': user_id, 'token': 'fake'})
        db.timetables.insert_one({
            'semester_id': sem_id,
            'days': ['Mon'],
            'time_slots': ['9:00-9:45', '9:45-10:30'],
            'grid': {
                'Mon': {
                    '9:00-9:45': {'subject': 'IT250', 'type': 'Lecture', 'teacher': 'Dr A', 'room': 'R1'},
                    '9:45-10:30': {'subject': 'IT260', 'type': 'Lecture', 'teacher': 'Dr B', 'room': 'R2'},
                }
            },
            'pushed_by': [],
        })
        created_events = []
        mock_service = MagicMock()
        mock_service.events.return_value.list.return_value.execute.return_value = {'items': [], 'nextPageToken': None}
        mock_service.events.return_value.delete.return_value.execute.return_value = {}

        def fake_create(service, body):
            created_events.append(body)
        with patch('utils.google_calendar.get_calendar_service', return_value=mock_service), \
             patch('utils.google_calendar.create_calendar_event', side_effect=fake_create):
            resp = client.post(
                f'/api/timetable/semester/{sem_id}/push-day',
                json={'date': '2026-04-06'},  # Monday
                headers=auth_header(token),
            )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['created'] == 2
        # Verify iaps_timetable_date is set on each event
        for ev in created_events:
            assert ev['extendedProperties']['private']['iaps_timetable_date'] == '2026-04-06'

    def test_push_day_skips_cancelled_slots(self, client, db):
        user_id, sem_id, token = self._setup(db)
        db.google_tokens.insert_one({'user_id': user_id, 'token': 'fake'})
        db.timetables.insert_one({
            'semester_id': sem_id,
            'days': ['Mon'],
            'time_slots': ['9:00-9:45'],
            'grid': {'Mon': {}},
            'pushed_by': [],
        })
        # Add a cancel override for this slot
        db.timetable_overrides.insert_one({
            'semester_id': sem_id, 'day': 'Mon', 'slot': '9:00-9:45',
            'action': 'cancel', 'scope': 'this_day', 'date': '2026-04-06',
            'reason': 'Faculty absent', 'created_by_name': 'CR',
            'created_by': str(ObjectId()), 'created_at': datetime.now(timezone.utc),
        })
        created_events = []
        mock_service = MagicMock()
        mock_service.events.return_value.list.return_value.execute.return_value = {'items': [], 'nextPageToken': None}
        with patch('utils.google_calendar.get_calendar_service', return_value=mock_service), \
             patch('utils.google_calendar.create_calendar_event', side_effect=lambda s, b: created_events.append(b)):
            resp = client.post(
                f'/api/timetable/semester/{sem_id}/push-day',
                json={'date': '2026-04-06'},
                headers=auth_header(token),
            )
        assert resp.status_code == 200
        assert resp.get_json()['created'] == 0
        assert len(created_events) == 0

    def test_push_day_respects_personal_skips(self, client, db):
        user_id, sem_id, token = self._setup(db)
        db.google_tokens.insert_one({'user_id': user_id, 'token': 'fake'})
        db.timetables.insert_one({
            'semester_id': sem_id,
            'days': ['Mon'],
            'time_slots': ['9:00-9:45', '9:45-10:30'],
            'grid': {
                'Mon': {
                    '9:00-9:45': {'subject': 'IT250', 'type': 'Lecture', 'teacher': '', 'room': ''},
                    '9:45-10:30': {'subject': 'IT260', 'type': 'Lecture', 'teacher': '', 'room': ''},
                }
            },
            'pushed_by': [],
        })
        db.personal_skips.insert_one({
            'user_id': user_id, 'semester_id': sem_id,
            'day': 'Mon', 'slot': '9:00-9:45', 'date': '2026-04-06', 'reason': '',
            'created_at': datetime.now(timezone.utc),
        })
        created_events = []
        mock_service = MagicMock()
        mock_service.events.return_value.list.return_value.execute.return_value = {'items': [], 'nextPageToken': None}
        with patch('utils.google_calendar.get_calendar_service', return_value=mock_service), \
             patch('utils.google_calendar.create_calendar_event', side_effect=lambda s, b: created_events.append(b)):
            resp = client.post(
                f'/api/timetable/semester/{sem_id}/push-day',
                json={'date': '2026-04-06'},
                headers=auth_header(token),
            )
        assert resp.status_code == 200
        # Only IT260 should be pushed (IT250 skipped personally)
        assert resp.get_json()['created'] == 1
        assert created_events[0]['summary'] == 'IT260'
