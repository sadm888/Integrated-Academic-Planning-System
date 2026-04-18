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
from uuid import uuid4
import logging
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify, send_file
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
                'updated_at': datetime.now(timezone.utc),
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
                'updated_at': datetime.now(timezone.utc),
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
        stored_name = f"{uuid4().hex}_{original_name}"
        file.save(os.path.join(ANALYTICS_DIR, stored_name))

        doc = {
            'subject_id': subject_id,
            'filename': original_name,
            'stored_name': stored_name,
            'size': size,
            'visibility': visibility,
            'uploaded_by': user_id,
            'created_at': datetime.now(timezone.utc),
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


# ── Shared score helper ───────────────────────────────────────────────────────

def _compute_weighted_score(entries):
    """
    Given a list of exam entry dicts, return the weighted percentage score
    (0–100) or None if there are no entries or zero total weightage.
    """
    if not entries:
        return None
    total_weight = sum(float(e.get('weightage', 0)) for e in entries)
    if total_weight == 0:
        return None
    weighted_sum = sum(
        (float(e.get('marks_obtained', 0)) / float(e.get('max_marks', 1)))
        * float(e.get('weightage', 0))
        for e in entries
        if float(e.get('max_marks', 0)) > 0  # guard against zero/missing max_marks
    )
    return round(weighted_sum, 2)


def _semester_label(sem):
    """Human-readable label for a semester document."""
    label = sem.get('name') or f"{sem.get('type', '').capitalize()} {sem.get('year', '')}".strip()
    if sem.get('session'):
        label += f" · {sem['session']}"
    return label


# ── Cross-semester Trend ──────────────────────────────────────────────────────

@marks_bp.route('/trend/<classroom_id>', methods=['GET'])
@token_required
def get_marks_trend(classroom_id):
    """
    Per-semester overall performance for the calling user across all semesters
    in a classroom. Subjects are unique per semester so we compute an overall
    average score per semester rather than tracking subject names across them.

    Response shape:
      {
        "semesters": [
          {
            "semester_id": "...",
            "semester_name": "Sem 4 (Even) 2024-28",
            "overall_score": 78.5,          // avg of subjects with scores, or null
            "subjects": [
              {"name": "IT250", "score": 82.5, "grade": "A"},
              {"name": "IT251", "score": null, "grade": ""}
            ]
          }
        ]
      }
    """
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()

        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        if not classroom or not is_member_of_classroom(classroom, user_id):
            return jsonify({'error': 'Access denied'}), 403

        # Sort by ObjectId — always present, naturally time-ordered
        semesters = list(db.semesters.find(
            {'classroom_id': classroom_id},
            {'_id': 1, 'name': 1, 'type': 1, 'year': 1, 'session': 1}
        ).sort('_id', 1))

        result = []
        for sem in semesters:
            sem_id = str(sem['_id'])
            subjects = list(db.subjects.find(
                {'semester_id': sem_id, 'classroom_id': classroom_id},
                {'_id': 1, 'name': 1}
            ))

            sem_subjects = []
            scored = []
            for sub in subjects:
                marks_doc = db.subject_marks.find_one(
                    {'subject_id': str(sub['_id']), 'user_id': user_id}
                )
                entries = marks_doc.get('entries', []) if marks_doc else []
                score = _compute_weighted_score(entries)
                grade = marks_doc.get('grade', '') if marks_doc else ''

                sem_subjects.append({'name': sub['name'], 'score': score, 'grade': grade})
                if score is not None:
                    scored.append(score)

            overall = round(sum(scored) / len(scored), 2) if scored else None
            result.append({
                'semester_id': sem_id,
                'semester_name': _semester_label(sem),
                'overall_score': overall,
                'subjects': sem_subjects,
            })

        return jsonify({'semesters': result}), 200
    except Exception as e:
        logger.error(f"Marks trend error: {e}")
        return jsonify({'error': 'Failed to fetch marks trend'}), 500


@marks_bp.route('/semester-analytics/<semester_id>', methods=['GET'])
@token_required
def get_semester_analytics(semester_id):
    """
    Per-subject breakdown for one semester (bar chart + radar chart data).

    Response shape:
      {
        "semester_name": "...",
        "is_cr": false,
        "subjects": [
          {
            "subject_id": "...",
            "name": "IT250",
            "score": 82.5,
            "grade": "A",
            "entries": [{"name": "Mid 1", "max_marks": 50, "marks_obtained": 42, "weightage": 40}]
          }
        ]
      }
    """
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

        is_cr = user_id in [str(c) for c in semester.get('cr_ids', [])]

        # semester['classroom_id'] is stored as string; subjects also store it as string
        subjects = list(db.subjects.find(
            {'semester_id': semester_id, 'classroom_id': semester['classroom_id']},
            {'_id': 1, 'name': 1}
        ))

        result_subjects = []
        for sub in subjects:
            sub_id = str(sub['_id'])
            marks_doc = db.subject_marks.find_one({'subject_id': sub_id, 'user_id': user_id})
            entries = marks_doc.get('entries', []) if marks_doc else []
            result_subjects.append({
                'subject_id': sub_id,
                'name': sub['name'],
                'score': _compute_weighted_score(entries),
                'grade': marks_doc.get('grade', '') if marks_doc else '',
                'entries': entries,
            })

        return jsonify({
            'semester_name': _semester_label(semester),
            'is_cr': is_cr,
            'subjects': result_subjects,
        }), 200
    except Exception as e:
        logger.error(f"Semester analytics error: {e}")
        return jsonify({'error': 'Failed to fetch semester analytics'}), 500


@marks_bp.route('/analytics/file/<file_id>', methods=['GET'])
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
