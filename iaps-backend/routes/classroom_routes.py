from flask import Blueprint, request, jsonify
from flask_cors import cross_origin
from datetime import datetime, timezone
from bson import ObjectId
import logging
import random
import string
import os

from middleware import token_required, is_member_of_classroom

classroom_bp = Blueprint('classroom', __name__, url_prefix='/api/classroom')
logger = logging.getLogger(__name__)


def generate_code(db):
    """Generate a unique 6-char classroom code"""
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if not db.classrooms.find_one({'code': code}):
            return code


def format_classroom(classroom, show_code=False):
    """Format classroom for API response"""
    result = {
        'id': str(classroom['_id']),
        'name': classroom['name'],
        'description': classroom.get('description', ''),
        'created_by': str(classroom['created_by']),
        'member_count': len(classroom.get('members', [])),
        'pending_requests': len(classroom.get('join_requests', [])),
        'created_at': classroom['created_at'].isoformat()
    }
    if show_code:
        result['code'] = classroom['code']
    return result


@classroom_bp.route('/create', methods=['POST'])
@cross_origin()
@token_required
def create_classroom():
    """Create a new classroom. Creator becomes a member and first CR of the auto-created semester."""
    from database import get_db

    try:
        data = request.get_json()
        user_id = request.user['user_id']
        user_oid = ObjectId(user_id)

        name = data.get('name', '').strip()
        description = data.get('description', '').strip()
        sem_type = data.get('semester_type', 'odd').strip() or 'odd'
        sem_number = data.get('semester_number', '').strip()
        sem_year = data.get('year', '').strip()
        sem_session = data.get('session', '').strip()

        if not name:
            return jsonify({'error': 'Classroom name is required'}), 400

        db = get_db()
        code = generate_code(db)

        classroom = {
            'name': name,
            'description': description,
            'code': code,
            'created_by': user_oid,
            'members': [user_oid],
            'join_requests': [],
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow()
        }

        result = db.classrooms.insert_one(classroom)
        classroom['_id'] = result.inserted_id
        classroom_id = str(result.inserted_id)

        # Build semester name from fields
        type_label = 'Odd' if sem_type == 'odd' else 'Even'
        parts = []
        if sem_number:
            parts.append(f'Semester {sem_number}')
            parts.append(f'({type_label})')
        else:
            parts.append(f'{type_label} Semester')
        if sem_year:
            parts.append(sem_year)
        if sem_session:
            parts.append(f'({sem_session})')
        sem_name = ' '.join(parts) if parts else 'Semester 1'

        # Auto-create first semester with creator as first CR
        first_semester = {
            'classroom_id': classroom_id,
            'name': sem_name,
            'type': sem_type,
            'number': sem_number,
            'year': sem_year,
            'session': sem_session,
            'cr_ids': [user_id],
            'is_active': True,
            'created_at': datetime.utcnow(),
            'archived_at': None
        }
        sem_result = db.semesters.insert_one(first_semester)

        return jsonify({
            'message': 'Classroom created successfully',
            'classroom': format_classroom(classroom, show_code=True),
            'semester': {
                'id': str(sem_result.inserted_id),
                'name': first_semester['name'],
                'type': first_semester['type'],
                'is_active': True
            }
        }), 201

    except Exception as e:
        logger.error(f"Create classroom error: {e}")
        return jsonify({'error': 'Failed to create classroom'}), 500


@classroom_bp.route('/join/request', methods=['POST'])
@cross_origin()
@token_required
def request_join():
    """Request to join a classroom using code. CR must approve."""
    from database import get_db

    try:
        data = request.get_json()
        user_id = request.user['user_id']
        user_oid = ObjectId(user_id)
        code = data.get('code', '').strip().upper()

        if not code:
            return jsonify({'error': 'Classroom code is required'}), 400

        db = get_db()
        classroom = db.classrooms.find_one({'code': code})

        if not classroom:
            return jsonify({'error': 'Invalid classroom code'}), 404

        # Already a member?
        if user_oid in classroom.get('members', []):
            return jsonify({'error': 'You are already a member of this classroom'}), 400

        # Already requested?
        for req in classroom.get('join_requests', []):
            if req.get('user_id') == user_oid:
                return jsonify({'error': 'You have already requested to join'}), 400

        # Add join request
        join_request = {
            'user_id': user_oid,
            'requested_at': datetime.utcnow()
        }

        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$push': {'join_requests': join_request}}
        )

        return jsonify({
            'message': 'Join request sent. A CR will approve your request.',
            'classroom_name': classroom['name']
        }), 200

    except Exception as e:
        logger.error(f"Join request error: {e}")
        return jsonify({'error': 'Failed to send join request'}), 500


