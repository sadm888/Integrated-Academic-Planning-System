from flask import Blueprint, request, jsonify
from datetime import datetime, timedelta, timezone
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
import secrets
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


def _log_login_activity(db, user_id: str, ip: str, device: str, ua: str, status: str, ts):
    """Insert a login activity record (DRY helper for success/failed paths)."""
    db.login_activity.insert_one({
        'user_id': str(user_id),
        'ip': ip,
        'device': device,
        'user_agent': ua,
        'status': status,
        'logged_in_at': ts,
    })


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
        'profile_picture': user.get('profile_picture')
    }


@auth_bp.route('/signup', methods=['POST'])
@limiter.limit('10 per hour')
def signup():
    """Registration with email/password. Auto-logs in on success."""
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
        invite_token = data.get('invite_token', '').strip()

        if not all([username, email, password]):
            return jsonify({'error': 'Username, email and password are required'}), 400

        if len(password) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400

        db = get_db()

        if db.users.find_one({'email': email}):
            return jsonify({'error': 'Email already registered'}), 400

        if db.users.find_one({'username': username}):
            return jsonify({'error': 'Username already taken'}), 400

        # Validate invite token if provided (optional — signup works without one)
        if invite_token:
            now = datetime.now(timezone.utc)
            invite = db.invitations.find_one({'token': invite_token})
            if not invite or invite.get('expires_at', now) < now or invite.get('used'):
                return jsonify({'error': 'Invalid or expired invitation link'}), 400

        hashed_password = generate_password_hash(password)

        user = {
            'username': username,
            'email': email,
            'password': hashed_password,
            'fullName': full_name,
            'phone': phone,
            'college': college,
            'department': department,
            'auth_method': 'email',
            'created_at': datetime.now(timezone.utc),
            'profile_picture': None
        }

        result = db.users.insert_one(user)
        user['_id'] = result.inserted_id
        user_id = str(result.inserted_id)

        # Mark invite as used
        if invite_token:
            db.invitations.update_one({'token': invite_token}, {'$set': {'used': True, 'used_by': user_id}})

        token = create_token(user)
        return jsonify({
            'message': 'Account created successfully.',
            'token': token,
            'user': format_user(user),
        }), 201

    except Exception as e:
        logger.error(f"Signup error: {e}")
        return jsonify({'error': 'Registration failed'}), 500


@auth_bp.route('/send-invite', methods=['POST'])
@token_required
@limiter.limit('10 per hour')
def send_invite():
    """Send an invitation email to a new user (authenticated)."""
    from database import get_db
    from config import Config
    from utils.mailer import send_invite_email

    try:
        data = request.get_json()
        to_email = data.get('email', '').strip().lower()
        if not to_email:
            return jsonify({'error': 'Recipient email is required'}), 400

        db = get_db()

        if db.users.find_one({'email': to_email}):
            return jsonify({'error': 'That email already has an IAPS account'}), 400

        # Get inviter's display name
        from bson import ObjectId
        inviter = db.users.find_one({'_id': ObjectId(request.user['user_id'])})
        inviter_name = (inviter.get('fullName') or inviter.get('username') or 'A friend') if inviter else 'A friend'

        invite_token = secrets.token_urlsafe(32)
        db.invitations.insert_one({
            'token': invite_token,
            'invited_email': to_email,
            'invited_by': request.user['user_id'],
            'inviter_name': inviter_name,
            'created_at': datetime.now(timezone.utc),
            'expires_at': datetime.now(timezone.utc) + timedelta(days=7),
            'used': False,
        })

        inviter_email = inviter.get('email', '') if inviter else ''
        send_invite_email(to_email, inviter_name, inviter_email, invite_token, Config.FRONTEND_URL)
        return jsonify({'message': f'Invitation sent to {to_email}'}), 200

    except Exception as e:
        logger.error(f"Send invite error: {e}")
        return jsonify({'error': 'Failed to send invitation'}), 500


@auth_bp.route('/check-invite/<token>', methods=['GET'])
def check_invite(token):
    """Validate an invite token and return the inviter's name (used by Signup page)."""
    from database import get_db

    try:
        db = get_db()
        now = datetime.now(timezone.utc)
        invite = db.invitations.find_one({'token': token})

        if not invite or invite.get('expires_at', now) < now or invite.get('used'):
            return jsonify({'valid': False}), 200

        return jsonify({
            'valid': True,
            'inviter_name': invite.get('inviter_name', 'Someone'),
            'invited_email': invite.get('invited_email', ''),
        }), 200

    except Exception as e:
        logger.error(f"Check invite error: {e}")
        return jsonify({'valid': False}), 200


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
            _log_login_activity(db, user['_id'], ip, device, ua_string, 'failed', now)
            return jsonify({'error': 'Incorrect password'}), 401

        token = create_token(user)
        _log_login_activity(db, user['_id'], ip, device, ua_string, 'success', now)

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
