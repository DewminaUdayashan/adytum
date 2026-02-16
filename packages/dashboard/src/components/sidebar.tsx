'use client';

/**
 * @file packages/dashboard/src/components/sidebar.tsx
 * @description Defines reusable UI components for the dashboard.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import {
  Activity,
  Terminal,
  MessageCircle,
  Coins,
  Shield,
  Layers,
  Brain,
  Clock,
  Puzzle,
  History,
  Cpu,
  GitBranch,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: Brain, group: 'main' },
  { href: '/chat', label: 'Chat Interface', icon: MessageCircle, group: 'main' },
  { href: '/agents', label: 'Agent Management', icon: GitBranch, group: 'main' },
  { href: '/workspaces', label: 'Workspaces', icon: Layers, group: 'main' },
  { href: '/tasks', label: 'Scheduled Tasks', icon: Clock, group: 'main' },
  { href: '/console', label: 'Console Stream', icon: Terminal, group: 'tools' },
  { href: '/memories', label: 'Logs & Memories', icon: History, group: 'tools' },
  { href: '/tokens', label: 'Token Usage', icon: Coins, group: 'tools' },
  { href: '/settings/llm', label: 'Model Settings', icon: Cpu, group: 'config' },
  { href: '/settings/agent', label: 'Agent Behavior', icon: Activity, group: 'config' },
  { href: '/skills', label: 'Skills', icon: Puzzle, group: 'config' },
  { href: '/permissions', label: 'Access Control', icon: Shield, group: 'config' },
];

const GROUPS: Record<string, string> = {
  main: 'Platform',
  tools: 'Developer',
  config: 'Configuration',
};

export function Sidebar() {
  const pathname = usePathname();

  const grouped = Object.keys(GROUPS).map((key) => ({
    key,
    label: GROUPS[key],
    items: NAV_ITEMS.filter((i) => i.group === key),
  }));

  return (
    <aside className="group flex h-full w-[270px] flex-col bg-bg-secondary border-r border-border-primary shadow-2xl z-50">
      {/* ── Brand ── */}
      <div className="flex-none px-6 py-6 border-b border-border-primary/40 bg-bg-tertiary/20">
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl overflow-hidden shadow-lg shadow-accent-primary/20 ring-1 ring-white/10">
            <img src="/avatars/prometheus.png" alt="Prometheus" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.src = 'https://ui-avatars.com/api/?name=Prometheus&background=0D1117&color=38bdf8')} />
          </div>
          <div className="flex flex-col">
            <span className="text-[17px] font-bold text-text-primary tracking-tight leading-none">
              Adytum
            </span>
          </div>
        </div>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 overflow-y-auto px-4 py-6 scrollbar-hide space-y-8">
        {grouped.map(
          ({ key, label, items }) =>
            items.length > 0 && (
              <div key={key}>
                <h3 className="px-3 mb-3 text-[10px] font-bold text-text-tertiary/70 uppercase tracking-[0.15em]">
                  {label}
                </h3>
                <div className="space-y-1">
                  {items.map(({ href, label: navLabel, icon: Icon }) => {
                    const isActive = pathname === href;
                    return (
                      <Link
                        key={href}
                        href={href}
                        className={clsx(
                          'group/item relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-200',
                          isActive
                            ? 'bg-accent-primary/[0.1] text-accent-primary'
                            : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
                        )}
                      >
                        {isActive && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r-full bg-accent-primary" />
                        )}
                        <Icon
                          className={clsx(
                            'h-[18px] w-[18px] transition-colors',
                            isActive
                              ? 'text-accent-primary'
                              : 'text-text-tertiary group-hover/item:text-text-secondary',
                          )}
                        />
                        <span>{navLabel}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ),
        )}
      </nav>


    </aside>
  );
}
