from flask import Blueprint, request, jsonify
from flask_cors import cross_origin
from datetime import datetime
from bson import ObjectId
import logging

from middleware import token_required, is_member_of_classroom

announcement_bp = Blueprint('announcement', __name__, url_prefix='/api/announcement')
logger = logging.getLogger(__name__)


def _get_semester_and_classroom(db, semester_id, user_id):
    """Return (semester, classroom) or (None, None) if not found / not a member."""
    try:
        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return None, None
        classroom = db.classrooms.find_one({'_id': ObjectId(semester['classroom_id'])})
        if not classroom or not is_member_of_classroom(classroom, user_id):
            return None, None
        return semester, classroom
    except Exception:
        return None, None


def _is_cr(semester, user_id):
    return user_id in [str(c) for c in semester.get('cr_ids', [])]


@announcement_bp.route('/semester/<semester_id>', methods=['GET'])
@cross_origin()
@token_required
def list_announcements(semester_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        semester, classroom = _get_semester_and_classroom(db, semester_id, user_id)
        if not semester:
            return jsonify({'error': 'Access denied'}), 403

        docs = list(db.announcements.find(
            {'semester_id': semester_id}
        ).sort('created_at', -1))

        result = []
        for doc in docs:
            result.append({
                'id': str(doc['_id']),
                'text': doc['text'],
                'created_by': doc.get('created_by'),
                'created_by_name': doc.get('created_by_name', 'CR'),
                'created_at': doc['created_at'].isoformat() + 'Z',
            })

        return jsonify({'announcements': result}), 200
    except Exception as e:
        logger.error(f"list_announcements error: {e}")
        return jsonify({'error': 'Failed to fetch announcements'}), 500


@announcement_bp.route('/semester/<semester_id>', methods=['POST'])
@cross_origin()
@token_required
def create_announcement(semester_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        semester, classroom = _get_semester_and_classroom(db, semester_id, user_id)
        if not semester:
            return jsonify({'error': 'Access denied'}), 403
        if not _is_cr(semester, user_id):
            return jsonify({'error': 'Only the CR can post announcements'}), 403

        data = request.get_json()
        text = (data.get('text') or '').strip()
        if not text:
            return jsonify({'error': 'Announcement text is required'}), 400
        if len(text) > 1000:
            return jsonify({'error': 'Announcement too long (max 1000 characters)'}), 400

        user_doc = db.users.find_one({'_id': ObjectId(user_id)}, {'fullName': 1, 'username': 1})
        creator_name = (user_doc.get('fullName') or user_doc.get('username', 'CR')) if user_doc else 'CR'

        doc = {
            'semester_id': semester_id,
            'text': text,
            'created_by': user_id,
            'created_by_name': creator_name,
            'created_at': datetime.utcnow(),
        }
        result = db.announcements.insert_one(doc)

        return jsonify({
            'announcement': {
                'id': str(result.inserted_id),
                'text': text,
                'created_by': user_id,
                'created_by_name': creator_name,
                'created_at': doc['created_at'].isoformat() + 'Z',
            }
        }), 201
    except Exception as e:
        logger.error(f"create_announcement error: {e}")
        return jsonify({'error': 'Failed to create announcement'}), 500


@announcement_bp.route('/<announcement_id>', methods=['DELETE'])
@cross_origin()
@token_required
def delete_announcement(announcement_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        doc = db.announcements.find_one({'_id': ObjectId(announcement_id)})
        if not doc:
            return jsonify({'error': 'Announcement not found'}), 404

        semester = db.semesters.find_one({'_id': ObjectId(doc['semester_id'])})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        if not _is_cr(semester, user_id):
            return jsonify({'error': 'Only the CR can delete announcements'}), 403

        db.announcements.delete_one({'_id': ObjectId(announcement_id)})
        return jsonify({'message': 'Announcement deleted'}), 200
    except Exception as e:
        logger.error(f"delete_announcement error: {e}")
        return jsonify({'error': 'Failed to delete announcement'}), 500
