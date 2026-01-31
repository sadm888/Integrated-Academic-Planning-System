from flask import Blueprint, request, jsonify
from flask_cors import cross_origin
import requests
import os
from datetime import datetime, timedelta
import jwt
from functools import wraps
import logging

auth_bp = Blueprint('auth', __name__)
logger = logging.getLogger(__name__)

# Configuration
SECRET_KEY = os.getenv('SECRET_KEY', 'your-secret-key-change-this')
RECAPTCHA_SECRET_KEY = os.getenv('RECAPTCHA_SECRET_KEY')

def verify_recaptcha(token):
    """Verify reCAPTCHA token with Google"""
    if not RECAPTCHA_SECRET_KEY:
        logger.warning("RECAPTCHA_SECRET_KEY not set, skipping verification")
        return True
    
    try:
        response = requests.post(
            'https://www.google.com/recaptcha/api/siteverify',
            data={
                'secret': RECAPTCHA_SECRET_KEY,
                'response': token
            },
            timeout=5
        )
        result = response.json()
        return result.get('success', False) and result.get('score', 0) > 0.5
    except Exception as e:
        logger.error(f"reCAPTCHA verification error: {e}")
        return False

def create_token(user_data):
    """Create JWT token"""
    payload = {
        'user_id': str(user_data['_id']),
        'email': user_data['email'],
        'username': user_data.get('username', ''),
        'exp': datetime.utcnow() + timedelta(days=7)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')

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

@auth_bp.route('/register', methods=['POST'])
@cross_origin()
def register():
    """Registration with email/password and additional info"""
    from database import get_db
    
    try:
        data = request.get_json()
        
        # Verify reCAPTCHA
        captcha_token = data.get('captchaToken')
        if captcha_token and not verify_recaptcha(captcha_token):
            return jsonify({'error': 'Invalid reCAPTCHA. Please try again.'}), 400
        
        username = data.get('username', '').strip()
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        full_name = data.get('fullName', '').strip()
        phone_number = data.get('phoneNumber', '').strip()
        
        if not all([username, email, password]):
            return jsonify({'error': 'Username, email and password are required'}), 400
        
        if len(password) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400
        
        db = get_db()
        
        # Check if user exists
        if db.users.find_one({'email': email}):
            return jsonify({'error': 'Email already registered'}), 400
        
        if db.users.find_one({'username': username}):
            return jsonify({'error': 'Username already taken'}), 400
        
        # Hash password
        from werkzeug.security import generate_password_hash
        hashed_password = generate_password_hash(password)
        
        # Create user
        user = {
            'username': username,
            'email': email,
            'password': hashed_password,
            'full_name': full_name,
            'phone_number': phone_number,
            'auth_method': 'email',
            'created_at': datetime.utcnow(),
            'profile_picture': None
        }
        
        result = db.users.insert_one(user)
        user['_id'] = result.inserted_id
        
        # Create token
        token = create_token(user)
        
        return jsonify({
            'message': 'Registration successful',
            'token': token,
            'user': {
                'id': str(user['_id']),
                'username': user['username'],
                'email': user['email'],
                'full_name': user.get('full_name'),
                'profile_picture': user.get('profile_picture')
            }
        }), 201
        
    except Exception as e:
        logger.error(f"Registration error: {e}")
        return jsonify({'error': 'Registration failed'}), 500

@auth_bp.route('/login', methods=['POST'])
@cross_origin()
def login():
    """Login with username OR email + password"""
    from database import get_db
    
    try:
        data = request.get_json()
        
        # Verify reCAPTCHA
        captcha_token = data.get('captchaToken')
        if captcha_token and not verify_recaptcha(captcha_token):
            return jsonify({'error': 'Invalid reCAPTCHA. Please try again.'}), 400
        
        username_or_email = data.get('usernameOrEmail', '').strip().lower()
        password = data.get('password', '')
        
        if not username_or_email or not password:
            return jsonify({'error': 'Username/Email and password are required'}), 400
        
        db = get_db()
        
        # Try to find user by email OR username
        user = db.users.find_one({
            '$or': [
                {'email': username_or_email},
                {'username': username_or_email}
            ]
        })
        
        if not user:
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Verify password
        from werkzeug.security import check_password_hash
        if 'password' not in user or not check_password_hash(user['password'], password):
            return jsonify({'error': 'Invalid credentials'}), 401
        
        # Create token
        token = create_token(user)
        
        return jsonify({
            'message': 'Login successful',
            'token': token,
            'user': {
                'id': str(user['_id']),
                'username': user['username'],
                'email': user['email'],
                'full_name': user.get('full_name'),
                'profile_picture': user.get('profile_picture')
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Login error: {e}")
        return jsonify({'error': 'Login failed'}), 500

@auth_bp.route('/google/login', methods=['POST'])
@cross_origin()
def google_login():
    """Google OAuth login - shows account picker popup"""
    from database import get_db
    
    try:
        data = request.get_json()
        google_token = data.get('credential')
        
        if not google_token:
            return jsonify({'error': 'Google token is required'}), 400
        
        # Verify Google token
        response = requests.get(
            'https://www.googleapis.com/oauth2/v3/tokeninfo',
            params={'id_token': google_token},
            timeout=5
        )
        
        if response.status_code != 200:
            return jsonify({'error': 'Invalid Google token'}), 401
        
        google_data = response.json()
        email = google_data.get('email', '').lower()
        google_id = google_data.get('sub')
        name = google_data.get('name', '')
        picture = google_data.get('picture', '')
        
        if not email or not google_id:
            return jsonify({'error': 'Could not retrieve user data from Google'}), 400
        
        db = get_db()
        
        # Check if user exists
        user = db.users.find_one({'email': email})
        
        if user:
            # Update existing user
            db.users.update_one(
                {'_id': user['_id']},
                {
                    '$set': {
                        'google_id': google_id,
                        'profile_picture': picture,
                        'last_login': datetime.utcnow()
                    }
                }
            )
        else:
            # Create new user from Google account
            username = email.split('@')[0]
            base_username = username
            counter = 1
            
            # Ensure unique username
            while db.users.find_one({'username': username}):
                username = f"{base_username}{counter}"
                counter += 1
            
            user = {
                'username': username,
                'email': email,
                'google_id': google_id,
                'full_name': name,
                'auth_method': 'google',
                'profile_picture': picture,
                'created_at': datetime.utcnow(),
                'last_login': datetime.utcnow()
            }
            
            result = db.users.insert_one(user)
            user['_id'] = result.inserted_id
        
        # Create token
        token = create_token(user)
        
        return jsonify({
            'message': 'Login successful',
            'token': token,
            'user': {
                'id': str(user['_id']),
                'username': user['username'],
                'email': user['email'],
                'full_name': user.get('full_name'),
                'profile_picture': user.get('profile_picture')
            }
        }), 200
        
    except requests.RequestException as e:
        logger.error(f"Google API error: {e}")
        return jsonify({'error': 'Failed to communicate with Google'}), 500
    except Exception as e:
        logger.error(f"Google login error: {e}")
        return jsonify({'error': 'Login failed'}), 500

@auth_bp.route('/verify', methods=['GET'])
@cross_origin()
@token_required
def verify_token():
    """Verify if token is valid"""
    return jsonify({
        'valid': True,
        'user': request.user
    }), 200