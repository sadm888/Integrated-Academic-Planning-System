"""
mailer.py — Flask-Mail wrapper for IAPS.
Call init_mail(app) once from create_app(), then use the send_* helpers anywhere.
"""
import logging
from flask_mail import Mail

logger = logging.getLogger(__name__)

mail = Mail()


def init_mail(app):
    """Bind Flask-Mail to the app instance."""
    mail.init_app(app)
