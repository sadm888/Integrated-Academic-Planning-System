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

            # ... (rest of your classroom and document indexes remain the same)
            
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