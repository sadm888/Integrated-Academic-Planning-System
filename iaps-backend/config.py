import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Flask/session internals expect the attribute name 'SECRET_KEY', so we alias it here
    SECRET_KEY = os.getenv('JWT_SECRET', 'dev-secret-change-in-production')

    MONGO_URI = os.getenv('MONGO_URI', 'mongodb://localhost:27017/iaps')

    JWT_SECRET = SECRET_KEY
    JWT_EXPIRATION = timedelta(days=7)

    MAIL_SERVER = os.getenv('MAIL_SERVER', 'smtp.gmail.com')
    MAIL_PORT = int(os.getenv('MAIL_PORT', 587))
    MAIL_USE_TLS = os.getenv('MAIL_USE_TLS', 'True') == 'True'
    MAIL_USERNAME = os.getenv('MAIL_USERNAME')
    MAIL_PASSWORD = os.getenv('MAIL_PASSWORD')
    MAIL_DEFAULT_SENDER = os.getenv('MAIL_DEFAULT_SENDER')

    FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://localhost:5173')

    # COOKIE_SECURE must be True in prod (HTTPS) — left off by default for local http dev
    COOKIE_SECURE = os.getenv('COOKIE_SECURE', 'False') == 'True'
    COOKIE_SAMESITE = os.getenv('COOKIE_SAMESITE', 'Lax')
    COOKIE_HTTPONLY = True

    GROQ_API_KEY = os.getenv('GROQ_API_KEY')