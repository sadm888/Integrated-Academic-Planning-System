import os
import re
from flask import Blueprint, request, jsonify
from datetime import datetime, timezone
from bson import ObjectId
import logging

from middleware import token_required, is_member_of_classroom, is_cr_of

UPLOAD_DIR = os.path.join(os.getcwd(), 'uploads', 'academics')

subject_bp = Blueprint('subject', __name__, url_prefix='/api/subject')
logger = logging.getLogger(__name__)


def _serialize_subject(s):
    return {
        'id': str(s['_id']),
        'name': s['name'],
        'code': s.get('code', ''),
        'credits': s.get('credits', ''),
        'faculties': s.get('faculties', []),
        'details': s.get('details', ''),
        'personal': s.get('personal', False),
        'created_by': s.get('created_by', ''),
        'timetable_name': s.get('timetable_name'),
        'linked_to_timetable': bool(s.get('timetable_name')),
        'resources_visible': s.get('resources_visible', True),
    }



@subject_bp.route('/create', methods=['POST'])
@token_required
def create_subject():
    """Create a new subject in a semester. CR only."""
    from database import get_db

    try:
        data = request.get_json()
        user_id = request.user['user_id']

        classroom_id = data.get('classroom_id', '').strip()
        semester_id = data.get('semester_id', '').strip()
        name = data.get('name', '').strip()
        code = data.get('code', '').strip()

        if not all([classroom_id, semester_id, name]):
            return jsonify({'error': 'Classroom ID, semester ID, and subject name are required'}), 400

        db = get_db()

        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        # Verify classroom membership
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        if not classroom or not is_member_of_classroom(classroom, user_id):
            return jsonify({'error': 'Access denied'}), 403

        # Non-CRs can add personal subjects (only visible to themselves)
        is_cr = is_cr_of(semester, user_id)
        is_personal = not is_cr

        # Prevent duplicate name within same scope (case-insensitive)
        escaped_name = re.escape(name)
        scope_filter = {'semester_id': semester_id, 'name': {'$regex': f'^{escaped_name}$', '$options': 'i'}}
        if is_personal:
            # Personal subjects: check only against this user's personal subjects
            scope_filter['personal'] = True
            scope_filter['created_by'] = user_id
        else:
            # Class subjects: check only against public subjects
            scope_filter['$or'] = [{'personal': {'$ne': True}}]
        existing = db.subjects.find_one(scope_filter)
        if existing:
            label = 'personal subject' if is_personal else 'class subject'
            return jsonify({'error': f'A {label} with this name already exists in this semester'}), 400

        credits = data.get('credits', '')
        faculties = data.get('faculties', [])
        details = data.get('details', '').strip()
        if isinstance(faculties, str):
            faculties = [f.strip() for f in faculties.split(',') if f.strip()]

        subject = {
            'classroom_id': classroom_id,
            'semester_id': semester_id,
            'name': name,
            'code': code,
            'credits': credits,
            'faculties': faculties,
            'details': details,
            'personal': is_personal,
            'created_by': user_id,
            'created_at': datetime.now(timezone.utc)
        }

        result = db.subjects.insert_one(subject)

        return jsonify({
            'message': 'Subject added',
            'subject': {
                'id': str(result.inserted_id),
                'name': name,
                'code': code,
                'credits': credits,
                'faculties': faculties,
                'details': details,
                'personal': is_personal,
                'created_by': user_id,
            }
        }), 201

    except Exception as e:
        logger.error(f"Create subject error: {e}")
        return jsonify({'error': 'Failed to create subject'}), 500


