"""Timetable management routes.

Collections used:
  timetables         — one per semester, stores base weekly grid
  timetable_overrides — day-specific CR overrides (cancel/reschedule/edit)
  academic_calendars  — semester academic calendar (holidays, exams, sem dates)
"""
from flask import Blueprint, request, jsonify
from flask_cors import cross_origin
from datetime import datetime, date, timedelta, timezone
from bson import ObjectId
import logging

from middleware import token_required, is_member_of_classroom, is_cr_of as _is_cr

timetable_bp = Blueprint('timetable', __name__, url_prefix='/api/timetable')
logger = logging.getLogger(__name__)

# ── Helpers ──────────────────────────────────────────────────────────────────


def _get_semester_and_check(db, semester_id, user_id):
    """Return (semester, classroom, is_cr) or raise."""
    semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
    if not semester:
        return None, None, False
    classroom = db.classrooms.find_one({'_id': ObjectId(semester['classroom_id'])})
    if not classroom or not is_member_of_classroom(classroom, user_id):
        return None, None, False
    return semester, classroom, _is_cr(semester, user_id)


def _serialize_timetable(doc):
    if not doc:
        return None
    return {
        'id': str(doc['_id']),
        'semester_id': doc['semester_id'],
        'days': doc.get('days', []),
        'time_slots': doc.get('time_slots', []),
        'grid': doc.get('grid', {}),
        'created_by': doc.get('created_by', ''),
        'updated_by': doc.get('updated_by', ''),
        'created_at': doc['created_at'].isoformat(),
        'updated_at': doc.get('updated_at', doc['created_at']).isoformat(),
    }


def _serialize_override(doc):
    return {
        'id': str(doc['_id']),
        'timetable_id': doc.get('timetable_id', ''),
        'semester_id': doc['semester_id'],
        'date': doc['date'],
        'day': doc['day'],
        'slot': doc['slot'],
        'action': doc['action'],
        'scope': doc['scope'],
        'changes': doc.get('changes', {}),
        'reason': doc.get('reason', ''),
        'created_by': doc.get('created_by', ''),
        'created_by_name': doc.get('created_by_name', ''),
        'created_at': doc['created_at'].isoformat(),
    }


