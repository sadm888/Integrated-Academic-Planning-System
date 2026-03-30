"""
google_calendar.py — Shared helper for Google Calendar API operations.
Handles credential construction, token refresh, and event CRUD.
No Flask dependencies — can be used from any route file.
"""
import logging
from datetime import datetime

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google.auth.exceptions import RefreshError
from googleapiclient.discovery import build

from config import Config

logger = logging.getLogger(__name__)


def get_valid_credentials(token_doc):
    """
    Given a google_tokens MongoDB document, return a valid Credentials object.
    Auto-refreshes if the access token is expired.

    Returns: (credentials, updated_fields_dict_or_None)
      - updated_fields is non-None only if a refresh happened; caller should persist to DB.
    Raises: google.auth.exceptions.RefreshError if refresh_token is invalid/revoked.
    """
    expiry = token_doc.get('token_expiry')
    if expiry and expiry.tzinfo is not None:
        # Credentials expects naive UTC datetimes
        expiry = expiry.replace(tzinfo=None)

    creds = Credentials(
        token=token_doc['access_token'],
        refresh_token=token_doc['refresh_token'],
        token_uri='https://oauth2.googleapis.com/token',
        client_id=Config.GOOGLE_CLIENT_ID,
        client_secret=Config.GOOGLE_CLIENT_SECRET,
        scopes=Config.GOOGLE_SCOPES,
    )
    creds.expiry = expiry

    updated_fields = None
    if not creds.valid:
        creds.refresh(Request())
        updated_fields = {
            'access_token': creds.token,
            'token_expiry': creds.expiry,
            'updated_at': datetime.utcnow(),
        }
        logger.info("Google access token refreshed")

    return creds, updated_fields


def get_calendar_service(token_doc, db, user_id):
    """
    Build and return a Google Calendar API service object.
    Automatically refreshes the access token and persists updates to MongoDB.

    Raises: RefreshError if the refresh_token has been revoked.
    """
    creds, updated_fields = get_valid_credentials(token_doc)

    if updated_fields:
        db.google_tokens.update_one(
            {'user_id': user_id},
            {'$set': updated_fields}
        )

    return build('calendar', 'v3', credentials=creds)


def format_event_for_google(title, start_dt, end_dt, description='', location=''):
    """
    Build a Google Calendar API event body dict.
    start_dt and end_dt must be ISO 8601 strings (e.g. '2026-02-24T09:00:00Z').
    """
    return {
        'summary': title,
        'description': description,
        'location': location,
        'start': {'dateTime': start_dt, 'timeZone': 'UTC'},
        'end': {'dateTime': end_dt, 'timeZone': 'UTC'},
    }


def list_calendar_events(service, time_min, time_max, calendar_id='primary'):
    """
    Fetch all events between time_min and time_max.
    All events (including personal Google Calendar events) are returned so users
    can see their full schedule. IAPS events are identified by the presence of
    any 'iaps_*' key in extendedProperties.private — callers use this to decide
    whether to allow editing/deleting.
    """
    all_events = []
    page_token = None
    while True:
        result = service.events().list(
            calendarId=calendar_id,
            timeMin=time_min,
            timeMax=time_max,
            singleEvents=True,
            orderBy='startTime',
            maxResults=250,
            pageToken=page_token,
        ).execute()
        all_events.extend(result.get('items', []))
        page_token = result.get('nextPageToken')
        if not page_token:
            break

    return all_events


def create_calendar_event(service, event_body, calendar_id='primary'):
    """Insert a single event. Returns the created event dict."""
    return service.events().insert(calendarId=calendar_id, body=event_body).execute()


def update_calendar_event(service, event_id, event_body, calendar_id='primary'):
    """Patch an existing event. Returns the updated event dict."""
    return service.events().patch(
        calendarId=calendar_id, eventId=event_id, body=event_body
    ).execute()


def delete_calendar_event(service, event_id, calendar_id='primary'):
    """Delete an event by ID."""
    service.events().delete(calendarId=calendar_id, eventId=event_id).execute()