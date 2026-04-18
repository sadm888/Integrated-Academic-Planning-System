"""
mailer.py — Flask-Mail wrapper for IAPS.
Call init_mail(app) once from create_app(), then use the send_* helpers anywhere.
"""
import logging
from flask_mail import Mail, Message

logger = logging.getLogger(__name__)

mail = Mail()


def init_mail(app):
    """Bind Flask-Mail to the app instance."""
    mail.init_app(app)


def send_verification_email(to_email: str, token: str, frontend_url: str):
    """Send an account-verification email with a one-time link."""
    link = f"{frontend_url}/verify-email?token={token}"
    msg = Message(
        subject="Verify your IAPS account",
        recipients=[to_email],
        html=f"""
        <div style="font-family:sans-serif;max-width:480px;margin:auto">
          <h2 style="color:#667eea">Verify your email</h2>
          <p>Thanks for signing up for IAPS! Click the button below to confirm your
             email address. This link expires in <strong>24 hours</strong>.</p>
          <a href="{link}"
             style="display:inline-block;margin:16px 0;padding:12px 28px;
                    background:#667eea;color:#fff;border-radius:8px;
                    text-decoration:none;font-weight:600">
            Verify Email
          </a>
          <p style="color:#6b7280;font-size:13px">
            Or copy this link into your browser:<br>
            <a href="{link}" style="color:#667eea">{link}</a>
          </p>
          <p style="color:#9ca3af;font-size:12px">
            If you didn't create an IAPS account, you can safely ignore this email.
          </p>
        </div>
        """,
    )
    try:
        mail.send(msg)
        logger.info(f"Verification email sent to {to_email}")
    except Exception as e:
        logger.error(f"Failed to send verification email to {to_email}: {e}")
        raise


def send_invite_email(to_email: str, inviter_name: str, inviter_email: str, token: str, frontend_url: str):
    """Send a platform-invitation email with a pre-filled signup link."""
    link = f"{frontend_url}/signup?invite={token}"
    msg = Message(
        subject=f"{inviter_name} invited you to join IAPS",
        recipients=[to_email],
        reply_to=inviter_email,
        html=f"""
        <div style="font-family:sans-serif;max-width:480px;margin:auto">
          <h2 style="color:#667eea">You're invited to IAPS</h2>
          <p><strong>{inviter_name}</strong> (<a href="mailto:{inviter_email}" style="color:#667eea">{inviter_email}</a>) has invited you to join
             <strong>IAPS</strong> — an academic platform for managing
             classrooms, timetables, attendance, and more.</p>
          <a href="{link}"
             style="display:inline-block;margin:16px 0;padding:12px 28px;
                    background:#667eea;color:#fff;border-radius:8px;
                    text-decoration:none;font-weight:600">
            Accept Invitation &amp; Sign Up
          </a>
          <p style="color:#6b7280;font-size:13px">
            Or copy this link into your browser:<br>
            <a href="{link}" style="color:#667eea">{link}</a>
          </p>
          <p style="color:#9ca3af;font-size:12px">
            This invitation link expires in <strong>7 days</strong>.
            If you weren't expecting this, you can safely ignore it.
          </p>
        </div>
        """,
    )
    try:
        mail.send(msg)
        logger.info(f"Invite email sent to {to_email} by {inviter_name} ({inviter_email})")
    except Exception as e:
        logger.error(f"Failed to send invite email to {to_email}: {e}")
        raise
