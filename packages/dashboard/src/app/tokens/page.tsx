'use client';

import { usePolling } from '@/hooks/use-polling';
import { PageHeader, Card, Badge, Spinner, EmptyState } from '@/components/ui';
import { Coins, TrendingUp, Cpu, Clock } from 'lucide-react';

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
}

interface TokenResponse {
  total: { tokens: number; cost: number };
  daily: DailyUsage[];
  recent: TokenRecord[];
}

export default function TokensPage() {
  const { data, loading } = usePolling<TokenResponse>('/api/tokens', 5000);

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
  for (const r of recent) {
    const existing = modelMap.get(r.model) || { tokens: 0, cost: 0, calls: 0 };
    existing.tokens += r.totalTokens;
    existing.cost += r.estimatedCost;
    existing.calls += 1;
    modelMap.set(r.model, existing);
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Token Analytics" subtitle="Per-model usage tracking, cost breakdown, and trends" />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard
            icon={Coins}
            label="Total Tokens"
            value={total.tokens.toLocaleString()}
            sub="all time"
          />
          <StatCard
            icon={TrendingUp}
            label="Total Cost"
            value={`$${total.cost.toFixed(4)}`}
            sub="estimated"
          />
          <StatCard
            icon={Cpu}
            label="Models Used"
            value={String(modelMap.size)}
            sub="unique models"
          />
          <StatCard
            icon={Clock}
            label="Recent Calls"
            value={String(recent.length)}
            sub="last session"
          />
        </div>

        {/* Model breakdown */}
        <div>
          <h2 className="text-sm font-semibold text-adytum-text mb-3">Usage by Model</h2>
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
                    <span className="text-sm font-medium text-adytum-text">{model}</span>
                    <Badge variant="info">{stats.calls} calls</Badge>
                  </div>
                  <div className="space-y-2">
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
            <h2 className="text-sm font-semibold text-adytum-text mb-3">Daily Usage</h2>
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-adytum-border">
                      <th className="text-left py-2 text-adytum-text-muted font-medium">Date</th>
                      <th className="text-left py-2 text-adytum-text-muted font-medium">Model</th>
                      <th className="text-right py-2 text-adytum-text-muted font-medium">Tokens</th>
                      <th className="text-right py-2 text-adytum-text-muted font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.map((d, i) => (
                      <tr key={i} className="border-b border-adytum-border/50">
                        <td className="py-2 text-adytum-text">{d.date}</td>
                        <td className="py-2 text-adytum-text-dim">{d.model}</td>
                        <td className="py-2 text-right text-adytum-text">{d.tokens.toLocaleString()}</td>
                        <td className="py-2 text-right text-adytum-accent">${d.cost.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* Recent records */}
        {recent.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-adytum-text mb-3">Recent Requests</h2>
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-adytum-border">
                      <th className="text-left py-2 text-adytum-text-muted font-medium">Time</th>
                      <th className="text-left py-2 text-adytum-text-muted font-medium">Model</th>
                      <th className="text-left py-2 text-adytum-text-muted font-medium">Role</th>
                      <th className="text-right py-2 text-adytum-text-muted font-medium">Prompt</th>
                      <th className="text-right py-2 text-adytum-text-muted font-medium">Completion</th>
                      <th className="text-right py-2 text-adytum-text-muted font-medium">Total</th>
                      <th className="text-right py-2 text-adytum-text-muted font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.slice().reverse().map((r, i) => (
                      <tr key={i} className="border-b border-adytum-border/50">
                        <td className="py-2 text-adytum-text-dim text-xs">
                          {new Date(r.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-2 text-adytum-text">{r.model}</td>
                        <td className="py-2">
                          <Badge>{r.role}</Badge>
                        </td>
                        <td className="py-2 text-right text-adytum-text-dim">{r.promptTokens.toLocaleString()}</td>
                        <td className="py-2 text-right text-adytum-text-dim">{r.completionTokens.toLocaleString()}</td>
                        <td className="py-2 text-right text-adytum-text font-medium">{r.totalTokens.toLocaleString()}</td>
                        <td className="py-2 text-right text-adytum-accent">${r.estimatedCost.toFixed(4)}</td>
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

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-adytum-accent/10">
          <Icon className="h-5 w-5 text-adytum-accent" />
        </div>
        <div>
          <p className="text-xs text-adytum-text-muted">{label}</p>
          <p className="text-xl font-bold text-adytum-text">{value}</p>
          <p className="text-xs text-adytum-text-muted">{sub}</p>
        </div>
      </div>
    </Card>
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
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-adytum-text-muted">{label}</span>
        <span className="text-adytum-text">{display}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-adytum-surface-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-adytum-accent transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
