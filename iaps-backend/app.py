from flask import Flask, jsonify
from flask_cors import CORS
from config import Config
from database import db
from email_service import init_mail
from socketio_instance import socketio
from limiter_instance import limiter
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def create_app():
    """Application factory pattern"""
    import os
    os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'  # allow OAuth over HTTP in local dev

    app = Flask(__name__)
    
    # Load configuration
    app.config.from_object(Config)
    
    # Configure CORS
    # This single block replaces the need for the manual 'after_request' headers
    CORS(app, 
         resources={r"/*": {"origins": ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173"]}},
         supports_credentials=True,
         allow_headers=['Content-Type', 'Authorization', 'Accept'],
         methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
         expose_headers=['Content-Type', 'Authorization'])
    
    # Initialize extensions
    limiter.init_app(app)

    try:
        init_mail(app)
    except Exception as e:
        logger.warning(f"Mail service failed to initialize: {e}")
    
    # Initialize database connection
    try:
        db.connect()
        logger.info("Database connected successfully")
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        # We don't raise here to allow the app to potentially 
        # report its own error via health checks
    
    # Register blueprints (Delayed imports to prevent circular dependency)
    from routes.auth_routes import auth_bp
    from routes.classroom_routes import classroom_bp
    from routes.semester_routes import semester_bp
    from routes.document_routes import document_bp
    from routes.todo_routes import todo_bp
    from routes.subject_routes import subject_bp
    from routes.calendar_routes import calendar_bp
    from routes.schedule_routes import schedule_bp
    from routes.chat_routes import chat_bp  # also registers Socket.IO events
    from routes.settings_routes import settings_bp
    from routes.academic_routes import academic_bp
    from routes.announcement_routes import announcement_bp
    from routes.dm_routes import dm_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(classroom_bp)
    app.register_blueprint(semester_bp)
    app.register_blueprint(document_bp)
    app.register_blueprint(todo_bp)
    app.register_blueprint(subject_bp)
    app.register_blueprint(calendar_bp)
    app.register_blueprint(schedule_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(academic_bp)
    app.register_blueprint(announcement_bp)
    app.register_blueprint(dm_bp)

    # Ensure avatar upload directory exists
    import os as _os
    _os.makedirs(_os.path.join(_os.getcwd(), 'uploads', 'avatars'), exist_ok=True)

    # Initialise Socket.IO (must come after CORS is configured)
    socketio.init_app(
        app,
        cors_allowed_origins=[
            'http://localhost:3000', 'http://127.0.0.1:3000',
            'http://localhost:5173', 'http://127.0.0.1:5173',
        ],
        async_mode='threading',
        max_http_buffer_size=50 * 1024 * 1024,
    )
    
    @app.route('/api/health', methods=['GET'])
    def health_check():
        return jsonify({
            'status': 'healthy',
            'service': 'IAPS Backend API',
            'version': '1.0.0'
        }), 200
    
    @app.route('/', methods=['GET'])
    def root():
        return jsonify({
            'message': 'IAPS Backend API',
            'version': '1.0.0'
        }), 200
    
    @app.errorhandler(404)
    def not_found(error):
        return jsonify({'error': 'Endpoint not found'}), 404
    
    @app.errorhandler(500)
    def internal_error(error):
        logger.error(f"Internal server error: {error}")
        return jsonify({'error': 'Internal server error'}), 500
    
    return app

if __name__ == '__main__':
    app = create_app()
    socketio.run(
        app,
        host='0.0.0.0',
        port=5001,
        debug=True,
        use_reloader=False,
    )