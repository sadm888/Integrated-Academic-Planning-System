"""marks_routes.py — Per-subject marks tracking and analytics.

REST:
  GET  /api/marks/structure/<subject_id>             — get exam structure (any member)
  POST /api/marks/structure/<subject_id>             — CR creates/replaces exam structure
  GET  /api/marks/my/<subject_id>                    — get my marks for a subject
  POST /api/marks/my/<subject_id>                    — save/update my marks
  GET  /api/marks/analytics/<subject_id>             — list analytics files
  POST /api/marks/analytics/<subject_id>             — upload analytics file (any member)
  DELETE /api/marks/analytics/<subject_id>/<file_id> — delete analytics file
  GET  /api/marks/analytics/file/<file_id>           — serve analytics file (token in query)
"""

import os
import uuid
import logging
from datetime import datetime

from flask import Blueprint, request, jsonify, send_file
from flask_cors import cross_origin
from bson import ObjectId
import jwt
from werkzeug.utils import secure_filename

from middleware import token_required, is_member_of_classroom, SECRET_KEY

marks_bp = Blueprint('marks', __name__, url_prefix='/api/marks')
logger = logging.getLogger(__name__)

ANALYTICS_DIR = os.path.join(os.getcwd(), 'uploads', 'analytics')
os.makedirs(ANALYTICS_DIR, exist_ok=True)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
ALLOWED_EXTENSIONS = {
    'pdf', 'doc', 'docx', 'ppt', 'pptx',
    'png', 'jpg', 'jpeg', 'gif', 'webp',
    'txt', 'xlsx', 'csv',
}


