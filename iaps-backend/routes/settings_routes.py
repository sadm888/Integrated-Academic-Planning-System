from flask import Blueprint, request, jsonify, send_file
from flask_cors import cross_origin
from flask_mail import Message
from datetime import datetime, timedelta, timezone
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from bson import ObjectId
import jwt
import random
import os
import logging

from database import db
from middleware import token_required, SECRET_KEY
from email_service import mail
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


def _generate_otp():
    return ''.join(random.choices('0123456789', k=6))


def _send_otp_email(email, otp, subject_action):
    try:
        html_body = f"""
        <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #667eea;">IAPS Verification Code</h2>
                    <p>Your code to {subject_action} is:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px;
                                     color: #667eea; background: #f0f0ff; padding: 16px 32px;
                                     border-radius: 8px; display: inline-block;">
                            {otp}
                        </span>
                    </div>
                    <p style="color: #666; font-size: 14px;">
                        This code is valid for <strong>15 minutes</strong>.
                        If you did not request this, you can safely ignore this email.
                    </p>
                </div>
            </body>
        </html>
        """
        msg = Message(
            subject=f"IAPS — Your verification code",
            recipients=[email],
            html=html_body
        )
        mail.send(msg)
        return True
    except Exception as e:
        logger.error(f"Failed to send OTP email: {e}")
        return False


def _store_otp(user_id, otp_type, otp, new_value=None):
    database = db.get_db()
    # Remove any existing OTPs of the same type for this user
    database.verification_tokens.delete_many({
        'userId': user_id,
        'type': otp_type
    })
    database.verification_tokens.insert_one({
        'token': otp,
        'type': otp_type,
        'userId': user_id,
        'newValue': new_value,
        'expiresAt': datetime.now(timezone.utc) + timedelta(minutes=15),
        'createdAt': datetime.now(timezone.utc)
    })


MAX_OTP_ATTEMPTS = 5

def _verify_otp(user_id, otp_type, otp):
    database = db.get_db()
    # Find by user + type (not by token value, so we can count attempts)
    token_doc = database.verification_tokens.find_one({
        'type': otp_type,
        'userId': user_id,
    })
    if not token_doc:
        return None
    if datetime.now(timezone.utc) > token_doc['expiresAt']:
        database.verification_tokens.delete_one({'_id': token_doc['_id']})
        return None
    if token_doc.get('failedAttempts', 0) >= MAX_OTP_ATTEMPTS:
        database.verification_tokens.delete_one({'_id': token_doc['_id']})
        return None
    if token_doc['token'] != otp:
        database.verification_tokens.update_one(
            {'_id': token_doc['_id']},
            {'$inc': {'failedAttempts': 1}}
        )
        return None
    database.verification_tokens.delete_one({'_id': token_doc['_id']})
    return token_doc


# ---------------------------------------------------------------------------
# POST /api/settings/verify-password  (used to gate personal docs in chat)
# ---------------------------------------------------------------------------
@settings_bp.route('/verify-password', methods=['POST'])
@cross_origin()
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
# GET /api/settings/avatar/<user_id>  (public — no auth)
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
# POST /api/settings/change-password-request
# ---------------------------------------------------------------------------
@settings_bp.route('/change-password-request', methods=['POST'])
@token_required
def change_password_request():
    try:
        database = db.get_db()
        user = database.users.find_one({'_id': ObjectId(request.user['user_id'])})
        if not user:
            return jsonify({'error': 'User not found'}), 404

        otp = _generate_otp()
        _store_otp(str(user['_id']), 'password_change', otp)

        sent = _send_otp_email(user['email'], otp, 'change your password')
        if not sent:
            return jsonify({'error': 'Failed to send OTP email'}), 500

        return jsonify({'message': f'OTP sent to {user["email"]}'}), 200
    except Exception as e:
        logger.error(f"change_password_request error: {e}")
        return jsonify({'error': 'Failed to send OTP'}), 500


