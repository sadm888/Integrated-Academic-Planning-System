from flask_mail import Mail, Message
import secrets
from datetime import datetime, timedelta
from database import db
from config import Config
import logging

logger = logging.getLogger(__name__)

mail = Mail()

def init_mail(app):
    """Initialize Flask-Mail with app"""
    mail.init_app(app)

def generate_verification_token(user_id):
    """Generate email verification token"""
    token = secrets.token_urlsafe(32)
    database = db.get_db()
    
    database.verification_tokens.insert_one({
        'token': token,
        'userId': user_id,
        'type': 'email_verification',
        'expiresAt': datetime.utcnow() + timedelta(hours=24),
        'createdAt': datetime.utcnow()
    })
    
    return token

def generate_classroom_invite_token(classroom_id, invited_by):
    """Generate classroom invite token"""
    token = secrets.token_urlsafe(32)
    database = db.get_db()
    
    database.verification_tokens.insert_one({
        'token': token,
        'classroomId': classroom_id,
        'invitedBy': invited_by,
        'type': 'classroom_invite',
        'expiresAt': datetime.utcnow() + timedelta(days=7),
        'createdAt': datetime.utcnow()
    })
    
    return token

def send_verification_email(email, username, token):
    """Send email verification email"""
    try:
        verification_url = f"{Config.FRONTEND_URL}/verify-email?token={token}"
        
        html_body = f"""
        <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #2563eb;">Welcome to IAPS, {username}!</h2>
                    <p>Thank you for signing up for the Integrated Academic Planning System.</p>
                    <p>Please verify your email address by clicking the button below:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="{verification_url}" 
                           style="background-color: #2563eb; color: white; padding: 12px 30px; 
                                  text-decoration: none; border-radius: 5px; display: inline-block;">
                            Verify Email
                        </a>
                    </div>
                    <p style="color: #666; font-size: 14px;">
                        Or copy and paste this link into your browser:<br>
                        <a href="{verification_url}">{verification_url}</a>
                    </p>
                    <p style="color: #666; font-size: 14px;">
                        This link will expire in 24 hours.
                    </p>
                </div>
            </body>
        </html>
        """
        
        msg = Message(
            subject="Verify Your IAPS Email",
            recipients=[email],
            html=html_body
        )
        
        mail.send(msg)
        logger.info(f"Verification email sent to {email}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to send verification email: {e}")
        return False

def send_classroom_invite_email(email, classroom_name, invited_by_name, token):
    """Send classroom invitation email"""
    try:
        invite_url = f"{Config.FRONTEND_URL}/join-classroom?token={token}"
        
        html_body = f"""
        <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #2563eb;">Classroom Invitation</h2>
                    <p><strong>{invited_by_name}</strong> has invited you to join the classroom:</p>
                    <p style="font-size: 18px; font-weight: bold; color: #2563eb;">{classroom_name}</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="{invite_url}" 
                           style="background-color: #10b981; color: white; padding: 12px 30px; 
                                  text-decoration: none; border-radius: 5px; display: inline-block;">
                            Join Classroom
                        </a>
                    </div>
                    <p style="color: #666; font-size: 14px;">
                        Or copy and paste this link into your browser:<br>
                        <a href="{invite_url}">{invite_url}</a>
                    </p>
                    <p style="color: #666; font-size: 14px;">
                        This invitation will expire in 7 days.
                    </p>
                </div>
            </body>
        </html>
        """
        
        msg = Message(
            subject=f"Invitation to join {classroom_name}",
            recipients=[email],
            html=html_body
        )
        
        mail.send(msg)
        logger.info(f"Classroom invite sent to {email}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to send classroom invite: {e}")
        return False

def verify_token(token, token_type):
    """Verify and consume a token"""
    database = db.get_db()
    
    token_doc = database.verification_tokens.find_one({
        'token': token,
        'type': token_type
    })
    
    if not token_doc:
        return None
    
    if datetime.utcnow() > token_doc['expiresAt']:
        database.verification_tokens.delete_one({'_id': token_doc['_id']})
        return None
    
    database.verification_tokens.delete_one({'_id': token_doc['_id']})
    
    return token_doc