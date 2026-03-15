"""dm_routes.py — Private direct messaging between classroom members and CRs.

REST:
  POST   /<classroom_id>/send                         — send text DM
  POST   /<classroom_id>/upload/<to_user_id>          — upload file DM
  GET    /<classroom_id>/thread/<with_user_id>        — message history
  POST   /<classroom_id>/thread/<with_user_id>/read   — mark thread as read
  GET    /unread-count                                — total unread DMs for current user
  DELETE /<classroom_id>/messages/<message_id>        — delete a DM message
  GET    /file/<message_id>                           — serve DM file
  GET    /<classroom_id>/member-stats                 — CR: per-member DM send counts

Socket:
  join_dm → join a two-user DM room
  dm_message (emit) → new DM delivered to recipient
  dm_message_deleted (emit) → DM deleted
"""

import os
import logging
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify, send_file
from flask_cors import cross_origin
from bson import ObjectId
import jwt
from werkzeug.utils import secure_filename

from middleware import token_required, SECRET_KEY
from socketio_instance import socketio
from utils.mime_check import is_dangerous

dm_bp = Blueprint('dm', __name__, url_prefix='/api/dm')
logger = logging.getLogger(__name__)

DM_UPLOAD_DIR = os.path.join(os.getcwd(), 'uploads', 'dm')
os.makedirs(DM_UPLOAD_DIR, exist_ok=True)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _dm_room(classroom_id, user_a, user_b):
    """Deterministic room name for a two-user DM thread in a classroom."""
    pair = '_'.join(sorted([user_a, user_b]))
    return f"dm_{classroom_id}_{pair}"


def _is_classroom_member(db, classroom_id, user_id):
    try:
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        return bool(classroom and user_id in [str(m) for m in classroom.get('members', [])])
    except Exception:
        return False


def _get_cr_ids(db, classroom_id):
    """Return CR ids from the active (or latest) semester of this classroom."""
    try:
        sem = db.semesters.find_one({'classroom_id': classroom_id, 'is_active': True})
        if not sem:
            sem = db.semesters.find_one({'classroom_id': classroom_id}, sort=[('created_at', -1)])
        return [str(c) for c in (sem.get('cr_ids', []) if sem else [])]
    except Exception:
        return []


def _serialize_dm(msg):
    deleted = msg.get('deleted_for_everyone', False)
    result = {
        'id': str(msg['_id']),
        'sender_id': msg['sender_id'],
        'sender_name': msg.get('sender_name', ''),
        'profile_picture': msg.get('profile_picture'),
        'text': None if deleted else msg.get('text'),
        'created_at': msg['created_at'].isoformat() + 'Z',
        'read_by': msg.get('read_by', []),
        'deleted_for_everyone': deleted,
    }
    if msg.get('file') and not deleted:
        result['file'] = msg['file']
    return result


# ─── Socket.IO: join DM room ──────────────────────────────────────────────────

@socketio.on('join_dm')
def handle_join_dm(data):
    """Verify both parties are classroom members, then subscribe socket to DM room."""
    from database import get_db
    from routes.chat_routes import _connected_users
    from flask_socketio import join_room

    user_data = _connected_users.get(request.sid)
    if not user_data:
        return

    classroom_id = (data.get('classroom_id') or '').strip()
    with_user_id = (data.get('with_user_id') or '').strip()
    if not classroom_id or not with_user_id:
        return

    db = get_db()
    user_id = user_data['user_id']
    if not _is_classroom_member(db, classroom_id, user_id):
        return
    if not _is_classroom_member(db, classroom_id, with_user_id):
        return

    room = _dm_room(classroom_id, user_id, with_user_id)
    join_room(room)


# ─── REST: send text DM ───────────────────────────────────────────────────────