# ---------------------------------------------------------------------------
# POST /api/settings/change-password-confirm
# ---------------------------------------------------------------------------
@settings_bp.route('/change-password-confirm', methods=['POST'])
@token_required
def change_password_confirm():
    try:
        data = request.get_json()
        otp = data.get('otp', '').strip()
        current_password = data.get('current_password', '')
        new_password = data.get('new_password', '')

        if not all([otp, current_password, new_password]):
            return jsonify({'error': 'OTP, current password, and new password are required'}), 400

        if len(new_password) < 8:
            return jsonify({'error': 'New password must be at least 8 characters'}), 400

        user_id = request.user['user_id']
        database = db.get_db()
        user = database.users.find_one({'_id': ObjectId(user_id)})
        if not user:
            return jsonify({'error': 'User not found'}), 404

        if not check_password_hash(user.get('password', ''), current_password):
            return jsonify({'error': 'Current password is incorrect'}), 400

        token_doc = _verify_otp(user_id, 'password_change', otp)
        if not token_doc:
            return jsonify({'error': 'Invalid or expired OTP'}), 400

        hashed = generate_password_hash(new_password)
        database.users.update_one({'_id': ObjectId(user_id)}, {'$set': {'password': hashed}})

        return jsonify({'message': 'Password changed successfully'}), 200
    except Exception as e:
        logger.error(f"change_password_confirm error: {e}")
        return jsonify({'error': 'Failed to change password'}), 500


# ---------------------------------------------------------------------------
# POST /api/settings/change-email-request
# ---------------------------------------------------------------------------
@settings_bp.route('/change-email-request', methods=['POST'])
@token_required
def change_email_request():
    try:
        data = request.get_json()
        new_email = data.get('new_email', '').strip().lower()

        if not new_email:
            return jsonify({'error': 'New email is required'}), 400

        database = db.get_db()
        if database.users.find_one({'email': new_email}):
            return jsonify({'error': 'Email already in use'}), 400

        user_id = request.user['user_id']
        otp = _generate_otp()
        _store_otp(user_id, 'email_change', otp, new_value=new_email)

        sent = _send_otp_email(new_email, otp, 'verify your new email')
        if not sent:
            return jsonify({'error': 'Failed to send OTP email'}), 500

        return jsonify({'message': f'OTP sent to {new_email}'}), 200
    except Exception as e:
        logger.error(f"change_email_request error: {e}")
        return jsonify({'error': 'Failed to send OTP'}), 500


# ---------------------------------------------------------------------------
# POST /api/settings/change-email-confirm
# ---------------------------------------------------------------------------
@settings_bp.route('/change-email-confirm', methods=['POST'])
@token_required
def change_email_confirm():
    try:
        data = request.get_json()
        otp = data.get('otp', '').strip()

        if not otp:
            return jsonify({'error': 'OTP is required'}), 400

        user_id = request.user['user_id']
        token_doc = _verify_otp(user_id, 'email_change', otp)
        if not token_doc:
            return jsonify({'error': 'Invalid or expired OTP'}), 400

        new_email = token_doc.get('newValue')
        if not new_email:
            return jsonify({'error': 'No pending email change found'}), 400

        database = db.get_db()
        # Double-check uniqueness
        if database.users.find_one({'email': new_email}):
            return jsonify({'error': 'Email already in use'}), 400

        database.users.update_one({'_id': ObjectId(user_id)}, {'$set': {'email': new_email}})
        user = database.users.find_one({'_id': ObjectId(user_id)})
        new_token = _create_token(user)

        return jsonify({
            'message': 'Email changed successfully',
            'token': new_token,
            'user': _format_user(user)
        }), 200
    except Exception as e:
        logger.error(f"change_email_confirm error: {e}")
        return jsonify({'error': 'Failed to change email'}), 500


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
@cross_origin()
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
@cross_origin()
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
@cross_origin()
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
@cross_origin()
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
