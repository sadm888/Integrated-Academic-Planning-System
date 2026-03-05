from flask import Blueprint, request, jsonify, redirect
from flask_cors import cross_origin
from datetime import datetime
import jwt
import logging

from middleware import token_required, SECRET_KEY
from config import Config

calendar_bp = Blueprint('calendar', __name__, url_prefix='/api/calendar')
logger = logging.getLogger(__name__)


@calendar_bp.route('/auth-url', methods=['GET'])
@cross_origin()
@token_required
def get_auth_url():
    """Return Google OAuth2 authorization URL. The user's JWT is passed as the state param."""
    from google_auth_oauthlib.flow import Flow

    try:
        # Grab the raw JWT from the Authorization header
        auth_header = request.headers.get('Authorization', '')
        token = auth_header[7:] if auth_header.startswith('Bearer ') else auth_header

        flow = Flow.from_client_config(
            {
                'web': {
                    'client_id': Config.GOOGLE_CLIENT_ID,
                    'client_secret': Config.GOOGLE_CLIENT_SECRET,
                    'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
                    'token_uri': 'https://oauth2.googleapis.com/token',
                    'redirect_uris': [Config.GOOGLE_REDIRECT_URI],
                }
            },
            scopes=Config.GOOGLE_SCOPES,
        )
        flow.redirect_uri = Config.GOOGLE_REDIRECT_URI

        auth_url, _ = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent',   # always get refresh_token
            state=token,        # carry JWT to identify user at callback
        )

        return jsonify({'auth_url': auth_url}), 200

    except Exception as e:
        logger.error(f"Auth URL error: {e}")
        return jsonify({'error': 'Failed to generate auth URL'}), 500


@calendar_bp.route('/callback', methods=['GET'])
@cross_origin()
def oauth_callback():
    """
    Google redirects here after the user grants permission.
    Exchanges the auth code for tokens and stores them, then redirects to the frontend.
    """
    from database import get_db
    from google_auth_oauthlib.flow import Flow

    try:
        code = request.args.get('code')
        state = request.args.get('state')   # this is the user's JWT

        if not code or not state:
            return redirect(f"{Config.FRONTEND_URL}/calendar?error=missing_params")

        # Recover user_id from the JWT carried in state
        try:
            payload = jwt.decode(state, SECRET_KEY, algorithms=['HS256'])
            user_id = payload['user_id']
        except jwt.ExpiredSignatureError:
            return redirect(f"{Config.FRONTEND_URL}/calendar?error=session_expired")
        except jwt.InvalidTokenError:
            return redirect(f"{Config.FRONTEND_URL}/calendar?error=invalid_token")

        # Exchange code for tokens
        flow = Flow.from_client_config(
            {
                'web': {
                    'client_id': Config.GOOGLE_CLIENT_ID,
                    'client_secret': Config.GOOGLE_CLIENT_SECRET,
                    'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
                    'token_uri': 'https://oauth2.googleapis.com/token',
                    'redirect_uris': [Config.GOOGLE_REDIRECT_URI],
                }
            },
            scopes=Config.GOOGLE_SCOPES,
            state=state,
        )
        flow.redirect_uri = Config.GOOGLE_REDIRECT_URI
        flow.fetch_token(code=code)
        credentials = flow.credentials

        db = get_db()
        token_doc = {
            'user_id': user_id,
            'access_token': credentials.token,
            'refresh_token': credentials.refresh_token,
            'token_expiry': credentials.expiry,
            'updated_at': datetime.utcnow(),
        }

        db.google_tokens.update_one(
            {'user_id': user_id},
            {'$set': token_doc, '$setOnInsert': {'created_at': datetime.utcnow()}},
            upsert=True
        )

        logger.info(f"Google Calendar connected for user {user_id}")
        return redirect(f"{Config.FRONTEND_URL}/calendar?connected=true")

    except Exception as e:
        logger.error(f"OAuth callback error: {e}")
        return redirect(f"{Config.FRONTEND_URL}/calendar?error=oauth_failed")


@calendar_bp.route('/status', methods=['GET'])
@cross_origin()
@token_required
def get_status():
    """Returns whether the current user has connected their Google Calendar."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()
        token_doc = db.google_tokens.find_one({'user_id': user_id})
        connected = token_doc is not None and bool(token_doc.get('refresh_token'))
        return jsonify({'connected': connected}), 200

    except Exception as e:
        logger.error(f"Status check error: {e}")
        return jsonify({'error': 'Failed to check status'}), 500


@calendar_bp.route('/disconnect', methods=['DELETE'])
@cross_origin()
@token_required
def disconnect():
    """Remove stored Google Calendar tokens for the current user."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()
        db.google_tokens.delete_one({'user_id': user_id})
        return jsonify({'message': 'Google Calendar disconnected'}), 200

    except Exception as e:
        logger.error(f"Disconnect error: {e}")
        return jsonify({'error': 'Failed to disconnect'}), 500


