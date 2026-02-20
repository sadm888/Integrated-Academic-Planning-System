from flask import Blueprint, request, jsonify
from flask_cors import cross_origin
from datetime import datetime
from bson import ObjectId
import logging

from middleware import token_required, is_member_of_classroom

todo_bp = Blueprint('todo', __name__, url_prefix='/api/todo')
logger = logging.getLogger(__name__)


@todo_bp.route('/create', methods=['POST'])
@cross_origin()
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
            'completed': False,
            'created_by': user_id,
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow()
        }

        result = db.todos.insert_one(todo)

        # Fetch creator info for the response
        creator = db.users.find_one({'_id': ObjectId(user_id)})

        return jsonify({
            'message': 'Todo created',
            'todo': {
                'id': str(result.inserted_id),
                'text': text,
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
@cross_origin()
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
            {'semester_id': semester_id}
        ).sort('created_at', -1))

        result = []
        for todo in todos:
            creator = db.users.find_one({'_id': ObjectId(todo['created_by'])})
            result.append({
                'id': str(todo['_id']),
                'text': todo['text'],
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
@cross_origin()
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

        classroom = db.classrooms.find_one({'_id': ObjectId(todo['classroom_id'])})
        if not classroom or not is_member_of_classroom(classroom, user_id):
            return jsonify({'error': 'Access denied'}), 403

        new_value = not todo.get('completed', False)
        db.todos.update_one(
            {'_id': ObjectId(todo_id)},
            {'$set': {'completed': new_value, 'updated_at': datetime.utcnow()}}
        )

        return jsonify({
            'message': 'Todo updated',
            'completed': new_value
        }), 200

    except Exception as e:
        logger.error(f"Toggle todo error: {e}")
        return jsonify({'error': 'Failed to update todo'}), 500


@todo_bp.route('/<todo_id>', methods=['DELETE'])
@cross_origin()
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

        is_owner = todo['created_by'] == user_id

        # Check if CR of the semester
        semester = db.semesters.find_one({'_id': ObjectId(todo['semester_id'])})
        is_cr = semester and str(user_id) in [str(c) for c in semester.get('cr_ids', [])]

        if not (is_owner or is_cr):
            return jsonify({'error': 'Permission denied'}), 403

        db.todos.delete_one({'_id': ObjectId(todo_id)})

        return jsonify({'message': 'Todo deleted'}), 200

    except Exception as e:
        logger.error(f"Delete todo error: {e}")
        return jsonify({'error': 'Failed to delete todo'}), 500