@subject_bp.route('/semester/<semester_id>/list', methods=['GET'])
@token_required
def list_subjects(semester_id):
    """List all subjects for a semester. Any member."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        classroom = db.classrooms.find_one({'_id': ObjectId(semester['classroom_id'])})
        if not classroom or not is_member_of_classroom(classroom, user_id):
            return jsonify({'error': 'Access denied'}), 403

        # Return public subjects + this user's own personal subjects
        subjects = list(db.subjects.find({
            'semester_id': semester_id,
            '$or': [
                {'personal': {'$ne': True}},
                {'personal': True, 'created_by': user_id},
            ]
        }).sort('created_at', 1))

        result = [_serialize_subject(s) for s in subjects]

        return jsonify({'subjects': result}), 200

    except Exception as e:
        logger.error(f"List subjects error: {e}")
        return jsonify({'error': 'Failed to fetch subjects'}), 500


@subject_bp.route('/<subject_id>', methods=['DELETE'])
@token_required
def delete_subject(subject_id):
    """Delete a subject. CR only."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        subject = db.subjects.find_one({'_id': ObjectId(subject_id)})
        if not subject:
            return jsonify({'error': 'Subject not found'}), 404

        semester = db.semesters.find_one({'_id': ObjectId(subject['semester_id'])})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        if subject.get('personal'):
            # Personal subjects can only be deleted by their creator
            if subject.get('created_by') != user_id:
                return jsonify({'error': 'Only the creator can delete a personal subject'}), 403
        else:
            # Class subjects can only be deleted by a CR
            if not is_cr_of(semester, user_id):
                return jsonify({'error': 'Only a CR can delete class subjects'}), 403

        db.subjects.delete_one({'_id': ObjectId(subject_id)})

        # Cascade: delete all academic resources (and their disk files) for this subject
        resources = list(db.academic_resources.find(
            {'semester_id': subject['semester_id'], 'subject_id': subject_id}
        ))
        for r in resources:
            if r.get('stored_name'):
                try:
                    os.remove(os.path.join(UPLOAD_DIR, r['stored_name']))
                except OSError:
                    pass
        db.academic_resources.delete_many(
            {'semester_id': subject['semester_id'], 'subject_id': subject_id}
        )
        # Cascade: delete custom sections and hidden default section markers
        db.custom_sections.delete_many(
            {'semester_id': subject['semester_id'], 'subject_id': subject_id}
        )
        db.hidden_default_sections.delete_many(
            {'semester_id': subject['semester_id'], 'subject_id': subject_id}
        )

        return jsonify({'message': 'Subject deleted'}), 200

    except Exception as e:
        logger.error(f"Delete subject error: {e}")
        return jsonify({'error': 'Failed to delete subject'}), 500


@subject_bp.route('/<subject_id>', methods=['PATCH'])
@token_required
def update_subject(subject_id):
    """Update subject fields (credits, faculties, details). CR only for class subjects."""
    from database import get_db
    try:
        data = request.get_json()
        user_id = request.user['user_id']
        db = get_db()

        subject = db.subjects.find_one({'_id': ObjectId(subject_id)})
        if not subject:
            return jsonify({'error': 'Subject not found'}), 404

        semester = db.semesters.find_one({'_id': ObjectId(subject['semester_id'])})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        # Personal subjects: only owner can edit
        if subject.get('personal'):
            if subject.get('created_by') != user_id:
                return jsonify({'error': 'Only the creator can edit a personal subject'}), 403
        else:
            if not is_cr_of(semester, user_id):
                return jsonify({'error': 'Only a CR can edit class subjects'}), 403

        update_fields = {}
        if 'credits' in data:
            update_fields['credits'] = data['credits']
        if 'faculties' in data:
            faculties = data['faculties']
            if isinstance(faculties, str):
                faculties = [f.strip() for f in faculties.split(',') if f.strip()]
            update_fields['faculties'] = faculties
        if 'details' in data:
            update_fields['details'] = data['details'].strip()
        if 'name' in data and data['name'].strip():
            update_fields['name'] = data['name'].strip()
        if 'code' in data:
            update_fields['code'] = data['code'].strip()
        if 'timetable_name' in data:
            update_fields['timetable_name'] = data['timetable_name'].strip() if data['timetable_name'] else None
        if 'resources_visible' in data:
            update_fields['resources_visible'] = bool(data['resources_visible'])

        if not update_fields:
            return jsonify({'error': 'No fields to update'}), 400

        db.subjects.update_one({'_id': ObjectId(subject_id)}, {'$set': update_fields})

        return jsonify({'message': 'Subject updated'}), 200

    except Exception as e:
        logger.error(f"Update subject error: {e}")
        return jsonify({'error': 'Failed to update subject'}), 500


