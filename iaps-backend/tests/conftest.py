"""
Shared test fixtures for IAPS backend.

Uses mongomock so no running MongoDB is required for the route/unit tests.
"""
import os
import sys
import pytest
import mongomock
import jwt
from datetime import datetime, timedelta, timezone
from werkzeug.security import generate_password_hash

# Ensure the backend root is on sys.path so imports resolve
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Set test env vars before any app import
os.environ.setdefault('MONGO_URI', 'mongodb://localhost:27017/iaps_test')
os.environ.setdefault('JWT_SECRET', 'test-secret-key')
os.environ.setdefault('MAIL_SERVER', 'smtp.example.com')
os.environ.setdefault('MAIL_USERNAME', 'test@example.com')
os.environ.setdefault('MAIL_PASSWORD', 'testpass')
os.environ.setdefault('MAIL_DEFAULT_SENDER', 'test@example.com')

SECRET_KEY = os.environ['JWT_SECRET']


# ---------------------------------------------------------------------------
# App / client fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope='session')
def app():
    """Create Flask app in test mode, then replace its DB with mongomock."""
    from app import create_app
    flask_app = create_app()
    flask_app.config['TESTING'] = True
    flask_app.config['RATELIMIT_ENABLED'] = False

    # Now replace the live DB with a fresh mongomock instance
    import database
    mock_client = mongomock.MongoClient()
    mock_db = mock_client.get_database('iaps_test')
    database.db._db = mock_db
    database.db._client = mock_client

    flask_app._mock_db = mock_db  # store for easy access
    return flask_app


@pytest.fixture
def db(app):
    """Expose the mock db directly to tests."""
    return app._mock_db


@pytest.fixture(autouse=True)
def clean_db(db):
    """Wipe all collections before each test for isolation."""
    for col in db.list_collection_names():
        db.drop_collection(col)
    yield


@pytest.fixture
def client(app):
    """Flask test client."""
    with app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# Helper factories
# ---------------------------------------------------------------------------
def make_token(user_id: str, email: str = 'test@example.com') -> str:
    """Create a signed JWT for a given user_id."""
    payload = {
        'user_id': user_id,
        'email': email,
        'username': 'testuser',
        'exp': datetime.now(timezone.utc) + timedelta(days=1),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm='HS256')


def auth_header(token: str) -> dict:
    """Return Authorization header dict."""
    return {'Authorization': f'Bearer {token}'}


@pytest.fixture
def registered_user(db):
    """Insert a test user and return (user_dict, token)."""
    from bson import ObjectId
    user = {
        '_id': ObjectId(),
        'username': 'testuser',
        'email': 'test@example.com',
        'password': generate_password_hash('password123'),
        'fullName': 'Test User',
        'college': 'Test College',
        'department': 'CS',
        'phone': '1234567890',
        'is_verified': False,
        'auth_method': 'email',
        'created_at': datetime.now(timezone.utc),
        'profile_picture': None,
    }
    db.users.insert_one(user)
    token = make_token(str(user['_id']), user['email'])
    return user, token


@pytest.fixture
def second_user(db):
    """A second test user."""
    from bson import ObjectId
    user = {
        '_id': ObjectId(),
        'username': 'seconduser',
        'email': 'second@example.com',
        'password': generate_password_hash('password123'),
        'fullName': 'Second User',
        'college': 'Test College',
        'department': 'CS',
        'phone': '0987654321',
        'is_verified': False,
        'auth_method': 'email',
        'created_at': datetime.now(timezone.utc),
        'profile_picture': None,
    }
    db.users.insert_one(user)
    token = make_token(str(user['_id']), user['email'])
    return user, token
