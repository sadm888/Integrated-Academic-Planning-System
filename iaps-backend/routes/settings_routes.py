from flask import Blueprint, request, jsonify, send_file
from datetime import datetime, timedelta, timezone
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from bson import ObjectId
import jwt
import os
import logging

from database import db
from middleware import token_required, SECRET_KEY
from utils.mime_check import is_image, is_dangerous

settings_bp = Blueprint('settings', __name__, url_prefix='/api/settings')
logger = logging.getLogger(__name__)

AVATARS_DIR = os.path.join(os.getcwd(), 'uploads', 'avatars')
ALLOWED_IMAGE_EXTS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
MAX_AVATAR_SIZE = 2 * 1024 * 1024  # 2 MB


def _create_token(user_data):
    payload = {
        'user_id': str(user_data['_id']),
        'email': user_data['email'],
        'username': user_data.get('username', ''),
        'exp': datetime.now(timezone.utc) + timedelta(days=7)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')


def _format_user(user):
    return {
        'id': str(user['_id']),
        'username': user['username'],
        'email': user['email'],
        'fullName': user.get('fullName'),
        'college': user.get('college'),
        'department': user.get('department'),
        'phone': user.get('phone', ''),
        'phone_public': user.get('phone_public', False),
        'is_verified': user.get('is_verified', False),
        'profile_picture': user.get('profile_picture'),
        'photo_removed_reason': user.get('photo_removed_reason'),
        'photo_removed_by': user.get('photo_removed_by'),
        'name_removed_reason': user.get('name_removed_reason'),
        'name_removed_by': user.get('name_removed_by'),
    }




# ---------------------------------------------------------------------------
# POST /api/settings/verify-password  (used to gate personal docs in chat)
# ---------------------------------------------------------------------------
@settings_bp.route('/verify-password', methods=['POST'])
@token_required
def verify_password():
    try:
        data = request.get_json() or {}
        password = (data.get('password') or '').strip()
        if not password:
            return jsonify({'error': 'Password required'}), 400
        database = db.get_db()
        user = database.users.find_one({'_id': ObjectId(request.user['user_id'])})
        if not user:
            return jsonify({'error': 'User not found'}), 404
        if not check_password_hash(user.get('password', ''), password):
            return jsonify({'error': 'Incorrect password'}), 401
        return jsonify({'ok': True}), 200
    except Exception as e:
        logger.error(f"verify_password error: {e}")
        return jsonify({'error': 'Failed to verify password'}), 500


# ---------------------------------------------------------------------------
# GET /api/settings/me
# ---------------------------------------------------------------------------
@settings_bp.route('/me', methods=['GET'])
@token_required
def get_me():
    try:
        database = db.get_db()
        user = database.users.find_one({'_id': ObjectId(request.user['user_id'])})
        if not user:
            return jsonify({'error': 'User not found'}), 404
        return jsonify({'user': _format_user(user)}), 200
    except Exception as e:
        logger.error(f"get_me error: {e}")
        return jsonify({'error': 'Failed to fetch profile'}), 500


# ---------------------------------------------------------------------------
# PATCH /api/settings/update-profile
# ---------------------------------------------------------------------------
@settings_bp.route('/update-profile', methods=['PATCH'])
@token_required
def update_profile():
    try:
        data = request.get_json()
        database = db.get_db()
        user_id = request.user['user_id']

        updates = {}
        if 'username' in data:
            new_username = data['username'].strip()
            if not new_username:
                return jsonify({'error': 'Username cannot be empty'}), 400
            # Check uniqueness (excluding self)
            existing = database.users.find_one({'username': new_username})
            if existing and str(existing['_id']) != user_id:
                return jsonify({'error': 'Username already taken'}), 400
            updates['username'] = new_username
        if 'fullName' in data:
            updates['fullName'] = data['fullName'].strip()
            # Clear name flag when user changes their display name
            updates['name_removed_reason'] = None
            updates['name_removed_by'] = None
        if 'college' in data:
            updates['college'] = data['college'].strip()
        if 'department' in data:
            updates['department'] = data['department'].strip()
        if 'phone' in data:
            updates['phone'] = data['phone'].strip()
        if 'phone_public' in data:
            updates['phone_public'] = bool(data['phone_public'])

        if not updates:
            return jsonify({'error': 'No fields to update'}), 400

        database.users.update_one({'_id': ObjectId(user_id)}, {'$set': updates})
        user = database.users.find_one({'_id': ObjectId(user_id)})
        new_token = _create_token(user)
        return jsonify({
            'message': 'Profile updated',
            'token': new_token,
            'user': _format_user(user)
        }), 200
    except Exception as e:
        logger.error(f"update_profile error: {e}")
        return jsonify({'error': 'Failed to update profile'}), 500


# ---------------------------------------------------------------------------
# POST /api/settings/upload-avatar
# ---------------------------------------------------------------------------
@settings_bp.route('/upload-avatar', methods=['POST'])
@token_required
def upload_avatar():
    try:
        if 'avatar' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['avatar']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
        if ext not in ALLOWED_IMAGE_EXTS:
            return jsonify({'error': 'Only image files are allowed'}), 400

        # Verify magic bytes confirm it is an actual image
        if not is_image(file):
            return jsonify({'error': 'File content does not match an image format'}), 400

        # Check size
        file.seek(0, 2)
        size = file.tell()
        file.seek(0)
        if size > MAX_AVATAR_SIZE:
            return jsonify({'error': 'Image must be under 2 MB'}), 400

        user_id = request.user['user_id']
        safe_name = secure_filename(file.filename)
        filename = f"{user_id}_{safe_name}"
        os.makedirs(AVATARS_DIR, exist_ok=True)

        # Remove old avatar files for this user
        for f_name in os.listdir(AVATARS_DIR):
            if f_name.startswith(f"{user_id}_"):
                try:
                    os.remove(os.path.join(AVATARS_DIR, f_name))
                except Exception:
                    pass

        filepath = os.path.join(AVATARS_DIR, filename)
        file.save(filepath)

        database = db.get_db()
        database.users.update_one(
            {'_id': ObjectId(user_id)},
            {'$set': {
                'profile_picture': filename,
                'photo_removed_reason': None,
                'photo_removed_by': None,
                'photo_removed_at': None,
            }}
        )
        user = database.users.find_one({'_id': ObjectId(user_id)})
        return jsonify({'message': 'Avatar uploaded', 'user': _format_user(user)}), 200
    except Exception as e:
        logger.error(f"upload_avatar error: {e}")
        return jsonify({'error': 'Failed to upload avatar'}), 500


# ---------------------------------------------------------------------------
# GET /api/settings/avatar/<user_id>  (public — thumbnails, no auth)
# ---------------------------------------------------------------------------
@settings_bp.route('/avatar/<user_id>', methods=['GET'])
def serve_avatar(user_id):
    try:
        database = db.get_db()
        user = database.users.find_one({'_id': ObjectId(user_id)})
        if not user or not user.get('profile_picture'):
            return jsonify({'error': 'Avatar not found'}), 404

        filepath = os.path.join(AVATARS_DIR, user['profile_picture'])
        if not os.path.exists(filepath):
            return jsonify({'error': 'Avatar file not found'}), 404

        return send_file(filepath)
    except Exception as e:
        logger.error(f"serve_avatar error: {e}")
        return jsonify({'error': 'Failed to serve avatar'}), 500


# ---------------------------------------------------------------------------
# GET /api/settings/avatar-token/<user_id>  (auth required — get signed token)
# ---------------------------------------------------------------------------
@settings_bp.route('/avatar-token/<user_id>', methods=['GET'])
@token_required
def get_avatar_token(user_id):
    """Return a short-lived signed token allowing the caller to fetch the fullscreen avatar."""
    try:
        database = db.get_db()
        target = database.users.find_one({'_id': ObjectId(user_id)})
        if not target or not target.get('profile_picture'):
            return jsonify({'error': 'Avatar not found'}), 404

        sig_payload = {
            'target': user_id,
            'viewer': request.user['user_id'],
            'exp': datetime.now(timezone.utc) + timedelta(minutes=2),
        }
        sig_token = jwt.encode(sig_payload, SECRET_KEY, algorithm='HS256')
        return jsonify({'token': sig_token}), 200
    except Exception as e:
        logger.error(f"get_avatar_token error: {e}")
        return jsonify({'error': 'Failed to generate token'}), 500


# ---------------------------------------------------------------------------
# GET /api/settings/avatar/full/<user_id>?sig=<token>  (signed — fullscreen)
# ---------------------------------------------------------------------------
@settings_bp.route('/avatar/full/<user_id>', methods=['GET'])
def serve_avatar_fullscreen(user_id):
    """Serve full-resolution avatar — requires a short-lived signed token."""
    try:
        sig = request.args.get('sig', '')
        if not sig:
            return jsonify({'error': 'Missing signature'}), 401

        try:
            data = jwt.decode(sig, SECRET_KEY, algorithms=['HS256'])
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Link expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid signature'}), 401

        if data.get('target') != user_id:
            return jsonify({'error': 'Token mismatch'}), 403

        database = db.get_db()
        user = database.users.find_one({'_id': ObjectId(user_id)})
        if not user or not user.get('profile_picture'):
            return jsonify({'error': 'Avatar not found'}), 404

        filepath = os.path.join(AVATARS_DIR, user['profile_picture'])
        if not os.path.exists(filepath):
            return jsonify({'error': 'Avatar file not found'}), 404

        response = send_file(filepath)
        response.headers['Cache-Control'] = 'no-store'
        return response
    except Exception as e:
        logger.error(f"serve_avatar_fullscreen error: {e}")
        return jsonify({'error': 'Failed to serve avatar'}), 500


# ---------------------------------------------------------------------------
# POST /api/settings/change-password
# ---------------------------------------------------------------------------
@settings_bp.route('/change-password', methods=['POST'])
@token_required
def change_password():
    try:
        data = request.get_json()
        current_password = data.get('current_password', '')
        new_password = data.get('new_password', '')

        if not all([current_password, new_password]):
            return jsonify({'error': 'Current password and new password are required'}), 400

        if len(new_password) < 8:
            return jsonify({'error': 'New password must be at least 8 characters'}), 400

        user_id = request.user['user_id']
        database = db.get_db()
        user = database.users.find_one({'_id': ObjectId(user_id)})
        if not user:
            return jsonify({'error': 'User not found'}), 404

        if not check_password_hash(user.get('password', ''), current_password):
            return jsonify({'error': 'Current password is incorrect'}), 400

        hashed = generate_password_hash(new_password)
        database.users.update_one({'_id': ObjectId(user_id)}, {'$set': {'password': hashed}})

        return jsonify({'message': 'Password changed successfully'}), 200
    except Exception as e:
        logger.error(f"change_password error: {e}")
        return jsonify({'error': 'Failed to change password'}), 500


# ---------------------------------------------------------------------------
# GET /api/settings/chat-files
# ---------------------------------------------------------------------------
@settings_bp.route('/chat-files', methods=['GET'])
@token_required
def get_chat_files():
    try:
        database = db.get_db()
        user_id = request.user['user_id']

        messages = list(database.chat_messages.find({
            'user_id': user_id,
            'file': {'$ne': None}
        }).sort('created_at', -1))

        # Build a map of classroom names
        classroom_ids = list({m['classroom_id'] for m in messages})
        classrooms = {}
        for cid in classroom_ids:
            try:
                c = database.classrooms.find_one({'_id': ObjectId(cid)})
                if c:
                    classrooms[cid] = c.get('name', cid)
            except Exception:
                classrooms[cid] = cid

        files = []
        for msg in messages:
            file_info = msg.get('file', {}) or {}
            files.append({
                'message_id': str(msg['_id']),
                'classroom_id': msg['classroom_id'],
                'classroom_name': classrooms.get(msg['classroom_id'], msg['classroom_id']),
                'filename': file_info.get('name', 'file'),
                'mime_type': file_info.get('mime_type', ''),
                'size': file_info.get('size', 0),
                'created_at': msg['created_at'].isoformat() if msg.get('created_at') else None
            })

        return jsonify({'files': files}), 200
    except Exception as e:
        logger.error(f"get_chat_files error: {e}")
        return jsonify({'error': 'Failed to fetch chat files'}), 500


# ---------------------------------------------------------------------------
# POST /api/settings/acknowledge-photo-removal
# ---------------------------------------------------------------------------
@settings_bp.route('/acknowledge-photo-removal', methods=['POST'])
@token_required
def acknowledge_photo_removal():
    try:
        database = db.get_db()
        user_id = request.user['user_id']
        database.users.update_one(
            {'_id': ObjectId(user_id)},
            {'$unset': {'photo_removed_reason': '', 'photo_removed_by': '', 'photo_removed_at': ''}}
        )
        return jsonify({'message': 'Acknowledged'}), 200
    except Exception as e:
        logger.error(f"acknowledge_photo_removal error: {e}")
        return jsonify({'error': 'Failed to acknowledge'}), 500


# ---------------------------------------------------------------------------
# DELETE /api/settings/chat-file/<message_id>
# ---------------------------------------------------------------------------
@settings_bp.route('/chat-file/<message_id>', methods=['DELETE'])
@token_required
def delete_chat_file(message_id):
    try:
        database = db.get_db()
        user_id = request.user['user_id']

        msg = database.chat_messages.find_one({'_id': ObjectId(message_id)})
        if not msg:
            return jsonify({'error': 'Message not found'}), 404
        if msg.get('user_id') != user_id:
            return jsonify({'error': 'Not authorized'}), 403
        if not msg.get('file'):
            return jsonify({'error': 'No file attached to this message'}), 400

        # Delete the file from disk (path is stored relative to cwd)
        file_info = msg['file'] or {}
        rel_path = file_info.get('path')
        disk_path = os.path.join(os.getcwd(), rel_path) if rel_path else None
        if disk_path and os.path.exists(disk_path):
            try:
                os.remove(disk_path)
            except Exception as del_err:
                logger.warning(f"Could not delete file {disk_path}: {del_err}")

        # Clear file from the message (keep text)
        database.chat_messages.update_one(
            {'_id': ObjectId(message_id)},
            {'$set': {'file': None}}
        )

        return jsonify({'message': 'File deleted'}), 200
    except Exception as e:
        logger.error(f"delete_chat_file error: {e}")
        return jsonify({'error': 'Failed to delete file'}), 500


# ─── Personal Documents (private, owner-only) ────────────────────────────────

PERSONAL_DOCS_DIR = os.path.join(os.getcwd(), 'uploads', 'personal_docs')
os.makedirs(PERSONAL_DOCS_DIR, exist_ok=True)
MAX_PERSONAL_DOC_SIZE = 20 * 1024 * 1024  # 20 MB


@settings_bp.route('/personal-docs', methods=['GET'])
@token_required
def list_personal_docs():
    """List the current user's personal documents."""
    try:
        user_id = request.user['user_id']
        database = db.get_db()
        docs = list(database.personal_docs.find(
            {'user_id': user_id},
            sort=[('created_at', -1)]
        ))
        return jsonify({'docs': [
            {
                'id': str(d['_id']),
                'label': d.get('label', d.get('filename', '')),
                'filename': d.get('filename', ''),
                'mime_type': d.get('mime_type', ''),
                'size': d.get('size', 0),
                'created_at': d['created_at'].isoformat() if 'created_at' in d else '',
            }
            for d in docs
        ]}), 200
    except Exception as e:
        logger.error(f"list_personal_docs error: {e}")
        return jsonify({'error': 'Failed to list documents'}), 500


@settings_bp.route('/personal-docs/upload', methods=['POST'])
@token_required
def upload_personal_doc():
    """Upload a personal document with a label."""
    try:
        user_id = request.user['user_id']
        file = request.files.get('file')
        label = (request.form.get('label') or '').strip()

        if not file:
            return jsonify({'error': 'No file provided'}), 400

        file.seek(0, 2)
        size = file.tell()
        file.seek(0)
        if size > MAX_PERSONAL_DOC_SIZE:
            return jsonify({'error': 'File too large (max 20 MB)'}), 413
        if is_dangerous(file):
            return jsonify({'error': 'File type not allowed'}), 400

        original_name = secure_filename(file.filename or 'document')
        timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
        stored_name = f"{timestamp}_{user_id}_{original_name}"
        file_path = os.path.join(PERSONAL_DOCS_DIR, stored_name)
        file.save(file_path)

        database = db.get_db()
        doc = {
            'user_id': user_id,
            'label': label or original_name,
            'filename': original_name,
            'stored_name': stored_name,
            'mime_type': file.content_type or 'application/octet-stream',
            'size': size,
            'created_at': datetime.now(timezone.utc),
        }
        result = database.personal_docs.insert_one(doc)
        doc['_id'] = result.inserted_id

        return jsonify({'doc': {
            'id': str(doc['_id']),
            'label': doc['label'],
            'filename': doc['filename'],
            'mime_type': doc['mime_type'],
            'size': doc['size'],
            'created_at': doc['created_at'].isoformat(),
        }}), 201
    except Exception as e:
        logger.error(f"upload_personal_doc error: {e}")
        return jsonify({'error': 'Failed to upload document'}), 500


@settings_bp.route('/personal-docs/<doc_id>', methods=['GET'])
def download_personal_doc(doc_id):
    """Serve a personal document — owner only, token from header or ?token= query param."""
    try:
        token = request.args.get('token') or request.headers.get('Authorization', '')
        if token.startswith('Bearer '):
            token = token[7:]
        if not token:
            return jsonify({'error': 'Authentication required'}), 401

        import jwt as pyjwt
        data = pyjwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        user_id = data.get('user_id')

        database = db.get_db()
        doc = database.personal_docs.find_one({'_id': ObjectId(doc_id)})
        if not doc:
            return jsonify({'error': 'Document not found'}), 404
        if doc['user_id'] != user_id:
            return jsonify({'error': 'Access denied'}), 403

        file_path = os.path.join(PERSONAL_DOCS_DIR, doc['stored_name'])
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found on disk'}), 404

        mime = doc.get('mime_type', 'application/octet-stream')
        return send_file(file_path, mimetype=mime, as_attachment=False,
                         download_name=doc.get('filename', 'document'))
    except Exception as e:
        logger.error(f"download_personal_doc error: {e}")
        return jsonify({'error': 'Failed to serve document'}), 500


@settings_bp.route('/personal-docs/<doc_id>', methods=['DELETE'])
@token_required
def delete_personal_doc(doc_id):
    """Delete a personal document."""
    try:
        user_id = request.user['user_id']
        database = db.get_db()
        doc = database.personal_docs.find_one({'_id': ObjectId(doc_id)})
        if not doc:
            return jsonify({'error': 'Document not found'}), 404
        if doc['user_id'] != user_id:
            return jsonify({'error': 'Access denied'}), 403

        file_path = os.path.join(PERSONAL_DOCS_DIR, doc['stored_name'])
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception as del_err:
                logger.warning(f"Could not delete file: {del_err}")

        database.personal_docs.delete_one({'_id': ObjectId(doc_id)})
        return jsonify({'message': 'Document deleted'}), 200
    except Exception as e:
        logger.error(f"delete_personal_doc error: {e}")
        return jsonify({'error': 'Failed to delete document'}), 500
