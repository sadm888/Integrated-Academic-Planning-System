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

  // handlers gets a new object identity every render, so we stash the latest
  // version in a ref instead of listing it as a dependency below — otherwise
  // the socket would reconnect on every render.
  const handlersRef = useRef(handlers);
  useEffect(() => { handlersRef.current = handlers; });

  useEffect(() => {
    if (!classroomId || !withUserId) return;

    const token = localStorage.getItem('token');
    const socket = io(BACKEND_URL, {
      query: { token },
      // See useSocket.js — backend's gthread worker can't hold a native
      // WebSocket open, so skip straight to polling instead of wasting
      // several seconds on a doomed websocket attempt first.
      transports: ['polling'],
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
      // tear down and reconnect fresh whenever we switch threads
      socket.disconnect();
      socketRef.current = null;
    };
  }, [classroomId, withUserId]);

  return { socketRef, connected };
}
