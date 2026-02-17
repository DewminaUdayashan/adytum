'use client';

/**
 * @file packages/dashboard/src/app/tokens/page.tsx
 * @description Defines route-level UI composition and page behavior.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePolling } from '@/hooks/use-polling';
import { Card, Badge, Spinner, EmptyState, Button, Select } from '@/components/ui';
import {
  Coins,
  TrendingUp,
  Clock,
  CalendarDays,
  RefreshCcw,
  Building2,
  Layers,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

interface TokenRecord {
  model: string;
  modelId: string;
  modelName: string;
  provider: string;
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
  provider: string;
  model: string;
  modelId: string;
  modelName: string;
  role: string;
  tokens: number;
  cost: number;
  calls: number;
}

interface ProviderUsage {
  provider: string;
  tokens: number;
  cost: number;
  calls: number;
}

interface ModelUsage {
  provider: string;
  model: string;
  modelId: string;
  tokens: number;
  cost: number;
  calls: number;
}

interface TokenResponse {
  total: { tokens: number; cost: number; calls: number };
  byProvider: ProviderUsage[];
  byModel: ModelUsage[];
  daily: DailyUsage[];
  recent: TokenRecord[];
}

function toDateInput(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function toPrettyDate(value: string): string {
  const parsed = parseDateInput(value);
  return parsed ? format(parsed, 'MMM d, yyyy') : value;
}

function parseDateInput(value: string): Date | null {
  if (!value) return null;
  try {
    return parseISO(value);
  } catch {
    return null;
  }
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatInteger(value: number): string {
  return value.toLocaleString();
}

function getProviderLabel(provider: string): string {
  if (!provider) return 'Unknown';
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export default function TokensPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');

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
    if (providerFilter) {
      params.set('provider', providerFilter);
    }
    if (modelFilter) {
      params.set('modelId', modelFilter);
    }
    params.set('limit', '80');

    const qs = params.toString();
    return `/api/tokens${qs ? `?${qs}` : ''}`;
  }, [dateFrom, dateTo, providerFilter, modelFilter]);

  const { data, loading, refresh } = usePolling<TokenResponse>(tokensPath, 5000);

  const total = data?.total || { tokens: 0, cost: 0, calls: 0 };
  const byProvider = data?.byProvider || [];
  const byModel = data?.byModel || [];
  const daily = data?.daily || [];
  const recent = data?.recent || [];

  const availableProviders = useMemo(
    () => Array.from(new Set(byProvider.map((p) => p.provider).filter(Boolean))),
    [byProvider],
  );

  const availableModels = useMemo(() => {
    const source = providerFilter ? byModel.filter((m) => m.provider === providerFilter) : byModel;
    return source;
  }, [byModel, providerFilter]);

  useEffect(() => {
    if (!modelFilter) return;
    if (availableModels.some((model) => model.modelId === modelFilter)) return;
    setModelFilter('');
  }, [availableModels, modelFilter]);

  const topProvider = byProvider[0];
  const topModel = byModel[0];
  const avgCostPerCall = total.calls > 0 ? total.cost / total.calls : 0;

  const rangeLabel = dateFrom || dateTo ? `${dateFrom || '…'} → ${dateTo || '…'}` : 'All time';

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="px-8 pt-8 pb-2">
        <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-medium">
          Analytics
        </p>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight mt-1">
          Token Usage
        </h1>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6 space-y-6">
        <Card>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-text-primary">Filters</p>
              <p className="text-xs text-text-muted">
                Filter by date, provider, and model. All metrics and tables update together.
              </p>
              <p className="text-[11px] text-text-tertiary flex items-center gap-1">
                <CalendarDays size={12} /> Range: {rangeLabel}
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 items-start">
              <div className="flex flex-col gap-1">
                <label className="mb-0 block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Date Range
                </label>
                <DateRangePicker
                  start={dateFrom}
                  end={dateTo}
                  onChange={(start, end) => {
                    setDateFrom(start);
                    setDateTo(end);
                  }}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Provider
                  </label>
                  <Select
                    value={providerFilter}
                    onChange={setProviderFilter}
                    options={[
                      { value: '', label: 'All Providers' },
                      ...availableProviders.map((provider) => ({
                        value: provider,
                        label: getProviderLabel(provider),
                      })),
                    ]}
                    placeholder="Select provider"
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Model
                  </label>
                  <Select
                    value={modelFilter}
                    onChange={setModelFilter}
                    options={[
                      { value: '', label: 'All Models' },
                      ...availableModels.map((model) => ({
                        value: model.modelId,
                        label: model.model,
                        description: model.modelId,
                      })),
                    ]}
                    placeholder="Select model"
                    className="w-full"
                  />
                </div>

                <div className="flex items-end gap-2">
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={() => {
                      setDateFrom('');
                      setDateTo('');
                      setProviderFilter('');
                      setModelFilter('');
                    }}
                  >
                    Clear Filters
                  </Button>
                  <Button variant="ghost" size="md" onClick={refresh}>
                    <RefreshCcw size={14} /> Refresh
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
          <MiniStat icon={Coins} label="Total Tokens" value={formatInteger(total.tokens)} />
          <MiniStat icon={TrendingUp} label="Total Cost" value={formatCurrency(total.cost)} />
          <MiniStat icon={Clock} label="Total Calls" value={formatInteger(total.calls)} />
          <MiniStat icon={Building2} label="Providers" value={String(byProvider.length)} />
          <MiniStat icon={Layers} label="Models" value={String(byModel.length)} />
        </div>

        <Card>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-text-primary">Usage Report</p>
              <p className="text-xs text-text-muted mt-1">
                Aggregated from persisted gateway token records.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="rounded-lg border border-border-primary/50 bg-bg-tertiary/30 px-3 py-2">
                <p className="text-text-muted uppercase tracking-wider text-[10px]">Top Provider</p>
                <p className="text-text-primary font-semibold mt-0.5">
                  {topProvider
                    ? `${getProviderLabel(topProvider.provider)} (${formatInteger(topProvider.tokens)} tokens)`
                    : 'N/A'}
                </p>
              </div>
              <div className="rounded-lg border border-border-primary/50 bg-bg-tertiary/30 px-3 py-2">
                <p className="text-text-muted uppercase tracking-wider text-[10px]">Top Model</p>
                <p className="text-text-primary font-semibold mt-0.5">
                  {topModel ? `${topModel.model} (${formatCurrency(topModel.cost)})` : 'N/A'}
                </p>
              </div>
              <div className="rounded-lg border border-border-primary/50 bg-bg-tertiary/30 px-3 py-2">
                <p className="text-text-muted uppercase tracking-wider text-[10px]">
                  Avg Cost / Call
                </p>
                <p className="text-text-primary font-semibold mt-0.5">
                  {formatCurrency(avgCostPerCall)}
                </p>
              </div>
            </div>
          </div>
        </Card>

        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-3">Usage by Provider</h2>
          {byProvider.length === 0 ? (
            <EmptyState
              icon={Coins}
              title="No token usage yet"
              description="Usage will appear here after the agent processes requests."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {byProvider.map((provider) => (
                <Card key={provider.provider}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-text-primary">
                      {getProviderLabel(provider.provider)}
                    </span>
                    <Badge variant="info">{formatInteger(provider.calls)} calls</Badge>
                  </div>
                  <div className="space-y-2.5">
                    <UsageBar
                      label="Tokens"
                      value={provider.tokens}
                      max={total.tokens || 1}
                      display={formatInteger(provider.tokens)}
                    />
                    <UsageBar
                      label="Cost"
                      value={provider.cost}
                      max={total.cost || 1}
                      display={formatCurrency(provider.cost)}
                    />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {byModel.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-text-primary mb-3">Usage by Model</h2>
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-primary bg-bg-tertiary/30">
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      Provider
                    </th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      Model
                    </th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      Calls
                    </th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      Tokens
                    </th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map((row) => (
                    <tr
                      key={row.modelId}
                      className="border-b border-border-primary/50 hover:bg-bg-secondary/30 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-text-secondary text-[13px]">
                        {getProviderLabel(row.provider)}
                      </td>
                      <td className="px-4 py-2.5 text-text-primary text-[13px]">
                        <div className="flex flex-col">
                          <span>{row.model}</span>
                          <span className="text-[10px] text-text-tertiary font-mono">
                            {row.modelId}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-text-secondary text-[13px]">
                        {formatInteger(row.calls)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-text-primary text-[13px]">
                        {formatInteger(row.tokens)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-success text-[13px] font-medium">
                        {formatCurrency(row.cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {daily.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-text-primary mb-3">Daily Usage</h2>
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-primary bg-bg-tertiary/30">
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      Date
                    </th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      Provider
                    </th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      Model
                    </th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      Role
                    </th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      Calls
                    </th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      Tokens
                    </th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((row) => (
                    <tr
                      key={`${row.date}-${row.modelId}-${row.role}`}
                      className="border-b border-border-primary/50 hover:bg-bg-secondary/30 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-text-primary text-[13px]">{row.date}</td>
                      <td className="px-4 py-2.5 text-text-secondary text-[13px]">
                        {getProviderLabel(row.provider)}
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary text-[13px]">
                        {row.modelName}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge>{row.role}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right text-text-secondary text-[13px]">
                        {formatInteger(row.calls)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-text-primary text-[13px]">
                        {formatInteger(row.tokens)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-success text-[13px] font-medium">
                        {formatCurrency(row.cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {recent.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-text-primary mb-3">Recent Requests</h2>
            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-primary bg-bg-tertiary/30">
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                        Time
                      </th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                        Provider
                      </th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                        Model
                      </th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                        Role
                      </th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                        Session
                      </th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                        Prompt
                      </th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                        Completion
                      </th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                        Total
                      </th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                        Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((record) => (
                      <tr
                        key={`${record.timestamp}-${record.sessionId}-${record.modelId}`}
                        className="border-b border-border-primary/50 hover:bg-bg-secondary/30 transition-colors"
                      >
                        <td className="px-4 py-2.5 text-text-muted text-[11px] font-mono">
                          {new Date(record.timestamp).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-text-secondary text-[13px]">
                          {getProviderLabel(record.provider)}
                        </td>
                        <td className="px-4 py-2.5 text-text-primary text-[13px]">
                          {record.modelName}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge>{record.role}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-text-tertiary text-[12px] font-mono truncate max-w-[140px]">
                          {record.sessionId}
                        </td>
                        <td className="px-4 py-2.5 text-right text-text-secondary text-[13px]">
                          {formatInteger(record.promptTokens)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-text-secondary text-[13px]">
                          {formatInteger(record.completionTokens)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-text-primary text-[13px] font-medium">
                          {formatInteger(record.totalTokens)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-success text-[13px] font-medium">
                          {formatCurrency(record.estimatedCost)}
                        </td>
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
          <p className="text-[11px] text-text-muted font-medium uppercase tracking-wider">
            {label}
          </p>
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

function DateRangePicker({
  start,
  end,
  onChange,
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [monthCursor, setMonthCursor] = useState<Date>(() =>
    start ? parseDateInput(start) || new Date() : new Date(),
  );
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const startDate = parseDateInput(start);
  const endDate = parseDateInput(end);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (!popoverRef.current) return;
      const target = event.target as Node;
      if (!popoverRef.current.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, []);

  const monthStart = startOfMonth(monthCursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(endOfMonth(monthCursor), { weekStartsOn: 0 });

  const days: Date[] = [];
  let cursor = gridStart;
  while (cursor <= gridEnd) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }

  const rangeStart =
    startDate && endDate ? (isAfter(startDate, endDate) ? endDate : startDate) : startDate;
  const rangeEnd =
    startDate && endDate ? (isAfter(startDate, endDate) ? startDate : endDate) : endDate;

  const isInRange = (day: Date): boolean => {
    if (!rangeStart || !rangeEnd) return false;
    return isWithinInterval(day, { start: rangeStart, end: rangeEnd });
  };

  const selectDate = (day: Date) => {
    const dayValue = toDateInput(day);

    if (!startDate || (startDate && endDate)) {
      onChange(dayValue, '');
      return;
    }

    if (isBefore(day, startDate)) {
      onChange(dayValue, toDateInput(startDate));
      return;
    }

    onChange(start, dayValue);
  };

  const triggerLabel =
    start && end
      ? `${toPrettyDate(start)} → ${toPrettyDate(end)}`
      : start
        ? `Start: ${toPrettyDate(start)}`
        : end
          ? `End: ${toPrettyDate(end)}`
          : 'Choose date range';

  return (
    <div className="relative" ref={popoverRef}>
      <Button
        variant="outline"
        size="md"
        className="w-full justify-between"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="truncate">{triggerLabel}</span>
        <CalendarDays size={14} />
      </Button>

      {open && (
        <div className="absolute z-40 mt-2 w-[320px] rounded-xl border border-border-primary bg-bg-secondary p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMonthCursor((prev) => addMonths(prev, -1))}
              className="rounded-lg p-1.5 text-text-secondary hover:bg-bg-tertiary"
              aria-label="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <p className="text-sm font-semibold text-text-primary">
              {format(monthCursor, 'MMMM yyyy')}
            </p>
            <button
              type="button"
              onClick={() => setMonthCursor((prev) => addMonths(prev, 1))}
              className="rounded-lg p-1.5 text-text-secondary hover:bg-bg-tertiary"
              aria-label="Next month"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const selectedStart = startDate ? isSameDay(day, startDate) : false;
              const selectedEnd = endDate ? isSameDay(day, endDate) : false;
              const inRange = isInRange(day);
              const inCurrentMonth = isSameMonth(day, monthCursor);

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => selectDate(day)}
                  className={[
                    'h-8 rounded-lg text-xs transition-colors',
                    inCurrentMonth ? 'text-text-primary' : 'text-text-muted/50',
                    inRange ? 'bg-accent-primary/15' : 'hover:bg-bg-tertiary',
                    selectedStart || selectedEnd
                      ? 'bg-accent-primary text-white hover:bg-accent-primary'
                      : '',
                  ].join(' ')}
                >
                  {format(day, 'd')}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const today = new Date();
                  const todayStr = toDateInput(today);
                  onChange(todayStr, todayStr);
                }}
              >
                Today
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const endDateLocal = new Date();
                  const startDateLocal = addDays(endDateLocal, -6);
                  onChange(toDateInput(startDateLocal), toDateInput(endDateLocal));
                }}
              >
                7D
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const endDateLocal = new Date();
                  const startDateLocal = addDays(endDateLocal, -29);
                  onChange(toDateInput(startDateLocal), toDateInput(endDateLocal));
                }}
              >
                30D
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onChange('', '');
                setOpen(false);
              }}
            >
              Reset Range
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
