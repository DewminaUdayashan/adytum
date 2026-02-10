'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getWebSocketUrl } from '@/lib/api';

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
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(getWebSocketUrl());
    socketRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Send connect frame
      ws.send(JSON.stringify({
        type: 'connect',
        channel: 'dashboard',
        sessionId: sessionIdRef.current,
      }));
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as StreamEvent;
        if (data.type === 'connect' && data.sessionId) {
          sessionIdRef.current = data.sessionId;
        }
        setEvents((prev) => [...prev.slice(-500), data]); // Keep last 500
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 3s
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  const sendMessage = useCallback((content: string, sessionId: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'message',
        sessionId,
        content,
      }));
    }
  }, []);

  const clearEvents = useCallback(() => setEvents([]), []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      socketRef.current?.close();
    };
  }, [connect]);

  return { connected, events, sendMessage, clearEvents, sessionId: sessionIdRef.current };
}
