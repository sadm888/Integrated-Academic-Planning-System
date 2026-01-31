import jwt
import bcrypt
from datetime import datetime, timedelta
from functools import wraps
from flask import request, jsonify
from config import Config
from database import db
from bson import ObjectId

def hash_password(password):
    """Hash password using bcrypt"""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password, hashed):
    """Verify password against hash"""
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def generate_jwt(user_id):
    """Generate JWT token"""
    payload = {
        'user_id': str(user_id),
        'exp': datetime.utcnow() + Config.JWT_EXPIRATION,
        'iat': datetime.utcnow()
    }
    return jwt.encode(payload, Config.JWT_SECRET, algorithm='HS256')

def decode_jwt(token):
    """Decode and verify JWT token"""
    try:
        return jwt.decode(token, Config.JWT_SECRET, algorithms=['HS256'])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def get_token_from_cookie():
    """Extract JWT token from HTTP-only cookie"""
    return request.cookies.get('auth_token')

def require_auth(f):
    """Decorator to protect routes requiring authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = get_token_from_cookie()
        
        if not token:
            return jsonify({'error': 'Authentication required'}), 401
        
        payload = decode_jwt(token)
        if not payload:
            return jsonify({'error': 'Invalid or expired token'}), 401
        
        database = db.get_db()
        user = database.users.find_one({'_id': ObjectId(payload['user_id'])})
        
        if not user:
            return jsonify({'error': 'User not found'}), 401
        
        request.current_user = {
            '_id': str(user['_id']),
            'email': user['email'],
            'username': user['username'],
            'isVerified': user.get('isVerified', False)
        }
        
        return f(*args, **kwargs)
    
    return decorated_function

def require_verified_email(f):
    """Decorator to require verified email"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not request.current_user.get('isVerified'):
            return jsonify({'error': 'Email verification required'}), 403
        return f(*args, **kwargs)
    
    return decorated_function

def require_cr_access(f):
    """Decorator to require CR privileges in a semester session"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Try to get semester_id from different sources
        semester_id = None
        
        # Check JSON body
        if request.json:
            semester_id = request.json.get('semesterSessionId')
        
        # Check URL parameters
        if not semester_id and 'semester_id' in kwargs:
            semester_id = kwargs.get('semester_id')
        
        # Check query parameters
        if not semester_id:
            semester_id = request.args.get('semesterSessionId')
        
        if not semester_id:
            return jsonify({'error': 'Semester session ID required'}), 400
        
        database = db.get_db()
        semester = database.semester_sessions.find_one({'_id': ObjectId(semester_id)})
        
        if not semester:
            return jsonify({'error': 'Semester session not found'}), 404
        
        user_id = request.current_user['_id']
        if user_id not in [str(cr_id) for cr_id in semester.get('crIds', [])]:
            return jsonify({'error': 'CR privileges required'}), 403
        
        return f(*args, **kwargs)
    
    return decorated_function

def validate_email(email):
    """Basic email validation"""
    import re
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_password(password):
    """Validate password strength"""
    if len(password) < 8:
        return False, "Password must be at least 8 characters"
    if not any(c.isupper() for c in password):
        return False, "Password must contain at least one uppercase letter"
    if not any(c.islower() for c in password):
        return False, "Password must contain at least one lowercase letter"
    if not any(c.isdigit() for c in password):
        return False, "Password must contain at least one number"
    return True, "Password is valid"