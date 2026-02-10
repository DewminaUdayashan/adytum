import { clsx } from 'clsx';
import React from 'react';

/* ─────────────────────────── Page Header ─────────────────────────── */

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-8 pt-6 pb-6 border-b border-border-primary/20">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-text-primary to-text-secondary w-fit tracking-tight">{title}</h1>
          {subtitle && (
            <p className="mt-1 text-sm text-text-muted font-medium tracking-normal leading-relaxed max-w-xl">{subtitle}</p>
          )}
        </div>
        {children && <div className="flex items-center flex-wrap gap-3">{children}</div>}
      </div>
    </div>
  );
}

/* ─────────────────────────── Card ─────────────────────────── */

export function Card({
  children,
  className,
  hover = false,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-xl border border-border-primary bg-bg-secondary p-5 shadow-sm',
        hover &&
          'group cursor-pointer transition-all duration-300 hover:border-accent-primary/40 hover:shadow-md hover:shadow-accent-primary/5',
        className,
      )}
    >
      {hover && (
        <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-br from-accent-primary/5 via-transparent to-transparent" />
      )}
      <div className="relative h-full">{children}</div>
    </div>
  );
}

/* ─────────────────────────── Badge ─────────────────────────── */

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({
  children,
  variant = 'default',
  size = 'md',
  className,
}: BadgeProps) {
  const colors = {
    default: 'bg-bg-tertiary text-text-secondary border-border-primary',
    success: 'bg-success/10 text-success border-success/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
    error: 'bg-error/10 text-error border-error/20',
    info: 'bg-info/10 text-info border-info/20',
  };
  
  const sizes = {
    sm: 'px-1.5 py-0.5 text-[10px]',
    md: 'px-2.5 py-1 text-[11px]',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-md font-semibold uppercase tracking-wider border',
        colors[variant],
        sizes[size],
        className
      )}
    >
      {children}
    </span>
  );
}

/* ─────────────────────────── Spinner ─────────────────────────── */

export function Spinner({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg', className?: string }) {
  const sizes = { sm: 'h-4 w-4 border-2', md: 'h-5 w-5 border-2', lg: 'h-8 w-8 border-3' };
  return (
    <div
      className={clsx(
        'animate-spin rounded-full border-border-secondary border-t-accent-primary',
        sizes[size],
        className
      )}
    />
  );
}

/* ─────────────────────────── Empty State ─────────────────────────── */

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in border border-dashed border-border-secondary/50 rounded-2xl bg-bg-secondary/20">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-tertiary shadow-inner ring-1 ring-border-primary">
        <Icon className="h-8 w-8 text-text-tertiary" />
      </div>
      <h3 className="text-base font-bold text-text-primary">{title}</h3>
      <p className="mt-2 text-sm text-text-muted max-w-xs leading-relaxed">{description}</p>
    </div>
  );
}

/* ─────────────────────────── Button ─────────────────────────── */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export function Button({
  children,
  variant = 'default',
  size = 'md',
  isLoading,
  className,
  disabled,
  ...props
}: ButtonProps) {
  const variants = {
    default:
      'bg-bg-tertiary text-text-primary border border-border-primary hover:bg-bg-hover hover:border-border-secondary shadow-sm',
    primary:
      'bg-accent-primary text-white font-semibold hover:bg-accent-primary/90 shadow-lg shadow-accent-primary/25 border border-transparent',
    outline:
      'bg-transparent border-2 border-border-primary text-text-primary hover:border-text-secondary hover:text-text-primary',
    ghost:
      'bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-tertiary',
    danger:
      'bg-error/10 text-error border border-error/20 hover:bg-error/20',
  };

  const sizes = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-6 text-base',
  };

  return (
    <button
      disabled={disabled || isLoading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-accent-primary/50 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {isLoading && <Spinner size="sm" className="mr-1" />}
      {children}
    </button>
  );
}
