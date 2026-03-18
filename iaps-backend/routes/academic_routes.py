"""academic_routes.py — Per-subject academic resource management.

REST:
  GET  /all-resources                                                  — all resources (cross-semester)
  GET  /my-semesters                                                   — semesters user can access
  GET  /<semester_id>/resources                                        — resources for semester (optional ?subject_id=)
  GET  /<semester_id>/subjects/<subject_id>/sections                  — sections for subject
  POST /<semester_id>/subjects/<subject_id>/sections                  — create custom section
  DELETE /<semester_id>/subjects/<subject_id>/sections/<section_id>   — delete/hide section
  POST /<semester_id>/upload                                           — upload file
  POST /<semester_id>/link-chat-file                                   — link chat file
  PATCH /<semester_id>/resources/<resource_id>                        — move resource
  DELETE /<semester_id>/resources/<resource_id>                       — delete resource
  GET  /<semester_id>/chat-files                                       — chat files for semester
  GET  /file/<resource_id>                                             — serve resource file
"""

import os
import logging
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify, send_file, redirect
from bson import ObjectId
import jwt
from werkzeug.utils import secure_filename

from middleware import token_required, SECRET_KEY
from utils.mime_check import is_dangerous

academic_bp = Blueprint('academic', __name__, url_prefix='/api/academics')
logger = logging.getLogger(__name__)

UPLOAD_DIR = os.path.join(os.getcwd(), 'uploads', 'academics')
os.makedirs(UPLOAD_DIR, exist_ok=True)

NON_DELETABLE_DEFAULTS = {'schedule', 'course_plan'}
DELETABLE_DEFAULTS = {'pyq', 'books'}
DEFAULT_CATEGORIES = ['schedule', 'course_plan', 'pyq', 'books']
CATEGORIES = set(DEFAULT_CATEGORIES)
CR_ONLY_CATEGORIES = {'schedule', 'course_plan'}
CATEGORY_LABELS = {
    'schedule': 'Schedule',
    'course_plan': 'Course Plan',
    'pyq': 'PYQ',
    'books': 'Books',
}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _is_member(db, semester_id, user_id):
    try:
        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return False
        classroom = db.classrooms.find_one({'_id': ObjectId(semester['classroom_id'])})
        if not classroom:
            return False
        return user_id in [str(m) for m in classroom.get('members', [])]
    except Exception:
        return False


def _is_cr(db, semester_id, user_id):
    try:
        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return False
        return user_id in [str(c) for c in semester.get('cr_ids', [])]
    except Exception:
        return False


def _serialize(r):
    return {
        'id': str(r['_id']),
        'subject_id': r.get('subject_id'),
        'category': r.get('category'),
        'folder_id': r.get('folder_id'),
        'name': r.get('name', ''),
        'mime_type': r.get('mime_type', 'application/octet-stream'),
        'size': r.get('size', 0),
        'uploaded_by': r.get('uploaded_by'),
        'uploaded_by_name': r.get('uploaded_by_name', ''),
        'source': r.get('source', 'upload'),
        'chat_message_id': r.get('chat_message_id'),
        'created_at': r['created_at'].isoformat(),
        'is_public': r.get('is_public', True),  # PYQ/Books visibility flag
    }


def _get_hidden_sections(db, semester_id, subject_id):
    """Return set of category names hidden for this subject."""
    return {
        h['category']
        for h in db.hidden_default_sections.find({
            'semester_id': semester_id,
            'subject_id': subject_id,
        })
    }


def _validate_category(db, semester_id, subject_id, category):
    """Return True if category is valid for this semester+subject."""
    if category in CATEGORIES:
        return True
    try:
        return bool(db.custom_sections.find_one({
            '_id': ObjectId(category),
            'semester_id': semester_id,
            'subject_id': subject_id,
        }))
    except Exception:
        return False


def _delete_resources_for_section(db, semester_id, subject_id, section_id):
    """Delete all resources in a section for a subject, including disk files."""
    resources = list(db.academic_resources.find({
        'semester_id': semester_id,
        'subject_id': subject_id,
        'category': section_id,
    }))
    for resource in resources:
        if resource.get('stored_name'):
            try:
                os.remove(os.path.join(UPLOAD_DIR, resource['stored_name']))
            except OSError:
                pass
    db.academic_resources.delete_many({
        'semester_id': semester_id,
        'subject_id': subject_id,
        'category': section_id,
    })


# ─── All resources (cross-semester) ───────────────────────────────────────────

