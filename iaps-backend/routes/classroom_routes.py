from flask import Blueprint, request, jsonify
from flask_cors import cross_origin
from datetime import datetime
from bson import ObjectId
import logging
import os
import jwt
from functools import wraps

classroom_bp = Blueprint('classroom', __name__)
logger = logging.getLogger(__name__)

SECRET_KEY = os.getenv('SECRET_KEY', 'your-secret-key-change-this')

def token_required(f):
    """Decorator to protect routes"""
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

@classroom_bp.route('/create', methods=['POST'])
@cross_origin()
@token_required
def create_classroom():
    """Create a new classroom"""
    from database import get_db
    
    try:
        data = request.get_json()
        user_id = request.user['user_id']
        
        name = data.get('name', '').strip()
        description = data.get('description', '').strip()
        subject = data.get('subject', '').strip()
        
        if not name:
            return jsonify({'error': 'Classroom name is required'}), 400
        
        db = get_db()
        
        # Generate unique classroom code
        import random
        import string
        while True:
            code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
            if not db.classrooms.find_one({'code': code}):
                break
        
        classroom = {
            'name': name,
            'description': description,
            'subject': subject,
            'code': code,
            'teacher_id': ObjectId(user_id),
            'students': [],
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow()
        }
        
        result = db.classrooms.insert_one(classroom)
        classroom['_id'] = result.inserted_id
        
        return jsonify({
            'message': 'Classroom created successfully',
            'classroom': {
                'id': str(classroom['_id']),
                'name': classroom['name'],
                'description': classroom['description'],
                'subject': classroom['subject'],
                'code': classroom['code'],
                'teacher_id': str(classroom['teacher_id']),
                'created_at': classroom['created_at'].isoformat()
            }
        }), 201
        
    except Exception as e:
        logger.error(f"Create classroom error: {e}")
        return jsonify({'error': 'Failed to create classroom'}), 500

