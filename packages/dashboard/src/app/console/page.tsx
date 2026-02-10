'use client';

import { useEffect, useRef, useState } from 'react';
import { useGatewaySocket, type StreamEvent } from '@/hooks/use-gateway-socket';
import { PageHeader, Badge, EmptyState, Button } from '@/components/ui';
import { Terminal, Trash2, Pause, Play, Circle } from 'lucide-react';
import { clsx } from 'clsx';

const TYPE_COLORS: Record<string, string> = {
  thinking: 'text-yellow-400',
  response: 'text-green-400',
  tool_call: 'text-cyan-400',
  tool_result: 'text-blue-400',
  status: 'text-adytum-text-muted',
  token_update: 'text-purple-400',
  error: 'text-red-400',
  connect: 'text-emerald-400',
  message: 'text-adytum-text',
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
};

export default function ConsolePage() {
  const { connected, events, clearEvents } = useGatewaySocket();
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
    <div className="flex flex-col h-full">
      <PageHeader title="Live Console" subtitle="Real-time stream of agent reasoning and tool execution">
        <div className="flex items-center gap-2">
          <Badge variant={connected ? 'success' : 'error'}>
            <Circle className={clsx('h-2 w-2 mr-1', connected ? 'fill-adytum-success' : 'fill-adytum-error')} />
            {connected ? 'Connected' : 'Disconnected'}
          </Badge>
          <Button size="sm" variant="ghost" onClick={() => setPaused(!paused)}>
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button size="sm" variant="ghost" onClick={clearEvents}>
            <Trash2 className="h-3 w-3" />
            Clear
          </Button>
        </div>
      </PageHeader>

      {/* Filter bar */}
      <div className="flex items-center gap-1 border-b border-adytum-border px-6 py-2 overflow-x-auto">
        <Button size="sm" variant={typeFilter === null ? 'primary' : 'ghost'} onClick={() => setTypeFilter(null)}>
          All
        </Button>
        {['thinking', 'response', 'tool_call', 'tool_result', 'status', 'token_update'].map((t) => (
          <Button key={t} size="sm" variant={typeFilter === t ? 'primary' : 'ghost'} onClick={() => setTypeFilter(t)}>
            {TYPE_PREFIXES[t]?.split(' ')[1] || t}
          </Button>
        ))}
      </div>

      {/* Console output */}
      <div ref={scrollRef} className="flex-1 overflow-auto bg-adytum-bg font-mono text-xs p-4 space-y-0.5">
        {displayEvents.length === 0 ? (
          <EmptyState
            icon={Terminal}
            title="Console is empty"
            description="Events will stream here in real-time as the agent processes requests."
          />
        ) : (
          displayEvents.map((event, i) => (
            <ConsoleEntry key={i} event={event} />
          ))
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4 border-t border-adytum-border px-6 py-2 text-xs text-adytum-text-muted">
        <span>{events.length} events</span>
        {paused && <span className="text-adytum-warning">⏸ Paused</span>}
      </div>
    </div>
  );
}

function ConsoleEntry({ event }: { event: StreamEvent }) {
  const type = event.streamType || event.type || 'unknown';
  const color = TYPE_COLORS[type] || 'text-adytum-text-dim';
  const prefix = TYPE_PREFIXES[type] || type.toUpperCase();
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });

  let content = '';
  if (event.delta) {
    content = event.delta;
  } else if (event.type === 'token_update') {
    content = `model=${event.model} tokens=${event.totalTokens} cost=$${(Number(event.estimatedCost) || 0).toFixed(4)}`;
  } else if (event.type === 'connect') {
    content = `channel=${event.channel} session=${String(event.sessionId || '').slice(0, 8)}`;
  } else if (event.type === 'message') {
    content = String(event.content || '').slice(0, 200);
  } else {
    content = JSON.stringify(event).slice(0, 200);
  }

  return (
    <div className="flex gap-2 hover:bg-adytum-surface/50 px-2 py-0.5 rounded">
      <span className="text-adytum-text-muted shrink-0">{time}</span>
      <span className={clsx('shrink-0 font-bold w-18', color)}>[{prefix}]</span>
      <span className="text-adytum-text-dim break-all">{content}</span>
    </div>
  );
}
