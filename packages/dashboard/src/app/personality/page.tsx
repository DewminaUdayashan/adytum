'use client';

import { useState, useEffect } from 'react';
import { gatewayFetch } from '@/lib/api';
import { PageHeader, Card, Button, Spinner, Badge } from '@/components/ui';
import { Sparkles, Save, RotateCcw, Eye, Edit3 } from 'lucide-react';

export default function PersonalityPage() {
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSoul();
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
    <div className="flex flex-col h-full">
      <PageHeader title="Personality" subtitle="Edit SOUL.md — the agent's personality, behavior, and values">
        <div className="flex items-center gap-2">
          {hasChanges && <Badge variant="warning">Unsaved changes</Badge>}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowDiff(!showDiff)}
            disabled={!hasChanges}
          >
            {showDiff ? <Edit3 className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showDiff ? 'Editor' : 'Diff'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setContent(original)} disabled={!hasChanges}>
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
          <Button size="sm" variant="primary" onClick={handleSave} disabled={!hasChanges || saving}>
            <Save className="h-3 w-3" />
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </PageHeader>

      {error && (
        <div className="mx-6 mt-4 rounded-lg bg-adytum-error/10 border border-adytum-error/30 px-4 py-2 text-sm text-adytum-error">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {showDiff ? (
          <DiffView original={original} modified={content} />
        ) : (
          <Card className="h-full">
            <div className="flex items-center gap-2 mb-3 pb-3 border-b border-adytum-border">
              <Sparkles className="h-4 w-4 text-adytum-accent" />
              <span className="text-sm font-medium text-adytum-text">SOUL.md</span>
              <span className="text-xs text-adytum-text-muted">
                {content.length} characters
              </span>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-[calc(100%-3rem)] bg-transparent text-sm text-adytum-text font-mono leading-relaxed resize-none focus:outline-none"
              placeholder="# Your Agent's Soul&#10;&#10;Define personality, behavior, values..."
              spellCheck={false}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function DiffView({ original, modified }: { original: string; modified: string }) {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const maxLines = Math.max(origLines.length, modLines.length);

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-adytum-border">
        <Eye className="h-4 w-4 text-adytum-accent" />
        <span className="text-sm font-medium text-adytum-text">Diff Preview</span>
      </div>
      <div className="grid grid-cols-2 gap-4 font-mono text-xs">
        <div>
          <p className="text-adytum-text-muted mb-2 font-sans text-xs font-medium">Original</p>
          <div className="space-y-0">
            {origLines.map((line, i) => {
              const modified_line = modLines[i];
              const isChanged = modified_line !== line;
              return (
                <div
                  key={i}
                  className={`px-2 py-0.5 rounded-sm ${
                    isChanged ? 'bg-adytum-error/10 text-adytum-error' : 'text-adytum-text-dim'
                  }`}
                >
                  <span className="text-adytum-text-muted mr-3 select-none">{String(i + 1).padStart(3)}</span>
                  {line || ' '}
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <p className="text-adytum-text-muted mb-2 font-sans text-xs font-medium">Modified</p>
          <div className="space-y-0">
            {modLines.map((line, i) => {
              const orig_line = origLines[i];
              const isChanged = orig_line !== line;
              return (
                <div
                  key={i}
                  className={`px-2 py-0.5 rounded-sm ${
                    isChanged ? 'bg-adytum-success/10 text-adytum-success' : 'text-adytum-text-dim'
                  }`}
                >
                  <span className="text-adytum-text-muted mr-3 select-none">{String(i + 1).padStart(3)}</span>
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
