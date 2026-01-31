from flask import Blueprint, request, jsonify
from database import db
from auth_utils import require_auth, require_cr_access
from datetime import datetime
from bson import ObjectId
import logging

logger = logging.getLogger(__name__)

semester_bp = Blueprint('semester', __name__, url_prefix='/api/semester')

@semester_bp.route('/create', methods=['POST'])
@require_auth
def create_semester():
    """Create new semester session (CR only)"""
    try:
        data = request.json
        classroom_id = data.get('classroomId', '')
        name = data.get('name', '').strip()
        
        if not all([classroom_id, name]):
            return jsonify({'error': 'Classroom ID and semester name required'}), 400
        
        user_id = request.current_user['_id']
        database = db.get_db()
        
        # Verify classroom membership
        classroom = database.classrooms.find_one({'_id': ObjectId(classroom_id)})
        
        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404
        
        if user_id not in classroom.get('members', []):
            return jsonify({'error': 'Not a member of this classroom'}), 403
        
        # Check if user is CR in current active semester
        current_semester = database.semester_sessions.find_one({
            'classroomId': classroom_id,
            'isActive': True
        })
        
        if current_semester and user_id not in current_semester.get('crIds', []):
            return jsonify({'error': 'CR privileges required'}), 403
        
        # Archive current active semester
        if current_semester:
            database.semester_sessions.update_one(
                {'_id': current_semester['_id']},
                {
                    '$set': {
                        'isActive': False,
                        'archivedAt': datetime.utcnow()
                    }
                }
            )
        
        # Create new semester session
        # Inherit CR list from previous semester or use creator
        cr_ids = current_semester.get('crIds', [user_id]) if current_semester else [user_id]
        
        semester_doc = {
            'classroomId': classroom_id,
            'name': name,
            'crIds': cr_ids,
            'isActive': True,
            'createdAt': datetime.utcnow(),
            'archivedAt': None
        }
        
        result = database.semester_sessions.insert_one(semester_doc)
        
        return jsonify({
            'message': 'New semester created successfully',
            'semester': {
                '_id': str(result.inserted_id),
                'name': name,
                'isActive': True,
                'crIds': cr_ids
            }
        }), 201
        
    except Exception as e:
        logger.error(f"Create semester error: {e}")
        return jsonify({'error': 'Server error creating semester'}), 500

@semester_bp.route('/classroom/<classroom_id>/list', methods=['GET'])
@require_auth
def list_semesters(classroom_id):
    """List all semesters for a classroom"""
    try:
        user_id = request.current_user['_id']
        database = db.get_db()
        
        # Verify classroom membership
        classroom = database.classrooms.find_one({'_id': ObjectId(classroom_id)})
        
        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404
        
        if user_id not in classroom.get('members', []):
            return jsonify({'error': 'Not a member of this classroom'}), 403
        
        # Get all semesters, sorted by creation date (newest first)
        semesters = list(database.semester_sessions.find(
            {'classroomId': classroom_id}
        ).sort('createdAt', -1))
        
        result = []
        for semester in semesters:
            result.append({
                '_id': str(semester['_id']),
                'name': semester['name'],
                'isActive': semester.get('isActive', False),
                'crIds': semester.get('crIds', []),
                'isCR': user_id in semester.get('crIds', []),
                'createdAt': semester['createdAt'].isoformat(),
                'archivedAt': semester['archivedAt'].isoformat() if semester.get('archivedAt') else None
            })
        
        return jsonify({'semesters': result}), 200
        
    except Exception as e:
        logger.error(f"List semesters error: {e}")
        return jsonify({'error': 'Server error fetching semesters'}), 500

