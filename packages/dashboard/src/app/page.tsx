'use client';

/**
 * @file packages/dashboard/src/app/page.tsx
 * @description Defines route-level UI composition and page behavior.
 */

import { useMemo, useState } from 'react';
import { usePolling } from '@/hooks/use-polling';
import { useGatewaySocket } from '@/hooks/use-gateway-socket';
import { Badge, Spinner, Button, Card } from '@/components/ui';
import { FeedbackButtons } from '@/components/feedback-buttons';
import {
  Activity,
  Brain,
  MessageSquare,
  Zap,
  Coins,
  Cpu,
  GitBranch,
  ShieldAlert,
  AlertCircle,
  Wrench,
  Search,
  Filter,
  MoreHorizontal,
  ChevronRight,
  BarChart3,
  MessageCircle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { clsx } from 'clsx';

/* ── Types ── */

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

interface TokenOverview {
  total: { tokens: number; cost: number; calls: number };
  byProvider: Array<{ provider: string; tokens: number; cost: number; calls: number }>;
  byModel: Array<{
    provider: string;
    model: string;
    modelId: string;
    tokens: number;
    cost: number;
    calls: number;
  }>;
  recent: Array<{ sessionId: string }>;
}

/* ── Configuration ── */

const ACTION_CONFIG: Record<string, { icon: any; label: string; color: string }> = {
  model_call: { icon: Cpu, label: 'Model Call', color: 'text-violet-400' },
  model_response: { icon: Brain, label: 'Generation', color: 'text-fuchsia-400' },
  tool_call: { icon: Wrench, label: 'Tool Use', color: 'text-cyan-400' },
  tool_result: { icon: Wrench, label: 'Tool Output', color: 'text-cyan-300' },
  thinking: { icon: Brain, label: 'Reasoning', color: 'text-emerald-400' },
  message_sent: { icon: MessageSquare, label: 'Sent', color: 'text-blue-400' },
  message_received: { icon: MessageSquare, label: 'Received', color: 'text-indigo-400' },
  security_event: { icon: ShieldAlert, label: 'Security', color: 'text-red-400' },
  error: { icon: AlertCircle, label: 'Error', color: 'text-rose-500' },
  sub_agent_spawn: { icon: GitBranch, label: 'Sub-Agent', color: 'text-amber-400' },
};

/* ── Components ── */

function StatCard({ label, value, trend, icon: Icon, trendUp }: any) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border-primary bg-bg-secondary p-5 transition-all hover:border-accent-primary/30 hover:bg-bg-hover">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
            {label}
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <h3 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
              {value}
            </h3>
            {trend && (
              <span
                className={clsx('text-xs font-medium', trendUp ? 'text-success' : 'text-error')}
              >
                {trend}
              </span>
            )}
          </div>
        </div>
        <div className="rounded-lg bg-bg-tertiary p-2 text-accent-primary opacity-60 group-hover:opacity-100 transition-opacity">
          <Icon size={18} />
        </div>
      </div>
      <div className="absolute inset-0 bg-gradient-to-br from-accent-primary/0 via-transparent to-transparent opacity-0 group-hover:opacity-5 transition-opacity" />
    </div>
  );
}

