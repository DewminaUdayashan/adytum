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
}: {
  pendingTools: string[];
  activities: ThinkingActivityEntry[];
  startedAt: number | null;
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
          <span className="text-sm text-text-secondary">Working…</span>
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

        <div className="mt-2.5 max-h-40 overflow-auto rounded-lg border border-border-primary/80 bg-bg-primary/50 px-2 py-1.5 font-mono text-[11px]">
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
