"""
presence.py — cross-instance Socket.IO presence tracking.

Backs "is this user online" / "who's in this room" with Redis reference
counts so the answer is correct no matter which instance a given socket
connection landed on. Without REDIS_URL set (single-instance/dev), every
function here is a no-op that returns None — callers fall back to the
existing in-process `_connected_users` dict, so behavior is unchanged
until Redis is actually configured.

Counts (not sets) because a user can have multiple simultaneous sockets
(multiple tabs/devices), each possibly connected to a different instance
and joining a room independently.
"""
import os
import logging

logger = logging.getLogger(__name__)

_redis_client = None
_redis_checked = False

USER_CONN_KEY = 'presence:user_conns'


def _get_redis():
    global _redis_client, _redis_checked
    if not _redis_checked:
        _redis_checked = True
        redis_url = os.environ.get('REDIS_URL', '').strip()
        if redis_url:
            import redis
            _redis_client = redis.from_url(redis_url, decode_responses=True)
    return _redis_client


def _room_key(room: str) -> str:
    return f'presence:room:{room}'


def mark_connected(user_id: str):
    """Increment this user's active-connection count. No-op if Redis isn't configured."""
    r = _get_redis()
    if r is None:
        return
    try:
        r.hincrby(USER_CONN_KEY, user_id, 1)
    except Exception as e:
        logger.warning(f"presence.mark_connected failed: {e}")


def mark_disconnected(user_id: str):
    """Decrement this user's active-connection count, cleaning up at zero."""
    r = _get_redis()
    if r is None:
        return
    try:
        count = r.hincrby(USER_CONN_KEY, user_id, -1)
        if count <= 0:
            r.hdel(USER_CONN_KEY, user_id)
    except Exception as e:
        logger.warning(f"presence.mark_disconnected failed: {e}")


def online_user_ids(user_ids):
    """Return the subset of user_ids with at least one active connection anywhere.
    Returns None (meaning "unknown, use local fallback") if Redis isn't configured."""
    r = _get_redis()
    if r is None or not user_ids:
        return None
    try:
        counts = r.hmget(USER_CONN_KEY, list(user_ids))
        return {uid for uid, c in zip(user_ids, counts) if c and int(c) > 0}
    except Exception as e:
        logger.warning(f"presence.online_user_ids failed: {e}")
        return None


def join_room_presence(room: str, user_id: str):
    r = _get_redis()
    if r is None:
        return
    try:
        r.hincrby(_room_key(room), user_id, 1)
    except Exception as e:
        logger.warning(f"presence.join_room_presence failed: {e}")


def leave_room_presence(room: str, user_id: str):
    r = _get_redis()
    if r is None:
        return
    try:
        key = _room_key(room)
        count = r.hincrby(key, user_id, -1)
        if count <= 0:
            r.hdel(key, user_id)
    except Exception as e:
        logger.warning(f"presence.leave_room_presence failed: {e}")


def room_online_user_ids(room: str):
    """Return user_ids with an active connection in this room, or None if Redis isn't configured."""
    r = _get_redis()
    if r is None:
        return None
    try:
        counts = r.hgetall(_room_key(room))
        return {uid for uid, c in counts.items() if int(c) > 0}
    except Exception as e:
        logger.warning(f"presence.room_online_user_ids failed: {e}")
        return None
