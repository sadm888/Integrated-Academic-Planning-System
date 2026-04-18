"""
chat_routes.py — Real-time classroom chat (semester-scoped).

REST  : GET  /<semester_id>/messages      — message history
        POST /<semester_id>/upload        — file upload + broadcast
        GET  /file/<message_id>           — serve uploaded file
        GET  /unread-counts               — unread count per semester
        POST /<semester_id>/read          — mark semester as read

Socket: connect / disconnect / join_room / send_message
"""

import os
import re
import logging
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify, send_file
from flask_socketio import join_room, emit
from bson import ObjectId
import jwt
from werkzeug.utils import secure_filename

from middleware import token_required, SECRET_KEY
from socketio_instance import socketio
from utils.encryption import encrypt_text, decrypt_text
from utils.mime_check import is_dangerous
from utils import toggle_reaction

chat_bp = Blueprint('chat', __name__, url_prefix='/api/chat')
logger = logging.getLogger(__name__)

CHAT_UPLOAD_DIR = os.path.join(os.getcwd(), 'uploads', 'chat')
os.makedirs(CHAT_UPLOAD_DIR, exist_ok=True)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB

# Maps socket session ID → {user_id, username, full_name}
_connected_users = {}


def emit_to_user(user_id, event, data):
    """Emit a socket event to all active sessions of a specific user."""
    for sid, u in _connected_users.items():
        if u.get('user_id') == user_id:
            socketio.emit(event, data, to=sid)


def notify_status_change(user_id, show_online):
    """Update cached privacy setting and broadcast status change to all rooms the user is in.

    Called from settings_routes when the user toggles show_online_status so that
    the change takes effect immediately in existing socket sessions.
    """
    event = 'user_online' if show_online else 'user_offline'
    rooms_notified = set()
    for u in _connected_users.values():
        if u.get('user_id') != user_id:
            continue
        u['show_online_status'] = show_online
        for room in u.get('rooms', set()):
            if room not in rooms_notified:
                rooms_notified.add(room)
                socketio.emit(event, {'user_id': user_id}, to=room)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _delete_message_and_cascade(db, message_id, semester_id):
    """Delete a chat message, its physical file, and any linked academic resources."""
    try:
        msg = db.chat_messages.find_one({'_id': ObjectId(message_id), 'semester_id': semester_id})
        if not msg:
            return
        # Delete physical file from disk
        if msg.get('file') and msg['file'].get('path'):
            try:
                abs_path = os.path.join(os.getcwd(), msg['file']['path'])
                if os.path.exists(abs_path):
                    os.remove(abs_path)
            except OSError:
                pass
        # Cascade: remove any academic_resources that reference this chat message
        db.academic_resources.delete_many({
            'chat_message_id': str(msg['_id']),
            'source': 'chat',
        })
        db.chat_messages.delete_one({'_id': ObjectId(message_id)})
    except Exception as e:
        logger.warning(f"_delete_message_and_cascade error: {e}")


def _serialize_message(msg, profile_picture=None):
    deleted = msg.get('deleted_for_everyone', False)
    result = {
        'id': str(msg['_id']),
        'type': msg.get('type'),
        'user_id': msg['user_id'],
        'username': msg['username'],
        'full_name': msg.get('full_name') or '',
        'profile_picture': profile_picture,
        'text': None if deleted else decrypt_text(msg.get('text')),
        'created_at': msg['created_at'].isoformat().replace('+00:00', '') + 'Z',
        'deleted_for_everyone': deleted,
        'reactions': msg.get('reactions', []),
    }
    if msg.get('file') and not deleted:
        result['file'] = msg['file']
    if msg.get('reply_to') and not deleted:
        result['reply_to'] = msg['reply_to']
    if msg.get('poll') and not deleted:
        result['poll'] = msg['poll']
    return result


def _is_cr_or_mod(db, semester_id, user_id):
    """Return True if user is a CR for this semester."""
    try:
        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return False
        return user_id in [str(c) for c in semester.get('cr_ids', [])]
    except Exception:
        return False


def _is_semester_member(db, semester_id, user_id):
    """Return True if user_id is a member of the classroom that owns this semester."""
    try:
        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
    except Exception:
        return False
    if not semester:
        return False
    classroom_id = semester.get('classroom_id')
    if not classroom_id:
        return False
    try:
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
    except Exception:
        return False
    if not classroom:
        return False
    return user_id in [str(m) for m in classroom.get('members', [])]


# ─── Socket.IO events ─────────────────────────────────────────────────────────

