'use client';

/**
 * @file packages/dashboard/src/app/personality/page.tsx
 * @description Defines route-level UI composition and page behavior.
 */

import { useState, useEffect } from 'react';
import { gatewayFetch } from '@/lib/api';
import { Card, Button, Spinner, Badge } from '@/components/ui';
import { Sparkles, Save, RotateCcw, Eye, Edit3 } from 'lucide-react';

export default function PersonalityPage() {
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadSoul();
  }, []);

  const loadSoul = async () => {
    try {
      setLoading(true);
      const data = await gatewayFetch<{ content: string }>('/api/personality');
      setContent(data.content);
      setOriginal(data.content);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await gatewayFetch('/api/personality', {
        method: 'PUT',
        body: JSON.stringify({ content }),
      });
      setOriginal(content);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = content !== original;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-medium">
              Configuration
            </p>
            <h1 className="text-2xl font-semibold text-text-primary tracking-tight mt-1">
              Personality
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && <Badge variant="warning">Unsaved</Badge>}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowDiff(!showDiff)}
              disabled={!hasChanges}
            >
              {showDiff ? <Edit3 className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {showDiff ? 'Editor' : 'Diff'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setContent(original)}
              disabled={!hasChanges}
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={handleSave}
              disabled={!hasChanges || saving}
            >
              <Save className="h-3 w-3" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-8 mb-2 rounded-lg bg-error/10 border border-error/20 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto px-8 pb-8">
        {showDiff ? (
          <DiffView original={original} modified={content} />
        ) : (
          <Card className="h-full">
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 mb-3 pb-3 border-b border-border-primary">
                <Sparkles className="h-4 w-4 text-accent-primary" />
                <span className="text-sm font-medium text-text-primary">SOUL.md</span>
                <span className="text-[11px] text-text-muted ml-auto">{content.length} chars</span>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="flex-1 w-full bg-transparent text-sm text-text-primary font-mono leading-relaxed resize-none focus:outline-none"
                placeholder="# Your Agent's Soul&#10;&#10;Define personality, behavior, values..."
                spellCheck={false}
              />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function DiffView({ original, modified }: { original: string; modified: string }) {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-border-primary">
        <Eye className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Diff Preview</span>
      </div>
      <div className="grid grid-cols-2 gap-4 font-mono text-xs">
        <div>
          <p className="text-text-muted mb-2 font-sans text-[11px] font-medium uppercase tracking-wider">
            Original
          </p>
          <div className="space-y-0">
            {origLines.map((line, i) => {
              const isChanged = modLines[i] !== line;
              return (
                <div
                  key={i}
                  className={`px-2 py-0.5 rounded-sm ${isChanged ? 'bg-error/10 text-error' : 'text-text-tertiary'}`}
                >
                  <span className="text-text-muted mr-3 select-none">
                    {String(i + 1).padStart(3)}
                  </span>
                  {line || ' '}
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-text-muted mb-2 font-sans text-[11px] font-medium uppercase tracking-wider">
            Modified
          </p>
          <div className="space-y-0">
            {modLines.map((line, i) => {
              const isChanged = origLines[i] !== line;
              return (
                <div
                  key={i}
                  className={`px-2 py-0.5 rounded-sm ${isChanged ? 'bg-success/10 text-success' : 'text-text-tertiary'}`}
                >
                  <span className="text-text-muted mr-3 select-none">
                    {String(i + 1).padStart(3)}
                  </span>
                  {line || ' '}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
