import os

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[],  # no global limit — apply per-route
    # REDIS_URL unset -> in-process storage (fine for a single instance/dev).
    # Set REDIS_URL in prod once running more than one instance, or limits
    # become per-instance and stop meaning anything.
    storage_uri=os.environ.get('REDIS_URL', '').strip() or 'memory://',
)