@socketio.on('connect')
def handle_connect():
    """Authenticate via JWT query param and register the session."""
    token = request.args.get('token')
    if not token:
        return False
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
        from database import get_db
        db = get_db()
        user_doc = db.users.find_one(
            {'_id': ObjectId(payload['user_id'])},
            {'fullName': 1, 'show_online_status': 1}
        )
        full_name = (user_doc.get('fullName') or '') if user_doc else ''
        show_online = (user_doc.get('show_online_status', True)) if user_doc else True
        _connected_users[request.sid] = {
            'user_id': payload['user_id'],
            'username': payload.get('username', payload.get('email', 'User')),
            'full_name': full_name,
            'show_online_status': show_online,
            'rooms': set(),
        }
        logger.info(f"Socket connected: {payload['user_id']}")
    except Exception as e:
        logger.error(f"Socket connect error: {e}")
        return False


@socketio.on('disconnect')
def handle_disconnect():
    user_data = _connected_users.pop(request.sid, None)
    if not user_data:
        return
    if not user_data.get('show_online_status', True):
        return
    user_id = user_data['user_id']
    # Only emit offline if this was the user's last active session
    still_connected = any(u['user_id'] == user_id for u in _connected_users.values())
    if not still_connected:
        for room in user_data.get('rooms', set()):
            socketio.emit('user_offline', {'user_id': user_id}, to=room)


@socketio.on('join_room')
def handle_join_room(data):
    """Verify membership then subscribe the socket to the semester room."""
    from database import get_db
    user_data = _connected_users.get(request.sid)
    if not user_data:
        return
    semester_id = data.get('semester_id')
    if not semester_id:
        return
    db = get_db()
    if not _is_semester_member(db, semester_id, user_data['user_id']):
        return
    join_room(semester_id)
    user_data['rooms'].add(semester_id)
    emit('joined', {'semester_id': semester_id})
    # Re-read privacy setting from DB (may have changed since connect)
    user_doc = db.users.find_one({'_id': ObjectId(user_data['user_id'])}, {'show_online_status': 1})
    show_online = user_doc.get('show_online_status', True) if user_doc else True
    user_data['show_online_status'] = show_online  # keep cache in sync
    if show_online:
        emit('user_online', {'user_id': user_data['user_id']}, to=semester_id)


@socketio.on('typing')
def handle_typing(data):
    """Broadcast a typing notification to all other members in the room."""
    user_data = _connected_users.get(request.sid)
    if not user_data:
        return
    semester_id = data.get('semester_id')
    if not semester_id or semester_id not in user_data.get('rooms', set()):
        return
    from database import get_db
    if not _is_semester_member(get_db(), semester_id, user_data['user_id']):
        return
    emit('user_typing', {
        'user_id': user_data['user_id'],
        'username': user_data['username'],
        'full_name': user_data.get('full_name', ''),
    }, to=semester_id, skip_sid=request.sid)


@socketio.on('send_message')
def handle_send_message(data):
    """Save a text message and broadcast it to the semester room."""
    from database import get_db
    user_data = _connected_users.get(request.sid)
    if not user_data:
        return
    semester_id = data.get('semester_id')
    text = (data.get('text') or '').strip()
    local_id = data.get('local_id', '')   # echo back for optimistic UI
    reply_to_id = (data.get('reply_to_id') or '').strip()
    if not semester_id or not text:
        return
    db = get_db()
    if not _is_semester_member(db, semester_id, user_data['user_id']):
        return
    sender_doc = db.users.find_one({'_id': ObjectId(user_data['user_id'])}, {'profile_picture': 1})
    profile_picture = (sender_doc.get('profile_picture') or None) if sender_doc else None

    reply_to = None
    if reply_to_id:
        try:
            ref = db.chat_messages.find_one(
                {'_id': ObjectId(reply_to_id), 'semester_id': semester_id}
            )
            if ref and not ref.get('deleted_for_everyone'):
                reply_to = {
                    'id': str(ref['_id']),
                    'text': (decrypt_text(ref.get('text')) or '')[:120],
                    'username': ref.get('username', ''),
                    'full_name': ref.get('full_name', ''),
                    'has_file': bool(ref.get('file')),
                }
        except Exception:
            pass

    msg = {
        'semester_id': semester_id,
        'user_id': user_data['user_id'],
        'username': user_data['username'],
        'full_name': user_data.get('full_name', ''),
        'text': encrypt_text(text),
        'file': None,
        'created_at': datetime.now(timezone.utc),
    }
    if reply_to:
        msg['reply_to'] = reply_to
    result = db.chat_messages.insert_one(msg)
    msg['_id'] = result.inserted_id
    payload = _serialize_message(msg, profile_picture)
    if local_id:
        payload['local_id'] = local_id
    emit('new_message', payload, to=semester_id)

    # ── @mention notifications ──────────────────────────────────────────────
    mentioned_usernames = list(set(re.findall(r'@([A-Za-z0-9_]+)', text))) if '@' in text else []
    if mentioned_usernames:
        try:
            semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
            classroom = db.classrooms.find_one({'_id': ObjectId(semester['classroom_id'])}) if semester else None
            if classroom:
                member_oids = classroom.get('members', [])
                mentioned_users = list(db.users.find(
                    {'username': {'$in': mentioned_usernames}, '_id': {'$in': member_oids}},
                    {'_id': 1, 'username': 1}
                ))
                # Build uid → [sids] map once to avoid O(M×N) nested loop
                uid_to_sids = {}
                for sid, ud in list(_connected_users.items()):
                    uid_to_sids.setdefault(ud['user_id'], []).append(sid)
                notification_base = {
                    'semester_id': semester_id,
                    'message_id': str(msg['_id']),
                    'mentioned_by': user_data.get('full_name') or user_data['username'],
                    'text': text[:100],
                }
                for mu in mentioned_users:
                    mu_id = str(mu['_id'])
                    if mu_id == user_data['user_id']:
                        continue  # don't notify yourself
                    for sid in uid_to_sids.get(mu_id, []):
                        socketio.emit('mention_notification', notification_base, to=sid)
        except Exception as e:
            logger.warning(f"Mention notification error: {e}")


