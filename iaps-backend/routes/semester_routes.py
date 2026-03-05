from flask import Blueprint, request, jsonify
from flask_cors import cross_origin
from datetime import datetime
from bson import ObjectId
import logging

from middleware import token_required, is_member_of_classroom

semester_bp = Blueprint('semester', __name__, url_prefix='/api/semester')
logger = logging.getLogger(__name__)


def is_cr_of(semester, user_id):
    """Check if user_id is in cr_ids of this semester"""
    return str(user_id) in [str(c) for c in semester.get('cr_ids', [])]


@semester_bp.route('/create', methods=['POST'])
@cross_origin()
@token_required
def create_semester():
    """Create a new semester. Only CRs of the current active semester can create a new one.
    Creating a new semester deactivates (archives) the previous active semester."""
    from database import get_db

    try:
        data = request.get_json()
        user_id = request.user['user_id']

        classroom_id = data.get('classroom_id', '').strip()
        name = data.get('name', '').strip()
        sem_type = data.get('type', '').strip()
        year = data.get('year', '').strip()
        session = data.get('session', '').strip()

        if not all([classroom_id, name]):
            return jsonify({'error': 'Classroom ID and semester name are required'}), 400

        db = get_db()

        # Verify classroom exists and user is a member
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404

        if not is_member_of_classroom(classroom, user_id):
            return jsonify({'error': 'Access denied'}), 403

        # Check if user is CR of the current active semester
        active_sem = db.semesters.find_one({
            'classroom_id': classroom_id,
            'is_active': True
        })

        if active_sem and not is_cr_of(active_sem, user_id):
            return jsonify({'error': 'Only a CR can create new semesters'}), 403

        # Archive all currently active semesters for this classroom
        db.semesters.update_many(
            {'classroom_id': classroom_id, 'is_active': True},
            {'$set': {'is_active': False, 'archived_at': datetime.utcnow()}}
        )

        # Create new semester with the current user as CR
        semester = {
            'classroom_id': classroom_id,
            'name': name,
            'type': sem_type,
            'year': year,
            'session': session,
            'cr_ids': [user_id],
            'is_active': True,
            'created_at': datetime.utcnow(),
            'archived_at': None
        }

        result = db.semesters.insert_one(semester)

        return jsonify({
            'message': 'Semester created successfully',
            'semester': {
                'id': str(result.inserted_id),
                'name': name,
                'type': sem_type,
                'year': year,
                'session': session,
                'cr_ids': [user_id],
                'is_active': True,
                'created_at': semester['created_at'].isoformat()
            }
        }), 201

    except Exception as e:
        logger.error(f"Create semester error: {e}")
        return jsonify({'error': 'Failed to create semester'}), 500


