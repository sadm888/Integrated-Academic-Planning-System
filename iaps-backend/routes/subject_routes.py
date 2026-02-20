from flask import Blueprint, request, jsonify
from flask_cors import cross_origin
from datetime import datetime
from bson import ObjectId
import logging

from middleware import token_required, is_member_of_classroom

subject_bp = Blueprint('subject', __name__, url_prefix='/api/subject')
logger = logging.getLogger(__name__)


def is_cr_of(semester, user_id):
    """Check if user_id is in cr_ids of this semester"""
    return str(user_id) in [str(c) for c in semester.get('cr_ids', [])]


@subject_bp.route('/create', methods=['POST'])
@cross_origin()
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

        if not is_cr_of(semester, user_id):
            return jsonify({'error': 'Only a CR can add subjects'}), 403

        # Prevent duplicate name within same semester (case-insensitive)
        import re
        escaped_name = re.escape(name)
        existing = db.subjects.find_one({
            'semester_id': semester_id,
            'name': {'$regex': f'^{escaped_name}$', '$options': 'i'}
        })
        if existing:
            return jsonify({'error': 'A subject with this name already exists in this semester'}), 400

        subject = {
            'classroom_id': classroom_id,
            'semester_id': semester_id,
            'name': name,
            'code': code,
            'created_by': user_id,
            'created_at': datetime.utcnow()
        }

        result = db.subjects.insert_one(subject)

        return jsonify({
            'message': 'Subject added',
            'subject': {
                'id': str(result.inserted_id),
                'name': name,
                'code': code
            }
        }), 201

    except Exception as e:
        logger.error(f"Create subject error: {e}")
        return jsonify({'error': 'Failed to create subject'}), 500


@subject_bp.route('/semester/<semester_id>/list', methods=['GET'])
@cross_origin()
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

        subjects = list(db.subjects.find(
            {'semester_id': semester_id}
        ).sort('created_at', 1))

        result = [{
            'id': str(s['_id']),
            'name': s['name'],
            'code': s.get('code', '')
        } for s in subjects]

        return jsonify({'subjects': result}), 200

    except Exception as e:
        logger.error(f"List subjects error: {e}")
        return jsonify({'error': 'Failed to fetch subjects'}), 500


@subject_bp.route('/<subject_id>', methods=['DELETE'])
@cross_origin()
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
        if not semester or not is_cr_of(semester, user_id):
            return jsonify({'error': 'Only a CR can delete subjects'}), 403

        db.subjects.delete_one({'_id': ObjectId(subject_id)})

        return jsonify({'message': 'Subject deleted'}), 200

    except Exception as e:
        logger.error(f"Delete subject error: {e}")
        return jsonify({'error': 'Failed to delete subject'}), 500