# ─── REST: message history ────────────────────────────────────────────────────

@chat_bp.route('/<semester_id>/messages', methods=['GET'])
@token_required
def get_messages(semester_id):
    """Return the last N messages for a semester (oldest first)."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_semester_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        limit = min(int(request.args.get('limit', 50)), 200)
        before_id = request.args.get('before_id', '')
        query = {'semester_id': semester_id, 'hidden_for': {'$nin': [user_id]}}
        if before_id:
            try:
                query['_id'] = {'$lt': ObjectId(before_id)}
            except Exception:
                pass
        msgs = list(db.chat_messages.find(
            query,
            sort=[('created_at', -1)],
            limit=limit,
        ))
        msgs.reverse()

        # Batch-fetch profile pictures for all senders
        sender_ids = list({m['user_id'] for m in msgs if m.get('user_id')})
        pic_map = {}
        if sender_ids:
            for u in db.users.find(
                {'_id': {'$in': [ObjectId(uid) for uid in sender_ids]}},
                {'profile_picture': 1},
            ):
                pic_map[str(u['_id'])] = u.get('profile_picture')

        return jsonify({'messages': [
            _serialize_message(m, pic_map.get(m.get('user_id')))
            for m in msgs
        ]}), 200
    except Exception as e:
        logger.error(f"get_messages error: {e}")
        return jsonify({'error': 'Failed to fetch messages'}), 500


# ─── REST: file upload ────────────────────────────────────────────────────────

@chat_bp.route('/<semester_id>/upload', methods=['POST'])
@token_required
def upload_file(semester_id):
    """Upload a file, save a chat message, and broadcast via Socket.IO."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        username = request.user.get('username', request.user.get('email', 'User'))
        db = get_db()
        if not _is_semester_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        user_doc = db.users.find_one({'_id': ObjectId(user_id)}, {'fullName': 1, 'profile_picture': 1})
        full_name = (user_doc.get('fullName') or '') if user_doc else ''
        profile_picture = (user_doc.get('profile_picture') or None) if user_doc else None

        file = request.files.get('file')
        text = (request.form.get('text') or '').strip() or None
        reply_to_id = (request.form.get('reply_to_id') or '').strip()

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
        file_path = os.path.join(CHAT_UPLOAD_DIR, stored_name)
        file.save(file_path)

        mime_type = file.content_type or 'application/octet-stream'

        upload_reply_to = None
        if reply_to_id:
            try:
                ref = db.chat_messages.find_one(
                    {'_id': ObjectId(reply_to_id), 'semester_id': semester_id}
                )
                if ref and not ref.get('deleted_for_everyone'):
                    upload_reply_to = {
                        'id': str(ref['_id']),
                        'text': (decrypt_text(ref.get('text')) or '')[:120],
                        'username': ref.get('username', ''),
                        'full_name': ref.get('full_name', ''),
                        'has_file': bool(ref.get('file')),
                    }
            except Exception:
                pass

        msg = {
            'semester_id': semester_id,
            'user_id': user_id,
            'username': username,
            'full_name': full_name,
            'text': encrypt_text(text) if text else None,
            'file': {
                'name': original_name,
                'path': os.path.join('uploads', 'chat', stored_name),
                'mime_type': mime_type,
                'size': size,
            },
            'created_at': datetime.now(timezone.utc),
        }
        if upload_reply_to:
            msg['reply_to'] = upload_reply_to
        result = db.chat_messages.insert_one(msg)
        msg['_id'] = result.inserted_id

        payload = _serialize_message(msg, profile_picture)
        socketio.emit('new_message', payload, to=semester_id)

        return jsonify({'message': payload}), 201
    except Exception as e:
        logger.error(f"upload_file error: {e}")
        return jsonify({'error': 'Failed to upload file'}), 500


# ─── REST: file serving ───────────────────────────────────────────────────────