@semester_bp.route('/<semester_id>', methods=['GET'])
@cross_origin()
@token_required
def get_semester(semester_id):
    """Get a single semester with its subjects and any pending CR nomination."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        user_oid = ObjectId(user_id)
        db = get_db()

        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        classroom = db.classrooms.find_one({'_id': ObjectId(semester['classroom_id'])})
        if not classroom or not is_member_of_classroom(classroom, user_oid):
            return jsonify({'error': 'Access denied'}), 403

        cr_ids = [str(c) for c in semester.get('cr_ids', [])]
        # Self-healing: if no CRs exist (legacy/corrupt data), assign the classroom creator
        if not cr_ids:
            creator_id = str(classroom.get('created_by', ''))
            if creator_id:
                db.semesters.update_one(
                    {'_id': ObjectId(semester_id)},
                    {'$set': {'cr_ids': [creator_id]}}
                )
                cr_ids = [creator_id]
        # Return public subjects + this user's own personal subjects
        subjects = list(db.subjects.find({
            'semester_id': semester_id,
            '$or': [
                {'personal': {'$ne': True}},
                {'personal': True, 'created_by': user_id},
            ]
        }))
        subjects_data = [
            {
                'id': str(s['_id']),
                'name': s['name'],
                'code': s.get('code', ''),
                'personal': s.get('personal', False),
                'created_by': s.get('created_by', ''),
            }
            for s in subjects
        ]

        # Check if current user has a pending CR nomination for this semester
        pending_nomination = None
        nomination = db.cr_nominations.find_one({
            'semester_id': semester_id,
            'nominated_user_id': user_id
        })
        if nomination:
            nominator = db.users.find_one(
                {'_id': ObjectId(nomination['nominated_by_user_id'])},
                {'fullName': 1, 'username': 1}
            )
            nominator_name = (
                (nominator.get('fullName') or nominator.get('username', 'Unknown'))
                if nominator else 'Unknown'
            )
            pending_nomination = {
                'nominated_by': nominator_name,
                'nomination_type': nomination.get('nomination_type', 'transfer'),
            }

        # Fetch pinned messages array (supports up to 3, most recent first)
        # Backward-compat: also check old single pinned_message_id field
        pinned_ids = list(semester.get('pinned_message_ids') or [])
        if not pinned_ids and semester.get('pinned_message_id'):
            pinned_ids = [semester['pinned_message_id']]

        pinned_messages = []
        for pmid in pinned_ids:
            try:
                pm = db.chat_messages.find_one({'_id': ObjectId(pmid)})
                if pm:
                    pinned_messages.append({
                        'id': str(pm['_id']),
                        'text': pm.get('text', ''),
                        'username': pm.get('username', ''),
                        'full_name': pm.get('full_name', ''),
                    })
            except Exception:
                pass

        return jsonify({'semester': {
            'id': str(semester['_id']),
            'classroom_id': semester['classroom_id'],
            'name': semester['name'],
            'type': semester.get('type', ''),
            'year': semester.get('year', ''),
            'session': semester.get('session', ''),
            'is_active': semester.get('is_active', False),
            'cr_ids': cr_ids,
            'is_user_cr': user_id in cr_ids,
            'subjects': subjects_data,
            'pending_nomination': pending_nomination,
            'pinned_messages': pinned_messages,
            'created_at': semester['created_at'].isoformat(),
        }}), 200
    except Exception as e:
        logger.error(f"Get semester error: {e}")
        return jsonify({'error': 'Failed to fetch semester'}), 500


@semester_bp.route('/classroom/<classroom_id>/list', methods=['GET'])
@cross_origin()
@token_required
def list_semesters(classroom_id):
    """List all semesters for a classroom"""
    from database import get_db

    try:
        user_id = request.user['user_id']
        user_oid = ObjectId(user_id)
        db = get_db()

        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404

        if not is_member_of_classroom(classroom, user_oid):
            return jsonify({'error': 'Access denied'}), 403

        semesters = list(db.semesters.find(
            {'classroom_id': classroom_id}
        ).sort('created_at', -1))

        result = []
        for sem in semesters:
            cr_ids = [str(c) for c in sem.get('cr_ids', [])]
            # Self-healing: assign classroom creator as CR if no CRs set
            if not cr_ids:
                creator_id = str(classroom.get('created_by', ''))
                if creator_id:
                    db.semesters.update_one(
                        {'_id': sem['_id']},
                        {'$set': {'cr_ids': [creator_id]}}
                    )
                    cr_ids = [creator_id]
            result.append({
                'id': str(sem['_id']),
                'name': sem['name'],
                'type': sem.get('type', ''),
                'year': sem.get('year', ''),
                'session': sem.get('session', ''),
                'is_active': sem.get('is_active', False),
                'cr_ids': cr_ids,
                'is_user_cr': user_id in cr_ids,
                'created_at': sem['created_at'].isoformat()
            })

        return jsonify({'semesters': result}), 200

    except Exception as e:
        logger.error(f"List semesters error: {e}")
        return jsonify({'error': 'Failed to fetch semesters'}), 500


@semester_bp.route('/<semester_id>/add-cr', methods=['POST'])
@cross_origin()
@token_required
def add_cr(semester_id):
    """Add a CR to a semester. Only existing CRs can add new CRs."""
    from database import get_db

    try:
        data = request.get_json()
        user_id = request.user['user_id']
        new_cr_id = data.get('user_id', '').strip()

        if not new_cr_id:
            return jsonify({'error': 'User ID is required'}), 400

        db = get_db()
        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})

        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        if not is_cr_of(semester, user_id):
            return jsonify({'error': 'Only a CR can add other CRs'}), 403

        # Check the new CR is a member of the classroom
        classroom = db.classrooms.find_one({'_id': ObjectId(semester['classroom_id'])})
        if not classroom or not is_member_of_classroom(classroom, new_cr_id):
            return jsonify({'error': 'User must be a member of the classroom'}), 400

        # Already a CR?
        if is_cr_of(semester, new_cr_id):
            return jsonify({'error': 'User is already a CR'}), 400

        db.semesters.update_one(
            {'_id': ObjectId(semester_id)},
            {'$push': {'cr_ids': new_cr_id}}
        )

        return jsonify({'message': 'CR added successfully'}), 200

    except Exception as e:
        logger.error(f"Add CR error: {e}")
        return jsonify({'error': 'Failed to add CR'}), 500


@semester_bp.route('/<semester_id>/remove-cr', methods=['POST'])
@cross_origin()
@token_required
def remove_cr(semester_id):
    """Remove a CR from a semester. CRs can remove other CRs. At least one CR must remain."""
    from database import get_db

    try:
        data = request.get_json()
        user_id = request.user['user_id']
        target_cr_id = data.get('user_id', '').strip()

        if not target_cr_id:
            return jsonify({'error': 'User ID is required'}), 400

        db = get_db()
        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})

        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        if not is_cr_of(semester, user_id):
            return jsonify({'error': 'Only a CR can remove CRs'}), 403

        cr_ids = [str(c) for c in semester.get('cr_ids', [])]

        if target_cr_id not in cr_ids:
            return jsonify({'error': 'User is not a CR'}), 400

        # Enforce at least one CR
        if len(cr_ids) <= 1:
            return jsonify({'error': 'Cannot remove the last CR. Add another CR first.'}), 400

        db.semesters.update_one(
            {'_id': ObjectId(semester_id)},
            {'$pull': {'cr_ids': target_cr_id}}
        )

        return jsonify({'message': 'CR removed successfully'}), 200

    except Exception as e:
        logger.error(f"Remove CR error: {e}")
        return jsonify({'error': 'Failed to remove CR'}), 500


@semester_bp.route('/<semester_id>/nominate-cr', methods=['POST'])
@cross_origin()
@token_required
def nominate_cr(semester_id):
    """CR nominates a member to take over their CR role. One pending nomination per semester."""
    from database import get_db
    try:
        data = request.get_json()
        user_id = request.user['user_id']
        nominee_id = data.get('user_id', '').strip()

        if not nominee_id:
            return jsonify({'error': 'User ID is required'}), 400

        if nominee_id == user_id:
            return jsonify({'error': 'You cannot nominate yourself'}), 400

        db = get_db()
        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        if not is_cr_of(semester, user_id):
            return jsonify({'error': 'Only a CR can nominate'}), 403

        # Nominee must be a classroom member
        classroom = db.classrooms.find_one({'_id': ObjectId(semester['classroom_id'])})
        if not classroom or not is_member_of_classroom(classroom, nominee_id):
            return jsonify({'error': 'User must be a classroom member'}), 400

        # Nominee must not already be a CR
        if is_cr_of(semester, nominee_id):
            return jsonify({'error': 'User is already a CR'}), 400

        # Upsert: only one transfer nomination per semester (replaces previous)
        db.cr_nominations.replace_one(
            {'semester_id': semester_id, 'nomination_type': {'$in': ['transfer', None]}},
            {
                'semester_id': semester_id,
                'nominated_user_id': nominee_id,
                'nominated_by_user_id': user_id,
                'nomination_type': 'transfer',
                'created_at': datetime.utcnow()
            },
            upsert=True
        )

        return jsonify({'message': 'Nomination sent'}), 200

    except Exception as e:
        logger.error(f"Nominate CR error: {e}")
        return jsonify({'error': 'Failed to send nomination'}), 500


@semester_bp.route('/<semester_id>/nominate-add-cr', methods=['POST'])
@cross_origin()
@token_required
def nominate_add_cr(semester_id):
    """CR nominates a member to become co-CR. Nominator keeps their own CR role."""
    from database import get_db
    try:
        data = request.get_json()
        user_id = request.user['user_id']
        nominee_id = data.get('user_id', '').strip()

        if not nominee_id:
            return jsonify({'error': 'User ID is required'}), 400
        if nominee_id == user_id:
            return jsonify({'error': 'You cannot nominate yourself'}), 400

        db = get_db()
        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404
        if not is_cr_of(semester, user_id):
            return jsonify({'error': 'Only a CR can nominate'}), 403

        classroom = db.classrooms.find_one({'_id': ObjectId(semester['classroom_id'])})
        if not classroom or not is_member_of_classroom(classroom, nominee_id):
            return jsonify({'error': 'User must be a classroom member'}), 400
        if is_cr_of(semester, nominee_id):
            return jsonify({'error': 'User is already a CR'}), 400

        # One co-CR nomination per nominee per semester
        nominator = db.users.find_one({'_id': ObjectId(user_id)}, {'fullName': 1, 'username': 1})
        nominator_name = (nominator.get('fullName') or nominator.get('username', 'CR')) if nominator else 'CR'

        db.cr_nominations.replace_one(
            {'semester_id': semester_id, 'nominated_user_id': nominee_id, 'nomination_type': 'add_co_cr'},
            {
                'semester_id': semester_id,
                'nominated_user_id': nominee_id,
                'nominated_by_user_id': user_id,
                'nominated_by': nominator_name,
                'nomination_type': 'add_co_cr',
                'created_at': datetime.utcnow()
            },
            upsert=True
        )
        return jsonify({'message': 'Co-CR nomination sent. They must accept.'}), 200

    except Exception as e:
        logger.error(f"Nominate add CR error: {e}")
        return jsonify({'error': 'Failed to send co-CR nomination'}), 500


@semester_bp.route('/<semester_id>/accept-cr', methods=['POST'])
@cross_origin()
@token_required
def accept_cr_nomination(semester_id):
    """Nominated user accepts — they become CR. For transfer: nominator loses CR. For add_co_cr: nominator keeps CR."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()

        nomination = db.cr_nominations.find_one({
            'semester_id': semester_id,
            'nominated_user_id': user_id
        })
        if not nomination:
            return jsonify({'error': 'No pending nomination for you in this semester'}), 404

        nominator_id = nomination['nominated_by_user_id']
        nomination_type = nomination.get('nomination_type', 'transfer')

        db.semesters.update_one(
            {'_id': ObjectId(semester_id)},
            {'$addToSet': {'cr_ids': user_id}}
        )
        # Only remove nominator for transfer (not for add_co_cr)
        if nomination_type == 'transfer':
            db.semesters.update_one(
                {'_id': ObjectId(semester_id)},
                {'$pull': {'cr_ids': nominator_id}}
            )

        db.cr_nominations.delete_one({'_id': nomination['_id']})

        # Notify the nominator that acceptance happened
        try:
            nominee = db.users.find_one({'_id': ObjectId(user_id)}, {'fullName': 1, 'username': 1})
            nominee_name = (nominee.get('fullName') or nominee.get('username', 'Someone')) if nominee else 'Someone'
            msg = (f'{nominee_name} accepted the co-CR role. You both are now CRs.'
                   if nomination_type == 'add_co_cr'
                   else f'{nominee_name} accepted the CR role. You are no longer CR.')
            db.cr_notifications.insert_one({
                'for_user_id': nominator_id,
                'semester_id': semester_id,
                'type': 'cr_accepted',
                'message': msg,
                'read': False,
                'created_at': datetime.utcnow(),
            })
            from routes.chat_routes import emit_to_user
            emit_to_user(nominator_id, 'cr_transfer_result', {
                'type': 'accepted',
                'semester_id': semester_id,
                'message': msg,
            })
        except Exception:
            pass

        return jsonify({'message': 'You are now a CR'}), 200

    except Exception as e:
        logger.error(f"Accept CR nomination error: {e}")
        return jsonify({'error': 'Failed to accept nomination'}), 500


