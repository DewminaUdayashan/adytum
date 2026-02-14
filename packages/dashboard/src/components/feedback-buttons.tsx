'use client';

import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { gatewayFetch } from '@/lib/api';

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
      <span className="flex items-center gap-1 text-[11px] text-text-muted ml-auto">
        {submitted === 'up' ? (
          <ThumbsUp className="h-3 w-3 text-success" />
        ) : (
          <ThumbsDown className="h-3 w-3 text-error" />
        )}
        Sent
      </span>
    );
  }

  return (
    <div className="relative ml-auto flex items-center gap-1">
      <button
        onClick={() => submit('up')}
        className="rounded p-1 text-text-muted hover:text-success hover:bg-success/10 transition-colors"
        title="Good response"
      >
        <ThumbsUp className="h-3 w-3" />
      </button>
      <button
        onClick={() => setShowReason(!showReason)}
        className="rounded p-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
        title="Bad response"
      >
        <ThumbsDown className="h-3 w-3" />
      </button>

      {showReason && (
        <div className="absolute right-0 top-6 z-50 w-56 rounded-xl border border-border-primary bg-bg-secondary p-3 animate-slide-up shadow-xl">
          <p className="text-[11px] font-medium text-text-primary mb-2">What went wrong?</p>
          <div className="flex flex-wrap gap-1 mb-2">
            {REASON_CODES.map(({ code, label }) => (
              <button
                key={code}
                onClick={() => submit('down', code)}
                className="rounded-md bg-bg-tertiary px-2 py-1 text-[11px] text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional comment…"
            className="w-full rounded-md bg-bg-primary border border-border-primary p-2 text-xs text-text-primary placeholder:text-text-muted resize-none h-14 focus:outline-none focus:border-accent-primary/50 transition-colors"
          />
          <button
            onClick={() => submit('down', 'other')}
            className="mt-1.5 w-full rounded-md bg-error/10 px-2 py-1 text-xs text-error hover:bg-error/20 transition-colors"
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
}