@chat_bp.route('/file/<message_id>', methods=['GET'])
def serve_file(message_id):
    """Stream an uploaded chat file to the requesting member.
    Accepts JWT via Authorization header OR ?token= query param (needed for browser
    direct URL access: window.open, <img src>, <video src>, etc.)."""
    from database import get_db
    try:
        # Accept token from query param (browser direct requests) or header
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
        user_id = data['user_id']
        db = get_db()
        msg = db.chat_messages.find_one({'_id': ObjectId(message_id)})
        if not msg:
            return jsonify({'error': 'Message not found'}), 404
        if not _is_semester_member(db, msg['semester_id'], user_id):
            return jsonify({'error': 'Not a member'}), 403
        if msg.get('deleted_for_everyone'):
            return jsonify({'error': 'This file has been deleted'}), 410
        file_info = msg.get('file')
        if not file_info:
            return jsonify({'error': 'No file in this message'}), 404
        abs_path = os.path.join(os.getcwd(), file_info['path'])
        if not os.path.exists(abs_path):
            return jsonify({'error': 'File not found on disk'}), 404
        return send_file(
            abs_path,
            mimetype=file_info.get('mime_type', 'application/octet-stream'),
            as_attachment=False,
            download_name=file_info.get('name', 'file'),
        )
    except Exception as e:
        logger.error(f"serve_file error: {e}")
        return jsonify({'error': 'Failed to serve file'}), 500


# ─── REST: warn user ─────────────────────────────────────────────────────────

@chat_bp.route('/<semester_id>/warn', methods=['POST'])
@token_required
def warn_user(semester_id):
    """CR sends a private warning to one user — not stored in chat, not visible to others."""
    from database import get_db
    try:
        data = request.get_json()
        cr_id = request.user['user_id']
        target_user_id = (data.get('user_id') or '').strip()
        message_id = (data.get('message_id') or '').strip()
        reason = (data.get('reason') or '').strip()

        if not target_user_id:
            return jsonify({'error': 'user_id is required'}), 400

        db = get_db()
        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        if not _is_cr_or_mod(db, semester_id, cr_id):
            return jsonify({'error': 'Only a CR or moderator can warn users'}), 403

        cr_ids = [str(c) for c in semester.get('cr_ids', [])]
        if target_user_id in cr_ids:
            return jsonify({'error': 'Cannot warn a CR'}), 400

        cr = db.users.find_one({'_id': ObjectId(cr_id)}, {'fullName': 1, 'username': 1})
        target = db.users.find_one({'_id': ObjectId(target_user_id)}, {'fullName': 1, 'username': 1})
        if not target:
            return jsonify({'error': 'User not found'}), 404

        cr_name = cr.get('fullName') or cr.get('username', 'CR') if cr else 'CR'
        target_name = target.get('fullName') or target.get('username', '') if target else ''
        warn_type = (data.get('warn_type') or 'chat').strip()  # 'chat' | 'username' | 'picture'

        # Delete the offending message and notify all room members so it disappears instantly
        if message_id:
            try:
                _delete_message_and_cascade(db, message_id, semester_id)
                socketio.emit('message_deleted', {'message_id': message_id}, room=semester_id)
            except Exception as del_err:
                logger.warning(f"Could not delete message {message_id}: {del_err}")

        # Store warning so it shows as a one-time popup (even if user is offline)
        db.user_warnings.insert_one({
            'user_id': target_user_id,
            'warn_type': warn_type,
            'cr_name': cr_name,
            'reason': reason,
            'warned_name': target_name,
            'semester_id': semester_id,
            'shown': False,
            'created_at': datetime.now(timezone.utc),
        })

        # Send live socket notification too (for immediate display if user is online)
        target_sids = [
            sid for sid, u in _connected_users.items()
            if u['user_id'] == target_user_id
        ]
        payload = {
            'cr_name': cr_name, 'reason': reason,
            'warn_type': warn_type, 'warned_name': target_name,
        }
        for sid in target_sids:
            socketio.emit('warn_notification', payload, to=sid)

        return jsonify({'message': 'Warning sent', 'delivered': len(target_sids) > 0}), 200

    except Exception as e:
        logger.error(f"Warn user error: {e}")
        return jsonify({'error': 'Failed to warn user'}), 500


# ─── REST: user warnings (one-time popups) ───────────────────────────────────

@chat_bp.route('/my-warnings', methods=['GET'])
@token_required
def get_my_warnings():
    """Return unshown warnings for the current user."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        warnings = list(db.user_warnings.find(
            {'user_id': user_id, 'shown': False},
            sort=[('created_at', 1)]
        ))
        return jsonify({'warnings': [
            {
                'id': str(w['_id']),
                'warn_type': w.get('warn_type', 'chat'),
                'cr_name': w.get('cr_name', ''),
                'reason': w.get('reason', ''),
                'warned_name': w.get('warned_name', ''),
            }
            for w in warnings
        ]}), 200
    except Exception as e:
        logger.error(f"get_my_warnings error: {e}")
        return jsonify({'error': 'Failed to fetch warnings'}), 500


@chat_bp.route('/my-warnings/<warning_id>/dismiss', methods=['POST'])
@token_required
def dismiss_warning(warning_id):
    """Mark a warning as shown so it doesn't appear again."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        db.user_warnings.update_one(
            {'_id': ObjectId(warning_id), 'user_id': user_id},
            {'$set': {'shown': True}}
        )
        return jsonify({'message': 'Dismissed'}), 200
    except Exception as e:
        logger.error(f"dismiss_warning error: {e}")
        return jsonify({'error': 'Failed to dismiss warning'}), 500


