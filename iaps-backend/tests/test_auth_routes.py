"""Tests for routes/auth_routes.py"""
import pytest
import json
from bson import ObjectId
from werkzeug.security import generate_password_hash


class TestSignup:
    def test_signup_success(self, client):
        resp = client.post('/api/auth/signup', json={
            'username': 'newuser',
            'email': 'new@example.com',
            'password': 'securepass123',
            'fullName': 'New User',
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert 'token' in data
        assert data['user']['email'] == 'new@example.com'
        assert data['user']['username'] == 'newuser'

    def test_signup_missing_username(self, client):
        resp = client.post('/api/auth/signup', json={
            'email': 'new@example.com',
            'password': 'securepass123',
        })
        assert resp.status_code == 400
        assert 'required' in resp.get_json()['error'].lower()

    def test_signup_missing_email(self, client):
        resp = client.post('/api/auth/signup', json={
            'username': 'newuser',
            'password': 'securepass123',
        })
        assert resp.status_code == 400

    def test_signup_missing_password(self, client):
        resp = client.post('/api/auth/signup', json={
            'username': 'newuser',
            'email': 'new@example.com',
        })
        assert resp.status_code == 400

    def test_signup_short_password(self, client):
        resp = client.post('/api/auth/signup', json={
            'username': 'newuser',
            'email': 'new@example.com',
            'password': 'short',
        })
        assert resp.status_code == 400
        assert '8' in resp.get_json()['error']

    def test_signup_duplicate_email(self, client, registered_user):
        user, _ = registered_user
        resp = client.post('/api/auth/signup', json={
            'username': 'otherusername',
            'email': user['email'],
            'password': 'securepass123',
        })
        assert resp.status_code == 400
        assert 'email' in resp.get_json()['error'].lower()

    def test_signup_duplicate_username(self, client, registered_user):
        user, _ = registered_user
        resp = client.post('/api/auth/signup', json={
            'username': user['username'],
            'email': 'other@example.com',
            'password': 'securepass123',
        })
        assert resp.status_code == 400
        assert 'username' in resp.get_json()['error'].lower()

    def test_signup_returns_user_fields(self, client):
        resp = client.post('/api/auth/signup', json={
            'username': 'fieldtest',
            'email': 'fields@example.com',
            'password': 'securepass123',
            'fullName': 'Field Test',
            'college': 'Test College',
            'department': 'CS',
        })
        assert resp.status_code == 201
        user = resp.get_json()['user']
        assert 'id' in user
        assert 'email' in user
        assert 'username' in user
        assert 'password' not in user  # password must never be returned


class TestLogin:
    def test_login_success_with_email(self, client, registered_user):
        user, _ = registered_user
        resp = client.post('/api/auth/login', json={
            'email': user['email'],
            'password': 'password123',
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'token' in data
        assert data['user']['email'] == user['email']

    def test_login_success_with_username(self, client, registered_user):
        user, _ = registered_user
        resp = client.post('/api/auth/login', json={
            'email': user['username'],   # the endpoint accepts username in 'email' field
            'password': 'password123',
        })
        assert resp.status_code == 200

    def test_login_wrong_password(self, client, registered_user):
        user, _ = registered_user
        resp = client.post('/api/auth/login', json={
            'email': user['email'],
            'password': 'wrongpassword',
        })
        assert resp.status_code == 401
        assert 'Invalid credentials' in resp.get_json()['error']

    def test_login_nonexistent_user(self, client):
        resp = client.post('/api/auth/login', json={
            'email': 'nobody@example.com',
            'password': 'password123',
        })
        assert resp.status_code == 401

    def test_login_missing_email(self, client):
        resp = client.post('/api/auth/login', json={'password': 'password123'})
        assert resp.status_code == 400

    def test_login_missing_password(self, client):
        resp = client.post('/api/auth/login', json={'email': 'test@example.com'})
        assert resp.status_code == 400

    def test_login_password_not_in_response(self, client, registered_user):
        user, _ = registered_user
        resp = client.post('/api/auth/login', json={
            'email': user['email'], 'password': 'password123'
        })
        assert resp.status_code == 200
        assert 'password' not in resp.get_json()['user']


class TestVerifyToken:
    def test_verify_valid_token(self, client, registered_user):
        user, token = registered_user
        resp = client.get('/api/auth/verify',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['valid'] is True
        assert data['user']['email'] == user['email']

    def test_verify_no_token(self, client):
        resp = client.get('/api/auth/verify')
        assert resp.status_code == 401

    def test_verify_bad_token(self, client):
        resp = client.get('/api/auth/verify',
                          headers={'Authorization': 'Bearer garbage'})
        assert resp.status_code == 401

    def test_verify_user_not_in_db(self, client, db):
        import jwt as pyjwt
        from datetime import datetime, timedelta
        # Token for a non-existent user
        token = pyjwt.encode({
            'user_id': str(ObjectId()),
            'email': 'ghost@example.com',
            'username': 'ghost',
            'exp': datetime.utcnow() + timedelta(days=1),
        }, 'test-secret-key', algorithm='HS256')
        resp = client.get('/api/auth/verify',
                          headers={'Authorization': f'Bearer {token}'})
        assert resp.status_code == 404
