import { useState, useEffect } from 'react';
import { Card, Button, Badge, Spinner, Select } from '../ui';
import { gatewayFetch } from '@/lib/api';
import { X, ArrowRight, Save, RotateCcw, ArrowUp, ArrowDown } from 'lucide-react';

interface ModelChainEditorProps {
  models: { id: string; provider: string; model: string }[];
}

export function ModelChainEditor({ models }: ModelChainEditorProps) {
  const [chains, setChains] = useState<Record<string, string[]>>({
    thinking: [],
    fast: [],
    local: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modified, setModified] = useState(false);

  useEffect(() => {
    void loadChains();
  }, []);

  const loadChains = async () => {
    try {
      const res = await gatewayFetch<{ modelChains: Record<string, string[]> }>(
        '/api/config/chains',
      );
      setChains(res.modelChains);
      setModified(false);
    } catch (err) {
      console.error('Failed to load chains', err);
    } finally {
      setLoading(false);
    }
  };

  const saveChains = async () => {
    setSaving(true);
    try {
      await gatewayFetch('/api/config/chains', {
        method: 'PUT',
        body: JSON.stringify({ modelChains: chains }),
      });
      setModified(false);
    } catch (err) {
      console.error('Failed to save chains', err);
      alert('Failed to save chains');
    } finally {
      setSaving(false);
    }
  };

  const addModelToChain = (role: string, modelId: string) => {
    if (!modelId) return;
    setChains((prev) => ({
      ...prev,
      [role]: [...(prev[role] || []), modelId],
    }));
    setModified(true);
  };

  const removeModelFromChain = (role: string, index: number) => {
    setChains((prev) => ({
      ...prev,
      [role]: prev[role].filter((_, i) => i !== index),
    }));
    setModified(true);
  };

  const moveModelInChain = (role: string, index: number, direction: 'up' | 'down') => {
    setChains((prev) => {
      const newChain = [...(prev[role] || [])];
      if (direction === 'up' && index > 0) {
        [newChain[index], newChain[index - 1]] = [newChain[index - 1], newChain[index]];
      } else if (direction === 'down' && index < newChain.length - 1) {
        [newChain[index], newChain[index + 1]] = [newChain[index + 1], newChain[index]];
      }
      return { ...prev, [role]: newChain };
    });
    setModified(true);
  };

  if (loading)
    return (
      <div className="p-8 flex justify-center">
        <Spinner />
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Model Chains</h2>
          <p className="text-xs text-text-tertiary">
            Define fallback chains for different agent roles. The system will try models in order.
          </p>
        </div>
        {modified && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadChains} disabled={saving}>
              <RotateCcw size={14} /> Revert
            </Button>
            <Button variant="primary" size="sm" onClick={saveChains} isLoading={saving}>
              <Save size={14} /> Save Changes
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6">
        {['thinking', 'fast', 'local'].map((role) => (
          <Card key={role} className="flex flex-col gap-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-text-primary">
                    {role}
                  </h3>
                  <Badge variant="default" size="sm" className="font-mono text-[10px]">
                    {chains[role]?.length || 0} models
                  </Badge>
                </div>
                <p className="text-xs text-text-tertiary mt-1">
                  {role === 'thinking' && 'Used for complex reasoning and planning tasks.'}
                  {role === 'fast' && 'Used for quick responses and simple queries.'}
                  {role === 'local' && 'Used for privacy-sensitive or offline tasks.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 min-h-[40px] p-2 bg-bg-tertiary rounded-lg border border-border-primary/50">
              {chains[role]?.length === 0 && (
                <span className="text-xs text-text-muted italic px-2">
                  No models configured. Will fail if called.
                </span>
              )}

              {chains[role]?.map((modelId, idx) => (
                <div key={`${role}-${idx}`} className="flex items-center">
                  <div className="flex items-center gap-1 bg-bg-primary border border-border-primary rounded px-2 py-1 text-xs text-text-primary">
                    <span>{modelId}</span>
                    <div className="flex items-center gap-0.5 ml-1 border-l border-border-primary pl-1">
                      <button
                        onClick={() => moveModelInChain(role, idx, 'up')}
                        disabled={idx === 0}
                        className="text-text-tertiary hover:text-accent-primary disabled:opacity-30"
                      >
                        <ArrowUp size={10} />
                      </button>
                      <button
                        onClick={() => moveModelInChain(role, idx, 'down')}
                        disabled={idx === chains[role].length - 1}
                        className="text-text-tertiary hover:text-accent-primary disabled:opacity-30"
                      >
                        <ArrowDown size={10} />
                      </button>
                    </div>
                    <button
                      onClick={() => removeModelFromChain(role, idx)}
                      className="text-text-tertiary hover:text-error ml-1"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  {idx < chains[role].length - 1 && (
                    <ArrowRight size={12} className="text-text-muted mx-1" />
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <Select
                  value=""
                  placeholder="Add model to chain..."
                  onChange={(val: string) => addModelToChain(role, val)}
                  options={models.map((m) => ({
                    value: m.id,
                    label: `${m.model}`,
                    description: m.provider,
                  }))}
                  className="w-full"
                />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
