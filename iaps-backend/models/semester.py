"""Semester Session Model"""

from datetime import datetime

class SemesterModel:
    """Semester session data model"""
    
    @staticmethod
    def create_semester(classroom_id, name, cr_ids, is_active=True):
        """Create semester session document"""
        return {
            'classroomId': classroom_id,
            'name': name.strip(),
            'crIds': cr_ids,
            'isActive': is_active,
            'createdAt': datetime.utcnow(),
            'archivedAt': None
        }
    
    @staticmethod
    def to_dict(semester):
        """Convert semester document to dictionary"""
        if not semester:
            return None
        return {
            '_id': str(semester['_id']),
            'classroomId': semester['classroomId'],
            'name': semester['name'],
            'crIds': semester.get('crIds', []),
            'isActive': semester.get('isActive', False),
            'createdAt': semester.get('createdAt'),
            'archivedAt': semester.get('archivedAt')
        }