@semester_bp.route('/<semester_id>', methods=['GET'])
@require_auth
def get_semester(semester_id):
    """Get semester details"""
    try:
        user_id = request.current_user['_id']
        database = db.get_db()
        
        semester = database.semester_sessions.find_one({'_id': ObjectId(semester_id)})
        
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404
        
        # Verify classroom membership
        classroom = database.classrooms.find_one({'_id': ObjectId(semester['classroomId'])})
        
        if not classroom or user_id not in classroom.get('members', []):
            return jsonify({'error': 'Access denied'}), 403
        
        return jsonify({
            'semester': {
                '_id': str(semester['_id']),
                'classroomId': semester['classroomId'],
                'name': semester['name'],
                'isActive': semester.get('isActive', False),
                'crIds': semester.get('crIds', []),
                'isCR': user_id in semester.get('crIds', []),
                'createdAt': semester['createdAt'].isoformat(),
                'archivedAt': semester['archivedAt'].isoformat() if semester.get('archivedAt') else None
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Get semester error: {e}")
        return jsonify({'error': 'Server error fetching semester'}), 500

@semester_bp.route('/<semester_id>/add-cr', methods=['POST'])
@require_auth
def add_cr(semester_id):
    """Add a CR to semester (existing CR only)"""
    try:
        data = request.json
        new_cr_id = data.get('userId', '')
        
        if not new_cr_id:
            return jsonify({'error': 'User ID required'}), 400
        
        user_id = request.current_user['_id']
        database = db.get_db()
        
        semester = database.semester_sessions.find_one({'_id': ObjectId(semester_id)})
        
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404
        
        # Check if requester is CR
        if user_id not in semester.get('crIds', []):
            return jsonify({'error': 'CR privileges required'}), 403
        
        # Verify new CR is a classroom member
        classroom = database.classrooms.find_one({'_id': ObjectId(semester['classroomId'])})
        
        if new_cr_id not in classroom.get('members', []):
            return jsonify({'error': 'User is not a classroom member'}), 400
        
        # Add CR
        database.semester_sessions.update_one(
            {'_id': ObjectId(semester_id)},
            {'$addToSet': {'crIds': new_cr_id}}
        )
        
        return jsonify({'message': 'CR added successfully'}), 200
        
    except Exception as e:
        logger.error(f"Add CR error: {e}")
        return jsonify({'error': 'Server error adding CR'}), 500

@semester_bp.route('/<semester_id>/remove-cr', methods=['POST'])
@require_auth
def remove_cr(semester_id):
    """Remove a CR from semester (CR only, must maintain at least 1 CR)"""
    try:
        data = request.json
        cr_to_remove = data.get('userId', '')
        
        if not cr_to_remove:
            return jsonify({'error': 'User ID required'}), 400
        
        user_id = request.current_user['_id']
        database = db.get_db()
        
        semester = database.semester_sessions.find_one({'_id': ObjectId(semester_id)})
        
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404
        
        # Check if requester is CR
        if user_id not in semester.get('crIds', []):
            return jsonify({'error': 'CR privileges required'}), 403
        
        # Ensure at least one CR remains
        if len(semester.get('crIds', [])) <= 1:
            return jsonify({'error': 'Cannot remove last CR. Add another CR first.'}), 400
        
        # Remove CR
        database.semester_sessions.update_one(
            {'_id': ObjectId(semester_id)},
            {'$pull': {'crIds': cr_to_remove}}
        )
        
        return jsonify({'message': 'CR removed successfully'}), 200
        
    except Exception as e:
        logger.error(f"Remove CR error: {e}")
        return jsonify({'error': 'Server error removing CR'}), 500

@semester_bp.route('/<semester_id>/switch-active', methods=['POST'])
@require_auth
def switch_active_semester(semester_id):
    """Switch which semester is active (does not archive, just changes active flag)"""
    try:
        user_id = request.current_user['_id']
        database = db.get_db()
        
        semester = database.semester_sessions.find_one({'_id': ObjectId(semester_id)})
        
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404
        
        # Verify classroom membership
        classroom = database.classrooms.find_one({'_id': ObjectId(semester['classroomId'])})
        
        if not classroom or user_id not in classroom.get('members', []):
            return jsonify({'error': 'Access denied'}), 403
        
        classroom_id = semester['classroomId']
        
        # Deactivate all semesters in this classroom
        database.semester_sessions.update_many(
            {'classroomId': classroom_id},
            {'$set': {'isActive': False}}
        )
        
        # Activate selected semester
        database.semester_sessions.update_one(
            {'_id': ObjectId(semester_id)},
            {'$set': {'isActive': True}}
        )
        
        return jsonify({'message': 'Active semester switched successfully'}), 200
        
    except Exception as e:
        logger.error(f"Switch semester error: {e}")
        return jsonify({'error': 'Server error switching semester'}), 500