'use client';

import { useState } from 'react';
import { usePolling } from '@/hooks/use-polling';
import { PageHeader, Card, Badge, Spinner, EmptyState, Button } from '@/components/ui';
import { FeedbackButtons } from '@/components/feedback-buttons';
import { Activity, Wrench, Brain, MessageSquare, ShieldAlert, AlertCircle, Cpu, GitBranch } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface LogEntry {
  id: string;
  traceId: string;
  timestamp: number;
  actionType: string;
  payload: Record<string, unknown>;
  status: string;
}

interface ActivityResponse {
  activities: LogEntry[];
  total: number;
  hasMore: boolean;
}

const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  model_call: Cpu,
  model_response: Brain,
  tool_call: Wrench,
  tool_result: Wrench,
  thinking: Brain,
  message_sent: MessageSquare,
  message_received: MessageSquare,
  security_event: ShieldAlert,
  error: AlertCircle,
  sub_agent_spawn: GitBranch,
};

const ACTION_LABELS: Record<string, string> = {
  model_call: 'Model Called',
  model_response: 'Model Response',
  tool_call: 'Tool Invoked',
  tool_result: 'Tool Result',
  thinking: 'Reasoning',
  message_sent: 'Message Sent',
  message_received: 'Message Received',
  security_event: 'Security Event',
  error: 'Error',
  sub_agent_spawn: 'Sub-Agent Spawned',
};

const STATUS_VARIANTS: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  success: 'success',
  error: 'error',
  blocked: 'error',
  pending: 'warning',
};

export default function ActivityPage() {
  const { data, loading } = usePolling<ActivityResponse>('/api/activity?limit=50', 3000);
  const [filter, setFilter] = useState<string | null>(null);

  const activities = data?.activities || [];
  const filtered = filter
    ? activities.filter((a) => a.actionType === filter)
    : activities;

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Activity Feed" subtitle="Real-time stream of all agent actions and decisions">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={filter === null ? 'primary' : 'ghost'}
            onClick={() => setFilter(null)}
          >
            All
          </Button>
          {['tool_call', 'model_response', 'thinking', 'security_event'].map((type) => (
            <Button
              key={type}
              size="sm"
              variant={filter === type ? 'primary' : 'ghost'}
              onClick={() => setFilter(type)}
            >
              {ACTION_LABELS[type]?.split(' ')[0]}
            </Button>
          ))}
        </div>
      </PageHeader>

      <div className="flex-1 overflow-auto p-6 space-y-3">
        {filtered.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No activity yet"
            description="Agent actions will appear here as they happen. Start a conversation in the terminal or chat."
          />
        ) : (
          filtered.map((entry) => (
            <ActivityCard key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}

function ActivityCard({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = ACTION_ICONS[entry.actionType] || Activity;
  const label = ACTION_LABELS[entry.actionType] || entry.actionType;
  const statusVariant = STATUS_VARIANTS[entry.status] || 'default';

  const summary = getPayloadSummary(entry);

  return (
    <Card hover className="animate-slide-up">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-adytum-surface-2">
          <Icon className="h-4 w-4 text-adytum-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-adytum-text">{label}</span>
            <Badge variant={statusVariant}>{entry.status}</Badge>
            <span className="ml-auto text-xs text-adytum-text-muted">
              {formatDistanceToNow(entry.timestamp, { addSuffix: true })}
            </span>
          </div>
          <p className="mt-1 text-sm text-adytum-text-dim truncate">
            {summary}
          </p>
          {expanded && (
            <pre className="mt-2 p-3 rounded-lg bg-adytum-bg text-xs text-adytum-text-dim overflow-x-auto">
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-adytum-accent hover:text-adytum-accent-light"
            >
              {expanded ? 'Collapse' : 'Details'}
            </button>
            <span className="text-xs text-adytum-text-muted">
              trace: {entry.traceId.slice(0, 8)}
            </span>
            <FeedbackButtons traceId={entry.traceId} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function getPayloadSummary(entry: LogEntry): string {
  const p = entry.payload;
  switch (entry.actionType) {
    case 'tool_call':
      return `Calling ${p.tool}(${JSON.stringify(p.arguments || {}).slice(0, 80)})`;
    case 'tool_result':
      return `${p.tool} → ${p.isError ? 'ERROR: ' : ''}${String(p.result).slice(0, 100)}`;
    case 'model_call':
      return `Model: ${p.model} | ${p.messageCount} messages`;
    case 'model_response':
      return `Response from ${p.model}`;
    case 'thinking':
      return String(p.thought).slice(0, 120);
    case 'security_event':
      return `${p.action}: ${p.reason || p.blockedPath || ''}`;
    default:
      return JSON.stringify(p).slice(0, 120);
  }
}
