"""
celery_app.py — Celery instance for offloading CPU-heavy AI/RAG work off the
web tier (PDF indexing today; see routes/ai_routes.py for the dispatch pattern).

Only meaningful when REDIS_URL is set: run a worker with
    celery -A celery_worker worker --loglevel=info
Without REDIS_URL, nothing imports this in a way that matters — callers fall
back to the original in-process threading.Thread behavior instead.
"""
import os

from celery import Celery

REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')

celery_app = Celery('iaps', broker=REDIS_URL, backend=REDIS_URL)
celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    task_track_started=True,
    result_expires=3600,  # 1 hour — plenty for a client to poll a completed task
)
