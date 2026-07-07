from flask import Flask, jsonify
from flask_cors import CORS
from config import Config
from database import db
from socketio_instance import socketio
from limiter_instance import limiter
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def create_app():
    """Application factory pattern"""
    import os
    app = Flask(__name__)

    app.config.from_object(Config)

    # Vite/CRA dev ports are always allowed; prod frontend comes from env
    allowed_origins = [
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:5173", "http://127.0.0.1:5173",
    ]
    frontend_url = os.environ.get("FRONTEND_URL", "").strip()
    if frontend_url and frontend_url not in allowed_origins:
        allowed_origins.append(frontend_url)

    CORS(app,
         resources={r"/*": {"origins": allowed_origins}},
         supports_credentials=True,
         allow_headers=['Content-Type', 'Authorization', 'Accept'],
         methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
         expose_headers=['Content-Type', 'Authorization'])

    limiter.init_app(app)
    from utils.mailer import init_mail
    init_mail(app)

    try:
        db.connect()
        logger.info("Database connected successfully")
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        # Don't raise — let the app boot so /api/health can still report the outage

    # Imported here, not at module level, to avoid circular imports with routes -> app
    from routes.auth_routes import auth_bp
    from routes.classroom_routes import classroom_bp
    from routes.semester_routes import semester_bp
    from routes.document_routes import document_bp
    from routes.todo_routes import todo_bp
    from routes.subject_routes import subject_bp
    from routes.chat_routes import chat_bp  # also registers Socket.IO events
    from routes.settings_routes import settings_bp
    from routes.academic_routes import academic_bp
    from routes.announcement_routes import announcement_bp
    from routes.dm_routes import dm_bp
    from routes.timetable_routes import timetable_bp
    from routes.marks_routes import marks_bp
    from routes.ai_routes import ai_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(classroom_bp)
    app.register_blueprint(semester_bp)
    app.register_blueprint(document_bp)
    app.register_blueprint(todo_bp)
    app.register_blueprint(subject_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(academic_bp)
    app.register_blueprint(announcement_bp)
    app.register_blueprint(dm_bp)
    app.register_blueprint(timetable_bp)
    app.register_blueprint(marks_bp)
    app.register_blueprint(ai_bp)

    import os as _os
    _os.makedirs(_os.path.join(_os.getcwd(), 'uploads', 'avatars'), exist_ok=True)

    # Socket.IO needs the same origin list as CORS, so this has to run after that's built.
    # threading mode: no monkey-patching required (matches the Procfile's `-k gthread`
    # worker). Eventlet was tried and reverted — its monkey-patch retrofit of locks
    # created before the patch runs is unreliable on this Python version (breaks
    # pymongo's TLS handshake to Atlas: "SSLSocket is not a GreenSSLSocket"), and
    # gunicorn's own startup creates some of those locks before our code ever runs.
    # threading mode falls back to long-polling instead of native websockets, which
    # is less efficient but actually works — correct beats fast here.
    # REDIS_URL (unset by default) enables cross-instance event fan-out via a message
    # queue; without it, everything still works exactly as today on a single instance.
    redis_url = os.environ.get('REDIS_URL', '').strip()
    socketio.init_app(
        app,
        cors_allowed_origins=allowed_origins,
        async_mode='threading',
        message_queue=redis_url or None,
        max_http_buffer_size=50 * 1024 * 1024,  # allow largish file/image uploads over the socket
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