from flask import Blueprint, request, jsonify
from datetime import datetime, timedelta, timezone
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
import logging

from middleware import token_required, SECRET_KEY
from limiter_instance import limiter

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')
logger = logging.getLogger(__name__)


def _parse_device(ua_string):
    """Parse a human-readable device label from a User-Agent string."""
    ua = ua_string or ''
    if 'Windows' in ua:
        os_name = 'Windows'
    elif 'Macintosh' in ua or 'Mac OS X' in ua:
        os_name = 'macOS'
    elif 'Android' in ua:
        os_name = 'Android'
    elif 'iPhone' in ua or 'iPad' in ua:
        os_name = 'iOS'
    elif 'Linux' in ua:
        os_name = 'Linux'
    else:
        os_name = 'Unknown OS'

    if 'Edg/' in ua:
        browser = 'Edge'
    elif 'OPR/' in ua or 'Opera' in ua:
        browser = 'Opera'
    elif 'Chrome/' in ua and 'Safari/' in ua:
        browser = 'Chrome'
    elif 'Firefox/' in ua:
        browser = 'Firefox'
    elif 'Safari/' in ua:
        browser = 'Safari'
    else:
        browser = 'Unknown Browser'

    return f'{browser} on {os_name}'


def create_token(user_data):
    """Create JWT token"""
    payload = {
        'user_id': str(user_data['_id']),
        'email': user_data['email'],
        'username': user_data.get('username', ''),
        'exp': datetime.now(timezone.utc) + timedelta(days=7)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')


def format_user(user):
    """Format user data for API response"""
    return {
        'id': str(user['_id']),
        'username': user['username'],
        'email': user['email'],
        'fullName': user.get('fullName'),
        'college': user.get('college'),
        'department': user.get('department'),
        'is_verified': user.get('is_verified', False),
        'profile_picture': user.get('profile_picture')
    }


@auth_bp.route('/signup', methods=['POST'])
@limiter.limit('10 per hour')
def signup():
    """Registration with email/password"""
    from database import get_db

    try:
        data = request.get_json()

        username = data.get('username', '').strip()
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        full_name = data.get('fullName', '').strip()
        phone = data.get('phone', '').strip()
        college = data.get('college', '').strip()
        department = data.get('department', '').strip()

        if not all([username, email, password]):
            return jsonify({'error': 'Username, email and password are required'}), 400

        if len(password) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400

        db = get_db()

        if db.users.find_one({'email': email}):
            return jsonify({'error': 'Email already registered'}), 400

        if db.users.find_one({'username': username}):
            return jsonify({'error': 'Username already taken'}), 400

        hashed_password = generate_password_hash(password)

        user = {
            'username': username,
            'email': email,
            'password': hashed_password,
            'fullName': full_name,
            'phone': phone,
            'college': college,
            'department': department,
            'is_verified': False,
            'auth_method': 'email',
            'created_at': datetime.now(timezone.utc),
            'profile_picture': None
        }

        result = db.users.insert_one(user)
        user['_id'] = result.inserted_id

        token = create_token(user)

        return jsonify({
            'message': 'Registration successful',
            'token': token,
            'user': format_user(user)
        }), 201

    except Exception as e:
        logger.error(f"Signup error: {e}")
        return jsonify({'error': 'Registration failed'}), 500


@auth_bp.route('/login', methods=['POST'])
@limiter.limit('20 per minute; 100 per hour')
def login():
    """Login with email + password"""
    from database import get_db

    try:
        data = request.get_json()

        email = data.get('email', '').strip().lower()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400

        db = get_db()

        user = db.users.find_one({
            '$or': [
                {'email': email},
                {'username': email}
            ]
        })

        ip = request.headers.get('X-Forwarded-For', request.remote_addr)
        ua_string = request.headers.get('User-Agent', '')
        device = _parse_device(ua_string)
        now = datetime.now(timezone.utc)

        if not user or 'password' not in user:
            return jsonify({'error': 'No account found with that email or username'}), 401

        if not check_password_hash(user.get('password', ''), password):
            db.login_activity.insert_one({
                'user_id': str(user['_id']),
                'ip': ip,
                'device': device,
                'user_agent': ua_string,
                'status': 'failed',
                'logged_in_at': now,
            })
            return jsonify({'error': 'Incorrect password'}), 401

        token = create_token(user)

        # Log successful login
        db.login_activity.insert_one({
            'user_id': str(user['_id']),
            'ip': ip,
            'device': device,
            'user_agent': ua_string,
            'status': 'success',
            'logged_in_at': now,
        })

        return jsonify({
            'message': 'Login successful',
            'token': token,
            'user': format_user(user)
        }), 200

    except Exception as e:
        logger.error(f"Login error: {e}")
        return jsonify({'error': 'Login failed'}), 500


@auth_bp.route('/verify', methods=['GET'])
@token_required
def verify_token():
    """Verify if token is valid and return user data"""
    from database import get_db
    from bson import ObjectId

    try:
        db = get_db()
        user = db.users.find_one({'_id': ObjectId(request.user['user_id'])})

        if not user:
            return jsonify({'error': 'User not found'}), 404

        return jsonify({
            'valid': True,
            'user': format_user(user)
        }), 200
    except Exception as e:
        logger.error(f"Verify error: {e}")
        return jsonify({'error': 'Verification failed'}), 500