@academic_bp.route('/all-resources', methods=['GET'])
@token_required
def all_resources():
    """Return all academic resources across every semester the user can access."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()

        classrooms = list(db.classrooms.find({'members': ObjectId(user_id)}, {'_id': 1, 'name': 1}))
        classroom_map = {str(c['_id']): c['name'] for c in classrooms}
        classroom_ids = list(classroom_map.keys())

        semesters = list(db.semesters.find(
            {'classroom_id': {'$in': classroom_ids}},
            {'_id': 1, 'name': 1, 'classroom_id': 1},
        ))
        semester_map = {
            str(s['_id']): {'name': s['name'], 'classroom_id': s.get('classroom_id', '')}
            for s in semesters
        }
        semester_ids = list(semester_map.keys())

        if not semester_ids:
            return jsonify({'resources': []}), 200

        # Subject names
        subjects = list(db.subjects.find(
            {'semester_id': {'$in': semester_ids}},
            {'_id': 1, 'name': 1, 'semester_id': 1},
        ))
        subject_map = {str(s['_id']): s.get('name', '') for s in subjects}

        resources = list(db.academic_resources.find(
            {'semester_id': {'$in': semester_ids}},
            sort=[('created_at', -1)],
        ))

        # Collect chat_message_ids already linked to academic resources (to avoid duplicates)
        linked_chat_ids = {
            str(r['chat_message_id'])
            for r in resources
            if r.get('source') == 'chat' and r.get('chat_message_id')
        }

        result = []
        for r in resources:
            sem = semester_map.get(r['semester_id'], {})
            result.append({
                **_serialize(r),
                'classroom_name': classroom_map.get(sem.get('classroom_id', ''), ''),
                'semester_name': sem.get('name', ''),
                'subject_name': subject_map.get(r.get('subject_id', ''), ''),
                'section_name': CATEGORY_LABELS.get(r.get('category', ''), r.get('category', '')),
                'classroom_id': sem.get('classroom_id', ''),
                'semester_id': r['semester_id'],
            })

        # Add semester documents (old upload system via SemesterDetail)
        docs = list(db.documents.find(
            {'semester_id': {'$in': semester_ids}},
            sort=[('created_at', -1)],
        ))
        for doc in docs:
            sem_id = doc.get('semester_id', '')
            sem = semester_map.get(sem_id, {})
            uploader = db.users.find_one({'_id': ObjectId(doc['uploaded_by'])}, {'fullName': 1, 'username': 1}) if doc.get('uploaded_by') else None
            uploader_name = (uploader.get('fullName') or uploader.get('username') or '') if uploader else ''
            result.append({
                'id': str(doc['_id']),
                'name': doc.get('filename') or 'Document',
                'mime_type': doc.get('mime_type', ''),
                'size': doc.get('file_size', 0),
                'created_at': doc['created_at'].isoformat() if 'created_at' in doc else '',
                'uploaded_by': str(doc.get('uploaded_by', '')),
                'uploaded_by_name': uploader_name,
                'source': 'document',
                'subject_name': '—',
                'section_name': 'Documents',
                'classroom_name': classroom_map.get(sem.get('classroom_id', ''), ''),
                'semester_name': sem.get('name', ''),
                'classroom_id': sem.get('classroom_id', ''),
                'semester_id': sem_id,
                'document_id': str(doc['_id']),
            })

        # Add unlinked chat files — chat messages store file info under msg['file'] subdoc
        linked_msg_oids = [ObjectId(cid) for cid in linked_chat_ids if cid]
        chat_msgs = list(db.chat_messages.find(
            {
                'semester_id': {'$in': semester_ids},
                'file': {'$exists': True, '$ne': None},
                '_id': {'$nin': linked_msg_oids},
            },
            sort=[('created_at', -1)],
        ))
        for msg in chat_msgs:
            sem_id = msg.get('semester_id', '')
            sem = semester_map.get(sem_id, {})
            file_sub = msg.get('file') or {}
            result.append({
                'id': str(msg['_id']),
                'name': file_sub.get('name') or 'Chat File',
                'mime_type': file_sub.get('mime_type', ''),
                'size': file_sub.get('size', 0),
                'created_at': msg['created_at'].isoformat() if 'created_at' in msg else '',
                'uploaded_by': str(msg.get('user_id', '')),
                'uploaded_by_name': msg.get('full_name') or msg.get('username') or '',
                'source': 'chat_unlinked',
                'subject_name': '—',
                'section_name': 'Chat Files',
                'classroom_name': classroom_map.get(sem.get('classroom_id', ''), ''),
                'semester_name': sem.get('name', ''),
                'classroom_id': sem.get('classroom_id', ''),
                'semester_id': sem_id,
                'chat_message_id': str(msg['_id']),
            })

        return jsonify({'resources': result}), 200
    except Exception as e:
        logger.error(f"all_resources error: {e}")
        return jsonify({'error': 'Failed to fetch resources'}), 500


# ─── My semesters ─────────────────────────────────────────────────────────────

@academic_bp.route('/my-semesters', methods=['GET'])
@token_required
def my_semesters():
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        classrooms = list(db.classrooms.find({'members': ObjectId(user_id)}))
        result = []
        for c in classrooms:
            cid = str(c['_id'])
            sems = list(db.semesters.find({'classroom_id': cid}).sort('created_at', -1))
            for s in sems:
                sid = str(s['_id'])
                cr_ids = [str(x) for x in s.get('cr_ids', [])]
                mod_ids = [str(x) for x in s.get('moderator_ids', [])]
                result.append({
                    'semester_id': sid,
                    'semester_name': s['name'],
                    'classroom_id': cid,
                    'classroom_name': c['name'],
                    'is_active': s.get('is_active', False),
                    'is_user_cr': user_id in cr_ids,
                    'is_user_mod': user_id in mod_ids,
                })
        return jsonify({'semesters': result}), 200
    except Exception as e:
        logger.error(f"my_semesters error: {e}")
        return jsonify({'error': 'Failed to fetch semesters'}), 500


# ─── Resources list ───────────────────────────────────────────────────────────

@academic_bp.route('/<semester_id>/resources', methods=['GET'])
@token_required
def list_resources(semester_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        query = {'semester_id': semester_id}
        subject_id = request.args.get('subject_id')
        if subject_id:
            query['subject_id'] = subject_id
        resources = list(db.academic_resources.find(query, sort=[('created_at', 1)]))

        # For PYQ/Books: non-CR members only see public files OR their own private files
        is_cr = _is_cr(db, semester_id, user_id)
        if not is_cr:
            resources = [
                r for r in resources
                if r.get('category') not in ('pyq', 'books')
                or r.get('is_public', True)
                or r.get('uploaded_by') == user_id
            ]

        # Filter out resources the user has personally hidden
        resources = [r for r in resources if user_id not in r.get('hidden_by', [])]

        return jsonify({'resources': [_serialize(r) for r in resources]}), 200
    except Exception as e:
        logger.error(f"list_resources error: {e}")
        return jsonify({'error': 'Failed to fetch resources'}), 500


# ─── Per-subject sections ─────────────────────────────────────────────────────

@academic_bp.route('/<semester_id>/subjects/<subject_id>/sections', methods=['GET'])
@token_required
def list_subject_sections(semester_id, subject_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403

        is_cr = _is_cr(db, semester_id, user_id)
        hidden = _get_hidden_sections(db, semester_id, subject_id)  # global CR hide

        # Per-user hidden pyq/books sections (personal, non-destructive)
        user_hidden = {
            h['category']
            for h in db.user_hidden_sections.find({
                'user_id': user_id,
                'semester_id': semester_id,
                'subject_id': subject_id,
            })
        }

        defaults = []
        for cat in DEFAULT_CATEGORIES:
            if cat in hidden:
                continue  # globally hidden by CR — skip for everyone
            defaults.append({
                'id': cat,
                'name': CATEGORY_LABELS[cat],
                'is_default': True,
                'cr_only': cat in CR_ONLY_CATEGORIES,
                'non_deletable': cat in NON_DELETABLE_DEFAULTS,
                'hidden': False,
                'user_hidden': cat in user_hidden,
            })

        custom = []
        for s in db.custom_sections.find(
            {'semester_id': semester_id, 'subject_id': subject_id},
            sort=[('created_at', 1)],
        ):
            created_by = s.get('created_by', '')
            is_private = s.get('is_private', False)
            # Private sections only visible to their creator and CRs
            if is_private and created_by != user_id and not is_cr:
                continue
            custom.append({
                'id': str(s['_id']),
                'name': s['name'],
                'is_default': False,
                'cr_only': False,
                'non_deletable': False,
                'hidden': False,
                'user_hidden': False,
                'created_by': created_by,
                'is_private': is_private,
            })

        subject_doc = db.subjects.find_one({'_id': ObjectId(subject_id), 'semester_id': semester_id}) if subject_id else None
        is_subject_owner = bool(subject_doc and subject_doc.get('personal') and str(subject_doc.get('created_by')) == user_id)

        if is_cr or is_subject_owner:
            # Add back globally-hidden defaults so CR/owner can re-enable them
            for cat in DELETABLE_DEFAULTS:
                if cat in hidden:
                    defaults.append({
                        'id': cat,
                        'name': CATEGORY_LABELS[cat],
                        'is_default': True,
                        'cr_only': cat in CR_ONLY_CATEGORIES,
                        'non_deletable': False,
                        'hidden': True,
                        'user_hidden': False,
                    })
        return jsonify({'sections': defaults + custom}), 200
    except Exception as e:
        logger.error(f"list_subject_sections error: {e}")
        return jsonify({'error': 'Failed to fetch sections'}), 500


@academic_bp.route('/<semester_id>/subjects/<subject_id>/sections', methods=['POST'])
@token_required
def create_subject_section(semester_id, subject_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403

        data = request.get_json()
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'error': 'Section name is required'}), 400
        if len(name) > 60:
            return jsonify({'error': 'Section name too long (max 60 characters)'}), 400
        if name.lower() in {v.lower() for v in CATEGORY_LABELS.values()}:
            return jsonify({'error': 'A default section with that name already exists'}), 400

        doc = {
            'semester_id': semester_id,
            'subject_id': subject_id,
            'name': name,
            'created_by': user_id,
            'created_at': datetime.now(timezone.utc),
        }
        result = db.custom_sections.insert_one(doc)
        return jsonify({
            'section': {
                'id': str(result.inserted_id),
                'name': name,
                'is_default': False,
                'cr_only': False,
                'non_deletable': False,
            }
        }), 201
    except Exception as e:
        logger.error(f"create_subject_section error: {e}")
        return jsonify({'error': 'Failed to create section'}), 500


@academic_bp.route('/<semester_id>/subjects/<subject_id>/sections/<section_id>', methods=['DELETE'])
@token_required
def delete_subject_section(semester_id, subject_id, section_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403

        if section_id in NON_DELETABLE_DEFAULTS:
            return jsonify({'error': 'This section cannot be deleted'}), 403

        if section_id in DELETABLE_DEFAULTS:
            # Personal subject owners can also remove default sections from their own subject
            subject_doc = db.subjects.find_one({'_id': ObjectId(subject_id), 'semester_id': semester_id})
            is_subject_owner = bool(
                subject_doc and subject_doc.get('personal') and subject_doc.get('created_by') == user_id
            )
            if not _is_cr(db, semester_id, user_id) and not is_subject_owner:
                return jsonify({'error': 'Only a CR or the subject owner can remove default sections'}), 403
            # Mark as hidden for this subject
            db.hidden_default_sections.update_one(
                {'semester_id': semester_id, 'subject_id': subject_id, 'category': section_id},
                {'$set': {'semester_id': semester_id, 'subject_id': subject_id, 'category': section_id}},
                upsert=True,
            )
            _delete_resources_for_section(db, semester_id, subject_id, section_id)
            return jsonify({'message': 'Section removed'}), 200

        # Custom section
        try:
            section = db.custom_sections.find_one({
                '_id': ObjectId(section_id),
                'semester_id': semester_id,
                'subject_id': subject_id,
            })
        except Exception:
            return jsonify({'error': 'Invalid section ID'}), 400

        if not section:
            return jsonify({'error': 'Section not found'}), 404
        if section['created_by'] != user_id and not _is_cr(db, semester_id, user_id):
            return jsonify({'error': 'Not authorized'}), 403

        _delete_resources_for_section(db, semester_id, subject_id, section_id)
        db.custom_sections.delete_one({'_id': ObjectId(section_id)})
        return jsonify({'message': 'Section deleted'}), 200
    except Exception as e:
        logger.error(f"delete_subject_section error: {e}")
        return jsonify({'error': 'Failed to delete section'}), 500


@academic_bp.route('/<semester_id>/subjects/<subject_id>/sections/<section_id>/toggle', methods=['POST'])
@token_required
def toggle_section_visibility(semester_id, subject_id, section_id):
    """Toggle visibility of a deletable default section (pyq/books). CR or personal subject owner."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        if section_id not in DELETABLE_DEFAULTS:
            return jsonify({'error': 'Only PYQ and Books sections can be toggled'}), 400
        subject_doc = db.subjects.find_one({'_id': ObjectId(subject_id), 'semester_id': semester_id})
        is_subject_owner = bool(subject_doc and subject_doc.get('personal') and str(subject_doc.get('created_by')) == user_id)
        if not _is_cr(db, semester_id, user_id) and not is_subject_owner:
            return jsonify({'error': 'Only a CR or subject owner can toggle sections'}), 403
        existing = db.hidden_default_sections.find_one({'semester_id': semester_id, 'subject_id': subject_id, 'category': section_id})
        if existing:
            # Currently hidden → show it (remove from hidden)
            db.hidden_default_sections.delete_one({'_id': existing['_id']})
            return jsonify({'message': 'Section restored', 'hidden': False}), 200
        else:
            # Currently visible → hide it
            db.hidden_default_sections.insert_one({'semester_id': semester_id, 'subject_id': subject_id, 'category': section_id})
            _delete_resources_for_section(db, semester_id, subject_id, section_id)
            return jsonify({'message': 'Section hidden', 'hidden': True}), 200
    except Exception as e:
        logger.error(f"toggle_section_visibility error: {e}")
        return jsonify({'error': 'Failed to toggle section'}), 500