@subject_bp.route('/semester/<semester_id>/sync-from-timetable', methods=['POST'])
@token_required
def sync_subjects_from_timetable(semester_id):
    """Sync Subject records from timetable grid strings (CR only, non-destructive)."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        if not is_cr_of(semester, user_id):
            return jsonify({'error': 'Only a CR can sync subjects'}), 403

        classroom_id = str(semester['classroom_id'])
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        if not classroom or not is_member_of_classroom(classroom, user_id):
            return jsonify({'error': 'Access denied'}), 403

        timetable = db.timetables.find_one({'semester_id': semester_id})
        if not timetable:
            return jsonify({'synced': 0, 'message': 'No timetable found'}), 200

        # Collect unique non-empty subject codes from the grid, with optional display names
        grid = timetable.get('grid', {})
        tt_subjects = {}  # code → display_name (or code if no subject_name set)
        for day_slots in grid.values():
            for cell in day_slots.values():
                code = (cell.get('subject') or '').strip()
                if code and cell.get('type', '').lower() != 'free':
                    display = (cell.get('subject_name') or '').strip() or code
                    tt_subjects[code] = display
        tt_names = set(tt_subjects.keys())

        # Find all class subjects that have a timetable_name no longer in the grid
        # (orphaned by a rename) — these should be renamed in-place so that
        # resources/marks (which reference subject_id) stay linked.
        all_linked = list(db.subjects.find({
            'semester_id': semester_id,
            'personal': {'$ne': True},
            'timetable_name': {'$exists': True, '$ne': None},
        }))
        orphaned = [s for s in all_linked if s.get('timetable_name') not in tt_names]
        # tt_names not yet matched to any existing subject
        unmatched_names = set(tt_names)
        for s in all_linked:
            tn = s.get('timetable_name') or s.get('name', '')
            unmatched_names.discard(tn)

        created = 0
        linked = 0
        renamed = 0

        for tt_code in list(unmatched_names):
            tt_display = tt_subjects[tt_code]  # subject_name if set, else same as code
            escaped = re.escape(tt_code)
            # Check if any existing subject matches by timetable_name or name
            existing = db.subjects.find_one({
                'semester_id': semester_id,
                'personal': {'$ne': True},
                '$or': [
                    {'timetable_name': {'$regex': f'^{escaped}$', '$options': 'i'}},
                    {'name': {'$regex': f'^{escaped}$', '$options': 'i'}},
                    {'code': {'$regex': f'^{escaped}$', '$options': 'i'}},
                ]
            })
            if existing:
                update = {'timetable_name': tt_code}
                if tt_display != tt_code:
                    # A real display name is available — set it if the subject name
                    # still looks like a code (equals its own timetable_name or code field)
                    cur_name = existing.get('name', '')
                    cur_code = existing.get('code', '')
                    if cur_name == cur_code or cur_name == tt_code or cur_name == (existing.get('timetable_name') or ''):
                        update['name'] = tt_display
                if not existing.get('timetable_name'):
                    db.subjects.update_one({'_id': existing['_id']}, {'$set': update})
                    linked += 1
                elif tt_display != tt_code and 'name' in update:
                    db.subjects.update_one({'_id': existing['_id']}, {'$set': {'name': tt_display}})
                    linked += 1
            elif orphaned:
                # Rename an orphaned subject in-place: preserves subject_id so
                # academic_resources, marks, etc. automatically follow.
                orphan = orphaned.pop(0)
                old_name = orphan.get('timetable_name') or orphan.get('name', '')
                db.subjects.update_one(
                    {'_id': orphan['_id']},
                    {'$set': {'name': tt_display, 'code': tt_code, 'timetable_name': tt_code}}
                )
                # Update attendance sessions and records that used the old name
                db.attendance_sessions.update_many(
                    {'semester_id': semester_id, 'subject': old_name},
                    {'$set': {'subject': tt_code}}
                )
                db.attendance_records.update_many(
                    {'semester_id': semester_id, 'subject': old_name},
                    {'$set': {'subject': tt_code}}
                )
                db.subject_attendance_config.update_many(
                    {'semester_id': semester_id, 'subject': old_name},
                    {'$set': {'subject': tt_code}}
                )
                renamed += 1
            else:
                db.subjects.insert_one({
                    'classroom_id': classroom_id,
                    'semester_id': semester_id,
                    'name': tt_display,
                    'code': tt_code if tt_display != tt_code else '',
                    'credits': '',
                    'faculties': [],
                    'details': '',
                    'personal': False,
                    'timetable_name': tt_code,
                    'created_by': user_id,
                    'created_at': datetime.now(timezone.utc),
                })
                created += 1

        return jsonify({
            'message': f'Sync complete: {created} created, {linked} linked, {renamed} renamed in-place',
            'created': created,
            'linked': linked,
            'renamed': renamed,
        }), 200

    except Exception as e:
        logger.error(f"Sync subjects error: {e}")
        return jsonify({'error': 'Failed to sync subjects'}), 500