# ─── REST: unread counts ──────────────────────────────────────────────────────

@chat_bp.route('/unread-counts', methods=['GET'])
@token_required
def get_unread_counts():
    """Return {semester_id: unread_count} for all semesters the user belongs to."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()

        try:
            oid = ObjectId(user_id)
        except Exception:
            return jsonify({'counts': {}}), 200

        # Find all classrooms user is a member of
        classrooms = list(db.classrooms.find({'members': oid}, {'_id': 1}))
        classroom_ids = [str(c['_id']) for c in classrooms]

        # Find all semesters for those classrooms
        semesters = list(db.semesters.find(
            {'classroom_id': {'$in': classroom_ids}},
            {'_id': 1}
        ))

        counts = {}
        for sem in semesters:
            sid = str(sem['_id'])
            last_read = db.chat_read_status.find_one(
                {'user_id': user_id, 'semester_id': sid}
            )
            cutoff = last_read['last_read_at'] if last_read else datetime(1970, 1, 1)
            count = db.chat_messages.count_documents({
                'semester_id': sid,
                'created_at': {'$gt': cutoff},
            })
            if count > 0:
                counts[sid] = count

        return jsonify({'counts': counts}), 200
    except Exception as e:
        logger.error(f"get_unread_counts error: {e}")
        return jsonify({'error': 'Failed to get unread counts'}), 500


# ─── REST: mark as read ───────────────────────────────────────────────────────

@chat_bp.route('/<semester_id>/read', methods=['POST'])
@token_required
def mark_read(semester_id):
    """Set last_read_at = now for the current user in this semester."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_semester_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        now = datetime.now(timezone.utc)
        db.chat_read_status.update_one(
            {'user_id': user_id, 'semester_id': semester_id},
            {'$set': {'last_read_at': now}},
            upsert=True,
        )
        socketio.emit('read_receipt', {'user_id': user_id, 'last_read_at': now.isoformat().replace('+00:00', '') + 'Z'}, to=semester_id)
        return jsonify({'message': 'Marked as read'}), 200
    except Exception as e:
        logger.error(f"mark_read error: {e}")
        return jsonify({'error': 'Failed to mark as read'}), 500


# ─── REST: message search ─────────────────────────────────────────────────────

