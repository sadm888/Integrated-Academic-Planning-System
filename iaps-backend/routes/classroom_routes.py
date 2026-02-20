from flask import Blueprint, request, jsonify
from flask_cors import cross_origin
from datetime import datetime
from bson import ObjectId
import logging
import random
import string

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

        # Auto-create first semester with creator as first CR
        first_semester = {
            'classroom_id': classroom_id,
            'name': 'Semester 1',
            'type': 'odd',
            'year': str(datetime.utcnow().year),
            'session': '',
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
                    'profile_picture': m.get('profile_picture')
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


@classroom_bp.route('/<classroom_id>', methods=['DELETE'])
@cross_origin()
@token_required
def delete_classroom(classroom_id):
    """Delete classroom (only the creator can delete)"""
    from database import get_db

    try:
        user_oid = ObjectId(request.user['user_id'])
        db = get_db()

        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})

        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404

        if classroom['created_by'] != user_oid:
            return jsonify({'error': 'Only the classroom creator can delete it'}), 403

        classroom_id_str = str(classroom['_id'])
        db.semesters.delete_many({'classroom_id': classroom_id_str})
        db.documents.delete_many({'classroom_id': classroom_id_str})
        db.subjects.delete_many({'classroom_id': classroom_id_str})
        db.todos.delete_many({'classroom_id': classroom_id_str})
        db.classrooms.delete_one({'_id': ObjectId(classroom_id)})

        return jsonify({'message': 'Classroom deleted successfully'}), 200

    except Exception as e:
        logger.error(f"Delete classroom error: {e}")
        return jsonify({'error': 'Failed to delete classroom'}), 500


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

        # Cannot remove the classroom creator
        if str(classroom['created_by']) == target_user_id:
            return jsonify({'error': 'Cannot remove the classroom creator'}), 400

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


@classroom_bp.route('/<classroom_id>/invite', methods=['POST'])
@cross_origin()
@token_required
def invite_member(classroom_id):
    """Send an email invite to join a classroom. CR only."""
    from database import get_db
    from middleware import get_active_semester
    from email_service import generate_classroom_invite_token, send_classroom_invite_email
    import re

    try:
        data = request.get_json()
        cr_user_id = request.user['user_id']
        email = data.get('email', '').strip().lower()

        if not email or not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
            return jsonify({'error': 'A valid email address is required'}), 400

        db = get_db()
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})

        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404

        # Only CRs of the active semester can invite
        active_sem = get_active_semester(db, classroom_id)
        if not active_sem or cr_user_id not in [str(c) for c in active_sem.get('cr_ids', [])]:
            return jsonify({'error': 'Only a CR can send invites'}), 403

        # Check if the email is already a member
        existing_user = db.users.find_one({'email': email})
        if existing_user and is_member_of_classroom(classroom, existing_user['_id']):
            return jsonify({'error': 'This user is already a member'}), 400

        # Get CR's username for the invite email
        cr_user = db.users.find_one({'_id': ObjectId(cr_user_id)})
        cr_name = cr_user['username'] if cr_user else 'A Class Representative'

        # Generate token and send email
        token = generate_classroom_invite_token(classroom_id, cr_user_id, email)
        email_sent = send_classroom_invite_email(email, classroom['name'], cr_name, token)

        if not email_sent:
            return jsonify({'error': 'Failed to send invite email. Check mail configuration.'}), 500

        return jsonify({
            'message': f'Invitation sent to {email}',
            'email': email
        }), 200

    except Exception as e:
        logger.error(f"Invite member error: {e}")
        return jsonify({'error': 'Failed to send invite'}), 500


@classroom_bp.route('/accept-invite', methods=['POST'])
@cross_origin()
@token_required
def accept_invite():
    """Accept a classroom invitation using a token."""
    from database import get_db
    from email_service import verify_token

    try:
        data = request.get_json()
        token = data.get('token', '').strip()
        user_id = request.user['user_id']
        user_oid = ObjectId(user_id)

        if not token:
            return jsonify({'error': 'Invite token is required'}), 400

        db = get_db()

        # Verify and consume the token
        token_doc = verify_token(token, 'classroom_invite')
        if not token_doc:
            return jsonify({'error': 'Invalid or expired invite link'}), 400

        classroom_id = token_doc['classroomId']
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})

        if not classroom:
            return jsonify({'error': 'Classroom no longer exists'}), 404

        # Already a member?
        if is_member_of_classroom(classroom, user_oid):
            return jsonify({
                'message': 'You are already a member of this classroom',
                'classroom_id': classroom_id,
                'classroom_name': classroom['name']
            }), 200

        # Add user to members
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {
                '$addToSet': {'members': user_oid},
                '$set': {'updated_at': datetime.utcnow()}
            }
        )

        # Also remove from join_requests if they had a pending request
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {'$pull': {'join_requests': {'user_id': user_oid}}}
        )

        return jsonify({
            'message': f'You have joined {classroom["name"]}!',
            'classroom_id': classroom_id,
            'classroom_name': classroom['name']
        }), 200

    except Exception as e:
        logger.error(f"Accept invite error: {e}")
        return jsonify({'error': 'Failed to accept invite'}), 500
