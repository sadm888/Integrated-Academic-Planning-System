from flask import Blueprint, request, jsonify
from database import db
from auth_utils import require_auth, require_cr_access
from datetime import datetime
from bson import ObjectId
from werkzeug.utils import secure_filename
import os
import logging

logger = logging.getLogger(__name__)

document_bp = Blueprint('document', __name__, url_prefix='/api/document')

# Configuration
UPLOAD_FOLDER = os.path.join(os.getcwd(), 'uploads')
ALLOWED_EXTENSIONS = {'pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'png', 'jpg', 'jpeg'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

# Ensure upload folder exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@document_bp.route('/upload', methods=['POST'])
@require_auth
def upload_document():
    """Upload document (stores metadata, file handling to be implemented)"""
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if not allowed_file(file.filename):
            return jsonify({'error': f'File type not allowed. Allowed: {", ".join(ALLOWED_EXTENSIONS)}'}), 400
        
        # Get metadata from form data
        classroom_id = request.form.get('classroomId')
        semester_id = request.form.get('semesterSessionId')
        course_id = request.form.get('courseId', None)
        doc_type = request.form.get('type', 'resource')  # resource, note, assignment, etc.
        use_for_ai = request.form.get('useForAI', 'false').lower() == 'true'
        
        if not all([classroom_id, semester_id]):
            return jsonify({'error': 'Classroom and semester IDs required'}), 400
        
        user_id = request.current_user['_id']
        database = db.get_db()
        
        # Verify access
        classroom = database.classrooms.find_one({'_id': ObjectId(classroom_id)})
        semester = database.semester_sessions.find_one({'_id': ObjectId(semester_id)})
        
        if not classroom or not semester:
            return jsonify({'error': 'Classroom or semester not found'}), 404
        
        if user_id not in classroom.get('members', []):
            return jsonify({'error': 'Not a member of this classroom'}), 403
        
        # Save file
        filename = secure_filename(file.filename)
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        unique_filename = f"{timestamp}_{user_id}_{filename}"
        file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
        
        file.save(file_path)
        
        # Store document metadata in database
        doc_metadata = {
            'classroomId': classroom_id,
            'semesterSessionId': semester_id,
            'courseId': course_id,
            'uploadedBy': user_id,
            'type': doc_type,
            'filename': filename,
            'fileUrl': file_path,  # In production, this would be S3 URL or similar
            'useForAI': use_for_ai,
            'fileSize': os.path.getsize(file_path),
            'createdAt': datetime.utcnow()
        }
        
        result = database.documents.insert_one(doc_metadata)
        
        return jsonify({
            'message': 'Document uploaded successfully',
            'document': {
                '_id': str(result.inserted_id),
                'filename': filename,
                'type': doc_type,
                'useForAI': use_for_ai,
                'createdAt': doc_metadata['createdAt'].isoformat()
            }
        }), 201
        
    except Exception as e:
        logger.error(f"Document upload error: {e}")
        return jsonify({'error': 'Server error uploading document'}), 500

@document_bp.route('/semester/<semester_id>/list', methods=['GET'])
@require_auth
def list_documents(semester_id):
    """List all documents for a semester"""
    try:
        user_id = request.current_user['_id']
        database = db.get_db()
        
        # Verify access
        semester = database.semester_sessions.find_one({'_id': ObjectId(semester_id)})
        
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404
        
        classroom = database.classrooms.find_one({'_id': ObjectId(semester['classroomId'])})
        
        if not classroom or user_id not in classroom.get('members', []):
            return jsonify({'error': 'Access denied'}), 403
        
        # Get documents
        course_id = request.args.get('courseId', None)
        doc_type = request.args.get('type', None)
        
        query = {'semesterSessionId': semester_id}
        if course_id:
            query['courseId'] = course_id
        if doc_type:
            query['type'] = doc_type
        
        documents = list(database.documents.find(query).sort('createdAt', -1))
        
        result = []
        for doc in documents:
            # Get uploader info
            uploader = database.users.find_one({'_id': ObjectId(doc['uploadedBy'])})
            
            result.append({
                '_id': str(doc['_id']),
                'filename': doc['filename'],
                'type': doc['type'],
                'courseId': doc.get('courseId'),
                'uploadedBy': {
                    'userId': doc['uploadedBy'],
                    'username': uploader['username'] if uploader else 'Unknown'
                },
                'useForAI': doc.get('useForAI', False),
                'fileSize': doc.get('fileSize', 0),
                'createdAt': doc['createdAt'].isoformat()
            })
        
        return jsonify({'documents': result}), 200
        
    except Exception as e:
        logger.error(f"List documents error: {e}")
        return jsonify({'error': 'Server error fetching documents'}), 500

@document_bp.route('/<document_id>', methods=['DELETE'])
@require_auth
def delete_document(document_id):
    """Delete document (owner or CR only)"""
    try:
        user_id = request.current_user['_id']
        database = db.get_db()
        
        document = database.documents.find_one({'_id': ObjectId(document_id)})
        
        if not document:
            return jsonify({'error': 'Document not found'}), 404
        
        # Check if user is owner or CR
        semester = database.semester_sessions.find_one({'_id': ObjectId(document['semesterSessionId'])})
        
        is_owner = document['uploadedBy'] == user_id
        is_cr = user_id in semester.get('crIds', [])
        
        if not (is_owner or is_cr):
            return jsonify({'error': 'Permission denied'}), 403
        
        # Delete file from filesystem
        if os.path.exists(document['fileUrl']):
            os.remove(document['fileUrl'])
        
        # Delete metadata
        database.documents.delete_one({'_id': ObjectId(document_id)})
        
        return jsonify({'message': 'Document deleted successfully'}), 200
        
    except Exception as e:
        logger.error(f"Delete document error: {e}")
        return jsonify({'error': 'Server error deleting document'}), 500

@document_bp.route('/<document_id>/toggle-ai', methods=['PATCH'])
@require_auth
def toggle_ai_usage(document_id):
    """Toggle AI usage flag for document (CR only)"""
    try:
        user_id = request.current_user['_id']
        database = db.get_db()
        
        document = database.documents.find_one({'_id': ObjectId(document_id)})
        
        if not document:
            return jsonify({'error': 'Document not found'}), 404
        
        # Check CR status
        semester = database.semester_sessions.find_one({'_id': ObjectId(document['semesterSessionId'])})
        
        if user_id not in semester.get('crIds', []):
            return jsonify({'error': 'CR privileges required'}), 403
        
        # Toggle flag
        new_value = not document.get('useForAI', False)
        
        database.documents.update_one(
            {'_id': ObjectId(document_id)},
            {'$set': {'useForAI': new_value}}
        )
        
        return jsonify({
            'message': 'AI usage flag updated',
            'useForAI': new_value
        }), 200
        
    except Exception as e:
        logger.error(f"Toggle AI usage error: {e}")
        return jsonify({'error': 'Server error updating document'}), 500