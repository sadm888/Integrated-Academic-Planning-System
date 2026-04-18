from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import ConnectionFailure
from config import Config
import logging

logger = logging.getLogger(__name__)

class Database:
    _instance = None
    _client = None
    _db = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(Database, cls).__new__(cls)
        return cls._instance
    
    def connect(self):
        """Establish MongoDB connection"""
        try:
            self._client = MongoClient(Config.MONGO_URI)
            # The 'ping' command is cheap and confirms the server is reachable
            self._client.admin.command('ping')
            self._db = self._client.get_database()
            logger.info("MongoDB connection established successfully")
            
            self._create_indexes()
            return self._db
        except ConnectionFailure as e:
            logger.error(f"MongoDB connection failed: {e}")
            raise
    
    def _create_indexes(self):
        """Create necessary database indexes"""
        try:
            # Users - unique email
            self._db.users.create_index([("email", ASCENDING)], unique=True)
            
            # Users - case-insensitive username
            # We use a specific name 'username_ci' to avoid conflicts with auto-generated names
            try:
                self._db.users.create_index(
                    [("username", ASCENDING)], 
                    unique=True,
                    collation={'locale': 'en', 'strength': 2},
                    name="username_case_insensitive"
                )
            except Exception as e:
                # If it still fails, it's likely because the OLD 'username_1' index exists
                # You might want to manually drop it once: self._db.users.drop_index("username_1")
                logger.warning(f"Could not create username index (may already exist): {e}")

            # google_tokens — one doc per user
            self._db.google_tokens.create_index(
                [("user_id", ASCENDING)], unique=True, name="google_tokens_user_id"
            )

            # schedule_requests — list by classroom, newest first
            self._db.schedule_requests.create_index(
                [("classroom_id", ASCENDING), ("created_at", DESCENDING)],
                name="schedule_requests_classroom_created"
            )

            # chat_messages — ordered per classroom
            self._db.chat_messages.create_index(
                [("classroom_id", ASCENDING), ("created_at", ASCENDING)],
                name="chat_messages_classroom_time"
            )

            # chat_read_status — one doc per user per classroom
            self._db.chat_read_status.create_index(
                [("user_id", ASCENDING), ("classroom_id", ASCENDING)],
                unique=True,
                name="chat_read_status_user_classroom"
            )

            # attendance_sessions — list by semester + date, dedup by date+slot
            self._db.attendance_sessions.create_index(
                [("semester_id", ASCENDING), ("date", ASCENDING), ("slot", ASCENDING)],
                name="attendance_sessions_semester_date_slot"
            )
            self._db.attendance_sessions.create_index(
                [("semester_id", ASCENDING), ("subject", ASCENDING), ("status", ASCENDING)],
                name="attendance_sessions_semester_subject_status"
            )

            # attendance_records — one per student per session
            self._db.attendance_records.create_index(
                [("session_id", ASCENDING), ("student_id", ASCENDING)],
                unique=True,
                name="attendance_records_session_student"
            )
            self._db.attendance_records.create_index(
                [("semester_id", ASCENDING), ("student_id", ASCENDING)],
                name="attendance_records_semester_student"
            )

            # attendance_settings — one per semester
            self._db.attendance_settings.create_index(
                [("semester_id", ASCENDING)],
                unique=True,
                name="attendance_settings_semester"
            )

            # email_verifications — look up by token; auto-expire via TTL on expires_at
            self._db.email_verifications.create_index(
                [("token", ASCENDING)], unique=True, name="email_verifications_token"
            )
            self._db.email_verifications.create_index(
                [("expires_at", ASCENDING)],
                expireAfterSeconds=0,
                name="email_verifications_ttl"
            )

            # invitations — look up by token; auto-expire via TTL on expires_at
            self._db.invitations.create_index(
                [("token", ASCENDING)], unique=True, name="invitations_token"
            )
            self._db.invitations.create_index(
                [("expires_at", ASCENDING)],
                expireAfterSeconds=0,
                name="invitations_ttl"
            )

            logger.info("Database indexes checked/created successfully")
        except Exception as e:
            logger.warning(f"Error creating indexes: {e}")
    
    def get_db(self):
        """Get database instance, connecting if necessary"""
        if self._db is None:
            return self.connect()
        return self._db
    
    def close(self):
        """Close MongoDB connection"""
        if self._client:
            self._client.close()
            logger.info("MongoDB connection closed")

# Initialize the singleton instance
db = Database()

def get_db():
    """Convenience function to get database instance"""
    return db.get_db()