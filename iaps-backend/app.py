from flask import Flask, jsonify
from flask_cors import CORS
from config import Config
from database import db
from email_service import init_mail
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def create_app():
    """Application factory pattern"""
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
    from routes.ai_routes import ai_bp
    from routes.todo_routes import todo_bp
    from routes.subject_routes import subject_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(classroom_bp)
    app.register_blueprint(semester_bp)
    app.register_blueprint(document_bp)
    app.register_blueprint(ai_bp)
    app.register_blueprint(todo_bp)
    app.register_blueprint(subject_bp)
    
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
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=True,
        use_reloader=False 
    )