from flask import Blueprint, request, jsonify
from datetime import datetime, timezone
from bson import ObjectId
import logging

from middleware import token_required, is_member_of_classroom, is_cr_of as _is_cr_of

schedule_bp = Blueprint('schedule', __name__, url_prefix='/api/schedule')
logger = logging.getLogger(__name__)


@schedule_bp.route('/create', methods=['POST'])
@token_required
def create_schedule():
    """CR posts a schedule batch (set of events) for a classroom semester."""
    from database import get_db

    try:
        data = request.get_json()
        user_id = request.user['user_id']

        classroom_id = data.get('classroom_id', '').strip()
        semester_id = data.get('semester_id', '').strip()
        title = data.get('title', '').strip()
        description = data.get('description', '').strip()
        events_raw = data.get('events', [])

        if not all([classroom_id, semester_id, title]):
            return jsonify({'error': 'classroom_id, semester_id, and title are required'}), 400

        if not isinstance(events_raw, list) or len(events_raw) == 0:
            return jsonify({'error': 'At least one event is required'}), 400

        db = get_db()

        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        if not classroom or not is_member_of_classroom(classroom, user_id):
            return jsonify({'error': 'Access denied'}), 403

        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        if not _is_cr_of(semester, user_id):
            return jsonify({'error': 'Only a CR can post schedule requests'}), 403

        parsed_events = []
        for i, ev in enumerate(events_raw):
            ev_title = ev.get('title', '').strip()
            ev_start = ev.get('start_datetime', '').strip()
            ev_end = ev.get('end_datetime', '').strip()
            if not all([ev_title, ev_start, ev_end]):
                return jsonify({
                    'error': f"Event {i + 1} is missing title, start_datetime, or end_datetime"
                }), 400
            try:
                start_dt = datetime.fromisoformat(ev_start.replace('Z', '+00:00'))
                end_dt = datetime.fromisoformat(ev_end.replace('Z', '+00:00'))
            except ValueError:
                return jsonify({'error': f"Event {i + 1}: invalid datetime format. Use ISO 8601."}), 400

            parsed_events.append({
                'title': ev_title,
                'start_datetime': start_dt,
                'end_datetime': end_dt,
                'description': ev.get('description', '').strip(),
                'location': ev.get('location', '').strip(),
            })

        schedule_doc = {
            'classroom_id': classroom_id,
            'semester_id': semester_id,
            'created_by': user_id,
            'title': title,
            'description': description,
            'events': parsed_events,
            'created_at': datetime.now(timezone.utc),
            'pulled_by': [],
        }

        result = db.schedule_requests.insert_one(schedule_doc)

        return jsonify({
            'message': 'Schedule posted successfully',
            'request_id': str(result.inserted_id)
        }), 201

    except Exception as e:
        logger.error(f"Create schedule error: {e}")
        return jsonify({'error': 'Failed to create schedule request'}), 500


@schedule_bp.route('/classroom/<classroom_id>', methods=['GET'])
@token_required
def list_schedules(classroom_id):
    """List all schedule requests for a classroom. Any member can see them."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        if not classroom or not is_member_of_classroom(classroom, user_id):
            return jsonify({'error': 'Access denied'}), 403

        cursor = db.schedule_requests.find({'classroom_id': classroom_id}).sort('created_at', -1)

        result = []
        for req in cursor:
            already_pulled = user_id in req.get('pulled_by', [])
            events = []
            for ev in req.get('events', []):
                events.append({
                    'title': ev['title'],
                    'start_datetime': ev['start_datetime'].isoformat(),
                    'end_datetime': ev['end_datetime'].isoformat(),
                    'description': ev.get('description', ''),
                    'location': ev.get('location', ''),
                })
            result.append({
                'id': str(req['_id']),
                'title': req['title'],
                'description': req.get('description', ''),
                'created_by': req['created_by'],
                'events': events,
                'created_at': req['created_at'].isoformat(),
                'already_pulled': already_pulled,
                'pulled_count': len(req.get('pulled_by', [])),
            })

        return jsonify({'schedule_requests': result}), 200

    except Exception as e:
        logger.error(f"List schedules error: {e}")
        return jsonify({'error': 'Failed to fetch schedule requests'}), 500


@schedule_bp.route('/request/<request_id>', methods=['DELETE'])
@token_required
def delete_schedule(request_id):
    """Delete a schedule request. CR of the semester can delete."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        req_doc = db.schedule_requests.find_one({'_id': ObjectId(request_id)})
        if not req_doc:
            return jsonify({'error': 'Schedule request not found'}), 404

        semester = db.semesters.find_one({'_id': ObjectId(req_doc['semester_id'])})
        is_cr = semester and _is_cr_of(semester, user_id)
        is_creator = req_doc['created_by'] == user_id

        if not (is_creator or is_cr):
            return jsonify({'error': 'Only a CR can delete schedule requests'}), 403

        db.schedule_requests.delete_one({'_id': ObjectId(request_id)})
        return jsonify({'message': 'Schedule request deleted'}), 200

    except Exception as e:
        logger.error(f"Delete schedule error: {e}")
        return jsonify({'error': 'Failed to delete schedule request'}), 500


