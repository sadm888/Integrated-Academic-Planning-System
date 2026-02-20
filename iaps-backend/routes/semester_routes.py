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