@chat_bp.route('/<semester_id>/search', methods=['GET'])
@token_required
def search_messages(semester_id):
    """Full-text search on chat messages for a semester."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_semester_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        q = (request.args.get('q') or '').strip()
        if not q or len(q) < 2:
            return jsonify({'messages': []}), 200
        msgs = list(db.chat_messages.find(
            {
                'semester_id': semester_id,
                'text': {'$regex': re.escape(q), '$options': 'i'},
                'deleted_for_everyone': {'$ne': True},
                'hidden_for': {'$nin': [user_id]},
            },
            sort=[('created_at', -1)],
            limit=40,
        ))
        msgs.reverse()
        sender_ids = list({m['user_id'] for m in msgs if m.get('user_id')})
        pic_map = {}
        if sender_ids:
            for u in db.users.find(
                {'_id': {'$in': [ObjectId(uid) for uid in sender_ids]}},
                {'profile_picture': 1},
            ):
                pic_map[str(u['_id'])] = u.get('profile_picture')
        return jsonify({'messages': [
            _serialize_message(m, pic_map.get(m.get('user_id')))
            for m in msgs
        ]}), 200
    except Exception as e:
        logger.error(f"search_messages error: {e}")
        return jsonify({'error': 'Failed to search messages'}), 500


# ─── REST: polls ──────────────────────────────────────────────────────────────

@chat_bp.route('/<semester_id>/polls', methods=['POST'])
@token_required
def create_poll(semester_id):
    """CR creates a poll — broadcasts as a special message type."""
    from database import get_db
    try:
        data = request.get_json() or {}
        user_id = request.user['user_id']
        db = get_db()
        if not _is_semester_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        if not _is_cr_or_mod(db, semester_id, user_id):
            return jsonify({'error': 'Only a CR can create polls'}), 403
        question = (data.get('question') or '').strip()
        options_raw = data.get('options') or []
        options = [o.strip() for o in options_raw if isinstance(o, str) and o.strip()]
        if not question:
            return jsonify({'error': 'Question is required'}), 400
        if len(options) < 2:
            return jsonify({'error': 'At least 2 options are required'}), 400
        if len(options) > 6:
            return jsonify({'error': 'Maximum 6 options allowed'}), 400

        user_doc = db.users.find_one({'_id': ObjectId(user_id)}, {'fullName': 1, 'username': 1, 'profile_picture': 1})
        username = request.user.get('username', '')
        full_name = (user_doc.get('fullName') or '') if user_doc else ''
        profile_picture = (user_doc.get('profile_picture') or None) if user_doc else None

        msg = {
            'semester_id': semester_id,
            'user_id': user_id,
            'username': username,
            'full_name': full_name,
            'type': 'poll',
            'text': None,
            'file': None,
            'poll': {
                'question': question,
                'options': [{'text': o, 'voters': []} for o in options],
                'is_closed': False,
            },
            'created_at': datetime.now(timezone.utc),
        }
        result = db.chat_messages.insert_one(msg)
        msg['_id'] = result.inserted_id
        payload = _serialize_message(msg, profile_picture)
        socketio.emit('new_message', payload, to=semester_id)
        return jsonify({'message': payload}), 201
    except Exception as e:
        logger.error(f"create_poll error: {e}")
        return jsonify({'error': 'Failed to create poll'}), 500


@chat_bp.route('/<semester_id>/polls/<message_id>/vote', methods=['POST'])
@token_required
def vote_poll(semester_id, message_id):
    """Cast or change a vote on a poll."""
    from database import get_db
    try:
        data = request.get_json() or {}
        user_id = request.user['user_id']
        db = get_db()
        if not _is_semester_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        option_index = data.get('option_index')
        if option_index is None or not isinstance(option_index, int):
            return jsonify({'error': 'option_index is required'}), 400
        msg = db.chat_messages.find_one({'_id': ObjectId(message_id), 'semester_id': semester_id, 'type': 'poll'})
        if not msg:
            return jsonify({'error': 'Poll not found'}), 404
        poll = msg.get('poll', {})
        if poll.get('is_closed'):
            return jsonify({'error': 'Poll is closed'}), 400
        options = poll.get('options', [])
        if option_index < 0 or option_index >= len(options):
            return jsonify({'error': 'Invalid option'}), 400
        # Determine toggle: was user already on this option?
        was_on_same = user_id in (msg['poll']['options'][option_index].get('voters', []))
        # Build updated options in-memory: remove user from all, then add to chosen (unless toggling off)
        for opt in options:
            opt['voters'] = [v for v in opt.get('voters', []) if v != user_id]
        if not was_on_same:
            options[option_index]['voters'].append(user_id)
        # Write atomically — findAndModify pattern: only update if doc hasn't changed since we read it
        result = db.chat_messages.update_one(
            {'_id': ObjectId(message_id), 'poll.is_closed': {'$ne': True}},
            {'$set': {'poll.options': options}}
        )
        if result.matched_count == 0:
            return jsonify({'error': 'Poll is closed or no longer exists'}), 400
        # Re-fetch to get updated doc and serialize
        updated = db.chat_messages.find_one({'_id': ObjectId(message_id)})
        sender_doc = db.users.find_one({'_id': ObjectId(updated['user_id'])}, {'profile_picture': 1})
        pic = (sender_doc.get('profile_picture') or None) if sender_doc else None
        payload = _serialize_message(updated, pic)
        socketio.emit('poll_updated', payload, to=semester_id)
        return jsonify({'message': payload}), 200
    except Exception as e:
        logger.error(f"vote_poll error: {e}")
        return jsonify({'error': 'Failed to vote'}), 500


@chat_bp.route('/<semester_id>/polls/<message_id>/close', methods=['POST'])
@token_required
def close_poll(semester_id, message_id):
    """CR closes a poll, preventing further votes."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_cr_or_mod(db, semester_id, user_id):
            return jsonify({'error': 'Only a CR can close polls'}), 403
        existing = db.chat_messages.find_one(
            {'_id': ObjectId(message_id), 'semester_id': semester_id, 'type': 'poll'}
        )
        if not existing:
            return jsonify({'error': 'Poll not found'}), 404
        db.chat_messages.update_one(
            {'_id': ObjectId(message_id)},
            {'$set': {'poll.is_closed': True}}
        )
        updated = db.chat_messages.find_one({'_id': ObjectId(message_id)})
        sender_doc = db.users.find_one({'_id': ObjectId(updated['user_id'])}, {'profile_picture': 1})
        pic = (sender_doc.get('profile_picture') or None) if sender_doc else None
        payload = _serialize_message(updated, pic)
        socketio.emit('poll_updated', payload, to=semester_id)
        return jsonify({'message': payload}), 200
    except Exception as e:
        logger.error(f"close_poll error: {e}")
        return jsonify({'error': 'Failed to close poll'}), 500