@classroom_bp.route('/<classroom_id>/approve', methods=['POST'])
@cross_origin()
@token_required
def approve_request(classroom_id):
    """Approve a join request. Only CRs of the active semester can approve."""
    from database import get_db
    from middleware import get_active_semester

    try:
        data = request.get_json()
        cr_user_id = request.user['user_id']
        target_user_id = data.get('user_id', '').strip()

        if not target_user_id:
            return jsonify({'error': 'User ID is required'}), 400

        db = get_db()
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})

        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404

        # Check if requester is a CR of the active semester
        active_sem = get_active_semester(db, classroom_id)
        if not active_sem or cr_user_id not in [str(c) for c in active_sem.get('cr_ids', [])]:
            return jsonify({'error': 'Only a CR can approve join requests'}), 403

        target_oid = ObjectId(target_user_id)

        # Remove from join_requests and add to members
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {
                '$pull': {'join_requests': {'user_id': target_oid}},
                '$addToSet': {'members': target_oid},
                '$set': {'updated_at': datetime.utcnow()}
            }
        )

        return jsonify({'message': 'Member approved successfully'}), 200

    except Exception as e:
        logger.error(f"Approve request error: {e}")
        return jsonify({'error': 'Failed to approve request'}), 500


@classroom_bp.route('/<classroom_id>/reject', methods=['POST'])
@cross_origin()
@token_required
def reject_request(classroom_id):
    """Reject a join request. Only CRs can reject."""
    from database import get_db
    from middleware import get_active_semester

    try:
        data = request.get_json()
        cr_user_id = request.user['user_id']
        target_user_id = data.get('user_id', '').strip()

        if not target_user_id:
            return jsonify({'error': 'User ID is required'}), 400

        db = get_db()
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})

        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404

        active_sem = get_active_semester(db, classroom_id)
        if not active_sem or cr_user_id not in [str(c) for c in active_sem.get('cr_ids', [])]:
            return jsonify({'error': 'Only a CR can reject join requests'}), 403

        target_oid = ObjectId(target_user_id)

        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$pull': {'join_requests': {'user_id': target_oid}}}
        )

        return jsonify({'message': 'Request rejected'}), 200

    except Exception as e:
        logger.error(f"Reject request error: {e}")
        return jsonify({'error': 'Failed to reject request'}), 500


@classroom_bp.route('/list', methods=['GET'])
@cross_origin()
@token_required
def list_classrooms():
    """List all classrooms the user is a member of"""
    from database import get_db

    try:
        user_id = request.user['user_id']
        user_oid = ObjectId(user_id)
        db = get_db()

        classrooms = list(db.classrooms.find({'members': user_oid}))

        result = []
        for c in classrooms:
            # Check if user is CR of the active semester
            active_sem = db.semesters.find_one({
                'classroom_id': str(c['_id']),
                'is_active': True
            })
            is_cr = False
            if active_sem:
                is_cr = user_id in [
                    str(cr) for cr in active_sem.get('cr_ids', [])
                ]

            formatted = format_classroom(c, show_code=is_cr)
            formatted['is_cr'] = is_cr
            result.append(formatted)

        return jsonify({'classrooms': result}), 200

    except Exception as e:
        logger.error(f"List classrooms error: {e}")
        return jsonify({'error': 'Failed to retrieve classrooms'}), 500