@semester_bp.route('/<semester_id>/decline-cr', methods=['POST'])
@cross_origin()
@token_required
def decline_cr_nomination(semester_id):
    """Nominated user declines — nomination is cancelled, nominator keeps their role."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()

        # Fetch nomination BEFORE deleting so we have nominator_id for notification
        nomination = db.cr_nominations.find_one({
            'semester_id': semester_id,
            'nominated_user_id': user_id
        })
        if not nomination:
            return jsonify({'error': 'No pending nomination found'}), 404

        nominator_id = nomination['nominated_by_user_id']
        db.cr_nominations.delete_one({'_id': nomination['_id']})

        # Notify the nominator that their transfer was declined
        try:
            nominee = db.users.find_one({'_id': ObjectId(user_id)}, {'fullName': 1, 'username': 1})
            nominee_name = (nominee.get('fullName') or nominee.get('username', 'Someone')) if nominee else 'Someone'
            db.cr_notifications.insert_one({
                'for_user_id': nominator_id,
                'semester_id': semester_id,
                'type': 'cr_declined',
                'message': f'{nominee_name} declined the CR role. You remain CR.',
                'read': False,
                'created_at': datetime.utcnow(),
            })
            from routes.chat_routes import emit_to_user
            emit_to_user(nominator_id, 'cr_transfer_result', {
                'type': 'declined',
                'semester_id': semester_id,
                'message': f'{nominee_name} declined the CR role. You remain CR.',
            })
        except Exception:
            pass

        return jsonify({'message': 'Nomination declined'}), 200

    except Exception as e:
        logger.error(f"Decline CR nomination error: {e}")
        return jsonify({'error': 'Failed to decline nomination'}), 500


@semester_bp.route('/<semester_id>/cr-notifications', methods=['GET'])
@cross_origin()
@token_required
def get_cr_notifications(semester_id):
    """Return unread CR transfer notifications for the current user in this semester."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        notes = list(db.cr_notifications.find({
            'for_user_id': user_id,
            'semester_id': semester_id,
            'read': False,
        }).sort('created_at', -1))
        result = [{'id': str(n['_id']), 'type': n['type'], 'message': n['message'], 'created_at': n['created_at'].isoformat()} for n in notes]
        # Mark all as read
        if notes:
            db.cr_notifications.update_many(
                {'_id': {'$in': [n['_id'] for n in notes]}},
                {'$set': {'read': True}}
            )
        return jsonify({'notifications': result}), 200
    except Exception as e:
        logger.error(f"Get CR notifications error: {e}")
        return jsonify({'error': 'Failed to fetch notifications'}), 500


