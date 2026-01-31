"""Classroom Model"""

from datetime import datetime

class ClassroomModel:
    """Classroom data model"""
    
    @staticmethod
    def create_classroom(name, created_by, join_code):
        """Create classroom document"""
        return {
            'name': name.strip(),
            'createdBy': created_by,
            'members': [created_by],
            'joinCode': join_code,
            'joinRequests': [],
            'createdAt': datetime.utcnow()
        }
    
    @staticmethod
    def to_dict(classroom):
        """Convert classroom document to dictionary"""
        if not classroom:
            return None
        return {
            '_id': str(classroom['_id']),
            'name': classroom['name'],
            'createdBy': classroom['createdBy'],
            'members': classroom.get('members', []),
            'joinCode': classroom['joinCode'],
            'joinRequests': classroom.get('joinRequests', []),
            'createdAt': classroom.get('createdAt')
        }