'use client';

import { Spinner } from '@/components/ui';
import { clsx } from 'clsx';
import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  Clock3,
  Info,
  Sparkles,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

export interface ThinkingActivityEntry {
  id: string;
  type: 'status' | 'thinking' | 'tool_call' | 'tool_result' | 'response' | 'error';
  text: string;
  timestamp: number;
}

const ACTIVITY_STYLE: Record<ThinkingActivityEntry['type'], { icon: LucideIcon; color: string }> = {
  status: { icon: Info, color: 'text-text-secondary' },
  thinking: { icon: Brain, color: 'text-warning' },
  tool_call: { icon: Wrench, color: 'text-accent-primary' },
  tool_result: { icon: CheckCircle2, color: 'text-success' },
  response: { icon: Sparkles, color: 'text-accent-secondary' },
  error: { icon: AlertTriangle, color: 'text-error' },
};

export function ThinkingIndicator({
  pendingTools,
  activities,
  startedAt,
  approvals = [],
  onApproval,
}: {
  pendingTools: string[];
  activities: ThinkingActivityEntry[];
  startedAt: number | null;
  approvals?: Array<{ id: string; description: string; kind: string; status?: 'pending' | 'approved' | 'denied' }>;
  onApproval?: (id: string, approved: boolean) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const recentActivities = useMemo(() => activities.slice(-8), [activities]);
  const elapsedSeconds = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

  useEffect(() => {
    if (!startedAt) return;

    setNow(Date.now());
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-bg-tertiary">
        <Bot className="h-4 w-4 text-text-tertiary" />
      </div>
      <div className="w-full max-w-2xl rounded-xl border border-border-primary bg-bg-secondary/70 px-4 py-3">
        <div className="flex items-center gap-3">
          <Spinner size="sm" />
          <span className="text-sm font-medium text-text-secondary">Working…</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-bg-tertiary px-2 py-0.5 text-[11px] text-text-muted">
            <Clock3 className="h-3 w-3" />
            {formatElapsed(elapsedSeconds)}
          </span>
        </div>

        {pendingTools.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {pendingTools.map((tool) => (
              <span
                key={tool}
                className="inline-flex items-center gap-1 rounded-md bg-bg-tertiary px-2 py-0.5 text-[11px] text-text-secondary"
              >
                <Zap className="h-2.5 w-2.5 text-warning" />
                <span className="font-mono">{tool}</span>
              </span>
            ))}
          </div>
        )}

        {/* Unified Approvals */}
        {approvals.length > 0 && (
          <div className="mt-3 space-y-2">
            {approvals.map((req) => (
              <div
                key={req.id}
                className="rounded-lg border border-border-primary bg-bg-primary/60 px-3 py-2.5 flex flex-col gap-2 shadow-sm animate-in fade-in slide-in-from-top-1 duration-200"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-bold text-text-primary uppercase tracking-wider">Approval Required</p>
                    <p className="text-xs text-text-muted mt-0.5 leading-tight">{req.description || req.kind}</p>
                  </div>
                  {req.status !== 'pending' && (
                    <span className={clsx(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter",
                      req.status === 'approved' ? "bg-success/20 text-success" : "bg-error/20 text-error"
                    )}>
                      {req.status}
                    </span>
                  )}
                </div>

                {req.status === 'pending' && (
                  <div className="flex gap-2 mt-1">
                    <button
                      className="flex-1 rounded-md bg-success/20 text-success px-2.5 py-1.5 text-xs font-semibold border border-success/40 transition-all hover:bg-success/30 hover:border-success/60 active:scale-[0.98]"
                      onClick={() => onApproval?.(req.id, true)}
                    >
                      Approve
                    </button>
                    <button
                      className="flex-1 rounded-md bg-error/15 text-error px-2.5 py-1.5 text-xs font-semibold border border-error/30 transition-all hover:bg-error/25 hover:border-error/50 active:scale-[0.98]"
                      onClick={() => onApproval?.(req.id, false)}
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 max-h-40 overflow-auto rounded-lg border border-border-primary/80 bg-bg-primary/50 px-2 py-1.5 font-mono text-[11px]">
          {recentActivities.length === 0 ? (
            <p className="px-1 py-0.5 text-text-muted">Awaiting model updates…</p>
          ) : (
            recentActivities.map((activity) => {
              const style = ACTIVITY_STYLE[activity.type];
              const Icon = style.icon;

              return (
                <div
                  key={activity.id}
                  className="flex items-start gap-2 rounded px-1 py-0.5 hover:bg-bg-secondary/40"
                >
                  <span className="mt-0.5 shrink-0 text-text-muted">
                    {new Date(activity.timestamp).toLocaleTimeString('en-US', {
                      hour12: false,
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <Icon className={clsx('mt-0.5 h-3 w-3 shrink-0', style.color)} />
                  <span className="break-words text-text-secondary">{activity.text}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
