'use client';

/**
 * @file packages/dashboard/src/app/console/page.tsx
 * @description Defines route-level UI composition and page behavior.
 */

import { useEffect, useRef, useState } from 'react';
import { useGatewaySocket, type StreamEvent } from '@/hooks/use-gateway-socket';
import { Badge, Button } from '@/components/ui';
import { Terminal, Trash2, Pause, Play, Check, X } from 'lucide-react';
import { clsx } from 'clsx';

const TYPE_COLORS: Record<string, string> = {
  thinking: 'text-warning',
  response: 'text-success',
  tool_call: 'text-accent-primary',
  tool_result: 'text-accent-secondary',
  status: 'text-text-muted',
  token_update: 'text-accent-secondary',
  error: 'text-error',
  connect: 'text-success',
  message: 'text-text-primary',
  approval_request: 'text-warning',
  'file:created': 'text-accent-primary',
  'file:modified': 'text-accent-primary',
  'file:deleted': 'text-error',
  'graph:indexing_started': 'text-warning',
  'graph:indexing_completed': 'text-success',
  'graph:node_updated': 'text-success',
  'system:resource_usage': 'text-text-muted',
  'system:health_warning': 'text-warning',
};

const TYPE_PREFIXES: Record<string, string> = {
  thinking: '🧠 THINK',
  response: '💬 RESP',
  tool_call: '🔧 TOOL',
  tool_result: '📦 RESULT',
  status: '📡 STATUS',
  token_update: '💰 TOKEN',
  error: '❌ ERROR',
  connect: '🔗 CONN',
  message: '💬 MSG',
  approval_request: '✅ APPROVE',
  'file:created': '📁 CREATE',
  'file:modified': '📝 MODIFY',
  'file:deleted': '🗑️ DELETE',
  'graph:indexing_started': '🔍 INDEX',
  'graph:indexing_completed': '✅ DONE',
  'graph:node_updated': '🌿 GRAPH',
  'system:resource_usage': '📊 SYSTEM',
  'system:health_warning': '⚠️ HEALTH',
};

export default function ConsolePage() {
  const { connected, events, clearEvents, sendFrame, sendInputResponse } = useGatewaySocket();
  const [paused, setPaused] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const displayEvents = typeFilter
    ? events.filter((e) => (e.streamType || e.type) === typeFilter)
    : events;

  // Auto-scroll to bottom
  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displayEvents.length, paused]);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-medium">
              Live Stream
            </p>
            <h1 className="text-2xl font-semibold text-text-primary tracking-tight mt-1">
              Console
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={connected ? 'success' : 'error'}>
              {connected ? 'Connected' : 'Offline'}
            </Badge>
            <Button size="sm" variant="ghost" onClick={() => setPaused(!paused)}>
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={clearEvents}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Console output */}
      <div ref={scrollRef} className="flex-1 overflow-auto font-mono text-xs px-8 py-4 space-y-px">
        {displayEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <Terminal className="h-8 w-8 text-text-muted mb-3" />
            <p className="text-sm text-text-tertiary">Waiting for events…</p>
          </div>
        ) : (
          displayEvents.map((event, i) => (
            <ConsoleEntry
              key={i}
              event={event}
              onApprove={(id, approved) => sendFrame({ type: 'approval_response', id, approved })}
              onInputResponse={(id, response) => sendInputResponse(id, response)}
            />
          ))
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4 border-t border-border-primary px-8 py-2 text-[11px] text-text-muted">
        <span>{events.length} events</span>
        {paused && <span className="text-warning">⏸ Paused</span>}
      </div>
    </div>
  );
}

function ConsoleEntry({
  event,
  onApprove,
  onInputResponse,
}: {
  event: StreamEvent;
  onApprove: (id: string, approved: boolean) => void;
  onInputResponse: (id: string, response: string) => void;
}) {
  const type = event.streamType || event.type || 'unknown';
  let color = TYPE_COLORS[type] || 'text-text-secondary';
  let prefix = TYPE_PREFIXES[type] || type.toUpperCase();
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  const [inputValue, setInputValue] = useState('');
  const [submitted, setSubmitted] = useState(false);

  let content = '';
  if (event.delta) {
    content = event.delta;
    if (type === 'status') {
      const match = content.match(/^\[(dreamer_run|monologue_run)\]\s*/);
      if (match) {
        const tag = match[1];
        if (tag === 'dreamer_run') {
          prefix = '🌙 DREAMER';
          color = 'text-accent-primary';
        } else if (tag === 'monologue_run') {
          prefix = '🧠 MONOLOGUE';
          color = 'text-accent-secondary';
        }
        content = content.replace(/^\[[^\]]+\]\s*/, '');
      }
    }
  } else if (event.type === 'token_update') {
    content = `model=${event.model} tokens=${event.totalTokens} cost=$${(Number(event.estimatedCost) || 0).toFixed(4)}`;
  } else if (event.type === 'connect') {
    content = `channel=${event.channel} session=${String(event.sessionId || '').slice(0, 8)}`;
  } else if (event.type === 'message') {
    content = String(event.content || '').slice(0, 200);
  } else if (event.type === 'approval_request') {
    content = `${event.description || ''}`;
  } else if (event.type === 'input_request') {
    content = `${event.description || 'Input Requested'}`;
    color = 'text-accent-primary';
    prefix = '❓ INPUT';
    // Ensure streamType is set for filtering if needed, though we rely on event.type
  } else {
    content = JSON.stringify(event).slice(0, 200);
  }

  const isApproval = event.type === 'approval_request' && typeof event.id === 'string';
  const isInput = event.type === 'input_request' && typeof event.id === 'string';

  return (
    <div className="flex gap-3 hover:bg-bg-secondary/40 px-3 py-1 rounded-md transition-colors items-start">
      <span className="text-text-muted shrink-0">{time}</span>
      <span className={clsx('shrink-0 font-bold w-28', color)}>[{prefix}]</span>
      <div className="flex-1">
        <span className="text-text-secondary break-all">{content}</span>
        {isApproval && (
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => onApprove(event.id as string, true)}>
              <Check className="h-3 w-3" />
              Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onApprove(event.id as string, false)}>
              <X className="h-3 w-3" />
              Deny
            </Button>
          </div>
        )}
        {isInput && !submitted && (
          <div className="mt-2 flex gap-2 items-center">
            <input
              type="text"
              className="bg-bg-primary border border-border-primary rounded px-2 py-1 text-text-primary text-xs focus:outline-none focus:border-accent-primary w-full max-w-sm"
              placeholder="Type your response..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inputValue.trim()) {
                  onInputResponse(event.id as string, inputValue);
                  setSubmitted(true);
                }
              }}
            />
            <Button
              size="sm"
              variant="primary"
              disabled={!inputValue.trim()}
              onClick={() => {
                onInputResponse(event.id as string, inputValue);
                setSubmitted(true);
              }}
            >
              Send
            </Button>
          </div>
        )}
        {submitted && <div className="mt-1 text-success text-[10px]">Response sent.</div>}
      </div>
    </div>
  );
}
