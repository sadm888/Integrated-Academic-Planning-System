"""Document Model"""

from datetime import datetime

class DocumentModel:
    """Document metadata model"""
    
    @staticmethod
    def create_document(classroom_id, semester_id, uploaded_by, filename, 
                       file_url, file_size, doc_type='resource', 
                       course_id=None, use_for_ai=False):
        """Create document metadata document"""
        return {
            'classroomId': classroom_id,
            'semesterSessionId': semester_id,
            'courseId': course_id,
            'uploadedBy': uploaded_by,
            'type': doc_type,
            'filename': filename,
            'fileUrl': file_url,
            'fileSize': file_size,
            'useForAI': use_for_ai,
            'createdAt': datetime.utcnow()
        }
    
    @staticmethod
    def to_dict(document):
        """Convert document to dictionary"""
        if not document:
            return None
        return {
            '_id': str(document['_id']),
            'classroomId': document['classroomId'],
            'semesterSessionId': document['semesterSessionId'],
            'courseId': document.get('courseId'),
            'uploadedBy': document['uploadedBy'],
            'type': document.get('type', 'resource'),
            'filename': document['filename'],
            'fileUrl': document['fileUrl'],
            'fileSize': document.get('fileSize', 0),
            'useForAI': document.get('useForAI', False),
            'createdAt': document.get('createdAt')
        }