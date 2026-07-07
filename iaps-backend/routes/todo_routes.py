from flask import Blueprint, request, jsonify
from datetime import datetime, timezone
from bson import ObjectId
import logging

from middleware import token_required, is_member_of_classroom

todo_bp = Blueprint('todo', __name__, url_prefix='/api/todo')
logger = logging.getLogger(__name__)


@todo_bp.route('/create', methods=['POST'])
@token_required
def create_todo():
    """Create a new todo item in a semester. Any member can create."""
    from database import get_db

    try:
        data = request.get_json()
        user_id = request.user['user_id']

        classroom_id = data.get('classroom_id', '').strip()
        semester_id = data.get('semester_id', '').strip()
        text = data.get('text', '').strip()
        subject_id = (data.get('subject_id') or '').strip() or None
        due_date = (data.get('due_date') or '').strip() or None

        if not all([classroom_id, semester_id, text]):
            return jsonify({'error': 'Classroom ID, semester ID, and text are required'}), 400

        db = get_db()

        classroom = db.classrooms.find_one({'_id': ObjectId(classroom_id)})
        if not classroom or not is_member_of_classroom(classroom, user_id):
            return jsonify({'error': 'Access denied'}), 403

        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        todo = {
            'classroom_id': classroom_id,
            'semester_id': semester_id,
            'text': text,
            'subject_id': subject_id,
            'due_date': due_date,
            'completed': False,
            'created_by': user_id,
            'created_at': datetime.now(timezone.utc),
            'updated_at': datetime.now(timezone.utc)
        }

        result = db.todos.insert_one(todo)

        creator = db.users.find_one({'_id': ObjectId(user_id)})

        return jsonify({
            'message': 'Todo created',
            'todo': {
                'id': str(result.inserted_id),
                'text': text,
                'subject_id': subject_id,
                'due_date': due_date,
                'completed': False,
                'created_by': {
                    'id': user_id,
                    'username': creator['username'] if creator else 'Unknown'
                },
                'created_at': todo['created_at'].isoformat()
            }
        }), 201

    except Exception as e:
        logger.error(f"Create todo error: {e}")
        return jsonify({'error': 'Failed to create todo'}), 500


@todo_bp.route('/semester/<semester_id>/list', methods=['GET'])
@token_required
def list_todos(semester_id):
    """List all todos for a semester."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        semester = db.semesters.find_one({'_id': ObjectId(semester_id)})
        if not semester:
            return jsonify({'error': 'Semester not found'}), 404

        classroom = db.classrooms.find_one({'_id': ObjectId(semester['classroom_id'])})
        if not classroom or not is_member_of_classroom(classroom, user_id):
            return jsonify({'error': 'Access denied'}), 403

        todos = list(db.todos.find(
            {'semester_id': semester_id, 'created_by': user_id}
        ).sort('created_at', -1))

        result = []
        for todo in todos:
            creator = db.users.find_one({'_id': ObjectId(todo['created_by'])})
            result.append({
                'id': str(todo['_id']),
                'text': todo['text'],
                'subject_id': todo.get('subject_id'),
                'due_date': todo.get('due_date'),
                'completed': todo.get('completed', False),
                'created_by': {
                    'id': todo['created_by'],
                    'username': creator['username'] if creator else 'Unknown'
                },
                'created_at': todo['created_at'].isoformat()
            })

        return jsonify({'todos': result}), 200

    except Exception as e:
        logger.error(f"List todos error: {e}")
        return jsonify({'error': 'Failed to fetch todos'}), 500


@todo_bp.route('/<todo_id>/toggle', methods=['PATCH'])
@token_required
def toggle_todo(todo_id):
    """Toggle a todo's completed status. Any member can toggle."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        todo = db.todos.find_one({'_id': ObjectId(todo_id)})
        if not todo:
            return jsonify({'error': 'Todo not found'}), 404

        if todo['created_by'] != user_id:
            return jsonify({'error': 'Permission denied'}), 403

        new_value = not todo.get('completed', False)
        db.todos.update_one(
            {'_id': ObjectId(todo_id)},
            {'$set': {'completed': new_value, 'updated_at': datetime.now(timezone.utc)}}
        )

        return jsonify({
            'message': 'Todo updated',
            'completed': new_value
        }), 200

    except Exception as e:
        logger.error(f"Toggle todo error: {e}")
        return jsonify({'error': 'Failed to update todo'}), 500


@todo_bp.route('/<todo_id>', methods=['PATCH'])
@token_required
def update_todo(todo_id):
    """Edit a todo's text, subject link, and/or due date. Creator only."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        data = request.get_json()
        text = (data.get('text') or '').strip()

        if not text:
            return jsonify({'error': 'Text is required'}), 400

        db = get_db()

        todo = db.todos.find_one({'_id': ObjectId(todo_id)})
        if not todo:
            return jsonify({'error': 'Todo not found'}), 404

        if todo['created_by'] != user_id:
            return jsonify({'error': 'Permission denied'}), 403

        updates = {'text': text, 'updated_at': datetime.now(timezone.utc)}
        # subject_id/due_date are optional on the request; only touch a field if
        # the client actually sent it, so a client that only cares about editing
        # text doesn't accidentally clear an existing subject link or due date.
        if 'subject_id' in data:
            updates['subject_id'] = (data.get('subject_id') or '').strip() or None
        if 'due_date' in data:
            updates['due_date'] = (data.get('due_date') or '').strip() or None

        db.todos.update_one(
            {'_id': ObjectId(todo_id)},
            {'$set': updates}
        )

        return jsonify({
            'message': 'Todo updated',
            'text': text,
            'subject_id': updates.get('subject_id', todo.get('subject_id')),
            'due_date': updates.get('due_date', todo.get('due_date')),
        }), 200

    except Exception as e:
        logger.error(f"Update todo error: {e}")
        return jsonify({'error': 'Failed to update todo'}), 500


@todo_bp.route('/<todo_id>', methods=['DELETE'])
@token_required
def delete_todo(todo_id):
    """Delete a todo. Creator or CR can delete."""
    from database import get_db

    try:
        user_id = request.user['user_id']
        db = get_db()

        todo = db.todos.find_one({'_id': ObjectId(todo_id)})
        if not todo:
            return jsonify({'error': 'Todo not found'}), 404

        if todo['created_by'] != user_id:
            return jsonify({'error': 'Permission denied'}), 403

        db.todos.delete_one({'_id': ObjectId(todo_id)})

        return jsonify({'message': 'Todo deleted'}), 200

    except Exception as e:
        logger.error(f"Delete todo error: {e}")
        return jsonify({'error': 'Failed to delete todo'}), 500