def _apply_overrides_to_week(grid, days, time_slots, overrides, week_start_date):
    """
    Build a week view by merging base grid with overrides.
    week_start_date: date object for Monday of the week.
    Returns (week_grid, day_overrides) where day_overrides is
    {day_label: {override_id, reason, override_by}} for day-level cancels.
    """
    # Map day abbreviation → date in the given week
    day_to_date = {}
    for i, day in enumerate(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']):
        day_to_date[day] = (week_start_date + timedelta(days=i)).strftime('%Y-%m-%d')

    # Build working copy of the grid
    week_grid = {}
    for day in days:
        week_grid[day] = {}
        for slot in time_slots:
            cell = dict(grid.get(day, {}).get(slot, {
                'subject': '', 'teacher': '', 'room': '', 'type': 'Free'
            }))
            cell['status'] = 'normal'
            cell['override_id'] = None
            cell['override_reason'] = ''
            cell['override_by'] = ''
            week_grid[day][slot] = cell

    day_overrides = {}  # day → {override_id, reason, override_by} for full-day cancels

    # Apply overrides
    for ov in overrides:
        day = ov['day']
        slot = ov['slot']
        action = ov['action']
        scope = ov['scope']
        ov_date = ov['date']

        # For 'this_day' overrides, only apply if the override's date matches the week
        if scope == 'this_day':
            expected_date = day_to_date.get(day)
            if ov_date != expected_date:
                continue

        # Create the day on-the-fly for days not in the base timetable (e.g. Sat/Sun)
        if day not in week_grid:
            week_grid[day] = {}

        # ── Full-day cancel (slot == 'ALL') ───────────────────────────────────
        if slot == 'ALL':
            if action == 'cancel':
                day_overrides[day] = {
                    'override_id': ov['id'],
                    'reason': ov.get('reason', ''),
                    'override_by': ov.get('created_by_name', ''),
                }
                # Mark every class slot on this day as cancelled
                for s, cell in week_grid[day].items():
                    if cell.get('type') not in ('Free', 'Lunch', 'Library', 'Break'):
                        cell['status'] = 'cancelled'
                        cell['override_id'] = ov['id']
                        cell['override_reason'] = ov.get('reason', '')
                        cell['override_by'] = ov.get('created_by_name', '')
            continue

        # ── Slot-level override ───────────────────────────────────────────────
        if slot not in week_grid[day]:
            week_grid[day][slot] = {
                'subject': '', 'teacher': '', 'room': '', 'type': 'Free',
                'status': 'normal', 'override_id': None, 'override_reason': '', 'override_by': '',
            }

        cell = week_grid[day][slot]
        changes = ov.get('changes', {})

        if action == 'cancel':
            cell['status'] = 'cancelled'
            cell['override_id'] = ov['id']
            cell['override_reason'] = ov.get('reason', '')
            cell['override_by'] = ov.get('created_by_name', '')
        elif action in ('reschedule', 'edit'):
            cell['status'] = 'modified'
            cell['override_id'] = ov['id']
            cell['override_reason'] = ov.get('reason', '')
            cell['override_by'] = ov.get('created_by_name', '')
            if 'subject' in changes:
                cell['subject'] = changes['subject']
            if 'teacher' in changes:
                cell['teacher'] = changes['teacher']
            if 'room' in changes:
                cell['room'] = changes['room']
            if 'type' in changes:
                cell['type'] = changes['type']
            if 'new_time' in changes:
                cell['rescheduled_time'] = changes['new_time']
            if 'new_date' in changes:
                cell['rescheduled_date'] = changes['new_date']
            if 'link' in changes:
                cell['link'] = changes['link']
            if 'notes' in changes:
                cell['notes'] = changes['notes']

    return week_grid, day_overrides


# ── Routes ────────────────────────────────────────────────────────────────────

@timetable_bp.route('/semester/<semester_id>/extract', methods=['POST'])
@cross_origin()
@token_required
def extract_timetable(semester_id):
    """CR uploads image → ML extracts timetable → returns JSON for review."""
    from database import get_db
    from utils.timetable_ml import extract_timetable_from_image

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester, classroom, is_cr = _get_semester_and_check(db, semester_id, user_id)
        if semester is None:
            return jsonify({'error': 'Semester not found or access denied'}), 404
        if not is_cr:
            return jsonify({'error': 'Only a CR can upload the timetable'}), 403

        if 'file' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400

        file = request.files['file']
        if not file.filename:
            return jsonify({'error': 'Empty filename'}), 400

        image_data = file.read()
        mime_type = file.content_type or 'image/jpeg'

        # If PDF, convert first page to image
        if mime_type == 'application/pdf' or file.filename.lower().endswith('.pdf'):
            try:
                import io
                from PIL import Image
                import fitz  # PyMuPDF
                pdf_doc = fitz.open(stream=image_data, filetype='pdf')
                page = pdf_doc[0]
                pix = page.get_pixmap(dpi=150)
                img = Image.frombytes('RGB', [pix.width, pix.height], pix.samples)
                buf = io.BytesIO()
                img.save(buf, format='JPEG', quality=90)
                image_data = buf.getvalue()
                mime_type = 'image/jpeg'
            except ImportError:
                # PyMuPDF not installed — attempt as image anyway
                mime_type = 'image/jpeg'

        result = extract_timetable_from_image(image_data, mime_type)

        if not result['success']:
            return jsonify({'error': result['error'], 'retry': True}), 422

        return jsonify({'extracted': result['data']}), 200

    except Exception as e:
        logger.error(f"Extract timetable error: {e}")
        return jsonify({'error': 'Extraction failed', 'retry': True}), 500


@timetable_bp.route('/semester/<semester_id>', methods=['POST'])
@cross_origin()
@token_required
def save_timetable(semester_id):
    """Save or replace the base timetable for a semester (CR only)."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester, classroom, is_cr = _get_semester_and_check(db, semester_id, user_id)
        if semester is None:
            return jsonify({'error': 'Semester not found or access denied'}), 404
        if not is_cr:
            return jsonify({'error': 'Only a CR can save the timetable'}), 403

        data = request.get_json()
        days = data.get('days', [])
        time_slots = data.get('time_slots', [])
        grid = data.get('grid', {})

        if not days or not time_slots or not grid:
            return jsonify({'error': 'days, time_slots, and grid are required'}), 400

        now = datetime.now(timezone.utc)
        existing = db.timetables.find_one({'semester_id': semester_id})

        if existing:
            old_grid = existing.get('grid', {})
            old_days = existing.get('days', [])
            old_slots = existing.get('time_slots', [])

            db.timetables.update_one(
                {'_id': existing['_id']},
                {'$set': {
                    'days': days,
                    'time_slots': time_slots,
                    'grid': grid,
                    'updated_by': user_id,
                    'updated_at': now,
                }}
            )
            doc = db.timetables.find_one({'_id': existing['_id']})

            # Clean up any leftover base-edit overrides — base changes reflect
            # directly in the grid, so these stale overrides are no longer needed.
            db.timetable_overrides.delete_many({
                'semester_id': semester_id,
                'is_base_edit': True,
            })

            # Detect changed cells for notifications and GCal resync
            all_days_union = set(old_days) | set(days)
            all_slots_union = set(old_slots) | set(time_slots)
            changed_cells = []
            for day in all_days_union:
                for slot in all_slots_union:
                    old_cell = old_grid.get(day, {}).get(slot, {})
                    new_cell = grid.get(day, {}).get(slot, {})
                    if (old_cell.get('subject', '') != new_cell.get('subject', '') or
                            old_cell.get('type', '') != new_cell.get('type', '') or
                            old_cell.get('teacher', '') != new_cell.get('teacher', '') or
                            old_cell.get('room', '') != new_cell.get('room', '')):
                        changed_cells.append((day, slot, new_cell))

            if changed_cells:
                cr_user = db.users.find_one({'_id': ObjectId(user_id)})
                cr_name = (cr_user.get('display_name') or cr_user.get('username', 'CR')) if cr_user else 'CR'

                notif_msg = f"Timetable updated: {len(changed_cells)} slot(s) changed in the base timetable."
                try:
                    db.messages.insert_one({
                        'semester_id': semester_id,
                        'user_id': user_id,
                        'username': cr_name,
                        'text': f"[TIMETABLE UPDATE] {notif_msg}",
                        'is_system': True,
                        'created_at': now,
                        'files': [],
                    })
                except Exception as chat_err:
                    logger.warning(f"Failed to post chat notification: {chat_err}")

                try:
                    from socketio_instance import socketio
                    socketio.emit('timetable_override', {
                        'semester_id': semester_id,
                        'message': notif_msg,
                    }, room=f'semester_{semester_id}')
                except Exception as sock_err:
                    logger.warning(f"Socket emit failed: {sock_err}")

                # Auto-resync Google Calendar for all users who previously pushed
                for pushed_user_id in existing.get('pushed_by', []):
                    try:
                        _resync_gcal_for_user(db, str(pushed_user_id), semester_id, doc)
                    except Exception as gcal_err:
                        logger.warning(f"GCal resync failed for user {pushed_user_id}: {gcal_err}")

        else:
            result = db.timetables.insert_one({
                'semester_id': semester_id,
                'classroom_id': str(semester['classroom_id']),
                'days': days,
                'time_slots': time_slots,
                'grid': grid,
                'created_by': user_id,
                'updated_by': user_id,
                'created_at': now,
                'updated_at': now,
            })
            doc = db.timetables.find_one({'_id': result.inserted_id})

        return jsonify({'timetable': _serialize_timetable(doc)}), 200

    except Exception as e:
        logger.error(f"Save timetable error: {e}")
        return jsonify({'error': 'Failed to save timetable'}), 500


@timetable_bp.route('/semester/<semester_id>', methods=['GET'])
@cross_origin()
@token_required
def get_timetable(semester_id):
    """Get the base timetable for a semester (all members)."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester, classroom, is_cr = _get_semester_and_check(db, semester_id, user_id)
        if semester is None:
            return jsonify({'error': 'Semester not found or access denied'}), 404

        doc = db.timetables.find_one({'semester_id': semester_id})
        return jsonify({
            'timetable': _serialize_timetable(doc),
            'is_cr': is_cr,
        }), 200

    except Exception as e:
        logger.error(f"Get timetable error: {e}")
        return jsonify({'error': 'Failed to fetch timetable'}), 500


@timetable_bp.route('/semester/<semester_id>/week', methods=['GET'])
@cross_origin()
@token_required
def get_week_view(semester_id):
    """
    Get this week's timetable with overrides applied.
    Query param: ?date=YYYY-MM-DD (any date in the desired week; defaults to today)
    """
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester, classroom, is_cr = _get_semester_and_check(db, semester_id, user_id)
        if semester is None:
            return jsonify({'error': 'Semester not found or access denied'}), 404

        doc = db.timetables.find_one({'semester_id': semester_id})
        if not doc:
            return jsonify({'timetable': None, 'week_grid': {}, 'is_cr': is_cr}), 200

        # Determine week start (Monday)
        date_str = request.args.get('date')
        if date_str:
            try:
                ref_date = date.fromisoformat(date_str)
            except ValueError:
                ref_date = date.today()
        else:
            ref_date = date.today()

        week_start = ref_date - timedelta(days=ref_date.weekday())  # Monday
        week_end = week_start + timedelta(days=6)

        # Fetch overrides for this week (both 'this_day' for the week dates and 'all_future')
        week_dates = [(week_start + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(7)]

        overrides_cursor = db.timetable_overrides.find({
            'semester_id': semester_id,
            '$or': [
                {'date': {'$in': week_dates}},
                {'scope': 'all_future'},
            ]
        })
        overrides = [_serialize_override(ov) for ov in overrides_cursor]

        week_grid, day_overrides = _apply_overrides_to_week(
            doc.get('grid', {}),
            doc.get('days', []),
            doc.get('time_slots', []),
            overrides,
            week_start,
        )

        # Fetch academic calendar events that fall within this week
        ac_events = {}
        try:
            ac_doc = db.academic_calendars.find_one({'semester_id': semester_id})
            if ac_doc:
                for ev in ac_doc.get('events', []):
                    if not ev.get('date'):
                        continue
                    ev_start = ev['date']
                    ev_end = ev.get('end_date') or ev_start
                    for date_str in week_dates:
                        if ev_start <= date_str <= ev_end:
                            if date_str not in ac_events:
                                ac_events[date_str] = []
                            ac_events[date_str].append({
                                'type': ev.get('type', 'Other'),
                                'title': ev.get('title', ''),
                                'start_time': ev.get('start_time', ''),
                                'end_time': ev.get('end_time', ''),
                            })
        except Exception as ac_err:
            logger.warning(f"Failed to fetch AC events for week view: {ac_err}")

        return jsonify({
            'timetable': _serialize_timetable(doc),
            'week_grid': week_grid,
            'week_start': week_start.isoformat(),
            'week_end': week_end.isoformat(),
            'is_cr': is_cr,
            'ac_events': ac_events,
            'day_overrides': day_overrides,
        }), 200

    except Exception as e:
        logger.error(f"Get week view error: {e}")
        return jsonify({'error': 'Failed to fetch week view'}), 500


@timetable_bp.route('/semester/<semester_id>/today', methods=['GET'])
@cross_origin()
@token_required
def get_today(semester_id):
    """Get today's classes with overrides applied."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester, classroom, is_cr = _get_semester_and_check(db, semester_id, user_id)
        if semester is None:
            return jsonify({'error': 'Semester not found or access denied'}), 404

        doc = db.timetables.find_one({'semester_id': semester_id})
        if not doc:
            return jsonify({'classes': [], 'day': '', 'is_cr': is_cr}), 200

        today = date.today()
        day_names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        today_day = day_names[today.weekday()]
        today_str = today.strftime('%Y-%m-%d')

        if today_day not in doc.get('days', []):
            return jsonify({'classes': [], 'day': today_day, 'is_cr': is_cr}), 200

        overrides_cursor = db.timetable_overrides.find({
            'semester_id': semester_id,
            'day': today_day,
            '$or': [
                {'date': today_str},
                {'scope': 'all_future'},
            ]
        })
        overrides = [_serialize_override(ov) for ov in overrides_cursor]

        week_start = today - timedelta(days=today.weekday())
        week_grid, _ = _apply_overrides_to_week(
            doc.get('grid', {}),
            [today_day],
            doc.get('time_slots', []),
            overrides,
            week_start,
        )

        today_slots = week_grid.get(today_day, {})
        classes = []
        for slot in doc.get('time_slots', []):
            cell = today_slots.get(slot, {})
            classes.append({'slot': slot, **cell})

        return jsonify({'classes': classes, 'day': today_day, 'is_cr': is_cr}), 200

    except Exception as e:
        logger.error(f"Get today error: {e}")
        return jsonify({'error': 'Failed to fetch today\'s classes'}), 500


@timetable_bp.route('/semester/<semester_id>/override', methods=['POST'])
@cross_origin()
@token_required
def add_override(semester_id):
    """CR adds a day-specific override (cancel / reschedule / edit)."""
    from database import get_db
    from socketio_instance import socketio

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester, classroom, is_cr = _get_semester_and_check(db, semester_id, user_id)
        if semester is None:
            return jsonify({'error': 'Semester not found or access denied'}), 404
        if not is_cr:
            return jsonify({'error': 'Only a CR can add overrides'}), 403

        data = request.get_json()
        required = ('date', 'day', 'slot', 'action', 'scope')
        if not all(data.get(f) for f in required):
            return jsonify({'error': f'Required fields: {", ".join(required)}'}), 400

        action = data['action']
        if action not in ('cancel', 'reschedule', 'edit'):
            return jsonify({'error': 'action must be cancel, reschedule, or edit'}), 400

        scope = data['scope']
        if scope not in ('this_day', 'all_future'):
            return jsonify({'error': 'scope must be this_day or all_future'}), 400

        # Get CR's display name for notifications
        cr_user = db.users.find_one({'_id': ObjectId(user_id)})
        cr_name = cr_user.get('display_name') or cr_user.get('username', 'CR') if cr_user else 'CR'

        timetable = db.timetables.find_one({'semester_id': semester_id})
        timetable_id = str(timetable['_id']) if timetable else ''

        override_doc = {
            'timetable_id': timetable_id,
            'semester_id': semester_id,
            'classroom_id': str(semester.get('classroom_id', '')),
            'date': data['date'],
            'day': data['day'],
            'slot': data['slot'],
            'action': action,
            'scope': scope,
            'changes': data.get('changes', {}),
            'reason': data.get('reason', '').strip(),
            'created_by': user_id,
            'created_by_name': cr_name,
            'created_at': datetime.now(timezone.utc),
        }

        result = db.timetable_overrides.insert_one(override_doc)
        override_doc['_id'] = result.inserted_id

        # Build notification message
        action_text = {
            'cancel': 'cancelled',
            'reschedule': 'rescheduled',
            'edit': 'modified',
        }[action]
        slot = data['slot']
        day = data['day']
        reason = data.get('reason', '').strip()
        scope_text = 'on ' + data['date'] if scope == 'this_day' else 'from ' + data['date'] + ' onwards'
        notif_msg = f"Timetable change: {slot} class on {day} {scope_text} has been {action_text}"
        if reason:
            notif_msg += f". Reason: {reason}"

        # Post auto-message to semester chat
        try:
            chat_msg = {
                'semester_id': semester_id,
                'user_id': user_id,
                'username': cr_name,
                'text': f"[TIMETABLE UPDATE] {notif_msg}",
                'is_system': True,
                'created_at': datetime.now(timezone.utc),
                'files': [],
            }
            db.messages.insert_one(chat_msg)
        except Exception as chat_err:
            logger.warning(f"Failed to post chat notification: {chat_err}")

        # Emit socket.IO notification to semester room
        try:
            socketio.emit('timetable_override', {
                'semester_id': semester_id,
                'message': notif_msg,
                'override': _serialize_override(override_doc),
            }, room=f'semester_{semester_id}')
        except Exception as sock_err:
            logger.warning(f"Socket emit failed: {sock_err}")

        return jsonify({
            'override': _serialize_override(override_doc),
            'message': 'Override added'
        }), 201

    except Exception as e:
        logger.error(f"Add override error: {e}")
        return jsonify({'error': 'Failed to add override'}), 500


@timetable_bp.route('/semester/<semester_id>/override/<override_id>', methods=['DELETE'])
@cross_origin()
@token_required
def delete_override(semester_id, override_id):
    """CR deletes a specific override."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester, classroom, is_cr = _get_semester_and_check(db, semester_id, user_id)
        if semester is None:
            return jsonify({'error': 'Semester not found or access denied'}), 404
        if not is_cr:
            return jsonify({'error': 'Only a CR can delete overrides'}), 403

        ov = db.timetable_overrides.find_one({'_id': ObjectId(override_id), 'semester_id': semester_id})
        if not ov:
            return jsonify({'error': 'Override not found'}), 404

        db.timetable_overrides.delete_one({'_id': ObjectId(override_id)})
        return jsonify({'message': 'Override deleted'}), 200

    except Exception as e:
        logger.error(f"Delete override error: {e}")
        return jsonify({'error': 'Failed to delete override'}), 500


@timetable_bp.route('/semester/<semester_id>/overrides', methods=['GET'])
@cross_origin()
@token_required
def list_overrides(semester_id):
    """List upcoming overrides for a semester (all members)."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester, classroom, is_cr = _get_semester_and_check(db, semester_id, user_id)
        if semester is None:
            return jsonify({'error': 'Semester not found or access denied'}), 404

        today_str = date.today().strftime('%Y-%m-%d')
        cursor = db.timetable_overrides.find({
            'semester_id': semester_id,
            '$or': [
                {'date': {'$gte': today_str}},
                {'scope': 'all_future'},
            ]
        }).sort('date', 1)

        overrides = [_serialize_override(ov) for ov in cursor]
        return jsonify({'overrides': overrides, 'is_cr': is_cr}), 200

    except Exception as e:
        logger.error(f"List overrides error: {e}")
        return jsonify({'error': 'Failed to fetch overrides'}), 500


# ── Push Timetable to Google Calendar (recurring events) ──────────────────────

def _parse_time_slot(slot_str):
    """Parse '8:00-9:00', '9am-10am', '14:00-15:00' → (sh, sm, eh, em) or None."""
    import re
    slot_str = slot_str.strip()
    m = re.match(r'^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})', slot_str)
    if m:
        return int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
    m = re.match(r'^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)', slot_str, re.I)
    if m:
        sh = int(m.group(1)); sm = int(m.group(2) or 0); sa = m.group(3).lower()
        eh = int(m.group(4)); em = int(m.group(5) or 0); ea = m.group(6).lower()
        if sa == 'pm' and sh != 12: sh += 12
        if sa == 'am' and sh == 12: sh = 0
        if ea == 'pm' and eh != 12: eh += 12
        if ea == 'am' and eh == 12: eh = 0
        return sh, sm, eh, em
    return None


def _day_to_rrule(day):
    return {'Mon': 'MO', 'Tue': 'TU', 'Wed': 'WE', 'Thu': 'TH', 'Fri': 'FR', 'Sat': 'SA', 'Sun': 'SU'}.get(day, 'MO')


def _resync_gcal_for_user(db, user_id, semester_id, doc):
    """
    Delete all previously-pushed IAPS timetable events for this semester
    from the user's Google Calendar, then recreate them from the current grid.
    Silently returns if the user hasn't pushed or has no GCal token.
    """
    from utils.google_calendar import get_calendar_service, create_calendar_event
    from google.auth.exceptions import RefreshError
    from googleapiclient.errors import HttpError

    push_config = doc.get('push_config', {}).get(str(user_id))
    if not push_config:
        return  # user never pushed

    token_doc = db.google_tokens.find_one({'user_id': str(user_id)})
    if not token_doc:
        return

    try:
        service = get_calendar_service(token_doc, db, str(user_id))
    except (RefreshError, Exception):
        return

    # Delete existing IAPS events for this semester
    try:
        page_token = None
        while True:
            resp = service.events().list(
                calendarId='primary',
                privateExtendedProperty=f'iaps_semester_id={semester_id}',
                privateExtendedProperty2='iaps_timetable=true',
                pageToken=page_token,
                maxResults=250,
            ).execute()
            for ev in resp.get('items', []):
                try:
                    service.events().delete(calendarId='primary', eventId=ev['id']).execute()
                except Exception:
                    pass
            page_token = resp.get('nextPageToken')
            if not page_token:
                break
    except Exception as e:
        logger.warning(f"GCal delete old events failed for user {user_id}: {e}")

    # Recreate with current grid
    TYPE_COLOR = {'Lecture': '7', 'Lab': '3', 'Tutorial': '2'}
    days = doc.get('days', [])
    time_slots = doc.get('time_slots', [])
    grid = doc.get('grid', {})

    try:
        sem_start = date.fromisoformat(push_config.get('semester_start') or date.today().isoformat())
        sem_end = date.fromisoformat(push_config['semester_end'])
    except (ValueError, KeyError):
        return

    until_str = sem_end.strftime('%Y%m%dT235959Z')

    for day in days:
        first_date = _next_weekday_date(sem_start, day)
        for slot in time_slots:
            cell = grid.get(day, {}).get(slot, {})
            subject = cell.get('subject', '').strip()
            cell_type = cell.get('type', 'Free')
            if not subject or cell_type in ('Free', 'Lunch', 'Break', 'Library', 'Cancelled', ''):
                continue
            parsed = _parse_time_slot(slot)
            if not parsed:
                continue
            sh, sm, eh, em = parsed
            start_dt = datetime(first_date.year, first_date.month, first_date.day, sh, sm)
            end_dt = datetime(first_date.year, first_date.month, first_date.day, eh, em)
            teacher = cell.get('teacher', '')
            room = cell.get('room', '')
            desc_parts = []
            if teacher: desc_parts.append(f"Faculty: {teacher}")
            if room: desc_parts.append(f"Room: {room}")
            event_body = {
                'summary': subject,
                'description': '\n'.join(desc_parts),
                'location': room,
                'start': {'dateTime': start_dt.strftime('%Y-%m-%dT%H:%M:%S'), 'timeZone': 'Asia/Kolkata'},
                'end': {'dateTime': end_dt.strftime('%Y-%m-%dT%H:%M:%S'), 'timeZone': 'Asia/Kolkata'},
                'recurrence': [f'RRULE:FREQ=WEEKLY;BYDAY={_day_to_rrule(day)};UNTIL={until_str}'],
                'colorId': TYPE_COLOR.get(cell_type, '8'),
                'extendedProperties': {
                    'private': {'iaps_timetable': 'true', 'iaps_semester_id': semester_id, 'iaps_type': cell_type}
                },
            }
            try:
                create_calendar_event(service, event_body)
            except Exception:
                pass


def _next_weekday_date(ref_date, day_abbr):
    target = {'Mon': 0, 'Tue': 1, 'Wed': 2, 'Thu': 3, 'Fri': 4, 'Sat': 5, 'Sun': 6}.get(day_abbr, 0)
    return ref_date + timedelta(days=(target - ref_date.weekday()) % 7)


@timetable_bp.route('/semester/<semester_id>/push-to-calendar', methods=['POST'])
@cross_origin()
@token_required
def push_to_calendar(semester_id):
    """Convert base timetable into recurring weekly Google Calendar events."""
    from database import get_db
    from utils.google_calendar import get_calendar_service, create_calendar_event
    from google.auth.exceptions import RefreshError
    from googleapiclient.errors import HttpError

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester, classroom, is_cr = _get_semester_and_check(db, semester_id, user_id)
        if semester is None:
            return jsonify({'error': 'Semester not found or access denied'}), 404

        data = request.get_json()
        semester_end_str = data.get('semester_end', '').strip()
        semester_start_str = data.get('semester_start', '').strip()
        if not semester_end_str:
            return jsonify({'error': 'semester_end date is required'}), 400

        try:
            sem_end = date.fromisoformat(semester_end_str)
            sem_start = date.fromisoformat(semester_start_str) if semester_start_str else date.today()
        except ValueError:
            return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD'}), 400

        doc = db.timetables.find_one({'semester_id': semester_id})
        if not doc:
            return jsonify({'error': 'No timetable found for this semester'}), 404

        token_doc = db.google_tokens.find_one({'user_id': user_id})
        if not token_doc:
            return jsonify({'error': 'Google Calendar not connected', 'not_connected': True}), 403

        try:
            service = get_calendar_service(token_doc, db, user_id)
        except RefreshError:
            db.google_tokens.delete_one({'user_id': user_id})
            return jsonify({'error': 'Google Calendar access was revoked. Please reconnect.', 'not_connected': True}), 403

        until_str = sem_end.strftime('%Y%m%dT235959Z')
        # Google Calendar color IDs: 1=Lavender, 2=Sage, 3=Grape, 7=Peacock(blue), 6=Tangerine
        TYPE_COLOR = {'Lecture': '7', 'Lab': '3', 'Tutorial': '2'}

        days = doc.get('days', [])
        time_slots = doc.get('time_slots', [])
        grid = doc.get('grid', {})
        created = 0
        skipped = 0

        for day in days:
            first_date = _next_weekday_date(sem_start, day)
            for slot in time_slots:
                cell = grid.get(day, {}).get(slot, {})
                subject = cell.get('subject', '').strip()
                cell_type = cell.get('type', 'Free')
                if not subject or cell_type in ('Free', 'Lunch', 'Break', 'Library', ''):
                    skipped += 1
                    continue
                parsed = _parse_time_slot(slot)
                if not parsed:
                    skipped += 1
                    continue
                sh, sm, eh, em = parsed
                start_dt = datetime(first_date.year, first_date.month, first_date.day, sh, sm)
                end_dt = datetime(first_date.year, first_date.month, first_date.day, eh, em)
                teacher = cell.get('teacher', '')
                room = cell.get('room', '')
                desc_parts = []
                if teacher: desc_parts.append(f"Faculty: {teacher}")
                if room: desc_parts.append(f"Room: {room}")
                if cell_type not in ('Lecture', 'Lab', 'Tutorial'): desc_parts.append(f"Type: {cell_type}")
                event_body = {
                    'summary': subject,
                    'description': '\n'.join(desc_parts),
                    'location': room,
                    'start': {'dateTime': start_dt.strftime('%Y-%m-%dT%H:%M:%S'), 'timeZone': 'Asia/Kolkata'},
                    'end': {'dateTime': end_dt.strftime('%Y-%m-%dT%H:%M:%S'), 'timeZone': 'Asia/Kolkata'},
                    'recurrence': [f'RRULE:FREQ=WEEKLY;BYDAY={_day_to_rrule(day)};UNTIL={until_str}'],
                    'colorId': TYPE_COLOR.get(cell_type, '8'),
                    'extendedProperties': {
                        'private': {'iaps_timetable': 'true', 'iaps_semester_id': semester_id, 'iaps_type': cell_type}
                    },
                }
                try:
                    create_calendar_event(service, event_body)
                    created += 1
                except HttpError as he:
                    logger.warning(f"Failed to create event {day} {slot}: {he}")
                    skipped += 1

        db.timetables.update_one({'_id': doc['_id']}, {
            '$addToSet': {'pushed_by': user_id},
            '$set': {
                f'push_config.{user_id}': {
                    'semester_start': semester_start_str,
                    'semester_end': semester_end_str,
                }
            }
        })
        return jsonify({
            'message': f'{created} recurring class event{"s" if created != 1 else ""} added to your Google Calendar',
            'created': created,
            'skipped': skipped,
        }), 200

    except HttpError as e:
        logger.error(f"Google API error in push-to-calendar: {e}")
        return jsonify({'error': 'Google Calendar API error', 'details': str(e)}), 502
    except Exception as e:
        logger.error(f"Push to calendar error: {e}")
        return jsonify({'error': 'Failed to push timetable to calendar'}), 500


# ── Academic Calendar Routes ──────────────────────────────────────────────────

@timetable_bp.route('/semester/<semester_id>/academic-calendar/extract', methods=['POST'])
@cross_origin()
@token_required
def extract_academic_calendar(semester_id):
    """CR uploads academic calendar image → ML extracts events → returns JSON."""
    from database import get_db
    from utils.timetable_ml import extract_academic_calendar_from_image

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester, classroom, is_cr = _get_semester_and_check(db, semester_id, user_id)
        if semester is None:
            return jsonify({'error': 'Semester not found or access denied'}), 404
        if not is_cr:
            return jsonify({'error': 'Only a CR can upload the academic calendar'}), 403

        if 'file' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400

        file = request.files['file']
        image_data = file.read()
        mime_type = file.content_type or 'image/jpeg'

        result = extract_academic_calendar_from_image(image_data, mime_type)
        if not result['success']:
            return jsonify({'error': result['error'], 'retry': True}), 422

        return jsonify({'extracted': result['data']}), 200

    except Exception as e:
        logger.error(f"Extract academic calendar error: {e}")
        return jsonify({'error': 'Extraction failed', 'retry': True}), 500


@timetable_bp.route('/semester/<semester_id>/academic-calendar', methods=['POST'])
@cross_origin()
@token_required
def save_academic_calendar(semester_id):
    """CR saves/replaces the academic calendar (after review)."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester, classroom, is_cr = _get_semester_and_check(db, semester_id, user_id)
        if semester is None:
            return jsonify({'error': 'Semester not found or access denied'}), 404
        if not is_cr:
            return jsonify({'error': 'Only a CR can save the academic calendar'}), 403

        data = request.get_json()
        events = data.get('events', [])
        semester_start = data.get('semester_start')
        semester_end = data.get('semester_end')

        now = datetime.now(timezone.utc)
        existing = db.academic_calendars.find_one({'semester_id': semester_id})

        cal_doc = {
            'semester_id': semester_id,
            'classroom_id': str(semester.get('classroom_id', '')),
            'semester_start': semester_start,
            'semester_end': semester_end,
            'events': events,
            'updated_by': user_id,
            'updated_at': now,
        }

        if existing:
            db.academic_calendars.update_one({'_id': existing['_id']}, {'$set': cal_doc})
            cal_doc['_id'] = existing['_id']
        else:
            cal_doc['created_by'] = user_id
            cal_doc['created_at'] = now
            result = db.academic_calendars.insert_one(cal_doc)
            cal_doc['_id'] = result.inserted_id

        # Mark holidays on the timetable (store separately as overrides for display)
        # Holidays with type=="Holiday" auto-appear as cancelled days for all
        holiday_events = [e for e in events if e.get('type') == 'Holiday']
        for holiday in holiday_events:
            h_date = holiday.get('date', '')
            if not h_date:
                continue
            try:
                d = date.fromisoformat(h_date)
                day_names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
                day = day_names[d.weekday()]
            except ValueError:
                continue

            # Check if there's already an override for this date (don't duplicate)
            existing_ov = db.timetable_overrides.find_one({
                'semester_id': semester_id,
                'date': h_date,
                'action': 'cancel',
                'is_holiday': True,
            })
            if not existing_ov:
                timetable = db.timetables.find_one({'semester_id': semester_id})
                time_slots = timetable.get('time_slots', []) if timetable else []
                for slot in time_slots:
                    db.timetable_overrides.insert_one({
                        'timetable_id': str(timetable['_id']) if timetable else '',
                        'semester_id': semester_id,
                        'classroom_id': str(semester.get('classroom_id', '')),
                        'date': h_date,
                        'day': day,
                        'slot': slot,
                        'action': 'cancel',
                        'scope': 'this_day',
                        'changes': {},
                        'reason': holiday.get('title', 'Holiday'),
                        'created_by': user_id,
                        'created_by_name': 'Academic Calendar',
                        'is_holiday': True,
                        'created_at': datetime.now(timezone.utc),
                    })

        return jsonify({
            'message': 'Academic calendar saved',
            'academic_calendar': {
                'id': str(cal_doc['_id']),
                'semester_start': semester_start,
                'semester_end': semester_end,
                'events': events,
                'updated_at': now.isoformat(),
            }
        }), 200

    except Exception as e:
        logger.error(f"Save academic calendar error: {e}")
        return jsonify({'error': 'Failed to save academic calendar'}), 500


@timetable_bp.route('/semester/<semester_id>/academic-calendar', methods=['GET'])
@cross_origin()
@token_required
def get_academic_calendar(semester_id):
    """Get the academic calendar for a semester (all members)."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester, classroom, is_cr = _get_semester_and_check(db, semester_id, user_id)
        if semester is None:
            return jsonify({'error': 'Semester not found or access denied'}), 404

        doc = db.academic_calendars.find_one({'semester_id': semester_id})
        if not doc:
            return jsonify({'academic_calendar': None, 'is_cr': is_cr}), 200

        return jsonify({
            'academic_calendar': {
                'id': str(doc['_id']),
                'semester_start': doc.get('semester_start'),
                'semester_end': doc.get('semester_end'),
                'events': doc.get('events', []),
                'updated_at': doc.get('updated_at', doc.get('created_at', datetime.now(timezone.utc))).isoformat(),
            },
            'is_cr': is_cr,
        }), 200

    except Exception as e:
        logger.error(f"Get academic calendar error: {e}")
        return jsonify({'error': 'Failed to fetch academic calendar'}), 500


@timetable_bp.route('/semester/<semester_id>/academic-calendar/push-to-calendar', methods=['POST'])
@cross_origin()
@token_required
def push_academic_calendar_to_gcal(semester_id):
    """Push academic calendar events to the requesting user's Google Calendar."""
    from database import get_db
    from utils.google_calendar import get_calendar_service, create_calendar_event
    from google.auth.exceptions import RefreshError
    from googleapiclient.errors import HttpError

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester, classroom, is_cr = _get_semester_and_check(db, semester_id, user_id)
        if semester is None:
            return jsonify({'error': 'Semester not found or access denied'}), 404

        doc = db.academic_calendars.find_one({'semester_id': semester_id})
        if not doc:
            return jsonify({'error': 'No academic calendar found for this semester'}), 404

        token_doc = db.google_tokens.find_one({'user_id': user_id})
        if not token_doc:
            return jsonify({'error': 'Google Calendar not connected', 'not_connected': True}), 403

        try:
            service = get_calendar_service(token_doc, db, user_id)
        except RefreshError:
            db.google_tokens.delete_one({'user_id': user_id})
            return jsonify({'error': 'Google Calendar access was revoked. Please reconnect.', 'not_connected': True}), 403

        # Color mapping per event type (Google Calendar color IDs)
        TYPE_COLOR = {
            'Holiday': '11',   # Tomato/red
            'Exam':    '6',    # Tangerine/orange
            'Event':   '7',    # Peacock/blue
            'Break':   '3',    # Grape/purple
            'Submission': '5', # Banana/yellow
            'Other':   '8',    # Graphite
        }

        events = doc.get('events', [])
        created = 0
        skipped = 0

        for ev in events:
            ev_date = ev.get('date', '').strip()
            ev_end_date = ev.get('end_date', ev_date).strip()
            title = ev.get('title', '').strip()
            ev_type = ev.get('type', 'Other')
            description = ev.get('description', '').strip()

            if not ev_date or not title:
                skipped += 1
                continue

            try:
                date.fromisoformat(ev_date)
                end_dt = date.fromisoformat(ev_end_date)
                # Google Calendar all-day events: end date is exclusive (next day)
                exclusive_end = (end_dt + timedelta(days=1)).isoformat()
            except ValueError:
                skipped += 1
                continue

            desc_parts = [f"Type: {ev_type}"]
            if description:
                desc_parts.append(description)

            event_body = {
                'summary': title,
                'description': '\n'.join(desc_parts),
                'start': {'date': ev_date},
                'end': {'date': exclusive_end},
                'colorId': TYPE_COLOR.get(ev_type, '8'),
                'extendedProperties': {
                    'private': {'iaps_academic_calendar': 'true', 'iaps_semester_id': semester_id}
                },
            }
            try:
                create_calendar_event(service, event_body)
                created += 1
            except HttpError as he:
                logger.warning(f"Failed to create academic calendar event '{title}': {he}")
                skipped += 1

        return jsonify({
            'message': f'{created} event{"s" if created != 1 else ""} added to your Google Calendar',
            'created': created,
            'skipped': skipped,
        }), 200

    except HttpError as e:
        logger.error(f"Google API error in push-academic-calendar: {e}")
        return jsonify({'error': 'Google Calendar API error', 'details': str(e)}), 502
    except Exception as e:
        logger.error(f"Push academic calendar error: {e}")
        return jsonify({'error': 'Failed to push academic calendar to Google Calendar'}), 500