# ─── REST: read receipts ──────────────────────────────────────────────────────

@chat_bp.route('/<semester_id>/read-receipts', methods=['GET'])
@token_required
def get_read_receipts(semester_id):
    """Return {user_id: last_read_at} for all members of this semester."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_semester_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        records = list(db.chat_read_status.find({'semester_id': semester_id}, {'_id': 0, 'user_id': 1, 'last_read_at': 1}))
        receipts = {r['user_id']: r['last_read_at'].isoformat().replace('+00:00', '') + 'Z' for r in records}
        return jsonify({'receipts': receipts}), 200
    except Exception as e:
        logger.error(f"get_read_receipts error: {e}")
        return jsonify({'error': 'Failed to get read receipts'}), 500


# ─── REST: reactions ──────────────────────────────────────────────────────────

@chat_bp.route('/<semester_id>/messages/<message_id>/react', methods=['POST'])
@token_required
def react_to_message(semester_id, message_id):
    """Toggle a reaction emoji on a message."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_semester_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        data = request.get_json() or {}
        emoji = (data.get('emoji') or '').strip()
        if not emoji:
            return jsonify({'error': 'emoji is required'}), 400
        msg = db.chat_messages.find_one({'_id': ObjectId(message_id), 'semester_id': semester_id})
        if not msg:
            return jsonify({'error': 'Message not found'}), 404

        reactions = toggle_reaction(msg.get('reactions', []), emoji, user_id)
        db.chat_messages.update_one({'_id': ObjectId(message_id)}, {'$set': {'reactions': reactions}})
        updated = db.chat_messages.find_one({'_id': ObjectId(message_id)})
        sender_doc = db.users.find_one({'_id': ObjectId(updated['user_id'])}, {'profile_picture': 1})
        pic = (sender_doc.get('profile_picture') or None) if sender_doc else None
        payload = _serialize_message(updated, pic)
        socketio.emit('reaction_updated', payload, to=semester_id)
        return jsonify({'message': payload}), 200
    except Exception as e:
        logger.error(f"react_to_message error: {e}")
        return jsonify({'error': 'Failed to react'}), 500


# ─── REST: global online status (for member cards / DMs) ──────────────────────

@chat_bp.route('/online-status', methods=['GET'])
@token_required
def get_online_status():
    """Return which of the requested user_ids are currently online (respecting privacy)."""
    from database import get_db
    try:
        user_ids = request.args.getlist('user_ids')
        if not user_ids:
            return jsonify({'online_user_ids': []}), 200
        socket_online = {u['user_id'] for u in _connected_users.values() if u['user_id'] in user_ids}
        if not socket_online:
            return jsonify({'online_user_ids': []}), 200
        # Always check DB for current privacy setting — cached value may be stale
        db = get_db()
        visible = db.users.find(
            {'_id': {'$in': [ObjectId(uid) for uid in socket_online]}, 'show_online_status': {'$ne': False}},
            {'_id': 1}
        )
        return jsonify({'online_user_ids': [str(u['_id']) for u in visible]}), 200
    except Exception as e:
        logger.error(f"get_online_status error: {e}")
        return jsonify({'online_user_ids': []}), 200


# ─── REST: online members ─────────────────────────────────────────────────────

