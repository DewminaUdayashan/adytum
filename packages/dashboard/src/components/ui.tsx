import { clsx } from 'clsx';

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
    <div className="flex items-center justify-between border-b border-adytum-border px-6 py-4">
      <div>
        <h1 className="text-xl font-bold text-adytum-text">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 text-sm text-adytum-text-muted">{subtitle}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

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
        'glass-card p-4',
        hover && 'glass-card-hover cursor-pointer transition-all',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  variant = 'default',
}: {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
}) {
  const colors = {
    default: 'bg-adytum-surface-2 text-adytum-text-dim',
    success: 'bg-adytum-success/15 text-adytum-success',
    warning: 'bg-adytum-warning/15 text-adytum-warning',
    error: 'bg-adytum-error/15 text-adytum-error',
    info: 'bg-adytum-info/15 text-adytum-info',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        colors[variant],
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' };
  return (
    <div
      className={clsx(
        'animate-spin rounded-full border-2 border-adytum-border border-t-adytum-accent',
        sizes[size],
      )}
    />
  );
}

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
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Icon className="h-12 w-12 text-adytum-text-muted mb-4" />
      <h3 className="text-lg font-medium text-adytum-text-dim">{title}</h3>
      <p className="mt-1 text-sm text-adytum-text-muted max-w-md">{description}</p>
    </div>
  );
}

export function Button({
  children,
  variant = 'default',
  size = 'md',
  onClick,
  disabled,
  className,
}: {
  children: React.ReactNode;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const variants = {
    default: 'bg-adytum-surface-2 text-adytum-text border border-adytum-border hover:bg-adytum-border/50',
    primary: 'bg-adytum-accent text-white hover:bg-adytum-accent-light',
    danger: 'bg-adytum-error/15 text-adytum-error border border-adytum-error/30 hover:bg-adytum-error/25',
    ghost: 'text-adytum-text-dim hover:text-adytum-text hover:bg-adytum-surface-2',
  };
  const sizes = {
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-4 py-2 text-sm',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {children}
    </button>
  );
}