@classroom_bp.route('/<classroom_id>', methods=['GET'])
@cross_origin()
@token_required
def get_classroom(classroom_id):
    """Get detailed classroom information with semesters"""
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

        # Get member info
        members = list(db.users.find({'_id': {'$in': classroom.get('members', [])}}))

        # Get pending join requests with user info
        join_requests = []
        for req in classroom.get('join_requests', []):
            req_user = db.users.find_one({'_id': req['user_id']})
            if req_user:
                join_requests.append({
                    'user_id': str(req['user_id']),
                    'username': req_user['username'],
                    'email': req_user['email'],
                    'fullName': req_user.get('fullName'),
                    'requested_at': req['requested_at'].isoformat()
                })

        # Get semesters for this classroom
        semesters = list(db.semesters.find(
            {'classroom_id': str(classroom['_id'])}
        ).sort('created_at', -1))

        formatted_semesters = []
        for sem in semesters:
            cr_ids = [str(c) for c in sem.get('cr_ids', [])]
            sem_id = str(sem['_id'])

            # Fetch subjects for this semester
            subjects = list(db.subjects.find({'semester_id': sem_id}).sort('created_at', 1))
            formatted_subjects = [{
                'id': str(s['_id']),
                'name': s['name'],
                'code': s.get('code', '')
            } for s in subjects]

            # Check for pending CR nomination for this user in this semester
            pending_nomination = None
            try:
                nomination = db.cr_nominations.find_one({
                    'semester_id': sem_id,
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
                        'semester_id': sem_id,
                        'semester_name': sem['name'],
                    }
            except Exception as e:
                logger.error(f"Nomination check error for sem {sem_id}: {e}")
                pending_nomination = None

            formatted_semesters.append({
                'id': sem_id,
                'name': sem['name'],
                'type': sem.get('type', ''),
                'year': sem.get('year', ''),
                'session': sem.get('session', ''),
                'is_active': sem.get('is_active', False),
                'cr_ids': cr_ids,
                'is_user_cr': user_id in cr_ids,
                'subjects': formatted_subjects,
                'pending_nomination': pending_nomination,
                'created_at': sem['created_at'].isoformat()
            })

        # Check if user is CR of active semester
        active_sem = next((s for s in formatted_semesters if s['is_active']), None)
        is_cr = active_sem['is_user_cr'] if active_sem else False

        return jsonify({
            'classroom': {
                'id': str(classroom['_id']),
                'name': classroom['name'],
                'description': classroom.get('description', ''),
                'code': classroom['code'] if is_cr else None,
                'created_by': str(classroom['created_by']),
                'members': [{
                    'id': str(m['_id']),
                    'username': m['username'],
                    'email': m['email'],
                    'fullName': m.get('fullName'),
                    'profile_picture': m.get('profile_picture'),
                    # phone: visible to CR always, or to everyone if member made it public
                    'phone': m.get('phone', '') if (is_cr or m.get('phone_public', False)) else None,
                    'phone_public': m.get('phone_public', False),
                } for m in members],
                'join_requests': join_requests if is_cr else [],
                'semesters': formatted_semesters,
                'is_cr': is_cr,
                'member_count': len(classroom.get('members', [])),
                'created_at': classroom['created_at'].isoformat()
            }
        }), 200

    except Exception as e:
        logger.error(f"Get classroom error: {e}")
        return jsonify({'error': 'Failed to retrieve classroom'}), 500


@classroom_bp.route('/<classroom_id>/leave', methods=['POST'])
@cross_origin()
@token_required
def leave_classroom(classroom_id):
    """Leave a classroom. Any member can leave at any time."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        user_oid = ObjectId(user_id)
        db = get_db()

        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})

        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404

        if not is_member_of_classroom(classroom, user_oid):
            return jsonify({'error': 'You are not a member of this classroom'}), 403

        # Block leave if user is the sole CR in any semester
        sole_cr_semesters = list(db.semesters.find({
            'classroom_id': classroom_id,
            'cr_ids': user_id
        }))
        for sem in sole_cr_semesters:
            cr_ids = [str(c) for c in sem.get('cr_ids', [])]
            if len(cr_ids) == 1:
                return jsonify({
                    'error': f'You are the only CR in "{sem["name"]}". Transfer your CR role before leaving.'
                }), 400

        # Get semester IDs for nomination cleanup
        sem_ids = [str(s['_id']) for s in db.semesters.find({'classroom_id': classroom_id}, {'_id': 1})]

        # Remove from members list
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {
                '$pull': {'members': user_oid},
                '$set': {'updated_at': datetime.utcnow()}
            }
        )

        # Remove from CR lists in every semester of this classroom
        db.semesters.update_many(
            {'classroom_id': classroom_id},
            {'$pull': {'cr_ids': user_id}}
        )

        # Cancel any pending CR nominations involving this user
        if sem_ids:
            db.cr_nominations.delete_many({
                'semester_id': {'$in': sem_ids},
                '$or': [
                    {'nominated_user_id': user_id},
                    {'nominated_by_user_id': user_id}
                ]
            })

        return jsonify({'message': 'You have left the classroom'}), 200

    except Exception as e:
        logger.error(f"Leave classroom error: {e}")
        return jsonify({'error': 'Failed to leave classroom'}), 500


@classroom_bp.route('/<classroom_id>/semester/<semester_id>/quit-cr', methods=['POST'])
@cross_origin()
@token_required
def quit_cr(classroom_id, semester_id):
    """Step down as CR in a semester without leaving the classroom. Only allowed if another CR exists."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester = db.semesters.find_one({'_id': ObjectId(semester_id), 'classroom_id': classroom_id})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        cr_ids = [str(c) for c in semester.get('cr_ids', [])]
        if user_id not in cr_ids:
            return jsonify({'error': 'You are not a CR of this semester'}), 403

        if len(cr_ids) <= 1:
            return jsonify({'error': 'You are the only CR. Transfer your role before stepping down.'}), 400

        db.semesters.update_one(
            {'_id': ObjectId(semester_id)},
            {'$pull': {'cr_ids': user_id}}
        )

        # Notify remaining CRs
        try:
            quitter = db.users.find_one({'_id': ObjectId(user_id)}, {'fullName': 1, 'username': 1})
            quitter_name = (quitter.get('fullName') or quitter.get('username', 'Someone')) if quitter else 'Someone'
            remaining_cr_ids = [c for c in cr_ids if c != user_id]
            for cr_id in remaining_cr_ids:
                db.cr_notifications.insert_one({
                    'for_user_id': cr_id,
                    'semester_id': semester_id,
                    'type': 'cr_stepped_down',
                    'message': f'{quitter_name} stepped down as CR in {semester["name"]}. You are now the sole CR.',
                    'read': False,
                    'created_at': datetime.utcnow(),
                })
        except Exception:
            pass

        return jsonify({'message': 'You have stepped down as CR'}), 200

    except Exception as e:
        logger.error(f"Quit CR error: {e}")
        return jsonify({'error': 'Failed to quit CR role'}), 500


@classroom_bp.route('/<classroom_id>/pending-nominations', methods=['GET'])
@cross_origin()
@token_required
def get_pending_nominations(classroom_id):
    """Return any pending CR nominations for the current user across all semesters in this classroom."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        semesters = list(db.semesters.find({'classroom_id': classroom_id}, {'_id': 1, 'name': 1}))
        result = []
        for sem in semesters:
            sem_id = str(sem['_id'])
            nomination = db.cr_nominations.find_one({
                'semester_id': sem_id,
                'nominated_user_id': user_id,
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
                result.append({
                    'semester_id': sem_id,
                    'semester_name': sem['name'],
                    'nominated_by': nominator_name,
                    'nomination_type': nomination.get('nomination_type', 'transfer'),
                })
        return jsonify({'nominations': result}), 200
    except Exception as e:
        logger.error(f"Get pending nominations error: {e}")
        return jsonify({'error': 'Failed to fetch nominations'}), 500


@classroom_bp.route('/<classroom_id>/cr-notifications', methods=['GET'])
@cross_origin()
@token_required
def get_classroom_cr_notifications(classroom_id):
    """Fetch all unread CR notifications for the current user across all semesters in this classroom."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        sem_ids = [str(s['_id']) for s in db.semesters.find({'classroom_id': classroom_id}, {'_id': 1})]
        notes = list(db.cr_notifications.find({
            'for_user_id': user_id,
            'semester_id': {'$in': sem_ids},
            'read': False,
        }).sort('created_at', -1))
        result = [{'id': str(n['_id']), 'type': n['type'], 'message': n['message'], 'created_at': n['created_at'].isoformat()} for n in notes]
        if notes:
            db.cr_notifications.update_many(
                {'_id': {'$in': [n['_id'] for n in notes]}},
                {'$set': {'read': True}}
            )
        return jsonify({'notifications': result}), 200
    except Exception as e:
        logger.error(f"Get classroom CR notifications error: {e}")
        return jsonify({'error': 'Failed to fetch notifications'}), 500


@classroom_bp.route('/<classroom_id>/remove-member', methods=['POST'])
@cross_origin()
@token_required
def remove_member(classroom_id):
    """Remove a member from the classroom. CR only. Cannot remove yourself or the creator."""
    from database import get_db
    from middleware import get_active_semester

    try:
        data = request.get_json()
        cr_user_id = request.user['user_id']
        target_user_id = data.get('user_id', '').strip()

        if not target_user_id:
            return jsonify({'error': 'User ID is required'}), 400

        db = get_db()
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})

        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404

        # Only CRs can remove members
        active_sem = get_active_semester(db, classroom_id)
        if not active_sem or cr_user_id not in [str(c) for c in active_sem.get('cr_ids', [])]:
            return jsonify({'error': 'Only a CR can remove members'}), 403

        # Cannot remove yourself
        if target_user_id == cr_user_id:
            return jsonify({'error': 'You cannot remove yourself'}), 400

        # CRs cannot remove other CRs
        active_sem_for_check = get_active_semester(db, classroom_id)
        if active_sem_for_check:
            target_cr_ids = [str(c) for c in active_sem_for_check.get('cr_ids', [])]
            if target_user_id in target_cr_ids:
                return jsonify({'error': 'Cannot remove another CR'}), 403

        target_oid = ObjectId(target_user_id)

        # Check they are actually a member
        if not is_member_of_classroom(classroom, target_oid):
            return jsonify({'error': 'User is not a member'}), 400

        # Remove from members
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {
                '$pull': {'members': target_oid},
                '$set': {'updated_at': datetime.utcnow()}
            }
        )

        # Also remove from any CR lists in this classroom's semesters
        db.semesters.update_many(
            {'classroom_id': classroom_id},
            {'$pull': {'cr_ids': target_user_id}}
        )

        return jsonify({'message': 'Member removed'}), 200

    except Exception as e:
        logger.error(f"Remove member error: {e}")
        return jsonify({'error': 'Failed to remove member'}), 500


