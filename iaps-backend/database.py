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
            # Fail fast (a few seconds) instead of pymongo's 30s default when Mongo is
            # unreachable/down — without this, every request touching the DB hangs for
            # ~30s before erroring, which reads as a stuck "loading" spinner on the frontend.
            self._client = MongoClient(
                Config.MONGO_URI,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000,
            )
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
            self._db.users.create_index([("email", ASCENDING)], unique=True)

            try:
                self._db.users.create_index(
                    [("username", ASCENDING)], 
                    unique=True,
                    collation={'locale': 'en', 'strength': 2},
                    name="username_case_insensitive"
                )
            except Exception as e:
                # Usually means the old non-collated 'username_1' index is still around;
                # drop it manually once with self._db.users.drop_index("username_1") if so
                logger.warning(f"Could not create username index (may already exist): {e}")

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

            # email_verifications — look up by token; auto-expire via TTL on expires_at
            self._db.email_verifications.create_index(
                [("token", ASCENDING)], unique=True, name="email_verifications_token"
            )
            self._db.email_verifications.create_index(
                [("expires_at", ASCENDING)],
                expireAfterSeconds=0,
                name="email_verifications_ttl"
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

db = Database()

def get_db():
    """Convenience function to get database instance"""
    return db.get_db()