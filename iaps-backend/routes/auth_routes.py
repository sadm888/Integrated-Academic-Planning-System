from flask import Blueprint, request, jsonify
from flask_cors import cross_origin
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
import logging

from middleware import token_required, SECRET_KEY

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')
logger = logging.getLogger(__name__)


def create_token(user_data):
    """Create JWT token"""
    payload = {
        'user_id': str(user_data['_id']),
        'email': user_data['email'],
        'username': user_data.get('username', ''),
        'exp': datetime.utcnow() + timedelta(days=7)
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
@cross_origin()
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
            'created_at': datetime.utcnow(),
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
@cross_origin()
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

        if not user:
            return jsonify({'error': 'Invalid credentials'}), 401

        if 'password' not in user or not check_password_hash(user['password'], password):
            return jsonify({'error': 'Invalid credentials'}), 401

        token = create_token(user)

        return jsonify({
            'message': 'Login successful',
            'token': token,
            'user': format_user(user)
        }), 200

    except Exception as e:
        logger.error(f"Login error: {e}")
        return jsonify({'error': 'Login failed'}), 500


@auth_bp.route('/verify', methods=['GET'])
@cross_origin()
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