@academic_bp.route('/<semester_id>/subjects/<subject_id>/sections/<section_id>/user-hide', methods=['POST'])
@token_required
def user_hide_section(semester_id, subject_id, section_id):
    """Per-user non-destructive hide/show of PYQ/Books sections (doesn't delete files)."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        if section_id not in DELETABLE_DEFAULTS:
            return jsonify({'error': 'Only PYQ and Books sections can be locked'}), 400
        existing = db.user_hidden_sections.find_one({
            'user_id': user_id, 'semester_id': semester_id,
            'subject_id': subject_id, 'category': section_id,
        })
        if existing:
            db.user_hidden_sections.delete_one({'_id': existing['_id']})
            return jsonify({'user_hidden': False}), 200
        else:
            db.user_hidden_sections.insert_one({
                'user_id': user_id, 'semester_id': semester_id,
                'subject_id': subject_id, 'category': section_id,
            })
            return jsonify({'user_hidden': True}), 200
    except Exception as e:
        logger.error(f"user_hide_section error: {e}")
        return jsonify({'error': 'Failed to toggle section visibility'}), 500


@academic_bp.route('/<semester_id>/subjects/<subject_id>/sections/<section_id>/lock', methods=['POST'])
@token_required
def lock_custom_section(semester_id, subject_id, section_id):
    """Toggle is_private on a custom section. Only the creator or a CR can lock/unlock."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        try:
            section = db.custom_sections.find_one({
                '_id': ObjectId(section_id),
                'semester_id': semester_id,
                'subject_id': subject_id,
            })
        except Exception:
            return jsonify({'error': 'Invalid section ID'}), 400
        if not section:
            return jsonify({'error': 'Section not found'}), 404
        if section.get('created_by') != user_id and not _is_cr(db, semester_id, user_id):
            return jsonify({'error': 'Not authorized'}), 403
        new_is_private = not section.get('is_private', False)
        db.custom_sections.update_one(
            {'_id': ObjectId(section_id)},
            {'$set': {'is_private': new_is_private}},
        )
        return jsonify({'is_private': new_is_private}), 200
    except Exception as e:
        logger.error(f"lock_custom_section error: {e}")
        return jsonify({'error': 'Failed to toggle section lock'}), 500


