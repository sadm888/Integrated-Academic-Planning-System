"""User Model"""

from datetime import datetime

class UserModel:
    """User data model"""
    
    @staticmethod
    def create_user(email, username, password_hash, full_name=None, phone=None, college=None, department=None):
        """Create user document"""
        return {
            'email': email.lower().strip(),
            'username': username.strip(),
            'passwordHash': password_hash,
            'fullName': full_name.strip() if full_name else None,
            'phone': phone.strip() if phone else None,
            'college': college.strip() if college else None,
            'department': department.strip() if department else None,
            'isVerified': False,
            'createdAt': datetime.utcnow()
        }
    
    @staticmethod
    def to_dict(user):
        """Convert user document to safe dictionary"""
        if not user:
            return None
        return {
            '_id': str(user['_id']),
            'email': user['email'],
            'username': user['username'],
            'fullName': user.get('fullName'),
            'phone': user.get('phone'),
            'college': user.get('college'),
            'department': user.get('department'),
            'isVerified': user.get('isVerified', False),
            'createdAt': user.get('createdAt')
        }