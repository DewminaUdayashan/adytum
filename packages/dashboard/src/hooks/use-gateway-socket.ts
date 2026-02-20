'use client';

/**
 * @file packages/dashboard/src/hooks/use-gateway-socket.ts
 * @description Provides reusable React hooks for dashboard behavior using Socket.IO.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { getSocketIOUrl } from '@/lib/api';

export interface StreamEvent {
  type: string;
  sessionId?: string;
  traceId?: string;
  delta?: string;
  streamType?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export function useGatewaySocket() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  // Helper to ensure we don't start multiple connections strictly in strict mode
  const connectingRef = useRef(false);
  const hasRestoredRef = useRef(false);

  // Restore events from sessionStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.sessionStorage.getItem('adytum.console.events');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as StreamEvent[];
        if (Array.isArray(parsed)) setEvents(parsed);
      } catch {
        // ignore
      }
    }
    hasRestoredRef.current = true;
  }, []);

  // Persist events to sessionStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!hasRestoredRef.current) return;
    window.sessionStorage.setItem('adytum.console.events', JSON.stringify(events));
  }, [events]);

  const handleIncomingData = useCallback((data: any) => {
    // If it's a connect ack
    if (data && data.type === 'connect' && data.sessionId) {
      sessionIdRef.current = data.sessionId;
    }

    // Normalize data to StreamEvent
    const event = data as StreamEvent;

    // DEBUG: Log incoming event to console
    if (event.type === 'input_request' || event.type === 'input_response') {
      console.log('[Dashboard] Received event:', event);
    }

    setEvents((prev) => {
      // Deduplicate if needed? For now just append.
      return [...prev.slice(-500), event];
    });
  }, []);

  const connect = useCallback(() => {
    if (socketRef.current?.connected || connectingRef.current) return;
    connectingRef.current = true;

    const socketUrl = getSocketIOUrl();
    console.log('Connecting to Socket.IO:', socketUrl);

    const socket = io(socketUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Socket.IO Connected:', socket.id);
      setConnected(true);
      connectingRef.current = false;

      // Send handshake/identify message
      socket.emit('message', {
        type: 'connect',
        channel: 'dashboard',
        sessionId: sessionIdRef.current,
      });
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket.IO Disconnected:', reason);
      setConnected(false);
      connectingRef.current = false;
    });

    socket.on('connect_error', (err) => {
      console.error('Socket.IO Connection Error:', err);
      connectingRef.current = false;
    });

    // Handle standard messages (chat, stream frames)
    socket.on('message', (data: any) => {
      handleIncomingData(data);
    });

    // Handle generic Event Bus events
    socket.on('event', (data: any) => {
      // Tag them so UI can distinguish if needed
      handleIncomingData({ ...data, source: 'eventLoop' });
    });
  }, [handleIncomingData]);

  const sendMessage = useCallback(
    (
      content: string,
      sessionId: string,
      options?: {
        modelRole?: string;
        modelId?: string;
        workspaceId?: string;
        attachments?: Array<{
          type: 'image' | 'file' | 'audio' | 'video';
          data: string;
          name?: string;
        }>;
      },
    ) => {
      if (socketRef.current?.connected) {
        socketRef.current.emit('message', {
          type: 'message',
          sessionId,
          content,
          ...options,
        });
      }
    },
    [],
  );

  const sendFrame = useCallback((frame: Record<string, unknown>) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('message', frame);
    }
  }, []);

  const clearEvents = useCallback(() => setEvents([]), []);

  useEffect(() => {
    connect();
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      connectingRef.current = false;
    };
  }, [connect]);

  return {
    connected,
    events,
    sendMessage,
    sendFrame,
    clearEvents,
    sessionId: sessionIdRef.current,
    sendInputResponse: useCallback((id: string, response: string) => {
      if (socketRef.current?.connected) {
        socketRef.current.emit('message', {
          type: 'input_response',
          id,
          response,
          sessionId: sessionIdRef.current,
        });
      }
    }, []),
  };
}
