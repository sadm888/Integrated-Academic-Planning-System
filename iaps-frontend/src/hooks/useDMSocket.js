import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { BACKEND_URL } from '../services/api';

/**
 * useDMSocket — manages a Socket.IO connection for a private DM thread.
 *
 * @param {string} classroomId
 * @param {string} withUserId   — the other participant's user ID
 * @param {object} handlers     — { onMessage, onDeleted }
 * @returns {{ socketRef, connected }}
 */
export function useDMSocket(classroomId, withUserId, handlers = {}) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  const handlersRef = useRef(handlers);
  useEffect(() => { handlersRef.current = handlers; });

  useEffect(() => {
    if (!classroomId || !withUserId) return;

    const token = localStorage.getItem('token');
    const socket = io(BACKEND_URL, {
      query: { token },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_dm', { classroom_id: classroomId, with_user_id: withUserId });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on('dm_message',            (msg)  => handlersRef.current.onMessage?.(msg));
    socket.on('dm_message_deleted',    (data) => handlersRef.current.onDeleted?.(data));
    socket.on('dm_message_tombstoned', (data) => handlersRef.current.onTombstoned?.(data));
    socket.on('dm_read',               (data) => handlersRef.current.onRead?.(data));
    socket.on('dm_typing',             (data) => handlersRef.current.onTyping?.(data));
    socket.on('dm_reaction_updated',   (data) => handlersRef.current.onReactionUpdated?.(data));
    socket.on('dm_pin_updated',        (data) => handlersRef.current.onPinUpdated?.(data));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [classroomId, withUserId]);

  return { socketRef, connected };
}