def _get_service_or_error(db, user_id):
    """
    Helper: fetch token doc, build Google Calendar service.
    Returns (service, None) on success or (None, response_tuple) on failure.
    """
    from utils.google_calendar import get_calendar_service
    from google.auth.exceptions import RefreshError

    token_doc = db.google_tokens.find_one({'user_id': user_id})
    if not token_doc:
        return None, (jsonify({'error': 'Google Calendar not connected', 'not_connected': True}), 403)

    try:
        service = get_calendar_service(token_doc, db, user_id)
        return service, None
    except RefreshError:
        db.google_tokens.delete_one({'user_id': user_id})
        return None, (
            jsonify({'error': 'Google Calendar access was revoked. Please reconnect.', 'not_connected': True}),
            403
        )


@calendar_bp.route('/events', methods=['GET'])
@cross_origin()
@token_required
def list_events():
    """List events from Google Calendar between time_min and time_max (ISO strings)."""
    from database import get_db
    from utils.google_calendar import list_calendar_events
    from googleapiclient.errors import HttpError

    try:
        user_id = request.user['user_id']
        db = get_db()

        service, err = _get_service_or_error(db, user_id)
        if err:
            return err

        time_min = request.args.get('time_min')
        time_max = request.args.get('time_max')
        if not time_min or not time_max:
            return jsonify({'error': 'time_min and time_max query params are required'}), 400

        events = list_calendar_events(service, time_min, time_max)
        return jsonify({'events': events}), 200

    except HttpError as e:
        logger.error(f"Google API error listing events: {e}")
        return jsonify({'error': 'Google Calendar API error', 'details': str(e)}), 502
    except Exception as e:
        logger.error(f"List events error: {e}")
        return jsonify({'error': 'Failed to fetch events'}), 500


@calendar_bp.route('/events', methods=['POST'])
@cross_origin()
@token_required
def create_event():
    """Create a new event in the user's Google Calendar."""
    from database import get_db
    from utils.google_calendar import format_event_for_google, create_calendar_event
    from googleapiclient.errors import HttpError

    try:
        user_id = request.user['user_id']
        data = request.get_json()
        db = get_db()

        service, err = _get_service_or_error(db, user_id)
        if err:
            return err

        title = data.get('title', '').strip()
        start_dt = data.get('start_datetime', '').strip()
        end_dt = data.get('end_datetime', '').strip()
        description = data.get('description', '').strip()
        location = data.get('location', '').strip()

        if not all([title, start_dt, end_dt]):
            return jsonify({'error': 'title, start_datetime, and end_datetime are required'}), 400

        event_body = format_event_for_google(title, start_dt, end_dt, description, location)
        created = create_calendar_event(service, event_body)

        return jsonify({'event': created}), 201

    except HttpError as e:
        logger.error(f"Google API error creating event: {e}")
        return jsonify({'error': 'Google Calendar API error', 'details': str(e)}), 502
    except Exception as e:
        logger.error(f"Create event error: {e}")
        return jsonify({'error': 'Failed to create event'}), 500


@calendar_bp.route('/events/<event_id>', methods=['PATCH'])
@cross_origin()
@token_required
def update_event(event_id):
    """Partially update an event in the user's Google Calendar."""
    from database import get_db
    from utils.google_calendar import update_calendar_event
    from googleapiclient.errors import HttpError

    try:
        user_id = request.user['user_id']
        data = request.get_json()
        db = get_db()

        service, err = _get_service_or_error(db, user_id)
        if err:
            return err

        event_body = {}
        if 'title' in data:
            event_body['summary'] = data['title']
        if 'description' in data:
            event_body['description'] = data['description']
        if 'location' in data:
            event_body['location'] = data['location']
        if 'start_datetime' in data:
            event_body['start'] = {'dateTime': data['start_datetime'], 'timeZone': 'UTC'}
        if 'end_datetime' in data:
            event_body['end'] = {'dateTime': data['end_datetime'], 'timeZone': 'UTC'}

        updated = update_calendar_event(service, event_id, event_body)
        return jsonify({'event': updated}), 200

    except HttpError as e:
        logger.error(f"Google API error updating event {event_id}: {e}")
        return jsonify({'error': 'Google Calendar API error', 'details': str(e)}), 502
    except Exception as e:
        logger.error(f"Update event error: {e}")
        return jsonify({'error': 'Failed to update event'}), 500


@calendar_bp.route('/events/<event_id>', methods=['DELETE'])
@cross_origin()
@token_required
def delete_event(event_id):
    """Delete an event from the user's Google Calendar."""
    from database import get_db
    from utils.google_calendar import delete_calendar_event
    from googleapiclient.errors import HttpError

    try:
        user_id = request.user['user_id']
        db = get_db()

        service, err = _get_service_or_error(db, user_id)
        if err:
            return err

        delete_calendar_event(service, event_id)
        return jsonify({'message': 'Event deleted'}), 200

    except HttpError as e:
        logger.error(f"Google API error deleting event {event_id}: {e}")
        return jsonify({'error': 'Google Calendar API error', 'details': str(e)}), 502
    except Exception as e:
        logger.error(f"Delete event error: {e}")
        return jsonify({'error': 'Failed to delete event'}), 500