@dm_bp.route('/<classroom_id>/send', methods=['POST'])
@cross_origin()
@token_required
def send_dm(classroom_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()

        if not _is_classroom_member(db, classroom_id, user_id):
            return jsonify({'error': 'Not a member'}), 403

        data = request.get_json()
        to_user_id = (data.get('to_user_id') or '').strip()
        text = (data.get('text') or '').strip() or None

        if not to_user_id:
            return jsonify({'error': 'to_user_id required'}), 400
        if not text:
            return jsonify({'error': 'Message text required'}), 400
        if not _is_classroom_member(db, classroom_id, to_user_id):
            return jsonify({'error': 'Recipient is not a member'}), 400

        # Non-CRs can only DM CRs
        cr_ids = _get_cr_ids(db, classroom_id)
        if user_id not in cr_ids and to_user_id not in cr_ids:
            return jsonify({'error': 'You can only send personal messages to a CR'}), 403

        sender_doc = db.users.find_one(
            {'_id': ObjectId(user_id)}, {'fullName': 1, 'username': 1, 'profile_picture': 1}
        )
        sender_name = (sender_doc.get('fullName') or sender_doc.get('username', '')) if sender_doc else ''
        profile_picture = (sender_doc.get('profile_picture') or None) if sender_doc else None

        msg = {
            'classroom_id': classroom_id,
            'sender_id': user_id,
            'receiver_id': to_user_id,
            'sender_name': sender_name,
            'profile_picture': profile_picture,
            'text': text,
            'file': None,
            'created_at': datetime.now(timezone.utc),
            'read_by': [user_id],
        }
        result = db.dm_messages.insert_one(msg)
        msg['_id'] = result.inserted_id
        payload = _serialize_dm(msg)
        socketio.emit('dm_message', payload, to=_dm_room(classroom_id, user_id, to_user_id))
        return jsonify({'message': payload}), 201

    except Exception as e:
        logger.error(f"send_dm error: {e}")
        return jsonify({'error': 'Failed to send message'}), 500


# ─── REST: upload file DM ─────────────────────────────────────────────────────

@dm_bp.route('/<classroom_id>/upload/<to_user_id>', methods=['POST'])
@cross_origin()
@token_required
def upload_dm_file(classroom_id, to_user_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()

        if not _is_classroom_member(db, classroom_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        if not _is_classroom_member(db, classroom_id, to_user_id):
            return jsonify({'error': 'Recipient not found'}), 400

        cr_ids = _get_cr_ids(db, classroom_id)
        if user_id not in cr_ids and to_user_id not in cr_ids:
            return jsonify({'error': 'You can only send personal messages to a CR'}), 403

        file = request.files.get('file')
        text = (request.form.get('text') or '').strip() or None

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
        file.save(os.path.join(DM_UPLOAD_DIR, stored_name))
        mime_type = file.content_type or 'application/octet-stream'

        sender_doc = db.users.find_one(
            {'_id': ObjectId(user_id)}, {'fullName': 1, 'username': 1, 'profile_picture': 1}
        )
        sender_name = (sender_doc.get('fullName') or sender_doc.get('username', '')) if sender_doc else ''
        profile_picture = (sender_doc.get('profile_picture') or None) if sender_doc else None

        msg = {
            'classroom_id': classroom_id,
            'sender_id': user_id,
            'receiver_id': to_user_id,
            'sender_name': sender_name,
            'profile_picture': profile_picture,
            'text': text,
            'file': {
                'name': original_name,
                'path': os.path.join('uploads', 'dm', stored_name),
                'mime_type': mime_type,
                'size': size,
            },
            'created_at': datetime.now(timezone.utc),
            'read_by': [user_id],
        }
        result = db.dm_messages.insert_one(msg)
        msg['_id'] = result.inserted_id
        payload = _serialize_dm(msg)
        socketio.emit('dm_message', payload, to=_dm_room(classroom_id, user_id, to_user_id))
        return jsonify({'message': payload}), 201

    except Exception as e:
        logger.error(f"upload_dm_file error: {e}")
        return jsonify({'error': 'Failed to upload file'}), 500


# ─── REST: thread history ─────────────────────────────────────────────────────

@dm_bp.route('/<classroom_id>/thread/<with_user_id>', methods=['GET'])
@cross_origin()
@token_required
def get_dm_thread(classroom_id, with_user_id):
    from database import get_db
    try:
        me = request.user['user_id']
        db = get_db()

        if not _is_classroom_member(db, classroom_id, me):
            return jsonify({'error': 'Not a member'}), 403

        limit = min(int(request.args.get('limit', 50)), 200)
        before_id = request.args.get('before_id', '')

        query = {
            'classroom_id': classroom_id,
            '$or': [
                {'sender_id': me, 'receiver_id': with_user_id},
                {'sender_id': with_user_id, 'receiver_id': me},
            ],
            'hidden_for': {'$nin': [me]},
        }
        if before_id:
            try:
                query['_id'] = {'$lt': ObjectId(before_id)}
            except Exception:
                pass

        msgs = list(db.dm_messages.find(query, sort=[('created_at', -1)], limit=limit))
        msgs.reverse()
        return jsonify({'messages': [_serialize_dm(m) for m in msgs]}), 200

    except Exception as e:
        logger.error(f"get_dm_thread error: {e}")
        return jsonify({'error': 'Failed to fetch messages'}), 500


# ─── REST: mark thread as read ────────────────────────────────────────────────

@dm_bp.route('/<classroom_id>/thread/<with_user_id>/read', methods=['POST'])
@cross_origin()
@token_required
def mark_dm_read(classroom_id, with_user_id):
    from database import get_db
    try:
        me = request.user['user_id']
        db = get_db()
        db.dm_messages.update_many(
            {'classroom_id': classroom_id, 'sender_id': with_user_id, 'receiver_id': me, 'read_by': {'$ne': me}},
            {'$addToSet': {'read_by': me}},
        )
        # Notify the sender that their messages were read
        room = _dm_room(classroom_id, me, with_user_id)
        socketio.emit('dm_read', {'reader_id': me}, to=room)
        return jsonify({'message': 'Marked as read'}), 200
    except Exception as e:
        logger.error(f"mark_dm_read error: {e}")
        return jsonify({'error': 'Failed to mark as read'}), 500


# ─── REST: total unread count ─────────────────────────────────────────────────

@dm_bp.route('/unread-count', methods=['GET'])
@cross_origin()
@token_required
def get_dm_unread_count():
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        count = db.dm_messages.count_documents({
            'receiver_id': user_id,
            'read_by': {'$ne': user_id},
        })
        return jsonify({'count': count}), 200
    except Exception as e:
        logger.error(f"get_dm_unread_count error: {e}")
        return jsonify({'error': 'Failed to get count'}), 500


# ─── REST: unread count per classroom ─────────────────────────────────────────

@dm_bp.route('/unread-by-classroom', methods=['GET'])
@cross_origin()
@token_required
def get_dm_unread_by_classroom():
    """Return { classroom_id: unread_count } for all classrooms with unread DMs."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        pipeline = [
            {'$match': {'receiver_id': user_id, 'read_by': {'$ne': user_id}}},
            {'$group': {'_id': '$classroom_id', 'count': {'$sum': 1}}},
        ]
        stats = list(db.dm_messages.aggregate(pipeline))
        return jsonify({'counts': {s['_id']: s['count'] for s in stats}}), 200
    except Exception as e:
        logger.error(f"get_dm_unread_by_classroom error: {e}")
        return jsonify({'error': 'Failed to get counts'}), 500


# ─── REST: delete message ─────────────────────────────────────────────────────

@dm_bp.route('/<classroom_id>/messages/<message_id>', methods=['DELETE'])
@cross_origin()
@token_required
def delete_dm_message(classroom_id, message_id):
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        msg = db.dm_messages.find_one({'_id': ObjectId(message_id), 'classroom_id': classroom_id})
        if not msg:
            return jsonify({'error': 'Message not found'}), 404
        if msg['sender_id'] != user_id:
            return jsonify({'error': 'Not authorized'}), 403

        mode = request.args.get('mode', '')  # 'for_me' | 'for_everyone' | ''
        room = _dm_room(classroom_id, msg['sender_id'], msg['receiver_id'])

        if mode == 'for_me':
            db.dm_messages.update_one(
                {'_id': ObjectId(message_id)},
                {'$addToSet': {'hidden_for': user_id}}
            )
            return jsonify({'message': 'Message hidden'}), 200
        elif mode == 'for_everyone':
            db.dm_messages.update_one(
                {'_id': ObjectId(message_id)},
                {'$set': {'deleted_for_everyone': True, 'text': None, 'file': None}}
            )
            socketio.emit('dm_message_tombstoned', {'message_id': message_id}, to=room)
            return jsonify({'message': 'Message deleted for everyone'}), 200
        else:
            if msg.get('file') and msg['file'].get('path'):
                try:
                    abs_path = os.path.join(os.getcwd(), msg['file']['path'])
                    if os.path.exists(abs_path):
                        os.remove(abs_path)
                except OSError:
                    pass
            db.dm_messages.delete_one({'_id': ObjectId(message_id)})
            socketio.emit('dm_message_deleted', {'message_id': message_id}, to=room)
            return jsonify({'message': 'Deleted'}), 200

    except Exception as e:
        logger.error(f"delete_dm_message error: {e}")
        return jsonify({'error': 'Failed to delete'}), 500


# ─── REST: file serving ───────────────────────────────────────────────────────

@dm_bp.route('/file/<message_id>', methods=['GET'])
@cross_origin()
def serve_dm_file(message_id):
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

        user_id = data['user_id']
        db = get_db()
        msg = db.dm_messages.find_one({'_id': ObjectId(message_id)})
        if not msg:
            return jsonify({'error': 'Message not found'}), 404
        if msg['sender_id'] != user_id and msg['receiver_id'] != user_id:
            return jsonify({'error': 'Not authorized'}), 403

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
        logger.error(f"serve_dm_file error: {e}")
        return jsonify({'error': 'Failed to serve file'}), 500


# ─── REST: unread count per sender in a classroom ────────────────────────────

@dm_bp.route('/<classroom_id>/unread-by-sender', methods=['GET'])
@cross_origin()
@token_required
def get_unread_by_sender(classroom_id):
    """Return { sender_id: unread_count } for all threads the current user has unread messages in."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_classroom_member(db, classroom_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        pipeline = [
            {'$match': {'receiver_id': user_id, 'classroom_id': classroom_id, 'read_by': {'$ne': user_id}}},
            {'$group': {'_id': '$sender_id', 'count': {'$sum': 1}}},
        ]
        stats = list(db.dm_messages.aggregate(pipeline))
        return jsonify({'unread': {s['_id']: s['count'] for s in stats}}), 200
    except Exception as e:
        logger.error(f"get_unread_by_sender error: {e}")
        return jsonify({'error': 'Failed to get unread counts'}), 500


# ─── REST: member DM stats (CR only) ─────────────────────────────────────────

@dm_bp.route('/<classroom_id>/member-stats', methods=['GET'])
@cross_origin()
@token_required
def get_member_dm_stats(classroom_id):
    """Return per-member outbound DM count in this classroom (CR only)."""
    from database import get_db
    try:
        user_id = request.user['user_id']
        db = get_db()
        if not _is_classroom_member(db, classroom_id, user_id):
            return jsonify({'error': 'Not a member'}), 403
        cr_ids = _get_cr_ids(db, classroom_id)
        if user_id not in cr_ids:
            return jsonify({'error': 'CR only'}), 403

        pipeline = [
            {'$match': {'classroom_id': classroom_id}},
            {'$group': {'_id': '$sender_id', 'count': {'$sum': 1}}},
        ]
        stats = list(db.dm_messages.aggregate(pipeline))
        return jsonify({'stats': {s['_id']: s['count'] for s in stats}}), 200

    except Exception as e:
        logger.error(f"get_member_dm_stats error: {e}")
        return jsonify({'error': 'Failed to get stats'}), 500