def _allowed(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def _check_subject_access(db, subject_id, user_id):
    """Returns (subject, semester, classroom, is_cr) or raises ValueError."""
    subject = db.subjects.find_one({'_id': ObjectId(subject_id)})
    if not subject:
        raise ValueError('Subject not found')
    semester = db.semesters.find_one({'_id': ObjectId(subject['semester_id'])})
    if not semester:
        raise ValueError('Semester not found')
    classroom = db.classrooms.find_one({'_id': ObjectId(subject['classroom_id'])})
    if not classroom or not is_member_of_classroom(classroom, user_id):
        raise ValueError('Access denied')
    is_cr = user_id in [str(c) for c in semester.get('cr_ids', [])]
    return subject, semester, classroom, is_cr


# ── Exam Structure ────────────────────────────────────────────────────────────

@marks_bp.route('/structure/<subject_id>', methods=['GET'])
@cross_origin()
@token_required
def get_exam_structure(subject_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        _check_subject_access(db, subject_id, user_id)
        struct = db.exam_structures.find_one({'subject_id': subject_id})
        if not struct:
            return jsonify({'structure': None}), 200
        return jsonify({'structure': {
            'id': str(struct['_id']),
            'exams': struct.get('exams', []),
            'updated_at': struct['updated_at'].isoformat() if 'updated_at' in struct else None,
        }}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        logger.error(f"Get exam structure error: {e}")
        return jsonify({'error': 'Failed to fetch exam structure'}), 500


@marks_bp.route('/structure/<subject_id>', methods=['POST'])
@cross_origin()
@token_required
def save_exam_structure(subject_id):
    """CR creates or replaces the exam structure for a subject."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        subject, semester, classroom, is_cr = _check_subject_access(db, subject_id, user_id)
        if not is_cr:
            return jsonify({'error': 'Only a CR can set the exam structure'}), 403

        data = request.get_json()
        exams = data.get('exams', [])

        # Validate: all weightages must sum to ≤ 100
        total_weight = sum(float(e.get('weightage', 0)) for e in exams)
        if total_weight > 100.01:
            return jsonify({'error': f'Total weightage ({total_weight}) exceeds 100'}), 400

        # Validate individual entries
        for e in exams:
            if not e.get('name', '').strip():
                return jsonify({'error': 'Each exam must have a name'}), 400
            if float(e.get('max_marks', 0)) <= 0:
                return jsonify({'error': 'Max marks must be > 0'}), 400
            if float(e.get('weightage', 0)) < 0:
                return jsonify({'error': 'Weightage cannot be negative'}), 400

        db.exam_structures.replace_one(
            {'subject_id': subject_id},
            {
                'subject_id': subject_id,
                'semester_id': subject['semester_id'],
                'exams': [
                    {
                        'name': e['name'].strip(),
                        'max_marks': float(e['max_marks']),
                        'weightage': float(e['weightage']),
                    }
                    for e in exams
                ],
                'updated_by': user_id,
                'updated_at': datetime.utcnow(),
            },
            upsert=True,
        )
        return jsonify({'message': 'Exam structure saved'}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        logger.error(f"Save exam structure error: {e}")
        return jsonify({'error': 'Failed to save exam structure'}), 500


# ── Personal Marks ────────────────────────────────────────────────────────────

@marks_bp.route('/my/<subject_id>', methods=['GET'])
@cross_origin()
@token_required
def get_my_marks(subject_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        _check_subject_access(db, subject_id, user_id)
        marks = db.subject_marks.find_one({'subject_id': subject_id, 'user_id': user_id})
        if not marks:
            return jsonify({'marks': None}), 200
        return jsonify({'marks': {
            'entries': marks.get('entries', []),
            'grade': marks.get('grade', ''),
            'updated_at': marks['updated_at'].isoformat() if 'updated_at' in marks else None,
        }}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        logger.error(f"Get my marks error: {e}")
        return jsonify({'error': 'Failed to fetch marks'}), 500


@marks_bp.route('/my/<subject_id>', methods=['POST'])
@cross_origin()
@token_required
def save_my_marks(subject_id):
    """Save/update personal marks for a subject (any member)."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        _check_subject_access(db, subject_id, user_id)

        data = request.get_json(force=True) or {}
        entries = data.get('entries', [])
        grade = data.get('grade', '').strip()

        # Validate individual entries
        for e in entries:
            if not e.get('name', '').strip():
                return jsonify({'error': 'Each exam must have a name'}), 400
            max_m = float(e.get('max_marks', 0) or 0)
            if max_m <= 0:
                return jsonify({'error': f'Max marks must be greater than 0 (got {max_m})'}), 400
            weight = float(e.get('weightage', 0) or 0)
            if weight < 0:
                return jsonify({'error': 'Weightage cannot be negative'}), 400

        # Validate: total scaled must not exceed 100
        total_scaled = 0
        total_weight = 0
        for e in entries:
            max_m = float(e.get('max_marks', 1))
            obtained = float(e.get('marks_obtained', 0) or 0)
            weight = float(e.get('weightage', 0))
            total_scaled += (obtained / max_m) * weight
            total_weight += weight

        if total_weight > 100.01:
            return jsonify({'error': f'Total weightage ({total_weight:.1f}%) exceeds 100'}), 400
        if total_scaled > 100.01:
            return jsonify({'error': f'Total scaled marks ({total_scaled:.2f}) exceed 100'}), 400

        db.subject_marks.replace_one(
            {'subject_id': subject_id, 'user_id': user_id},
            {
                'subject_id': subject_id,
                'user_id': user_id,
                'entries': [
                    {
                        'name': e['name'].strip(),
                        'max_marks': float(e['max_marks']),
                        'weightage': float(e['weightage']),
                        'marks_obtained': float(e.get('marks_obtained', 0) or 0),
                    }
                    for e in entries
                ],
                'grade': grade,
                'updated_at': datetime.utcnow(),
            },
            upsert=True,
        )
        return jsonify({'message': 'Marks saved'}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        logger.error(f"Save my marks error: {e}")
        return jsonify({'error': 'Failed to save marks'}), 500


# ── Analytics Files ───────────────────────────────────────────────────────────

@marks_bp.route('/analytics/<subject_id>', methods=['GET'])
@cross_origin()
@token_required
def list_analytics(subject_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        subject, semester, classroom, is_cr = _check_subject_access(db, subject_id, user_id)

        # Visibility filter:
        # - CRs see everything (public + cr_only + all personal)
        # - Students see: 'public' + their own 'personal'
        if is_cr:
            query = {'subject_id': subject_id}
        else:
            query = {
                'subject_id': subject_id,
                '$or': [
                    {'visibility': 'public'},
                    {'visibility': {'$exists': False}},
                    {'visibility': 'personal', 'uploaded_by': user_id},
                ]
            }

        files = list(db.subject_analytics.find(query).sort('created_at', -1))

        result = []
        for f in files:
            uploader = db.users.find_one(
                {'_id': ObjectId(f['uploaded_by'])},
                {'fullName': 1, 'username': 1}
            ) if f.get('uploaded_by') else None
            uploader_name = (uploader.get('fullName') or uploader.get('username', '')) if uploader else ''
            result.append({
                'id': str(f['_id']),
                'filename': f['filename'],
                'size': f.get('size', 0),
                'uploaded_by': f.get('uploaded_by', ''),
                'uploaded_by_name': uploader_name,
                'visibility': f.get('visibility', 'public'),
                'created_at': f['created_at'].isoformat(),
                'can_delete': is_cr or f.get('uploaded_by') == user_id,
            })

        return jsonify({'files': result}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        logger.error(f"List analytics error: {e}")
        return jsonify({'error': 'Failed to fetch analytics'}), 500


@marks_bp.route('/analytics/<subject_id>', methods=['POST'])
@cross_origin()
@token_required
def upload_analytics(subject_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        subject, semester, classroom, is_cr = _check_subject_access(db, subject_id, user_id)

        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['file']
        if not file.filename:
            return jsonify({'error': 'Empty filename'}), 400
        if not _allowed(file.filename):
            return jsonify({'error': 'File type not allowed'}), 400

        # Size check
        file.seek(0, 2)
        size = file.tell()
        file.seek(0)
        if size > MAX_FILE_SIZE:
            return jsonify({'error': 'File too large (max 50 MB)'}), 400

        # Visibility: CRs choose public/cr_only; students always personal
        if is_cr:
            visibility = request.form.get('visibility', 'public')
            if visibility not in ('public', 'cr_only'):
                visibility = 'public'
        else:
            visibility = 'personal'

        original_name = secure_filename(file.filename)
        stored_name = f"{uuid.uuid4().hex}_{original_name}"
        file.save(os.path.join(ANALYTICS_DIR, stored_name))

        doc = {
            'subject_id': subject_id,
            'filename': original_name,
            'stored_name': stored_name,
            'size': size,
            'visibility': visibility,
            'uploaded_by': user_id,
            'created_at': datetime.utcnow(),
        }
        result = db.subject_analytics.insert_one(doc)

        return jsonify({
            'message': 'File uploaded',
            'file': {
                'id': str(result.inserted_id),
                'filename': original_name,
                'size': size,
            }
        }), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        logger.error(f"Upload analytics error: {e}")
        return jsonify({'error': 'Failed to upload file'}), 500


@marks_bp.route('/analytics/<subject_id>/<file_id>', methods=['DELETE'])
@cross_origin()
@token_required
def delete_analytics(subject_id, file_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        subject, semester, classroom, is_cr = _check_subject_access(db, subject_id, user_id)

        f = db.subject_analytics.find_one({'_id': ObjectId(file_id), 'subject_id': subject_id})
        if not f:
            return jsonify({'error': 'File not found'}), 404

        if not is_cr and f.get('uploaded_by') != user_id:
            return jsonify({'error': 'Permission denied'}), 403

        # Remove from disk
        try:
            os.remove(os.path.join(ANALYTICS_DIR, f['stored_name']))
        except OSError:
            pass

        db.subject_analytics.delete_one({'_id': ObjectId(file_id)})
        return jsonify({'message': 'File deleted'}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        logger.error(f"Delete analytics error: {e}")
        return jsonify({'error': 'Failed to delete file'}), 500


@marks_bp.route('/analytics/<subject_id>/<file_id>/visibility', methods=['POST'])
@cross_origin()
@token_required
def update_analytics_visibility(subject_id, file_id):
    """Update visibility of an analytics file. CR can set public/cr_only; uploader can toggle their own."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        subject, semester, classroom, is_cr = _check_subject_access(db, subject_id, user_id)

        f = db.subject_analytics.find_one({'_id': ObjectId(file_id), 'subject_id': subject_id})
        if not f:
            return jsonify({'error': 'File not found'}), 404

        if not is_cr and f.get('uploaded_by') != user_id:
            return jsonify({'error': 'Permission denied'}), 403

        data = request.get_json(force=True) or {}
        new_vis = data.get('visibility', '')

        if is_cr:
            if new_vis not in ('public', 'cr_only'):
                return jsonify({'error': 'Invalid visibility'}), 400
        else:
            # Students can only toggle their own personal files — stays personal
            new_vis = 'personal'

        db.subject_analytics.update_one(
            {'_id': ObjectId(file_id)},
            {'$set': {'visibility': new_vis}}
        )
        return jsonify({'message': 'Visibility updated', 'visibility': new_vis}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as e:
        logger.error(f"Update analytics visibility error: {e}")
        return jsonify({'error': 'Failed to update visibility'}), 500


@marks_bp.route('/analytics/file/<file_id>', methods=['GET'])
@cross_origin()
def serve_analytics_file(file_id):
    """Serve analytics file. Auth via ?token= query param."""
    from database import get_db
    try:
        token = request.args.get('token', '')
        if not token:
            return jsonify({'error': 'Token required'}), 401
        try:
            jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401

        db = get_db()
        f = db.subject_analytics.find_one({'_id': ObjectId(file_id)})
        if not f:
            return jsonify({'error': 'File not found'}), 404

        path = os.path.join(ANALYTICS_DIR, f['stored_name'])
        if not os.path.exists(path):
            return jsonify({'error': 'File not found on disk'}), 404

        return send_file(path, as_attachment=False, download_name=f['filename'])
    except Exception as e:
        logger.error(f"Serve analytics error: {e}")
        return jsonify({'error': 'Failed to serve file'}), 500
