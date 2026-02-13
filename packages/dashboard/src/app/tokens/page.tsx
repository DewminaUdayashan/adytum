'use client';

import { useMemo, useState } from 'react';
import { usePolling } from '@/hooks/use-polling';
import { Card, Badge, Spinner, EmptyState, Button } from '@/components/ui';
import { Coins, TrendingUp, Cpu, Clock, Calendar, RefreshCcw } from 'lucide-react';

interface TokenRecord {
  model: string;
  role: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  timestamp: number;
  sessionId: string;
}

interface DailyUsage {
  date: string;
  tokens: number;
  cost: number;
  model: string;
  role: string;
  calls: number;
}

interface TokenResponse {
  total: { tokens: number; cost: number };
  daily: DailyUsage[];
  recent: TokenRecord[];
}

export default function TokensPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const tokensPath = useMemo(() => {
    const params = new URLSearchParams();
    if (dateFrom) {
      const from = new Date(`${dateFrom}T00:00:00`);
      params.set('from', String(from.getTime()));
    }
    if (dateTo) {
      const to = new Date(`${dateTo}T23:59:59.999`);
      params.set('to', String(to.getTime()));
    }
    const qs = params.toString();
    return `/api/tokens${qs ? `?${qs}` : ''}`;
  }, [dateFrom, dateTo]);

  const { data, loading, refresh } = usePolling<TokenResponse>(tokensPath, 5000);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  const total = data?.total || { tokens: 0, cost: 0 };
  const daily = data?.daily || [];
  const recent = data?.recent || [];

  // Aggregate by model
  const modelMap = new Map<string, { tokens: number; cost: number; calls: number }>();
  for (const d of daily) {
    const existing = modelMap.get(d.model) || { tokens: 0, cost: 0, calls: 0 };
    existing.tokens += d.tokens;
    existing.cost += d.cost;
    existing.calls += d.calls;
    modelMap.set(d.model, existing);
  }

  const rangeLabel = dateFrom || dateTo ? `${dateFrom || '…'} → ${dateTo || '…'}` : 'All time';

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-8 pt-8 pb-2">
        <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-medium">Analytics</p>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight mt-1">Token Usage</h1>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6 space-y-6">
        {/* Filters */}
        <Card>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-text-primary">Filters</p>
              <p className="text-xs text-text-muted">Default shows all daily usage. Narrow by date to focus analysis.</p>
              <p className="text-[11px] text-text-tertiary flex items-center gap-1">
                <Calendar size={12} /> Range: {rangeLabel}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="flex flex-col">
                <label className="text-[11px] uppercase text-text-muted font-medium mb-1">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="rounded-lg bg-bg-tertiary border border-border-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary/50"
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[11px] uppercase text-text-muted font-medium mb-1">To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="rounded-lg bg-bg-tertiary border border-border-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary/50"
                />
              </div>
              <div className="flex items-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                >
                  Clear
                </Button>
                <Button variant="ghost" size="sm" onClick={refresh}>
                  <RefreshCcw size={14} /> Refresh
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MiniStat icon={Coins} label="Total Tokens" value={total.tokens.toLocaleString()} />
          <MiniStat icon={TrendingUp} label="Total Cost" value={`$${total.cost.toFixed(4)}`} />
          <MiniStat icon={Cpu} label="Models" value={String(modelMap.size)} />
          <MiniStat icon={Clock} label="Recent Calls" value={String(recent.length)} />
        </div>

        {/* Model breakdown */}
        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-3">Usage by Model</h2>
          {modelMap.size === 0 ? (
            <EmptyState
              icon={Coins}
              title="No token usage yet"
              description="Token usage will appear here after the agent processes requests."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Array.from(modelMap.entries()).map(([model, stats]) => (
                <Card key={model}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-text-primary">{model}</span>
                    <Badge variant="info">{stats.calls} calls</Badge>
                  </div>
                  <div className="space-y-2.5">
                    <UsageBar
                      label="Tokens"
                      value={stats.tokens}
                      max={total.tokens || 1}
                      display={stats.tokens.toLocaleString()}
                    />
                    <UsageBar
                      label="Cost"
                      value={stats.cost}
                      max={total.cost || 1}
                      display={`$${stats.cost.toFixed(4)}`}
                    />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Daily breakdown */}
        {daily.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-text-primary mb-3">Daily Usage</h2>
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-primary bg-bg-tertiary/30">
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Date</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Model</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Role</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Calls</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Tokens</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((d, i) => (
                    <tr key={i} className="border-b border-border-primary/50 hover:bg-bg-secondary/30 transition-colors">
                      <td className="px-4 py-2.5 text-text-primary text-[13px]">{d.date}</td>
                      <td className="px-4 py-2.5 text-text-secondary text-[13px]">{d.model}</td>
                      <td className="px-4 py-2.5"><Badge>{d.role}</Badge></td>
                      <td className="px-4 py-2.5 text-right text-text-secondary text-[13px]">{d.calls.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-text-primary text-[13px]">{d.tokens.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-success text-[13px] font-medium">${d.cost.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {/* Recent records */}
        {recent.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-text-primary mb-3">Recent Requests</h2>
            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-primary bg-bg-tertiary/30">
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Time</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Model</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Role</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Session</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Prompt</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Completion</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Total</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.slice().reverse().map((r, i) => (
                      <tr key={i} className="border-b border-border-primary/50 hover:bg-bg-secondary/30 transition-colors">
                        <td className="px-4 py-2.5 text-text-muted text-[11px] font-mono">
                          {new Date(r.timestamp).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-text-primary text-[13px]">{r.model}</td>
                        <td className="px-4 py-2.5"><Badge>{r.role}</Badge></td>
                        <td className="px-4 py-2.5 text-text-tertiary text-[12px] font-mono truncate max-w-[140px]">{r.sessionId}</td>
                        <td className="px-4 py-2.5 text-right text-text-secondary text-[13px]">{r.promptTokens.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-text-secondary text-[13px]">{r.completionTokens.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-text-primary text-[13px] font-medium">{r.totalTokens.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-success text-[13px] font-medium">${r.estimatedCost.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border-primary bg-bg-secondary/50 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-primary/10 text-accent-primary">
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div>
          <p className="text-[11px] text-text-muted font-medium uppercase tracking-wider">{label}</p>
          <p className="text-lg font-semibold text-text-primary leading-tight">{value}</p>
        </div>
      </div>
    </div>
  );
}

function UsageBar({
  label,
  value,
  max,
  display,
}: {
  label: string;
  value: number;
  max: number;
  display: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1.5">
        <span className="text-text-muted">{label}</span>
        <span className="text-text-primary font-medium">{display}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-bg-tertiary overflow-hidden">
        <div
          className="h-full rounded-full bg-accent-primary transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
