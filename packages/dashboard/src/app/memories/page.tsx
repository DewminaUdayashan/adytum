'use client';

/**
 * @file packages/dashboard/src/app/memories/page.tsx
 * @description Defines route-level UI composition and page behavior.
 */

import { clsx } from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { gatewayFetch } from '@/lib/api';
import { PageHeader, Card, Badge, Button, EmptyState, Spinner } from '@/components/ui';
import { CheckCircle2, RefreshCw, Save, Trash2, X, Pencil, Filter } from 'lucide-react';

type Memory = {
  id: string;
  content: string;
  source: string;
  category: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt: number;
};

type MemoriesResponse = {
  items: Memory[];
  total: number;
  hasMore: boolean;
};

const CATEGORY_OPTIONS = [
  { value: 'dream', label: 'Dreamer' },
  { value: 'monologue', label: 'Inner Monologue' },
];

export default function MemoriesPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState<string>('');
  const [activeCats, setActiveCats] = useState<string[]>(['dream', 'monologue']);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () => activeCats.map((c) => `category=${encodeURIComponent(c)}`).join('&') || '',
    [activeCats],
  );

  const load = async () => {
    try {
      setLoading(true);
      const res = await gatewayFetch<MemoriesResponse>(`/api/memories?${query}&limit=100`);
      setMemories(res.items || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load memories');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [query]);

  const startEdit = (m: Memory) => {
    setEditingId(m.id);
    setEditContent(m.content);
    setEditCategory(m.category);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditContent('');
    setEditCategory('');
  };

  const saveEdit = async (id: string) => {
    try {
      setSavingId(id);
      const payload: any = { content: editContent, category: editCategory };
      const res = await gatewayFetch<{ memory: Memory }>(`/api/memories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setMemories((prev) => prev.map((m) => (m.id === id ? res.memory : m)));
      cancelEdit();
    } catch (err: any) {
      alert(err?.message || 'Failed to save');
    } finally {
      setSavingId(null);
    }
  };

  const deleteMemory = async (id: string) => {
    if (!confirm('Delete this memory?')) return;
    try {
      setDeletingId(id);
      await gatewayFetch(`/api/memories/${id}`, { method: 'DELETE' });
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (err: any) {
      alert(err?.message || 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  const toggleCategory = (value: string) => {
    setActiveCats((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value],
    );
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Logs & Memories"
        subtitle="Review, edit, or remove entries created by Dreamer or Inner Monologue."
      >
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </PageHeader>

      <div className="p-6 flex flex-col gap-6 overflow-auto">
        <Card className="p-4 bg-bg-secondary/40 border-border-primary/40" hover={false}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm font-bold text-text-primary uppercase tracking-wider opacity-60">
                <Filter className="h-3.5 w-3.5" />
                <span>Filters</span>
              </div>
              <div className="h-6 w-px bg-border-primary/40" />
              <div className="flex items-center gap-2">
                {CATEGORY_OPTIONS.map((opt) => {
                  const active = activeCats.includes(opt.value);
                  return (
                    <Button
                      key={opt.value}
                      variant={active ? 'primary' : 'ghost'}
                      size="sm"
                      className={clsx(
                        'transition-all duration-200',
                        active ? 'shadow-lg shadow-accent-primary/20' : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
                      )}
                      onClick={() => toggleCategory(opt.value)}
                    >
                      {opt.label}
                    </Button>
                  );
                })}
              </div>
            </div>
            {error && <div className="text-error text-xs font-medium animate-pulse">{error}</div>}
          </div>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : memories.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing to show"
            description="No dreamer or inner monologue memories found."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {memories.map((m) => {
              const isEditing = editingId === m.id;
              return (
                <Card key={m.id} hover className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={m.category === 'dream' ? 'info' : 'warning'} size="sm">
                        {m.category}
                      </Badge>
                      <span className="text-xs text-text-tertiary">{m.source}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="space-y-3">
                      <textarea
                        className="w-full rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent-primary/60 focus:outline-none"
                        rows={4}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                      />
                      <div className="flex items-center gap-3">
                        <select
                          className="rounded-md border border-border-primary bg-bg-tertiary px-2 py-1 text-sm text-text-primary focus:border-accent-primary/50 focus:outline-none"
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                        >
                          {CATEGORY_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <div className="ml-auto flex gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            isLoading={savingId === m.id}
                            onClick={() => saveEdit(m.id)}
                          >
                            <Save className="h-4 w-4" /> Save
                          </Button>
                          <Button variant="ghost" size="sm" onClick={cancelEdit}>
                            <X className="h-4 w-4" /> Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
                      {m.content}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    {!isEditing && (
                      <Button variant="outline" size="sm" onClick={() => startEdit(m)}>
                        <Pencil className="h-4 w-4" /> Edit
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      size="sm"
                      isLoading={deletingId === m.id}
                      onClick={() => deleteMemory(m.id)}
                    >
                      <Trash2 className="h-4 w-4" /> Delete
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
