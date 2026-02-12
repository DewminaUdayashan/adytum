'use client';

import { useState } from 'react';
import { usePolling } from '@/hooks/use-polling';
import { gatewayFetch } from '@/lib/api';
import { PageHeader, Card, Badge, Button, EmptyState, Spinner } from '@/components/ui';
import { 
  Brain, 
  Trash2, 
  Plus, 
  RefreshCw, 
  Server, 
  CheckCircle, 
  AlertCircle 
} from 'lucide-react';
import { clsx } from 'clsx';

interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  model: string;
  source: 'default' | 'user' | 'discovered';
  baseUrl?: string;
  apiKey?: string;
}

interface ModelsResponse {
  models: ModelEntry[];
}

export default function ModelSettingsPage() {
  const { data, loading, refresh } = usePolling<ModelsResponse>('/api/models', 5000);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ discovered: ModelEntry[] } | null>(null);
  const [newModelId, setNewModelId] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const models = data?.models || [];

  const handleScan = async () => {
    setIsScanning(true);
    setScanResult(null);
    try {
      const res = await gatewayFetch<{ discovered: ModelEntry[] }>('/api/models/scan', {
        method: 'POST',
      });
      setScanResult(res);
      refresh(); // Refresh the list
    } catch (err) {
      console.error('Scan failed', err);
    } finally {
      setIsScanning(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newModelId.trim() || !newModelId.includes('/')) {
        setAddError('Format must be provider/model');
        return;
    }
    
    setIsAdding(true);
    setAddError(null);

    try {
        const [provider, model] = newModelId.split('/');
        await gatewayFetch('/api/models', {
            method: 'POST',
            body: JSON.stringify({
                id: newModelId,
                name: newModelId,
                provider,
                model
            })
        });
        setNewModelId('');
        refresh();
    } catch (err: any) {
        setAddError(err.message || 'Failed to add model');
    } finally {
        setIsAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
      if (!confirm(`Remove model ${id}?`)) return;
      try {
          await gatewayFetch(`/api/models/${encodeURIComponent(id)}`, {
              method: 'DELETE'
          });
          refresh();
      } catch (err) {
          console.error('Failed to delete', err);
          alert('Failed to delete model');
      }
  };

  // Group models by provider
  const byProvider: Record<string, ModelEntry[]> = {};
  for (const m of models) {
      byProvider[m.provider] = byProvider[m.provider] || [];
      byProvider[m.provider].push(m);
  }

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-20">
      <PageHeader 
        title="Model Management" 
        subtitle="Configure the LLMs available to Adytum. Auto-discover local models or add cloud providers manually."
      >
        <Button 
            variant="outline" 
            size="sm" 
            onClick={refresh}
            isLoading={loading && !data}
        >
            <RefreshCw size={14} className={loading && !data ? 'animate-spin' : ''} />
            Refresh
        </Button>
      </PageHeader>

      <div className="px-8 space-y-8">
        
        {/* Actions */ }
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-accent-primary/10 text-accent-primary">
                        <Server size={20} />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-text-primary">Local Discovery</h3>
                        <p className="text-xs text-text-tertiary">Scan for Ollama, LM Studio, etc.</p>
                    </div>
                </div>
                <div className="mt-auto">
                    <Button 
                        variant="primary" 
                        size="sm" 
                        className="w-full"
                        onClick={handleScan}
                        isLoading={isScanning}
                    >
                        <RefreshCw size={14} className={isScanning ? "animate-spin" : ""} />
                        Scan Local Models
                    </Button>
                </div>
                {scanResult && (
                    <div className="mt-2 text-xs text-success flex items-center gap-1.5 bg-success/5 p-2 rounded-lg border border-success/10">
                        <CheckCircle size={12} />
                        Found {scanResult.discovered.length} new models
                    </div>
                )}
            </Card>

            <Card className="flex flex-col gap-4">
                 <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-bg-tertiary text-text-secondary">
                        <Plus size={20} />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-text-primary">Add Manually</h3>
                        <p className="text-xs text-text-tertiary">Add a provider/model identifier</p>
                    </div>
                </div>
                
                <form onSubmit={handleAdd} className="mt-auto flex gap-2">
                    <input 
                        type="text" 
                        value={newModelId}
                        onChange={(e) => setNewModelId(e.target.value)}
                        placeholder="provider/model (e.g. anthropic/claude-3-5-sonnet)"
                        className="flex-1 h-8 rounded-lg border border-border-primary bg-bg-tertiary px-3 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-primary/50 focus:outline-none"
                    />
                    <Button variant="default" size="sm" type="submit" isLoading={isAdding}>
                        Add
                    </Button>
                </form>
                 {addError && (
                    <div className="mt-1 text-[10px] text-error flex items-center gap-1">
                        <AlertCircle size={10} />
                        {addError}
                    </div>
                )}
            </Card>
        </div>

        {/* Models List */}
        <div>
            <h2 className="text-lg font-bold text-text-primary mb-4 flex items-center gap-2">
                Available Models
                <Badge variant="default" size="sm" className="ml-2 font-mono">{models.length}</Badge>
            </h2>

            {Object.entries(byProvider).length === 0 ? (
                <EmptyState 
                    icon={Brain}
                    title="No Models Found"
                    description="No models are currently configured. Scan for local models or add one manually."
                />
            ) : (
                <div className="grid grid-cols-1 gap-6">
                    {Object.entries(byProvider).map(([provider, list]) => (
                        <div key={provider} className="space-y-3">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-text-tertiary pl-1">{provider}</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {list.map((model) => (
                                    <div 
                                        key={model.id}
                                        className="group relative flex flex-col justify-between rounded-xl border border-border-primary bg-bg-secondary p-4 transition-all hover:border-accent-primary/30 hover:shadow-sm"
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <Badge 
                                                variant={model.source === 'discovered' ? 'success' : model.source === 'user' ? 'info' : 'default'}
                                                size="sm"
                                            >
                                                {model.source}
                                            </Badge>
                                            {model.source !== 'default' && (
                                                <button 
                                                    onClick={() => handleDelete(model.id)}
                                                    className="text-text-tertiary hover:text-error transition-colors p-1 rounded-md hover:bg-bg-tertiary"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                        
                                        <div>
                                            <p className="text-xs font-medium text-text-secondary mb-0.5">{model.provider}</p>
                                            <h4 className="text-sm font-bold text-text-primary truncate" title={model.model}>{model.model}</h4>
                                        </div>
                                        
                                        {model.baseUrl && (
                                            <div className="mt-3 pt-3 border-t border-border-primary/30">
                                                <p className="text-[10px] font-mono text-text-tertiary truncate" title={model.baseUrl}>
                                                    {model.baseUrl}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
      </div>
    </div>
  );
}