function ActivityItem({ activity }: { activity: LogEntry }) {
  const config = ACTION_CONFIG[activity.actionType] || {
    icon: Activity,
    label: activity.actionType,
    color: 'text-text-secondary',
  };
  const Icon = config.icon;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="group relative flex gap-4 rounded-xl border border-transparent p-4 transition-all hover:border-border-primary hover:bg-bg-secondary/40">
      {/* Connector Line */}
      <div className="absolute left-[27px] top-14 bottom-0 w-px bg-border-primary/50 group-last:hidden" />

      {/* Icon */}
      <div
        className={clsx(
          'relative flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-white/5 bg-bg-tertiary shadow-lg transition-transform group-hover:scale-105',
          config.color,
        )}
      >
        <Icon size={18} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div
          className="flex items-center justify-between gap-4 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            <span className={clsx('text-[13px] font-semibold', config.color)}>{config.label}</span>
            <span className="h-1 w-1 rounded-full bg-border-secondary" />
            <span className="text-xs text-text-tertiary font-mono">
              {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
            </span>
          </div>
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 rounded-full">
              <MoreHorizontal size={14} />
            </Button>
          </div>
        </div>

        <div className="mt-2 text-sm text-text-secondary leading-relaxed break-words font-mono bg-bg-tertiary/30 rounded-lg p-3 border border-border-primary/30">
          {expanded ? (
            <pre className="whitespace-pre-wrap overflow-x-auto">
              {JSON.stringify(activity.payload, null, 2)}
            </pre>
          ) : (
            <span>
              {JSON.stringify(activity.payload).slice(0, 180)}
              {JSON.stringify(activity.payload).length > 180 && '...'}
            </span>
          )}
        </div>

        {/* Feedback Actions */}
        <div className="mt-3 flex items-center gap-3">
          <FeedbackButtons traceId={activity.id} />
          {activity.status && (
            <span className="uppercase tracking-widest text-[9px] py-0.5">
              <Badge variant={activity.status === 'success' ? 'success' : 'error'} size="sm">
                {activity.status}
              </Badge>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */

export default function ActivityPage() {
  const { data, loading } = usePolling<ActivityResponse>('/api/activity?limit=50', 3000);
  const { data: tokenData } = usePolling<TokenOverview>('/api/tokens?limit=80', 5000);
  const { connected } = useGatewaySocket();

  const activities = data?.activities || [];
  const stats = useMemo(() => {
    const toolCalls = activities.filter((activity) => activity.actionType === 'tool_call').length;
    const modelCalls = tokenData?.total.calls || 0;
    const totalTokens = tokenData?.total.tokens || 0;
    const totalCost = tokenData?.total.cost || 0;
    const activeSessions = new Set(
      (tokenData?.recent || []).map((row) => row.sessionId).filter(Boolean),
    ).size;
    const modelCount = tokenData?.byModel.length || 0;

    return [
      {
        label: 'Total Tokens',
        value: totalTokens.toLocaleString(),
        icon: Coins,
        trend: `$${totalCost.toFixed(4)}`,
        trendUp: totalCost >= 0,
      },
      {
        label: 'Model Calls',
        value: modelCalls.toLocaleString(),
        icon: Cpu,
        trend: `${modelCount} models`,
        trendUp: modelCount > 0,
      },
      {
        label: 'Tool Usage',
        value: toolCalls.toLocaleString(),
        icon: Wrench,
        trend: `${activities.length} events`,
        trendUp: toolCalls > 0,
      },
      {
        label: 'Active Sessions',
        value: activeSessions.toLocaleString(),
        icon: MessageCircle,
        trend: connected ? 'live' : 'offline',
        trendUp: connected,
      },
    ];
  }, [activities, connected, tokenData]);

  if (loading && !data) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <div className="relative h-12 w-12">
          <div className="absolute inset-0 animate-ping rounded-full bg-accent-primary/30"></div>
          <Spinner size="lg" className="text-accent-primary" />
        </div>
        <p className="text-sm font-medium text-text-tertiary animate-pulse">
          Initializing Neural Link...
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden p-6 lg:p-10 space-y-8 no-scrollbar scroll-smooth">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-2 w-2 rounded-full bg-accent-primary shadow-[0_0_8px] shadow-accent-primary"></div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-accent-primary">
              System Overview
            </h4>
          </div>
          <h1 className="text-3xl font-bold text-text-primary tracking-tight">Agent Activity</h1>
        </div>
        <div className="flex gap-3">
          <Button variant="default" size="sm" className="gap-2">
            <Filter size={14} />
            Filter
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="gap-2 bg-accent-primary/10 text-accent-primary border-accent-primary/20 hover:bg-accent-primary/20 hover:border-accent-primary/30"
          >
            <Activity size={14} />
            Live Feed
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      {/* Main Feed */}
      <div className="rounded-2xl border border-border-primary bg-bg-secondary/30 backdrop-blur-sm p-1">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary/50">
          <h3 className="text-sm font-semibold text-text-primary">Recent Events</h3>
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
              size={14}
            />
            <input
              type="text"
              placeholder="Search logs..."
              className="h-8 w-64 rounded-lg border border-border-primary bg-bg-tertiary pl-9 pr-3 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-primary/50 focus:outline-none focus:ring-1 focus:ring-accent-primary/20"
            />
          </div>
        </div>

        <div className="p-4 space-y-2">
          {activities.length === 0 ? (
            <div className="py-20 text-center">
              <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-bg-tertiary flex items-center justify-center text-text-muted">
                <Activity size={32} />
              </div>
              <p className="text-text-secondary font-medium">No activity recorded</p>
              <p className="text-text-tertiary text-sm mt-1">Waiting for agent events...</p>
            </div>
          ) : (
            activities.map((activity) => <ActivityItem key={activity.id} activity={activity} />)
          )}
        </div>
      </div>
    </div>
  );
}
