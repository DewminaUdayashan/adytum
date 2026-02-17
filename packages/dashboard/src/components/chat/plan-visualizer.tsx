import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Workflow,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Plan } from '@adytum/shared';

interface PlanVisualizerProps {
  plan: Plan;
  className?: string;
}

export function PlanVisualizer({ plan, className }: PlanVisualizerProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!plan || !plan.steps) return null;

  return (
    <div
      className={clsx(
        'rounded-xl border border-border-primary bg-bg-secondary/50 overflow-hidden my-2',
        className,
      )}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-bg-tertiary/30 hover:bg-bg-tertiary/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-accent-primary/10 text-accent-primary">
            <Workflow size={16} />
          </div>
          <div className="text-left">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
              Execution Plan
            </h3>
            <p className="text-sm font-medium text-text-primary line-clamp-1">{plan.goal}</p>
          </div>
        </div>
        {isExpanded ? (
          <ChevronDown size={16} className="text-text-tertiary" />
        ) : (
          <ChevronRight size={16} className="text-text-tertiary" />
        )}
      </button>

      {/* Steps List */}
      {isExpanded && (
        <div className="p-4 space-y-3">
          {plan.steps.map((step) => (
            <div key={step.id} className="relative pl-6 group">
              {/* Activity Line */}
              <div className="absolute left-[11px] top-6 bottom-[-12px] w-px bg-border-primary/50 group-last:hidden" />

              {/* Status Icon */}
              <div className="absolute left-0 top-1">
                <StatusIcon status={step.status} />
              </div>

              <div className="rounded-lg border border-border-primary/50 bg-bg-primary/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary">{step.description}</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-mono text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded">
                        {step.tool || 'thinking'}
                      </span>
                      {step.dependencies.length > 0 && (
                        <span className="text-[10px] text-text-muted flex items-center gap-1">
                          after {step.dependencies.map((d) => d.replace('step_', '')).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                  {step.status && (
                    <span
                      className={clsx(
                        'text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider',
                        step.status === 'completed'
                          ? 'bg-success/10 text-success'
                          : step.status === 'failed'
                            ? 'bg-error/10 text-error'
                            : step.status === 'running'
                              ? 'bg-accent-primary/10 text-accent-primary animate-pulse'
                              : 'bg-bg-tertiary text-text-muted',
                      )}
                    >
                      {step.status}
                    </span>
                  )}
                </div>

                {/* Error Message */}
                {step.error && (
                  <div className="mt-2 p-2 rounded bg-error/5 border border-error/10 text-xs text-error/90 font-mono">
                    {step.error}
                  </div>
                )}

                {/* Result Preview (Optional - tailored for code/text) */}
                {step.result && step.status === 'completed' && (
                  <div className="mt-2 p-2 rounded bg-bg-tertiary/50 border border-border-primary/30 text-xs text-text-secondary font-mono truncate">
                    {step.result.slice(0, 100)}
                    {step.result.length > 100 && '...'}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status?: string }) {
  switch (status) {
    case 'completed':
    case 'success':
      return <CheckCircle2 size={22} className="fill-success/10 text-success" />;
    case 'running':
      return (
        <div className="h-[22px] w-[22px] rounded-full border-2 border-accent-primary border-t-transparent animate-spin" />
      );
    case 'failed':
    case 'error':
      return <AlertTriangle size={22} className="fill-error/10 text-error" />;
    default:
      return <Circle size={22} className="text-border-secondary fill-bg-tertiary" />;
  }
}
