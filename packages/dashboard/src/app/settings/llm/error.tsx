'use client';

import { useEffect } from 'react';
import { Button, Card, EmptyState } from '@/components/ui';
import { AlertCircle } from 'lucide-react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('LLM Settings Error:', error);
  }, [error]);

  return (
    <div className="p-8">
      <Card className="border-error/20 bg-error/5">
        <EmptyState
          icon={AlertCircle}
          title="Something went wrong"
          description={error.message || 'An unexpected error occurred while loading settings.'}
        />
        <div className="flex justify-center mt-6">
          <Button onClick={reset} variant="default">
            Try again
          </Button>
        </div>
      </Card>
    </div>
  );
}