@classroom_bp.route('/join', methods=['POST'])
@cross_origin()
@token_required
def join_classroom():
    """Join a classroom using code"""
    from database import get_db
    
    try:
        data = request.get_json()
        user_id = request.user['user_id']
        code = data.get('code', '').strip().upper()
        
        if not code:
            return jsonify({'error': 'Classroom code is required'}), 400
        
        db = get_db()
        classroom = db.classrooms.find_one({'code': code})
        
        if not classroom:
            return jsonify({'error': 'Invalid classroom code'}), 404
        
        # Check if already a member
        student_id = ObjectId(user_id)
        if student_id in classroom.get('students', []):
            return jsonify({'error': 'You are already a member of this classroom'}), 400
        
        # Add student to classroom
        db.classrooms.update_one(
            {'_id': classroom['_id']},
            {
                '$push': {'students': student_id},
                '$set': {'updated_at': datetime.utcnow()}
            }
        )
        
        return jsonify({
            'message': 'Joined classroom successfully',
            'classroom': {
                'id': str(classroom['_id']),
                'name': classroom['name'],
                'description': classroom['description'],
                'subject': classroom['subject'],
                'code': classroom['code']
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Join classroom error: {e}")
        return jsonify({'error': 'Failed to join classroom'}), 500

@classroom_bp.route('/list', methods=['GET'])
@cross_origin()
@token_required
def list_classrooms():
    """List all classrooms for the user"""
    from database import get_db
    
    try:
        user_id = ObjectId(request.user['user_id'])
        db = get_db()
        
        # Get classrooms where user is teacher
        teacher_classrooms = list(db.classrooms.find({'teacher_id': user_id}))
        
        # Get classrooms where user is student
        student_classrooms = list(db.classrooms.find({'students': user_id}))
        
        def format_classroom(classroom):
            return {
                'id': str(classroom['_id']),
                'name': classroom['name'],
                'description': classroom.get('description', ''),
                'subject': classroom.get('subject', ''),
                'code': classroom['code'],
                'teacher_id': str(classroom['teacher_id']),
                'student_count': len(classroom.get('students', [])),
                'created_at': classroom['created_at'].isoformat()
            }
        
        return jsonify({
            'teacher_classrooms': [format_classroom(c) for c in teacher_classrooms],
            'student_classrooms': [format_classroom(c) for c in student_classrooms]
        }), 200
        
    except Exception as e:
        logger.error(f"List classrooms error: {e}")
        return jsonify({'error': 'Failed to retrieve classrooms'}), 500

@classroom_bp.route('/<classroom_id>', methods=['GET'])
@cross_origin()
@token_required
def get_classroom(classroom_id):
    """Get detailed classroom information"""
    from database import get_db
    
    try:
        user_id = ObjectId(request.user['user_id'])
        db = get_db()
        
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        
        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404
        
        # Check if user has access
        is_teacher = classroom['teacher_id'] == user_id
        is_student = user_id in classroom.get('students', [])
        
        if not (is_teacher or is_student):
            return jsonify({'error': 'Access denied'}), 403
        
        # Get teacher info
        teacher = db.users.find_one({'_id': classroom['teacher_id']})
        
        # Get students info
        students = list(db.users.find({'_id': {'$in': classroom.get('students', [])}}))
        
        return jsonify({
            'classroom': {
                'id': str(classroom['_id']),
                'name': classroom['name'],
                'description': classroom.get('description', ''),
                'subject': classroom.get('subject', ''),
                'code': classroom['code'] if is_teacher else None,
                'teacher': {
                    'id': str(teacher['_id']),
                    'username': teacher['username'],
                    'email': teacher['email'],
                    'profile_picture': teacher.get('profile_picture')
                },
                'students': [{
                    'id': str(s['_id']),
                    'username': s['username'],
                    'email': s['email'],
                    'profile_picture': s.get('profile_picture')
                } for s in students],
                'is_teacher': is_teacher,
                'created_at': classroom['created_at'].isoformat()
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Get classroom error: {e}")
        return jsonify({'error': 'Failed to retrieve classroom'}), 500

@classroom_bp.route('/<classroom_id>', methods=['PUT'])
@cross_origin()
@token_required
def update_classroom(classroom_id):
    """Update classroom details (teacher only)"""
    from database import get_db
    
    try:
        user_id = ObjectId(request.user['user_id'])
        data = request.get_json()
        db = get_db()
        
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        
        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404
        
        if classroom['teacher_id'] != user_id:
            return jsonify({'error': 'Only the teacher can update classroom'}), 403
        
        update_data = {}
        if 'name' in data:
            update_data['name'] = data['name'].strip()
        if 'description' in data:
            update_data['description'] = data['description'].strip()
        if 'subject' in data:
            update_data['subject'] = data['subject'].strip()
        
        if update_data:
            update_data['updated_at'] = datetime.utcnow()
            db.classrooms.update_one(
                {'_id': ObjectId(classroom_id)},
                {'$set': update_data}
            )
        
        return jsonify({'message': 'Classroom updated successfully'}), 200
        
    except Exception as e:
        logger.error(f"Update classroom error: {e}")
        return jsonify({'error': 'Failed to update classroom'}), 500

@classroom_bp.route('/<classroom_id>', methods=['DELETE'])
@cross_origin()
@token_required
def delete_classroom(classroom_id):
    """Delete classroom (teacher only)"""
    from database import get_db
    
    try:
        user_id = ObjectId(request.user['user_id'])
        db = get_db()
        
        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        
        if not classroom:
            return jsonify({'error': 'Classroom not found'}), 404
        
        if classroom['teacher_id'] != user_id:
            return jsonify({'error': 'Only the teacher can delete classroom'}), 403
        
        db.classrooms.delete_one({'_id': ObjectId(classroom_id)})
        
        return jsonify({'message': 'Classroom deleted successfully'}), 200
        
    except Exception as e:
        logger.error(f"Delete classroom error: {e}")
        return jsonify({'error': 'Failed to delete classroom'}), 500