@semester_bp.route('/<semester_id>/links', methods=['GET'])
@cross_origin()
@token_required
def list_links(semester_id):
    """List all links for a semester. Any member can view."""
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
        links = list(db.semester_links.find({'semester_id': semester_id}).sort('created_at', 1))
        result = [{'id': str(l['_id']), 'label': l['label'], 'url': l['url'], 'created_at': l['created_at'].isoformat()} for l in links]
        return jsonify({'links': result}), 200
    except Exception as e:
        logger.error(f"List links error: {e}")
        return jsonify({'error': 'Failed to fetch links'}), 500


@semester_bp.route('/<semester_id>/links', methods=['POST'])
@cross_origin()
@token_required
def add_link(semester_id):
    """CR adds a labeled link to the semester."""
    from database import get_db
    try:
        data = request.get_json()
        user_id = request.user['user_id']
        label = data.get('label', '').strip()
        url = data.get('url', '').strip()
        if not label or not url:
            return jsonify({'error': 'Label and URL are required'}), 400
        if not url.startswith(('http://', 'https://')):
            return jsonify({'error': 'URL must start with http:// or https://'}), 400
        db = get_db()
        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404
        if not is_cr_of(semester, user_id):
            return jsonify({'error': 'Only a CR can add links'}), 403
        link = {'semester_id': semester_id, 'label': label, 'url': url, 'created_by': user_id, 'created_at': datetime.utcnow()}
        result = db.semester_links.insert_one(link)
        return jsonify({'message': 'Link added', 'link': {'id': str(result.inserted_id), 'label': label, 'url': url, 'created_at': link['created_at'].isoformat()}}), 201
    except Exception as e:
        logger.error(f"Add link error: {e}")
        return jsonify({'error': 'Failed to add link'}), 500


