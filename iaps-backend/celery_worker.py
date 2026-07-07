"""
celery_worker.py — entrypoint for the Celery worker process.

    celery -A celery_worker worker --loglevel=info

Deliberately does not import app.py (Flask factory, Socket.IO, CORS, etc.) —
the worker only needs the task definitions and a DB connection, not the web stack.
"""
from celery_app import celery_app
from routes.ai_routes import _index_pdf_task  # noqa: F401 — registers the task

__all__ = ['celery_app']
