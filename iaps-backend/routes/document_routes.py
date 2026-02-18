from flask import Blueprint, request, jsonify
from flask_cors import cross_origin
from datetime import datetime
from bson import ObjectId
from werkzeug.utils import secure_filename
import os
import logging

from middleware import token_required, is_member_of_classroom

logger = logging.getLogger(__name__)

document_bp = Blueprint('document', __name__, url_prefix='/api/document')

UPLOAD_FOLDER = os.path.join(os.getcwd(), 'uploads')
ALLOWED_EXTENSIONS = {'pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'png', 'jpg', 'jpeg'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def is_cr_of(semester, user_id):
    return str(user_id) in [str(c) for c in semester.get('cr_ids', [])]


@document_bp.route('/upload', methods=['POST'])
@cross_origin()
@token_required
def upload_document():
    """Upload document. Any member can upload."""
    from database import get_db

    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['file']

        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        if not allowed_file(file.filename):
            return jsonify({'error': f'File type not allowed. Allowed: {", ".join(ALLOWED_EXTENSIONS)}'}), 400

        classroom_id = request.form.get('classroomId')
        semester_id = request.form.get('semesterId')
        course_id = request.form.get('courseId', None)
        doc_type = request.form.get('type', 'resource')
        use_for_ai = request.form.get('useForAI', 'false').lower() == 'true'

        if not all([classroom_id, semester_id]):
            return jsonify({'error': 'Classroom and semester IDs required'}), 400

        user_id = request.user['user_id']
        db = get_db()

        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        if not classroom or not is_member_of_classroom(classroom, user_id):
            return jsonify({'error': 'Access denied'}), 403

        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        filename = secure_filename(file.filename)
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        unique_filename = f"{timestamp}_{user_id}_{filename}"
        file_path = os.path.join(UPLOAD_FOLDER, unique_filename)

        file.save(file_path)

        doc_metadata = {
            'classroom_id': classroom_id,
            'semester_id': semester_id,
            'course_id': course_id,
            'uploaded_by': user_id,
            'type': doc_type,
            'filename': filename,
            'file_path': file_path,
            'use_for_ai': use_for_ai,
            'file_size': os.path.getsize(file_path),
            'created_at': datetime.utcnow()
        }

        result = db.documents.insert_one(doc_metadata)

        return jsonify({
            'message': 'Document uploaded successfully',
            'document': {
                'id': str(result.inserted_id),
                'filename': filename,
                'type': doc_type,
                'course_id': course_id,
                'use_for_ai': use_for_ai,
                'created_at': doc_metadata['created_at'].isoformat()
            }
        }), 201

    except Exception as e:
        logger.error(f"Document upload error: {e}")
        return jsonify({'error': 'Server error uploading document'}), 500


@document_bp.route('/semester/<semester_id>/list', methods=['GET'])
@cross_origin()
@token_required
def list_documents(semester_id):
    """List all documents for a semester"""
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

        query = {'semester_id': semester_id}
        doc_type = request.args.get('type')
        course_id = request.args.get('courseId')
        if doc_type:
            query['type'] = doc_type
        if course_id:
            query['course_id'] = course_id

        documents = list(db.documents.find(query).sort('created_at', -1))

        result = []
        for doc in documents:
            uploader = db.users.find_one({'_id': ObjectId(doc['uploaded_by'])})
            result.append({
                'id': str(doc['_id']),
                'filename': doc['filename'],
                'type': doc['type'],
                'course_id': doc.get('course_id'),
                'uploaded_by': {
                    'id': doc['uploaded_by'],
                    'username': uploader['username'] if uploader else 'Unknown'
                },
                'use_for_ai': doc.get('use_for_ai', False),
                'file_size': doc.get('file_size', 0),
                'created_at': doc['created_at'].isoformat()
            })

        return jsonify({'documents': result}), 200

    except Exception as e:
        logger.error(f"List documents error: {e}")
        return jsonify({'error': 'Server error fetching documents'}), 500


@document_bp.route('/<document_id>', methods=['DELETE'])
@cross_origin()
@token_required
def delete_document(document_id):
    """Delete document (owner or CR only)"""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        document = db.documents.find_one({'_id': ObjectId(document_id)})
        if not document:
            return jsonify({'error': 'Document not found'}), 404

        is_owner = document['uploaded_by'] == user_id

        # Check if CR of the semester
        semester = db.semesters.find_one({'_id': ObjectId(document['semester_id'])})
        is_cr = semester and is_cr_of(semester, user_id)

        if not (is_owner or is_cr):
            return jsonify({'error': 'Permission denied'}), 403

        if os.path.exists(document.get('file_path', '')):
            os.remove(document['file_path'])

        db.documents.delete_one({'_id': ObjectId(document_id)})

        return jsonify({'message': 'Document deleted successfully'}), 200

    except Exception as e:
        logger.error(f"Delete document error: {e}")
        return jsonify({'error': 'Server error deleting document'}), 500


@document_bp.route('/<document_id>/toggle-ai', methods=['PATCH'])
@cross_origin()
@token_required
def toggle_ai_usage(document_id):
    """Toggle AI usage flag for document (CR only)"""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        document = db.documents.find_one({'_id': ObjectId(document_id)})
        if not document:
            return jsonify({'error': 'Document not found'}), 404

        semester = db.semesters.find_one({'_id': ObjectId(document['semester_id'])})
        if not semester or not is_cr_of(semester, user_id):
            return jsonify({'error': 'CR privileges required'}), 403

        new_value = not document.get('use_for_ai', False)
        db.documents.update_one(
            {'_id': ObjectId(document_id)},
            {'$set': {'use_for_ai': new_value}}
        )

        return jsonify({
            'message': 'AI usage flag updated',
            'use_for_ai': new_value
        }), 200

    except Exception as e:
        logger.error(f"Toggle AI usage error: {e}")
        return jsonify({'error': 'Server error updating document'}), 500
