'use client';

import { useState } from 'react';
import { ThumbsUp, ThumbsDown, ChevronDown } from 'lucide-react';
import { gatewayFetch } from '@/lib/api';
import { clsx } from 'clsx';

const REASON_CODES = [
  { code: 'inaccurate', label: 'Inaccurate' },
  { code: 'too_verbose', label: 'Too Verbose' },
  { code: 'wrong_tone', label: 'Wrong Tone' },
  { code: 'security_overreach', label: 'Security Overreach' },
  { code: 'slow', label: 'Too Slow' },
  { code: 'perfect', label: 'Perfect' },
  { code: 'other', label: 'Other' },
];

export function FeedbackButtons({ traceId }: { traceId: string }) {
  const [submitted, setSubmitted] = useState<'up' | 'down' | null>(null);
  const [showReason, setShowReason] = useState(false);
  const [comment, setComment] = useState('');

  const submit = async (rating: 'up' | 'down', reasonCode?: string) => {
    try {
      await gatewayFetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          traceId,
          rating,
          reasonCode,
          comment: comment || undefined,
        }),
      });
      setSubmitted(rating);
      setShowReason(false);
    } catch {
      // Silently fail
    }
  };

  if (submitted) {
    return (
      <span className="flex items-center gap-1 text-xs text-adytum-text-muted ml-auto">
        {submitted === 'up' ? (
          <ThumbsUp className="h-3 w-3 text-adytum-success" />
        ) : (
          <ThumbsDown className="h-3 w-3 text-adytum-error" />
        )}
        Feedback sent
      </span>
    );
  }

  return (
    <div className="relative ml-auto flex items-center gap-1">
      <button
        onClick={() => submit('up')}
        className="rounded p-1 text-adytum-text-muted hover:text-adytum-success hover:bg-adytum-success/10 transition-colors"
        title="Good response"
      >
        <ThumbsUp className="h-3 w-3" />
      </button>
      <button
        onClick={() => setShowReason(!showReason)}
        className="rounded p-1 text-adytum-text-muted hover:text-adytum-error hover:bg-adytum-error/10 transition-colors"
        title="Bad response"
      >
        <ThumbsDown className="h-3 w-3" />
      </button>

      {showReason && (
        <div className="absolute right-0 top-6 z-50 w-64 glass-card p-3 animate-slide-up shadow-xl">
          <p className="text-xs font-medium text-adytum-text mb-2">What went wrong?</p>
          <div className="flex flex-wrap gap-1 mb-2">
            {REASON_CODES.map(({ code, label }) => (
              <button
                key={code}
                onClick={() => submit('down', code)}
                className="rounded-md bg-adytum-surface-2 px-2 py-1 text-xs text-adytum-text-dim hover:bg-adytum-border hover:text-adytum-text transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional comment..."
            className="w-full rounded-md bg-adytum-bg border border-adytum-border p-2 text-xs text-adytum-text resize-none h-16 focus:outline-none focus:border-adytum-accent"
          />
          <button
            onClick={() => submit('down', 'other')}
            className="mt-1 w-full rounded-md bg-adytum-error/15 px-2 py-1 text-xs text-adytum-error hover:bg-adytum-error/25 transition-colors"
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
}