# ─── Section Folders (sub-folders inside a section) ───────────────────────────

@academic_bp.route('/<semester_id>/subjects/<subject_id>/sections/<section_id>/folders', methods=['GET'])
@token_required
def list_section_folders(semester_id, subject_id, section_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        folders = list(db.section_folders.find(
            {'semester_id': semester_id, 'subject_id': subject_id, 'section_id': section_id},
            sort=[('created_at', 1)],
        ))
        return jsonify({'folders': [{'id': str(f['_id']), 'name': f['name']} for f in folders]}), 200
    except Exception as e:
        logger.error(f"list_section_folders error: {e}")
        return jsonify({'error': 'Failed to list folders'}), 500


@academic_bp.route('/<semester_id>/subjects/<subject_id>/sections/<section_id>/folders', methods=['POST'])
@token_required
def create_section_folder(semester_id, subject_id, section_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        data = request.get_json()
        name = (data.get('name') or '').strip()
        if not name or len(name) > 60:
            return jsonify({'error': 'Folder name required (max 60 chars)'}), 400
        result = db.section_folders.insert_one({
            'semester_id': semester_id,
            'subject_id': subject_id,
            'section_id': section_id,
            'name': name,
            'created_by': user_id,
            'created_at': datetime.now(timezone.utc),
        })
        return jsonify({'folder': {'id': str(result.inserted_id), 'name': name}}), 201
    except Exception as e:
        logger.error(f"create_section_folder error: {e}")
        return jsonify({'error': 'Failed to create folder'}), 500


@academic_bp.route('/<semester_id>/subjects/<subject_id>/sections/<section_id>/folders/<folder_id>', methods=['DELETE'])
@token_required
def delete_section_folder(semester_id, subject_id, section_id, folder_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        db.section_folders.delete_one({'_id': ObjectId(folder_id)})
        # Move files in this folder back to "uncategorized" (remove folder_id)
        db.academic_resources.update_many(
            {'semester_id': semester_id, 'subject_id': subject_id, 'category': section_id, 'folder_id': folder_id},
            {'$unset': {'folder_id': ''}}
        )
        return jsonify({'message': 'Folder deleted'}), 200
    except Exception as e:
        logger.error(f"delete_section_folder error: {e}")
        return jsonify({'error': 'Failed to delete folder'}), 500


# ─── Upload ───────────────────────────────────────────────────────────────────

@academic_bp.route('/<semester_id>/upload', methods=['POST'])
@token_required
def upload_resource(semester_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403

        subject_id = request.form.get('subject_id', '').strip() or None
        category = request.form.get('category', '').strip()

        if not subject_id:
            return jsonify({'error': 'subject_id is required'}), 400
        if not category:
            return jsonify({'error': 'category is required'}), 400
        if not _validate_category(db, semester_id, subject_id, category):
            return jsonify({'error': 'Invalid category'}), 400
        if category in CR_ONLY_CATEGORIES and not _is_cr(db, semester_id, user_id):
            return jsonify({'error': 'Only the CR can upload to this section'}), 403

        file = request.files.get('file')
        if not file:
            return jsonify({'error': 'No file provided'}), 400

        file.seek(0, 2)
        size = file.tell()
        file.seek(0)
        if size > MAX_FILE_SIZE:
            return jsonify({'error': 'File too large (max 50 MB)'}), 413
        if is_dangerous(file):
            return jsonify({'error': 'File type not allowed'}), 400

        original_name = file.filename or 'file'
        safe_name = secure_filename(original_name) or 'file'
        timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
        stored_name = f"{timestamp}_{user_id}_{safe_name}"
        file.save(os.path.join(UPLOAD_DIR, stored_name))

        user_doc = db.users.find_one({'_id': ObjectId(user_id)}, {'fullName': 1, 'username': 1})
        uploader_name = ((user_doc.get('fullName') or user_doc.get('username', '')) if user_doc else '')

        folder_id = request.form.get('folder_id', '').strip() or None

        # is_public: CRs choose public/private for PYQ/Books; non-CRs always private
        is_public_raw = request.form.get('is_public', 'true').lower()
        is_public = is_public_raw != 'false'
        if category in ('pyq', 'books') and not _is_cr(db, semester_id, user_id):
            is_public = False  # members' uploads to Books/PYQ are always private

        resource = {
            'semester_id': semester_id,
            'subject_id': subject_id,
            'category': category,
            'folder_id': folder_id,
            'name': original_name,
            'stored_name': stored_name,
            'mime_type': file.content_type or 'application/octet-stream',
            'size': size,
            'uploaded_by': user_id,
            'uploaded_by_name': uploader_name,
            'source': 'upload',
            'chat_message_id': None,
            'is_public': is_public,
            'created_at': datetime.now(timezone.utc),
        }
        result = db.academic_resources.insert_one(resource)
        resource['_id'] = result.inserted_id
        return jsonify({'resource': _serialize(resource)}), 201
    except Exception as e:
        logger.error(f"upload_resource error: {e}")
        return jsonify({'error': 'Failed to upload resource'}), 500


# ─── Link chat file ────────────────────────────────────────────────────────────

@academic_bp.route('/<semester_id>/link-chat-file', methods=['POST'])
@token_required
def link_chat_file(semester_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403

        data = request.get_json()
        chat_message_id = (data.get('chat_message_id') or '').strip()
        subject_id = (data.get('subject_id') or '').strip() or None
        category = (data.get('category') or '').strip()
        folder_id = (data.get('folder_id') or '').strip() or None

        if not chat_message_id:
            return jsonify({'error': 'chat_message_id is required'}), 400
        if not subject_id:
            return jsonify({'error': 'subject_id is required'}), 400
        if not _validate_category(db, semester_id, subject_id, category):
            return jsonify({'error': 'Invalid category'}), 400
        if category in CR_ONLY_CATEGORIES and not _is_cr(db, semester_id, user_id):
            return jsonify({'error': 'Only the CR can add files to this section'}), 403

        msg = db.chat_messages.find_one({
            '_id': ObjectId(chat_message_id),
            'semester_id': semester_id,
        })
        if not msg or not msg.get('file'):
            return jsonify({'error': 'Chat file not found'}), 404

        existing = db.academic_resources.find_one({
            'semester_id': semester_id,
            'chat_message_id': chat_message_id,
        })
        if existing:
            update_fields = {'subject_id': subject_id, 'category': category}
            if folder_id is not None:
                update_fields['folder_id'] = folder_id
            db.academic_resources.update_one(
                {'_id': existing['_id']},
                {'$set': update_fields},
            )
            existing.update(update_fields)
            return jsonify({'resource': _serialize(existing)}), 200

        user_doc = db.users.find_one({'_id': ObjectId(user_id)}, {'fullName': 1, 'username': 1})
        uploader_name = ((user_doc.get('fullName') or user_doc.get('username', '')) if user_doc else '')

        resource = {
            'semester_id': semester_id,
            'subject_id': subject_id,
            'category': category,
            'folder_id': folder_id,
            'name': msg['file']['name'],
            'stored_name': None,
            'mime_type': msg['file'].get('mime_type', 'application/octet-stream'),
            'size': msg['file'].get('size', 0),
            'uploaded_by': user_id,
            'uploaded_by_name': uploader_name,
            'source': 'chat',
            'chat_message_id': chat_message_id,
            'created_at': datetime.now(timezone.utc),
        }
        result = db.academic_resources.insert_one(resource)
        resource['_id'] = result.inserted_id
        return jsonify({'resource': _serialize(resource)}), 201
    except Exception as e:
        logger.error(f"link_chat_file error: {e}")
        return jsonify({'error': 'Failed to link chat file'}), 500


# ─── Move resource ─────────────────────────────────────────────────────────────

@academic_bp.route('/<semester_id>/resources/<resource_id>', methods=['PATCH'])
@token_required
def move_resource(semester_id, resource_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403

        data = request.get_json()
        updates = {}
        if 'subject_id' in data:
            updates['subject_id'] = data['subject_id'] or None
        if 'category' in data:
            cat = data['category']
            resource = db.academic_resources.find_one({'_id': ObjectId(resource_id), 'semester_id': semester_id})
            effective_subject = updates.get('subject_id') or (resource.get('subject_id') if resource else None)
            if not _validate_category(db, semester_id, effective_subject, cat):
                return jsonify({'error': 'Invalid category'}), 400
            updates['category'] = cat
        if 'folder_id' in data:
            updates['folder_id'] = data['folder_id'] or None

        if not updates:
            return jsonify({'error': 'Nothing to update'}), 400

        db.academic_resources.update_one(
            {'_id': ObjectId(resource_id), 'semester_id': semester_id},
            {'$set': updates},
        )
        r = db.academic_resources.find_one({'_id': ObjectId(resource_id)})
        return jsonify({'resource': _serialize(r)}), 200
    except Exception as e:
        logger.error(f"move_resource error: {e}")
        return jsonify({'error': 'Failed to move resource'}), 500


# ─── Toggle public/private (PYQ/Books, CR only) ──────────────────────────────

@academic_bp.route('/<semester_id>/resources/<resource_id>/toggle-public', methods=['PATCH'])
@token_required
def toggle_resource_public(semester_id, resource_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_cr(db, semester_id, user_id):
            return jsonify({'error': 'Only a CR can change visibility'}), 403
        resource = db.academic_resources.find_one({'_id': ObjectId(resource_id), 'semester_id': semester_id})
        if not resource:
            return jsonify({'error': 'Resource not found'}), 404
        new_val = not resource.get('is_public', True)
        db.academic_resources.update_one(
            {'_id': ObjectId(resource_id)},
            {'$set': {'is_public': new_val}},
        )
        return jsonify({'is_public': new_val}), 200
    except Exception as e:
        logger.error(f"toggle_resource_public error: {e}")
        return jsonify({'error': 'Failed to toggle visibility'}), 500


# ─── Hide resource for self (members on public CR PYQ/Books files) ───────────

@academic_bp.route('/<semester_id>/resources/<resource_id>/hide', methods=['POST'])
@token_required
def hide_resource_for_self(semester_id, resource_id):
    """Add user_id to resource's hidden_by list — removes it from their view only."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        resource = db.academic_resources.find_one({'_id': ObjectId(resource_id), 'semester_id': semester_id})
        if not resource:
            return jsonify({'error': 'Resource not found'}), 404
        db.academic_resources.update_one(
            {'_id': ObjectId(resource_id)},
            {'$addToSet': {'hidden_by': user_id}},
        )
        return jsonify({'message': 'Resource hidden'}), 200
    except Exception as e:
        logger.error(f"hide_resource_for_self error: {e}")
        return jsonify({'error': 'Failed to hide resource'}), 500


# ─── Delete resource ──────────────────────────────────────────────────────────

@academic_bp.route('/<semester_id>/resources/<resource_id>', methods=['DELETE'])
@token_required
def delete_resource(semester_id, resource_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        resource = db.academic_resources.find_one({
            '_id': ObjectId(resource_id),
            'semester_id': semester_id,
        })
        if not resource:
            return jsonify({'error': 'Resource not found'}), 404
        if resource['uploaded_by'] != user_id and not _is_cr(db, semester_id, user_id):
            return jsonify({'error': 'Not authorized'}), 403
        if resource.get('stored_name'):
            try:
                os.remove(os.path.join(UPLOAD_DIR, resource['stored_name']))
            except OSError:
                pass
        db.academic_resources.delete_one({'_id': ObjectId(resource_id)})
        return jsonify({'message': 'Resource deleted'}), 200
    except Exception as e:
        logger.error(f"delete_resource error: {e}")
        return jsonify({'error': 'Failed to delete resource'}), 500


# ─── Chat files listing ────────────────────────────────────────────────────────

@academic_bp.route('/<semester_id>/chat-files', methods=['GET'])
@token_required
def list_chat_files(semester_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403

        linked_ids = {
            r['chat_message_id']
            for r in db.academic_resources.find(
                {'semester_id': semester_id, 'source': 'chat'},
                {'chat_message_id': 1},
            )
            if r.get('chat_message_id')
        }

        msgs = list(db.chat_messages.find(
            {'semester_id': semester_id, 'file': {'$ne': None}},
            sort=[('created_at', -1)],
            limit=100,
        ))

        result = [
            {
                'message_id': str(m['_id']),
                'name': m['file']['name'],
                'mime_type': m['file'].get('mime_type', ''),
                'size': m['file'].get('size', 0),
                'sender': m.get('full_name') or m.get('username', ''),
                'created_at': m['created_at'].isoformat(),
                'linked': str(m['_id']) in linked_ids,
            }
            for m in msgs if m.get('file')
        ]
        return jsonify({'chat_files': result}), 200
    except Exception as e:
        logger.error(f"list_chat_files error: {e}")
        return jsonify({'error': 'Failed to fetch chat files'}), 500


# ─── File serving ─────────────────────────────────────────────────────────────

@academic_bp.route('/file/<resource_id>', methods=['GET'])
def serve_academic_file(resource_id):
    from database import get_db
    try:
        token = request.args.get('token') or request.headers.get('Authorization', '')
        if token.startswith('Bearer '):
            token = token[7:]
        if not token:
            return jsonify({'error': 'Token is missing'}), 401
        try:
            data = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401

        db = get_db()
        resource = db.academic_resources.find_one({'_id': ObjectId(resource_id)})
        if not resource:
            return jsonify({'error': 'Resource not found'}), 404

        user_id = data['user_id']
        if not _is_member(db, resource['semester_id'], user_id):
            return jsonify({'error': 'Not a member'}), 403

        if resource.get('source') == 'chat' and resource.get('chat_message_id'):
            chat_msg = db.chat_messages.find_one({'_id': ObjectId(resource['chat_message_id'])})
            if not chat_msg or not chat_msg.get('file') or chat_msg.get('deleted_for_everyone'):
                # Stale reference — clean up and return gone
                db.academic_resources.delete_one({'_id': resource['_id']})
                return jsonify({'error': 'File no longer available'}), 410
            abs_path = os.path.join(os.getcwd(), chat_msg['file']['path'])
            if not os.path.exists(abs_path):
                return jsonify({'error': 'File not found on disk'}), 404
            return send_file(
                abs_path,
                mimetype=chat_msg['file'].get('mime_type', 'application/octet-stream'),
                as_attachment=False,
                download_name=chat_msg['file'].get('name', 'file'),
            )

        abs_path = os.path.join(UPLOAD_DIR, resource.get('stored_name', ''))
        if not os.path.exists(abs_path):
            return jsonify({'error': 'File not found on disk'}), 404

        return send_file(
            abs_path,
            mimetype=resource.get('mime_type', 'application/octet-stream'),
            as_attachment=False,
            download_name=resource.get('name', 'file'),
        )
    except Exception as e:
        logger.error(f"serve_academic_file error: {e}")
        return jsonify({'error': 'Failed to serve file'}), 500