@schedule_bp.route('/request/<request_id>/pull', methods=['POST'])
@token_required
def pull_schedule(request_id):
    """Pull a single schedule request into the caller's Google Calendar."""
    from database import get_db
    from utils.google_calendar import get_calendar_service, format_event_for_google, create_calendar_event
    from google.auth.exceptions import RefreshError
    from googleapiclient.errors import HttpError

    try:
        user_id = request.user['user_id']
        db = get_db()

        req_doc = db.schedule_requests.find_one({'_id': ObjectId(request_id)})
        if not req_doc:
            return jsonify({'error': 'Schedule request not found'}), 404

        classroom = db.classrooms.find_one({'_id': ObjectId(req_doc['classroom_id'])})
        if not classroom or not is_member_of_classroom(classroom, user_id):
            return jsonify({'error': 'Access denied'}), 403

        if user_id in req_doc.get('pulled_by', []):
            return jsonify({'message': 'Already pulled', 'already_pulled': True}), 200

        token_doc = db.google_tokens.find_one({'user_id': user_id})
        if not token_doc:
            return jsonify({'error': 'Google Calendar not connected', 'not_connected': True}), 403

        try:
            service = get_calendar_service(token_doc, db, user_id)
        except RefreshError:
            db.google_tokens.delete_one({'user_id': user_id})
            return jsonify({'error': 'Google Calendar access was revoked. Please reconnect.', 'not_connected': True}), 403

        count = 0
        for ev in req_doc.get('events', []):
            start_iso = ev['start_datetime'].strftime('%Y-%m-%dT%H:%M:%SZ')
            end_iso = ev['end_datetime'].strftime('%Y-%m-%dT%H:%M:%SZ')
            event_body = format_event_for_google(
                title=ev['title'],
                start_dt=start_iso,
                end_dt=end_iso,
                description=ev.get('description', ''),
                location=ev.get('location', ''),
            )
            create_calendar_event(service, event_body)
            count += 1

        db.schedule_requests.update_one(
            {'_id': ObjectId(request_id)},
            {'$addToSet': {'pulled_by': user_id}}
        )

        return jsonify({'message': f'{count} event{"s" if count != 1 else ""} added to your Google Calendar'}), 200

    except HttpError as e:
        logger.error(f"Google API error pulling schedule {request_id}: {e}")
        return jsonify({'error': 'Google Calendar API error', 'details': str(e)}), 502
    except Exception as e:
        logger.error(f"Pull schedule error: {e}")
        return jsonify({'error': 'Failed to pull schedule'}), 500


@schedule_bp.route('/classroom/<classroom_id>/pull-all', methods=['POST'])
@token_required
def pull_all_schedules(classroom_id):
    """Pull all un-accepted schedule requests for a classroom into Google Calendar."""
    from database import get_db
    from utils.google_calendar import get_calendar_service, format_event_for_google, create_calendar_event
    from google.auth.exceptions import RefreshError
    from googleapiclient.errors import HttpError

    try:
        user_id = request.user['user_id']
        db = get_db()

        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        if not classroom or not is_member_of_classroom(classroom, user_id):
            return jsonify({'error': 'Access denied'}), 403

        token_doc = db.google_tokens.find_one({'user_id': user_id})
        if not token_doc:
            return jsonify({'error': 'Google Calendar not connected', 'not_connected': True}), 403

        pending = list(db.schedule_requests.find({
            'classroom_id': classroom_id,
            'pulled_by': {'$nin': [user_id]}
        }))

        if not pending:
            return jsonify({'message': 'No pending schedule requests', 'total_events': 0}), 200

        try:
            service = get_calendar_service(token_doc, db, user_id)
        except RefreshError:
            db.google_tokens.delete_one({'user_id': user_id})
            return jsonify({'error': 'Google Calendar access was revoked. Please reconnect.', 'not_connected': True}), 403

        total = 0
        for req_doc in pending:
            for ev in req_doc.get('events', []):
                start_iso = ev['start_datetime'].strftime('%Y-%m-%dT%H:%M:%SZ')
                end_iso = ev['end_datetime'].strftime('%Y-%m-%dT%H:%M:%SZ')
                event_body = format_event_for_google(
                    title=ev['title'],
                    start_dt=start_iso,
                    end_dt=end_iso,
                    description=ev.get('description', ''),
                    location=ev.get('location', ''),
                )
                create_calendar_event(service, event_body)
                total += 1
            db.schedule_requests.update_one(
                {'_id': req_doc['_id']},
                {'$addToSet': {'pulled_by': user_id}}
            )

        return jsonify({
            'message': f'{total} event{"s" if total != 1 else ""} added to your Google Calendar',
            'total_events': total
        }), 200

    except HttpError as e:
        logger.error(f"Google API error in pull-all for classroom {classroom_id}: {e}")
        return jsonify({'error': 'Google Calendar API error', 'details': str(e)}), 502
    except Exception as e:
        logger.error(f"Pull-all error: {e}")
        return jsonify({'error': 'Failed to pull all schedules'}), 500