@classroom_bp.route('/<classroom_id>/remove-member-avatar', methods=['POST'])
@cross_origin()
@token_required
def remove_member_avatar(classroom_id):
    """CR removes a member's profile photo with a reason."""
    from database import get_db
    from middleware import get_active_semester

    try:
        data = request.get_json()
        cr_user_id = request.user['user_id']
        target_user_id = data.get('user_id', '').strip()
        reason = data.get('reason', '').strip()

        if not target_user_id:
            return jsonify({'error': 'User ID is required'}), 400
        if not reason:
            return jsonify({'error': 'Reason is required'}), 400

        db = get_db()
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404

        active_sem = get_active_semester(db, classroom_id)
        if not active_sem or cr_user_id not in [str(c) for c in active_sem.get('cr_ids', [])]:
            return jsonify({'error': 'Only a CR can remove profile photos'}), 403

        target_oid = ObjectId(target_user_id)
        if not is_member_of_classroom(classroom, target_oid):
            return jsonify({'error': 'User is not a member'}), 400

        target = db.users.find_one({'_id': target_oid})
        if not target:
            return jsonify({'error': 'User not found'}), 404
        if not target.get('profile_picture'):
            return jsonify({'error': 'User has no profile photo'}), 400

        # Delete file from disk
        avatars_dir = os.path.join(os.getcwd(), 'uploads', 'avatars')
        filepath = os.path.join(avatars_dir, target['profile_picture'])
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
            except Exception as e:
                logger.warning(f"Could not delete avatar file: {e}")

        cr = db.users.find_one({'_id': ObjectId(cr_user_id)}, {'fullName': 1, 'username': 1})
        cr_name = (cr.get('fullName') or cr.get('username', 'CR')) if cr else 'CR'

        db.users.update_one(
            {'_id': target_oid},
            {'$set': {
                'profile_picture': None,
                'photo_removed_reason': reason,
                'photo_removed_by': cr_name,
                'photo_removed_at': datetime.utcnow()
            }}
        )

        return jsonify({'message': 'Profile photo removed'}), 200

    except Exception as e:
        logger.error(f"Remove member avatar error: {e}")
        return jsonify({'error': 'Failed to remove photo'}), 500


