"""Shared authentication middleware"""
import jwt
import os
from functools import wraps
from flask import request, jsonify
from bson import ObjectId

SECRET_KEY = os.getenv('JWT_SECRET', 'dev-secret-change-in-production')


def token_required(f):
    """Decorator to protect routes - reads Bearer token from Authorization header"""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')

        if not token:
            return jsonify({'error': 'Token is missing'}), 401

        try:
            if token.startswith('Bearer '):
                token = token[7:]
            data = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
            request.user = data
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401

        return f(*args, **kwargs)

    return decorated


def get_current_user_id():
    """Get current user's ID as string from request.user"""
    return request.user['user_id']


def get_current_user_oid():
    """Get current user's ID as ObjectId from request.user"""
    return ObjectId(request.user['user_id'])


def is_member_of_classroom(classroom, user_id):
    """Check if a user is a member of a classroom (creator or joined member)"""
    user_oid = ObjectId(user_id) if isinstance(user_id, str) else user_id
    return user_oid in classroom.get('members', [])


def is_cr_of_semester(db, semester_id, user_id):
    """Check if user is a CR of the given semester"""
    semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
    if not semester:
        return False, None
    user_str = str(user_id) if not isinstance(user_id, str) else user_id
    is_cr = user_str in [str(cr) for cr in semester.get('cr_ids', [])]
    return is_cr, semester


def get_active_semester(db, classroom_id):
    """Get the currently active semester for a classroom"""
    return db.semesters.find_one({
        'classroom_id': str(classroom_id),
        'is_active': True
    })
