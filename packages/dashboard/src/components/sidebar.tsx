'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import {
  Activity,
  Terminal,
  MessageCircle,
  Coins,
  Shield,
  Sparkles,
  Heart,
  Zap,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'Activity', icon: Activity },
  { href: '/console', label: 'Console', icon: Terminal },
  { href: '/chat', label: 'Chat', icon: MessageCircle },
  { href: '/tokens', label: 'Tokens', icon: Coins },
  { href: '/permissions', label: 'Permissions', icon: Shield },
  { href: '/personality', label: 'Personality', icon: Sparkles },
  { href: '/heartbeat', label: 'Heartbeat', icon: Heart },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-adytum-border bg-adytum-surface">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 py-5 border-b border-adytum-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-adytum-accent/20 animate-pulse-glow">
          <Zap className="h-4 w-4 text-adytum-accent" />
        </div>
        <span className="text-lg font-bold tracking-tight text-adytum-text">
          Adytum
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                isActive
                  ? 'bg-adytum-accent/15 text-adytum-accent-light border border-adytum-accent/30'
                  : 'text-adytum-text-dim hover:bg-adytum-surface-2 hover:text-adytum-text border border-transparent',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Status */}
      <div className="border-t border-adytum-border px-4 py-3">
        <StatusIndicator />
      </div>
    </aside>
  );
}

function StatusIndicator() {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-2 rounded-full bg-adytum-success animate-pulse" />
      <span className="text-xs text-adytum-text-muted">Gateway connected</span>
    </div>
  );
}