@classroom_bp.route('/<classroom_id>/flag-member-name', methods=['POST'])
@cross_origin()
@token_required
def flag_member_name(classroom_id):
    """CR flags a member's display name as inappropriate; member is shown as Anonymous until they change it."""
    from database import get_db
    from middleware import get_active_semester

    try:
        data = request.get_json()
        cr_user_id = request.user['user_id']
        target_user_id = data.get('user_id', '').strip()
        reason = data.get('reason', '').strip()

        if not target_user_id:
            return jsonify({'error': 'User ID is required'}), 400
        if not reason:
            return jsonify({'error': 'Reason is required'}), 400

        db = get_db()
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404

        active_sem = get_active_semester(db, classroom_id)
        if not active_sem or cr_user_id not in [str(c) for c in active_sem.get('cr_ids', [])]:
            return jsonify({'error': 'Only a CR can flag names'}), 403

        target_oid = ObjectId(target_user_id)
        if not is_member_of_classroom(classroom, target_oid):
            return jsonify({'error': 'User is not a member'}), 400

        target = db.users.find_one({'_id': target_oid})
        if not target:
            return jsonify({'error': 'User not found'}), 404

        cr = db.users.find_one({'_id': ObjectId(cr_user_id)}, {'fullName': 1, 'username': 1})
        cr_name = (cr.get('fullName') or cr.get('username', 'CR')) if cr else 'CR'

        db.users.update_one(
            {'_id': target_oid},
            {'$set': {
                'name_removed_reason': reason,
                'name_removed_by': cr_name,
                'name_removed_at': datetime.now(timezone.utc)
            }}
        )

        return jsonify({'message': 'Display name flagged. Member will be notified.'}), 200

    except Exception as e:
        logger.error(f"Flag member name error: {e}")
        return jsonify({'error': 'Failed to flag display name'}), 500


