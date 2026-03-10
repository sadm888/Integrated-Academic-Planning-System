import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { BACKEND_URL } from '../services/api';

/**
 * useSocket — manages a Socket.IO connection for a semester chat room.
 *
 * @param {string} semesterId
 * @param {object} handlers  — { onMessage, onDeleted, onWarn, onPinned, onUnpinned }
 * @returns {{ socketRef: React.MutableRefObject, connected: boolean }}
 */
export function useSocket(semesterId, handlers = {}) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  // Keep a stable ref to the latest handlers so the effect never needs to
  // re-run when callbacks change (avoids stale closures).
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!semesterId) return;

    const token = localStorage.getItem('token');
    const socket = io(BACKEND_URL, {
      query: { token },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_room', { semester_id: semesterId });
    });

    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on('new_message',        (msg)  => handlersRef.current.onMessage?.(msg));
    socket.on('message_deleted',    (data) => handlersRef.current.onDeleted?.(data));
    socket.on('message_tombstoned', (data) => handlersRef.current.onTombstoned?.(data));
    socket.on('warn_notification',  (data) => handlersRef.current.onWarn?.(data));
    socket.on('message_pinned',     (data) => handlersRef.current.onPinned?.(data));
    socket.on('message_unpinned',   (data) => handlersRef.current.onUnpinned?.(data));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [semesterId]);

  return { socketRef, connected };
}