@chat_bp.route('/<semester_id>/online-members', methods=['GET'])
@token_required
def get_online_members(semester_id):
    """Return user_ids currently online in this semester room (respecting privacy setting)."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_semester_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        # Collect user_ids that have joined this room
        socket_online = {
            u['user_id']
            for u in _connected_users.values()
            if semester_id in u.get('rooms', set())
        }
        if not socket_online:
            return jsonify({'online_user_ids': []}), 200
        # Always check DB for current privacy setting — cached value may be stale
        visible = db.users.find(
            {'_id': {'$in': [ObjectId(uid) for uid in socket_online]}, 'show_online_status': {'$ne': False}},
            {'_id': 1}
        )
        return jsonify({'online_user_ids': [str(u['_id']) for u in visible]}), 200
    except Exception as e:
        logger.error(f"get_online_members error: {e}")
        return jsonify({'online_user_ids': []}), 200


# ─── REST: pin / unpin message ────────────────────────────────────────────────

@chat_bp.route('/<semester_id>/pin', methods=['POST'])
@token_required
def pin_message(semester_id):
    """CR or mod pins a message. Up to 3 pinned messages (most recent first); oldest dropped when a 4th is added."""
    from database import get_db
    try:
        data = request.get_json()
        user_id = request.user['user_id']
        message_id = (data.get('message_id') or '').strip()
        if not message_id:
            return jsonify({'error': 'message_id is required'}), 400
        db = get_db()
        if not _is_cr_or_mod(db, semester_id, user_id):
            return jsonify({'error': 'Only a CR or moderator can pin messages'}), 403
        msg = db.chat_messages.find_one({'_id': ObjectId(message_id), 'semester_id': semester_id})
        if not msg:
            return jsonify({'error': 'Message not found'}), 404

        # Prepend to pinned_message_ids array, keep max 3 (newest first)
        semester_doc = db.semesters.find_one({'_id': ObjectId(semester_id)}, {'pinned_message_ids': 1})
        existing = list(semester_doc.get('pinned_message_ids') or [])
        # Remove if already pinned (re-pin moves it to front)
        existing = [mid for mid in existing if mid != message_id]
        existing.insert(0, message_id)
        existing = existing[:3]  # max 3

        db.semesters.update_one(
            {'_id': ObjectId(semester_id)},
            {'$set': {'pinned_message_ids': existing}}
        )
        sender_doc = db.users.find_one({'_id': ObjectId(msg['user_id'])}, {'profile_picture': 1}) if msg.get('user_id') else None
        pic = (sender_doc.get('profile_picture') or None) if sender_doc else None
        pinned_data = _serialize_message(msg, pic)
        socketio.emit('message_pinned', {'message': pinned_data, 'pinned_ids': existing}, room=semester_id)
        return jsonify({'message': 'Message pinned', 'pinned': pinned_data, 'pinned_ids': existing}), 200
    except Exception as e:
        logger.error(f"pin_message error: {e}")
        return jsonify({'error': 'Failed to pin message'}), 500


# ─── REST: delete message ─────────────────────────────────────────────────────

@chat_bp.route('/<semester_id>/messages/<message_id>', methods=['DELETE'])
@token_required
def delete_message(semester_id, message_id):
    """Delete a chat message. Author or CR/mod can delete. Cascades to academic resources."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_semester_member(db, semester_id, user_id):
            return jsonify({'error': 'Not a member'}), 403

        msg = db.chat_messages.find_one({'_id': ObjectId(message_id), 'semester_id': semester_id})
        if not msg:
            return jsonify({'error': 'Message not found'}), 404

        mode = request.args.get('mode', '')  # 'for_me' | 'for_everyone' | ''

        if mode == 'for_me':
            db.chat_messages.update_one(
                {'_id': ObjectId(message_id)},
                {'$addToSet': {'hidden_for': user_id}}
            )
            return jsonify({'message': 'Message hidden'}), 200

        if msg['user_id'] == user_id:
            if mode == 'for_everyone':
                # Delete physical file and linked academic resources first
                if msg.get('file') and msg['file'].get('path'):
                    try:
                        abs_path = os.path.join(os.getcwd(), msg['file']['path'])
                        if os.path.exists(abs_path):
                            os.remove(abs_path)
                    except OSError:
                        pass
                db.academic_resources.delete_many({'chat_message_id': str(msg['_id']), 'source': 'chat'})
                db.chat_messages.update_one(
                    {'_id': ObjectId(message_id)},
                    {'$set': {'deleted_for_everyone': True, 'text': None, 'file': None}}
                )
                socketio.emit('message_tombstoned', {'message_id': message_id}, room=semester_id)
                return jsonify({'message': 'Message deleted for everyone'}), 200
            else:
                _delete_message_and_cascade(db, message_id, semester_id)
                socketio.emit('message_deleted', {'message_id': message_id}, room=semester_id)
                return jsonify({'message': 'Message deleted'}), 200
        elif _is_cr_or_mod(db, semester_id, user_id):
            _delete_message_and_cascade(db, message_id, semester_id)
            socketio.emit('message_deleted', {'message_id': message_id}, room=semester_id)
            return jsonify({'message': 'Message deleted'}), 200
        else:
            return jsonify({'error': 'Not authorized'}), 403
    except Exception as e:
        logger.error(f"delete_message error: {e}")
        return jsonify({'error': 'Failed to delete message'}), 500


@chat_bp.route('/<semester_id>/pin', methods=['DELETE'])
@token_required
def unpin_message(semester_id):
    """CR or mod unpins a specific message (by message_id query param) or clears all pins."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        message_id = (request.args.get('message_id') or '').strip()
        db = get_db()
        if not _is_cr_or_mod(db, semester_id, user_id):
            return jsonify({'error': 'Only a CR or moderator can unpin messages'}), 403

        if message_id:
            # Remove specific message from the pinned list
            db.semesters.update_one(
                {'_id': ObjectId(semester_id)},
                {'$pull': {'pinned_message_ids': message_id}}
            )
            socketio.emit('message_unpinned', {'message_id': message_id}, room=semester_id)
        else:
            # Clear all pins
            db.semesters.update_one(
                {'_id': ObjectId(semester_id)},
                {'$set': {'pinned_message_ids': []}}
            )
            socketio.emit('message_unpinned', {'message_id': None}, room=semester_id)

        return jsonify({'message': 'Message unpinned'}), 200
    except Exception as e:
        logger.error(f"unpin_message error: {e}")
        return jsonify({'error': 'Failed to unpin message'}), 500