@classroom_bp.route('/<classroom_id>/activity', methods=['GET'])
@cross_origin()
@token_required
def get_classroom_activity(classroom_id):
    """Return recent activity for a classroom: announcements, unread chat counts, pending requests."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()

        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        if not classroom or not is_member_of_classroom(classroom, user_id):
            return jsonify({'error': 'Access denied'}), 403

        # All semesters for this classroom
        semesters = list(db.semesters.find({'classroom_id': classroom_id}, {'_id': 1, 'name': 1}))
        semester_ids = [str(s['_id']) for s in semesters]
        sem_names = {str(s['_id']): s.get('name', '') for s in semesters}

        # Recent announcements (last 7 days, max 10)
        from datetime import timedelta
        seven_days_ago = datetime.utcnow() - timedelta(days=7)
        raw_ann = list(db.announcements.find(
            {'semester_id': {'$in': semester_ids}, 'created_at': {'$gte': seven_days_ago}},
            sort=[('created_at', -1)],
            limit=10
        ))
        announcements = [
            {
                'id': str(a['_id']),
                'text': a['text'],
                'created_by_name': a.get('created_by_name', 'CR'),
                'semester_name': sem_names.get(a.get('semester_id', ''), ''),
                'created_at': a['created_at'].isoformat(),
            }
            for a in raw_ann
        ]

        # Unread chat counts per semester
        unread_chat = {}
        for sid in semester_ids:
            last_read = db.chat_read_status.find_one({'user_id': user_id, 'semester_id': sid})
            from datetime import datetime as _dt
            cutoff = last_read['last_read_at'] if last_read else _dt(1970, 1, 1)
            count = db.chat_messages.count_documents({
                'semester_id': sid,
                'created_at': {'$gt': cutoff},
                'user_id': {'$ne': user_id},
            })
            if count > 0:
                unread_chat[sid] = {'count': count, 'semester_name': sem_names.get(sid, '')}

        # Pending join requests count (CR only)
        pending_requests = len(classroom.get('join_requests', [])) if classroom.get('is_cr_for_user') else 0
        # Re-check CR status properly
        is_cr = user_id == str(classroom.get('created_by', ''))
        if not is_cr:
            for sem in semesters:
                full_sem = db.semesters.find_one({'_id': sem['_id']}, {'cr_ids': 1})
                if full_sem and user_id in [str(c) for c in full_sem.get('cr_ids', [])]:
                    is_cr = True
                    break
        pending_requests = len(classroom.get('join_requests', [])) if is_cr else 0

        return jsonify({
            'announcements': announcements,
            'unread_chat': unread_chat,
            'pending_requests': pending_requests,
        }), 200

    except Exception as e:
        logger.error(f"get_classroom_activity error: {e}")
        return jsonify({'error': 'Failed to fetch activity'}), 500


@classroom_bp.route('/<classroom_id>', methods=['DELETE'])
@cross_origin()
@token_required
def delete_classroom(classroom_id):
    """Delete a classroom and all its data. CR only."""
    from database import get_db
    from middleware import get_active_semester

    try:
        user_id = request.user['user_id']
        db = get_db()

        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404

        active_sem = get_active_semester(db, classroom_id)
        if not active_sem or user_id not in [str(c) for c in active_sem.get('cr_ids', [])]:
            return jsonify({'error': 'Only a CR can delete this classroom'}), 403

        # Collect semester IDs for cascade
        semester_ids = [str(s['_id']) for s in db.semesters.find({'classroom_id': classroom_id}, {'_id': 1})]

        if semester_ids:
            # Delete academic resource files + records
            for r in db.academic_resources.find({'semester_id': {'$in': semester_ids}}):
                if r.get('stored_name'):
                    try:
                        os.remove(os.path.join(os.getcwd(), 'uploads', 'academics', r['stored_name']))
                    except OSError:
                        pass
            db.academic_resources.delete_many({'semester_id': {'$in': semester_ids}})
            db.custom_sections.delete_many({'semester_id': {'$in': semester_ids}})
            db.hidden_default_sections.delete_many({'semester_id': {'$in': semester_ids}})
            db.cr_nominations.delete_many({'semester_id': {'$in': semester_ids}})
            db.semester_sessions.delete_many({'semester_id': {'$in': semester_ids}})

        # Delete subjects
        db.subjects.delete_many({'classroom_id': classroom_id})

        # Delete documents + files from disk
        for doc in db.documents.find({'classroom_id': classroom_id}):
            if doc.get('file_path') and os.path.exists(doc['file_path']):
                try:
                    os.remove(doc['file_path'])
                except OSError:
                    pass
        db.documents.delete_many({'classroom_id': classroom_id})

        # Delete chat messages + attached files
        for msg in db.chat_messages.find({'classroom_id': classroom_id}):
            file_path = (msg.get('file') or {}).get('path')
            if file_path:
                abs_path = os.path.join(os.getcwd(), file_path)
                if os.path.exists(abs_path):
                    try:
                        os.remove(abs_path)
                    except OSError:
                        pass
        db.chat_messages.delete_many({'classroom_id': classroom_id})
        db.chat_read_status.delete_many({'classroom_id': classroom_id})

        # Delete other classroom-level data
        db.announcements.delete_many({'classroom_id': classroom_id})
        db.todos.delete_many({'classroom_id': classroom_id})
        db.schedule_requests.delete_many({'classroom_id': classroom_id})

        # Delete semesters then the classroom itself
        db.semesters.delete_many({'classroom_id': classroom_id})
        db.classrooms.delete_one({'_id': ObjectId(classroom_id)})

        return jsonify({'message': 'Classroom deleted'}), 200

    except Exception as e:
        logger.error(f"Delete classroom error: {e}")
        return jsonify({'error': 'Failed to delete classroom'}), 500