@semester_bp.route('/<semester_id>/links/<link_id>', methods=['DELETE'])
@cross_origin()
@token_required
def delete_link(semester_id, link_id):
    """CR deletes a link."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404
        if not is_cr_of(semester, user_id):
            return jsonify({'error': 'Only a CR can delete links'}), 403
        result = db.semester_links.delete_one({'_id': ObjectId(link_id), 'semester_id': semester_id})
        if result.deleted_count == 0:
            return jsonify({'error': 'Link not found'}), 404
        return jsonify({'message': 'Link deleted'}), 200
    except Exception as e:
        logger.error(f"Delete link error: {e}")
        return jsonify({'error': 'Failed to delete link'}), 500


@semester_bp.route('/<semester_id>', methods=['DELETE'])
@cross_origin()
@token_required
def delete_semester(semester_id):
    """Delete a semester (CR only, cannot delete the only semester)"""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        if not is_cr_of(semester, user_id):
            return jsonify({'error': 'Only a CR can delete semesters'}), 403

        # Don't allow deleting if it's the only semester
        semester_count = db.semesters.count_documents({
            'classroom_id': semester['classroom_id']
        })
        if semester_count <= 1:
            return jsonify({'error': 'Cannot delete the only semester'}), 400

        db.semesters.delete_one({'_id': ObjectId(semester_id)})

        # Cascade-delete subjects and todos for this semester
        db.subjects.delete_many({'semester_id': semester_id})
        db.todos.delete_many({'semester_id': semester_id})

        # If we deleted the active semester, activate the most recent remaining one
        if semester.get('is_active'):
            latest = db.semesters.find_one(
                {'classroom_id': semester['classroom_id']},
                sort=[('created_at', -1)]
            )
            if latest:
                db.semesters.update_one(
                    {'_id': latest['_id']},
                    {'$set': {'is_active': True, 'archived_at': None}}
                )

        return jsonify({'message': 'Semester deleted successfully'}), 200

    except Exception as e:
        logger.error(f"Delete semester error: {e}")
        return jsonify({'error': 'Failed to delete semester'}), 500


