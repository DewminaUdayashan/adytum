'use client';

/**
 * @file packages/dashboard/src/app/settings/llm/page.tsx
 * @description Defines route-level UI composition and page behavior.
 */

import { useState, useEffect, useRef } from 'react';
import { usePolling } from '@/hooks/use-polling';
import { gatewayFetch } from '@/lib/api';
import { PageHeader, Card, Badge, Button, EmptyState, Spinner, Select } from '@/components/ui';
import {
  Brain,
  Trash2,
  Plus,
  RefreshCw,
  Server,
  CheckCircle,
  AlertCircle,
  Database,
  Link as LinkIcon,
  Key as KeyIcon,
  Layers,
  X,
  Zap,
  Cpu,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Save,
  RotateCcw,
  Search,
  GripVertical,
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

interface RoutingConfig {
  maxRetries: number;
  fallbackOnRateLimit: boolean;
  fallbackOnError: boolean;
}

const MODEL_ROLES = [
  {
    value: 'thinking',
    label: 'Thinking',
    icon: <Brain size={14} />,
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    description: 'Complex reasoning & planning',
  },
  {
    value: 'fast',
    label: 'Fast',
    icon: <Zap size={14} />,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    description: 'Quick responses & simple tasks',
  },
  {
    value: 'local',
    label: 'Local',
    icon: <Cpu size={14} />,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    description: 'Private & offline tasks',
  },
];

export default function ModelSettingsPage() {
  const { data, loading, refresh } = usePolling<ModelsResponse>('/api/models', 5000);
  const [activeTab, setActiveTab] = useState<'models' | 'chains'>('models');

  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ discovered: ModelEntry[] } | null>(null);

  // Add Manual State
  const [newModelId, setNewModelId] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  // Model Detail Panel
  const [selectedModel, setSelectedModel] = useState<ModelEntry | null>(null);
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [isSavingModel, setIsSavingModel] = useState(false);

  // Chains State
  const [chains, setChains] = useState<Record<string, string[]>>({
    thinking: [],
    fast: [],
    local: [],
  });
  const [chainsLoading, setChainsLoading] = useState(true);
  const [chainsSaving, setChainsSaving] = useState(false);
  const [chainsModified, setChainsModified] = useState(false);

  // Routing behavior
  const [routing, setRouting] = useState<RoutingConfig>({
    maxRetries: 5,
    fallbackOnRateLimit: true,
    fallbackOnError: false,
  });
  const [routingLoading, setRoutingLoading] = useState(true);
  const [routingSaving, setRoutingSaving] = useState(false);
  const [routingModified, setRoutingModified] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [draggingItem, setDraggingItem] = useState<{ role: string; index: number } | null>(null);
  const [dragInsertIndex, setDragInsertIndex] = useState<{ role: string; index: number } | null>(
    null,
  );
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);

  const parseParameters = (name: string): string | null => {
    // Matches patterns like "7b", "7.5b", "70b", "1.5t", etc.
    const match = name.match(/(\d+\.?\d*[bt])/i);
    return match ? match[0].toUpperCase() : null;
  };

  const models = data?.models || [];

  // Group models by provider
  const filteredModels = models.filter(
    (m) =>
      m.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.provider.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const byProvider: Record<string, ModelEntry[]> = {};
  for (const m of filteredModels) {
    byProvider[m.provider] = byProvider[m.provider] || [];
    byProvider[m.provider].push(m);
  }
  const providers = Object.keys(byProvider).sort();

  // Derived state for active provider (prevents render loop)
  const activeProvider = selectedProvider || (providers.length > 0 ? providers[0] : null);

  // Load chains
  useEffect(() => {
    void loadChains();
  }, []);

  useEffect(() => {
    void loadRouting();
  }, []);

  const loadChains = async () => {
    try {
      const res = await gatewayFetch<{ modelChains: Record<string, string[]> }>(
        '/api/config/chains',
      );
      setChains(res.modelChains || { thinking: [], fast: [], local: [] });
      setChainsModified(false);
    } catch (err) {
      console.error('Failed to load chains', err);
    } finally {
      setChainsLoading(false);
    }
  };

  const loadRouting = async () => {
    try {
      const res = await gatewayFetch<{ routing: RoutingConfig }>('/api/config/routing');
      setRouting(
        res.routing || { maxRetries: 5, fallbackOnRateLimit: true, fallbackOnError: false },
      );
      setRoutingModified(false);
    } catch (err) {
      console.error('Failed to load routing config', err);
    } finally {
      setRoutingLoading(false);
    }
  };

  const saveChains = async (newChains?: Record<string, string[]>) => {
    const chainsToSave = newChains || chains;
    setChainsSaving(true);
    try {
      await gatewayFetch('/api/config/chains', {
        method: 'PUT',
        body: JSON.stringify({ modelChains: chainsToSave }),
      });
      setChains(chainsToSave);
      setChainsModified(false);
    } catch (err) {
      console.error('Failed to save chains', err);
      alert('Failed to save chains');
    } finally {
      setChainsSaving(false);
    }
  };

  const saveRouting = async () => {
    setRoutingSaving(true);
    try {
      await gatewayFetch('/api/config/routing', {
        method: 'PUT',
        body: JSON.stringify({ routing }),
      });
      setRoutingModified(false);
    } catch (err) {
      console.error('Failed to save routing config', err);
      alert('Failed to save routing config');
    } finally {
      setRoutingSaving(false);
    }
  };

  // Get which roles a model is assigned to
  const getModelRoles = (modelId: string): string[] => {
    const roles: string[] = [];
    for (const [role, modelIds] of Object.entries(chains)) {
      if (modelIds.includes(modelId)) {
        roles.push(role);
      }
    }
    return roles;
  };

  // Toggle a model in/out of a role chain
  const toggleModelRole = (modelId: string, role: string) => {
    setChains((prev) => {
      const current = prev[role] || [];
      let updated: string[];
      if (current.includes(modelId)) {
        updated = current.filter((id) => id !== modelId);
      } else {
        updated = [...current, modelId];
      }
      const newChains = { ...prev, [role]: updated };
      // Auto-save when toggling from detail panel
      void saveChains(newChains);
      return newChains;
    });
  };

  const addModelToChain = (role: string, modelId: string) => {
    if (!modelId) return;
    setChains((prev) => ({
      ...prev,
      [role]: [...(prev[role] || []), modelId],
    }));
    setChainsModified(true);
  };

  const removeModelFromChain = (role: string, index: number) => {
    setChains((prev) => ({
      ...prev,
      [role]: prev[role].filter((_, i) => i !== index),
    }));
    setChainsModified(true);
  };

  const moveModelInChain = (role: string, index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    reorderModelInChain(role, index, targetIndex);
  };

  const reorderModelInChain = (role: string, fromIndex: number, toIndex: number) => {
    setChains((prev) => {
      const newChain = [...(prev[role] || [])];
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= newChain.length ||
        toIndex >= newChain.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }

      const [movedModel] = newChain.splice(fromIndex, 1);
      newChain.splice(toIndex, 0, movedModel);
      setChainsModified(true);
      return { ...prev, [role]: newChain };
    });
  };

  const reorderModelByInsertPosition = (role: string, fromIndex: number, insertIndex: number) => {
    setChains((prev) => {
      const newChain = [...(prev[role] || [])];
      if (fromIndex < 0 || fromIndex >= newChain.length) {
        return prev;
      }

      const boundedInsertIndex = Math.max(0, Math.min(insertIndex, newChain.length));
      const targetIndex =
        boundedInsertIndex > fromIndex ? boundedInsertIndex - 1 : boundedInsertIndex;
      if (targetIndex === fromIndex) {
        return prev;
      }

      const [movedModel] = newChain.splice(fromIndex, 1);
      newChain.splice(targetIndex, 0, movedModel);
      setChainsModified(true);
      return { ...prev, [role]: newChain };
    });
  };

  const cleanupDragPreview = () => {
    if (dragPreviewRef.current?.parentNode) {
      dragPreviewRef.current.parentNode.removeChild(dragPreviewRef.current);
    }
    dragPreviewRef.current = null;
  };

  const setTileDragPreview = (e: React.DragEvent<HTMLDivElement>) => {
    cleanupDragPreview();

    const sourceEl = e.currentTarget;
    const rect = sourceEl.getBoundingClientRect();
    const clone = sourceEl.cloneNode(true) as HTMLDivElement;

    clone.style.width = `${rect.width}px`;
    clone.style.boxSizing = 'border-box';
    clone.style.position = 'fixed';
    clone.style.top = '-9999px';
    clone.style.left = '-9999px';
    clone.style.margin = '0';
    clone.style.pointerEvents = 'none';
    clone.style.opacity = '0.96';
    clone.style.transform = 'none';
    clone.style.zIndex = '9999';

    document.body.appendChild(clone);
    dragPreviewRef.current = clone;

    const offsetX = Math.min(Math.max(e.clientX - rect.left, 0), Math.max(rect.width - 1, 0));
    const offsetY = Math.min(Math.max(e.clientY - rect.top, 0), Math.max(rect.height - 1, 0));
    e.dataTransfer.setDragImage(clone, offsetX, offsetY);
  };

  const clearDragState = () => {
    setDraggingItem(null);
    setDragInsertIndex(null);
    cleanupDragPreview();
  };

  const handleScan = async () => {
    setIsScanning(true);
    setScanResult(null);
    try {
      const res = await gatewayFetch<{ discovered: ModelEntry[] }>('/api/models/scan', {
        method: 'POST',
      });
      setScanResult(res);
      refresh();
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
          model,
          baseUrl: newBaseUrl.trim() || undefined,
          apiKey: newApiKey.trim() || undefined,
        }),
      });
      setNewModelId('');
      setNewBaseUrl('');
      setNewApiKey('');
      refresh();
      setSelectedProvider(provider);
    } catch (err: any) {
      setAddError(err.message || 'Failed to add model');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (id: string, provider: string) => {
    if (!confirm(`Remove model ${id}?`)) return;
    try {
      await gatewayFetch(`/api/models/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (selectedModel?.id === id) setSelectedModel(null);
      refresh();
    } catch (err) {
      console.error('Failed to delete', err);
      alert('Failed to delete model');
    }
  };

  // Find friendly model name from ID
  const getModelName = (modelId: string): string => {
    const found = models.find((m) => m.id === modelId);
    return found ? found.model : modelId;
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-20">
      <PageHeader
        title="Model Management"
        subtitle="Configure the LLMs available to Adytum. Click a model to configure and assign roles."
      >
        <Button variant="outline" size="sm" onClick={refresh} isLoading={loading && !data}>
          <RefreshCw size={14} className={loading && !data ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </PageHeader>

      <div className="px-8 space-y-6">
        {/* Tabs */}
        <div className="flex border-b border-border-primary">
          <button
            onClick={() => {
              setActiveTab('models');
              setSelectedModel(null);
            }}
            className={clsx(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === 'models'
                ? 'border-accent-primary text-accent-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            <div className="flex items-center gap-2">
              <Brain size={16} />
              Models
            </div>
          </button>
          <button
            onClick={() => {
              setActiveTab('chains');
              setSelectedModel(null);
            }}
            className={clsx(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              activeTab === 'chains'
                ? 'border-accent-primary text-accent-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            <div className="flex items-center gap-2">
              <Layers size={16} />
              Chains
            </div>
          </button>
        </div>

        {activeTab === 'models' ? (
          <div className="flex flex-col lg:flex-row gap-8 animate-fade-in">
            {/* Left Sidebar: Providers */}
            <div className="w-full lg:w-72 shrink-0 space-y-6">
              <div className="space-y-1">
                <h3 className="text-xs font-bold uppercase tracking-wider text-text-tertiary mb-2 px-2">
                  Providers
                </h3>
                {providers.length === 0 && !loading && (
                  <div className="text-sm text-text-muted px-2 italic">No providers</div>
                )}
                {providers.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setSelectedProvider(p);
                      setSelectedModel(null);
                    }}
                    className={clsx(
                      'w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors duration-200',
                      activeProvider === p
                        ? 'bg-accent-primary/10 text-accent-primary font-medium'
                        : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
                    )}
                  >
                    <span className="capitalize">{p}</span>
                    <Badge
                      variant="default"
                      size="sm"
                      className="bg-transparent border-transparent text-inherit"
                    >
                      {byProvider[p].length}
                    </Badge>
                  </button>
                ))}
              </div>

              {/* Add / Scan Actions */}
              <Card className="p-4 space-y-4 bg-bg-tertiary/30 border-dashed">
                <h3 className="text-xs font-bold uppercase tracking-wider text-text-tertiary">
                  Actions
                </h3>

                {/* Scan */}
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start text-xs"
                    onClick={handleScan}
                    isLoading={isScanning}
                  >
                    <RefreshCw size={12} className={isScanning ? 'animate-spin' : ''} />
                    Scan Local Models
                  </Button>
                  {scanResult && (
                    <div className="mt-1.5 text-[10px] text-success flex items-center gap-1">
                      <CheckCircle size={10} />
                      Found {scanResult.discovered.length}
                    </div>
                  )}
                </div>

                <div className="h-px bg-border-primary/50" />

                {/* Add Manual */}
                <div className="space-y-3">
                  <span className="text-xs font-medium text-text-secondary">Add Custom Model</span>

                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newModelId}
                      onChange={(e) => setNewModelId(e.target.value)}
                      placeholder="provider/model (e.g. openai/gpt-4)"
                      className="w-full h-8 rounded border border-border-primary bg-bg-secondary px-2 text-xs text-text-primary focus:border-accent-primary/50 focus:outline-none"
                    />
                    <div className="relative">
                      <LinkIcon size={12} className="absolute left-2 top-2 text-text-tertiary" />
                      <input
                        type="text"
                        value={newBaseUrl}
                        onChange={(e) => setNewBaseUrl(e.target.value)}
                        placeholder="Base URL (optional)"
                        className="w-full h-8 rounded border border-border-primary bg-bg-secondary pl-7 pr-2 text-xs text-text-primary focus:border-accent-primary/50 focus:outline-none"
                      />
                    </div>
                    <div className="relative">
                      <KeyIcon size={12} className="absolute left-2 top-2 text-text-tertiary" />
                      <input
                        type="password"
                        value={newApiKey}
                        onChange={(e) => setNewApiKey(e.target.value)}
                        placeholder="API Key (optional)"
                        className="w-full h-8 rounded border border-border-primary bg-bg-secondary pl-7 pr-2 text-xs text-text-primary focus:border-accent-primary/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <Button
                    variant="default"
                    size="sm"
                    className="w-full justify-start text-xs"
                    onClick={handleAdd}
                    isLoading={isAdding}
                    disabled={!newModelId.trim()}
                  >
                    <Plus size={12} />
                    Add Manual
                  </Button>
                  {addError && (
                    <div className="text-[10px] text-error flex items-center gap-1">
                      <AlertCircle size={10} />
                      {addError}
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {/* Right Content: Models for Selected Provider */}
            <div className="flex-1 min-w-0 space-y-4">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search models by name, ID or provider..."
                  className="w-full h-10 rounded-xl border border-border-primary bg-bg-tertiary/20 pl-9 pr-4 text-sm text-text-primary focus:border-accent-primary/50 focus:outline-none focus:ring-1 focus:ring-accent-primary/20 transition-all"
                />
              </div>

              {!activeProvider ? (
                <EmptyState
                  icon={Brain}
                  title="No Models Configured"
                  description="Scan for local models or add a provider manually to get started."
                />
              ) : selectedModel ? (
                /* ── Model Detail Panel ── */
                <div className="animate-fade-in space-y-6 max-w-2xl">
                  <button
                    onClick={() => setSelectedModel(null)}
                    className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors"
                  >
                    ← Back to {activeProvider}
                  </button>

                  <Card className="space-y-5">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-accent-primary/10">
                          <Database size={22} className="text-accent-primary" />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-text-primary">
                            {selectedModel.model}
                          </h2>
                          <p className="text-sm text-text-tertiary font-mono">{selectedModel.id}</p>
                        </div>
                      </div>
                      <Badge
                        variant={
                          selectedModel.source === 'discovered'
                            ? 'success'
                            : selectedModel.source === 'user'
                              ? 'info'
                              : 'default'
                        }
                        size="sm"
                      >
                        {selectedModel.source}
                      </Badge>
                    </div>

                    {/* Model Config — Editable */}
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-text-primary">
                          Connection Settings
                        </h3>
                        <p className="text-xs text-text-tertiary mt-0.5">
                          Configure API endpoint and credentials for this model.
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-bg-tertiary/50 border border-border-primary/30">
                        <div>
                          <span className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">
                            Provider
                          </span>
                          <p className="text-sm text-text-primary capitalize mt-0.5">
                            {selectedModel.provider}
                          </p>
                        </div>
                        <div>
                          <span className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">
                            Source
                          </span>
                          <p className="text-sm text-text-primary capitalize mt-0.5">
                            {selectedModel.source}
                          </p>
                        </div>
                        <div className="col-span-2">
                          <label className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">
                            Base URL
                          </label>
                          <div className="relative mt-1">
                            <LinkIcon
                              size={12}
                              className="absolute left-2.5 top-2.5 text-text-tertiary"
                            />
                            <input
                              type="text"
                              value={editBaseUrl}
                              onChange={(e) => setEditBaseUrl(e.target.value)}
                              placeholder="e.g. https://openrouter.ai/api/v1"
                              className="w-full h-9 rounded-lg border border-border-primary bg-bg-secondary pl-8 pr-3 text-sm text-text-primary font-mono focus:border-accent-primary/50 focus:outline-none"
                            />
                          </div>
                        </div>
                        <div className="col-span-2">
                          <label className="text-[10px] font-medium uppercase tracking-wider text-text-tertiary">
                            API Key
                          </label>
                          <div className="relative mt-1">
                            <KeyIcon
                              size={12}
                              className="absolute left-2.5 top-2.5 text-text-tertiary"
                            />
                            <input
                              type="password"
                              value={editApiKey}
                              onChange={(e) => setEditApiKey(e.target.value)}
                              placeholder="sk-..."
                              className="w-full h-9 rounded-lg border border-border-primary bg-bg-secondary pl-8 pr-3 text-sm text-text-primary font-mono focus:border-accent-primary/50 focus:outline-none"
                            />
                          </div>
                        </div>
                        <div className="col-span-2 flex justify-end">
                          <Button
                            variant="primary"
                            size="sm"
                            isLoading={isSavingModel}
                            onClick={async () => {
                              setIsSavingModel(true);
                              try {
                                await gatewayFetch(
                                  `/api/models/${encodeURIComponent(selectedModel.id)}`,
                                  {
                                    method: 'PUT',
                                    body: JSON.stringify({
                                      baseUrl: editBaseUrl.trim() || undefined,
                                      apiKey: editApiKey.trim() || undefined,
                                    }),
                                  },
                                );
                                // Update local state
                                setSelectedModel({
                                  ...selectedModel,
                                  baseUrl: editBaseUrl.trim() || undefined,
                                  apiKey: editApiKey.trim() || undefined,
                                });
                                refresh();
                              } catch (err) {
                                alert('Failed to save model settings');
                              } finally {
                                setIsSavingModel(false);
                              }
                            }}
                          >
                            <Save size={14} /> Save Connection
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Role Assignment */}
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-text-primary">Assign to Roles</h3>
                        <p className="text-xs text-text-tertiary mt-0.5">
                          Toggle roles to include this model in the corresponding fallback chain.
                          The agent uses these chains to select models for different tasks.
                        </p>
                      </div>

                      <div className="space-y-2">
                        {MODEL_ROLES.map((role) => {
                          const isAssigned = getModelRoles(selectedModel.id).includes(role.value);
                          const position = isAssigned
                            ? (chains[role.value]?.indexOf(selectedModel.id) ?? -1) + 1
                            : null;

                          return (
                            <button
                              key={role.value}
                              onClick={() => toggleModelRole(selectedModel.id, role.value)}
                              className={clsx(
                                'w-full flex items-center justify-between p-3 rounded-lg border transition-all duration-200',
                                isAssigned
                                  ? 'border-accent-primary/40 bg-accent-primary/5'
                                  : 'border-border-primary/50 bg-bg-tertiary/30 hover:border-border-primary',
                              )}
                            >
                              <div className="flex items-center gap-3">
                                <div className={clsx('p-1.5 rounded-lg', role.bgColor, role.color)}>
                                  {role.icon}
                                </div>
                                <div className="text-left">
                                  <span className="text-sm font-medium text-text-primary">
                                    {role.label}
                                  </span>
                                  <p className="text-[11px] text-text-tertiary">
                                    {role.description}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {position && (
                                  <span className="text-[10px] text-text-muted">
                                    #{position} in chain
                                  </span>
                                )}
                                <div
                                  className={clsx(
                                    'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
                                    isAssigned
                                      ? 'border-accent-primary bg-accent-primary'
                                      : 'border-border-primary',
                                  )}
                                >
                                  {isAssigned && <CheckCircle size={12} className="text-white" />}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Delete Action */}
                    {selectedModel.source !== 'default' && (
                      <div className="pt-4 border-t border-border-primary/30">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(selectedModel.id, selectedModel.provider)}
                          className="text-error border-error/30 hover:bg-error/10"
                        >
                          <Trash2 size={14} />
                          Remove Model
                        </Button>
                      </div>
                    )}
                  </Card>
                </div>
              ) : (
                <div className="space-y-4 animate-fade-in">
                  <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-xl font-bold text-text-primary capitalize">
                      {activeProvider}
                    </h2>
                    <Badge variant="default" size="sm">
                      {byProvider[activeProvider]?.length || 0} Models
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {byProvider[activeProvider]?.map((model) => {
                      const assignedRoles = getModelRoles(model.id);
                      return (
                        <Card
                          key={model.id}
                          className="group flex flex-col gap-3 transition-all hover:border-accent-primary/30 cursor-pointer"
                          onClick={() => {
                            setSelectedModel(model);
                            setEditBaseUrl(model.baseUrl || '');
                            setEditApiKey(model.apiKey || '');
                          }}
                        >
                          <div className="flex justify-between items-start">
                            <div className="bg-bg-tertiary rounded p-1.5">
                              <Database size={16} className="text-text-secondary" />
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {model.source !== 'default' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (activeProvider) void handleDelete(model.id, activeProvider);
                                  }}
                                  className="p-1.5 text-text-tertiary hover:text-error hover:bg-bg-tertiary rounded transition-colors"
                                  title="Delete Model"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center gap-2">
                              <h3
                                className="font-bold text-text-primary truncate"
                                title={model.model}
                              >
                                {model.model}
                              </h3>
                              {parseParameters(model.model || model.id) && (
                                <Badge
                                  variant="default"
                                  size="sm"
                                  className="text-[9px] h-4 px-1 border-accent-primary/20 text-accent-primary/70 bg-accent-primary/10"
                                >
                                  {parseParameters(model.model || model.id)}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <p className="text-xs text-text-tertiary font-mono truncate">
                                {model.id}
                              </p>
                              {model.baseUrl && (
                                <Badge variant="default" size="sm" className="h-4 text-[9px] px-1">
                                  URL
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="mt-auto pt-3 flex items-center justify-between border-t border-border-primary/30">
                            <Badge
                              variant={
                                model.source === 'discovered'
                                  ? 'success'
                                  : model.source === 'user'
                                    ? 'info'
                                    : 'default'
                              }
                              size="sm"
                            >
                              {model.source}
                            </Badge>
                            {/* Show assigned roles */}
                            {assignedRoles.length > 0 && (
                              <div className="flex gap-1">
                                {assignedRoles.map((r) => {
                                  const roleInfo = MODEL_ROLES.find((mr) => mr.value === r);
                                  return (
                                    <span
                                      key={r}
                                      className={clsx(
                                        'text-[9px] px-1.5 py-0.5 rounded-full font-medium',
                                        roleInfo?.bgColor,
                                        roleInfo?.color,
                                      )}
                                      title={`Assigned to ${roleInfo?.label}`}
                                    >
                                      {roleInfo?.label}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── Chains Tab (inline editor) ── */
          <div className="animate-fade-in max-w-4xl space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-text-primary">Model Chains</h2>
                <p className="text-sm text-text-secondary">
                  Define model fallback chains for each agent role. The agent tries models in order
                  — if the first fails, it falls back to the next.
                </p>
              </div>
              {chainsModified && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={loadChains} disabled={chainsSaving}>
                    <RotateCcw size={14} /> Revert
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => saveChains()}
                    isLoading={chainsSaving}
                  >
                    <Save size={14} /> Save Changes
                  </Button>
                </div>
              )}
            </div>

            {chainsLoading ? (
              <div className="p-8 flex justify-center">
                <Spinner />
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {MODEL_ROLES.map((role) => (
                  <Card key={role.value} className="flex flex-col gap-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className={clsx('p-1.5 rounded-lg', role.bgColor, role.color)}>
                            {role.icon}
                          </div>
                          <h3 className="text-sm font-bold uppercase tracking-wider text-text-primary">
                            {role.label}
                          </h3>
                          <Badge variant="default" size="sm" className="font-mono text-[10px]">
                            {chains[role.value]?.length || 0} models
                          </Badge>
                        </div>
                        <p className="text-xs text-text-tertiary mt-1 ml-9">{role.description}</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {chains[role.value]?.length === 0 ? (
                        <div className="p-6 bg-bg-tertiary/20 rounded-xl border border-dashed border-border-primary/50 flex flex-col items-center justify-center text-center">
                          <AlertCircle size={24} className="text-text-tertiary mb-2 opacity-20" />
                          <p className="text-xs text-text-muted italic">
                            No models configured for this role.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {chains[role.value].map((modelId, idx) => (
                            <div key={`${role.value}-${idx}`}>
                              <div
                                onDragOver={(e) => {
                                  if (!draggingItem || draggingItem.role !== role.value) return;
                                  e.preventDefault();
                                  if (
                                    dragInsertIndex?.role !== role.value ||
                                    dragInsertIndex.index !== idx
                                  ) {
                                    setDragInsertIndex({ role: role.value, index: idx });
                                  }
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  if (!draggingItem || draggingItem.role !== role.value) return;
                                  reorderModelByInsertPosition(role.value, draggingItem.index, idx);
                                  clearDragState();
                                }}
                                className={clsx(
                                  'transition-all rounded-full',
                                  draggingItem?.role === role.value ? 'h-1.5 mb-2' : 'h-0 mb-0',
                                  dragInsertIndex?.role === role.value &&
                                    dragInsertIndex.index === idx
                                    ? 'bg-accent-primary/80'
                                    : 'bg-transparent',
                                )}
                              />

                              <div
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.effectAllowed = 'move';
                                  e.dataTransfer.setData('text/plain', `${role.value}:${idx}`);
                                  setTileDragPreview(e);

                                  setDraggingItem({ role: role.value, index: idx });
                                  setDragInsertIndex({ role: role.value, index: idx });
                                }}
                                onDragEnd={clearDragState}
                                onDragOver={(e) => {
                                  if (!draggingItem || draggingItem.role !== role.value) return;
                                  e.preventDefault();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const nextInsertIndex =
                                    e.clientY >= rect.top + rect.height / 2 ? idx + 1 : idx;
                                  if (
                                    dragInsertIndex?.role !== role.value ||
                                    dragInsertIndex.index !== nextInsertIndex
                                  ) {
                                    setDragInsertIndex({
                                      role: role.value,
                                      index: nextInsertIndex,
                                    });
                                  }
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  if (!draggingItem || draggingItem.role !== role.value) return;
                                  const insertIndex =
                                    dragInsertIndex?.role === role.value
                                      ? dragInsertIndex.index
                                      : idx;
                                  reorderModelByInsertPosition(
                                    role.value,
                                    draggingItem.index,
                                    insertIndex,
                                  );
                                  clearDragState();
                                }}
                                className={clsx(
                                  'group flex items-center justify-between p-3 bg-bg-primary border rounded-xl shadow-sm transition-all duration-150 select-none',
                                  dragInsertIndex?.role === role.value &&
                                    (dragInsertIndex.index === idx ||
                                      dragInsertIndex.index === idx + 1)
                                    ? 'border-accent-primary/60'
                                    : 'border-border-primary hover:border-accent-primary/30',
                                  draggingItem?.role === role.value && draggingItem.index === idx
                                    ? 'opacity-40'
                                    : '',
                                )}
                              >
                                <div className="flex items-center gap-3">
                                  <div
                                    className="p-1 text-text-tertiary cursor-grab active:cursor-grabbing"
                                    title="Drag to reorder"
                                  >
                                    <GripVertical size={14} />
                                  </div>
                                  <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-bg-tertiary text-[11px] font-bold text-text-secondary border border-border-primary/50">
                                    {idx + 1}
                                  </div>
                                  <div className="flex flex-col min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-bold text-text-primary truncate">
                                        {getModelName(modelId)}
                                      </span>
                                      {parseParameters(modelId) && (
                                        <Badge
                                          variant="default"
                                          size="sm"
                                          className="text-[9px] h-4 px-1 border-accent-primary/20 text-accent-primary/70 bg-accent-primary/10"
                                        >
                                          {parseParameters(modelId)}
                                        </Badge>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-text-tertiary font-mono truncate">
                                      {modelId}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => moveModelInChain(role.value, idx, 'up')}
                                    disabled={idx === 0}
                                    className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-secondary disabled:opacity-20 transition-colors"
                                    title="Move Up"
                                  >
                                    <ArrowUp size={14} />
                                  </button>
                                  <button
                                    onClick={() => moveModelInChain(role.value, idx, 'down')}
                                    disabled={idx === chains[role.value].length - 1}
                                    className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-secondary disabled:opacity-20 transition-colors"
                                    title="Move Down"
                                  >
                                    <ArrowDown size={14} />
                                  </button>
                                  <div className="w-px h-4 bg-border-primary/50 mx-1" />
                                  <button
                                    onClick={() => removeModelFromChain(role.value, idx)}
                                    className="p-1.5 rounded-lg hover:bg-error/10 text-text-secondary hover:text-error transition-colors"
                                    title="Remove from chain"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                          <div
                            onDragOver={(e) => {
                              if (!draggingItem || draggingItem.role !== role.value) return;
                              e.preventDefault();
                              const endIndex = chains[role.value].length;
                              if (
                                dragInsertIndex?.role !== role.value ||
                                dragInsertIndex.index !== endIndex
                              ) {
                                setDragInsertIndex({ role: role.value, index: endIndex });
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (!draggingItem || draggingItem.role !== role.value) return;
                              reorderModelByInsertPosition(
                                role.value,
                                draggingItem.index,
                                chains[role.value].length,
                              );
                              clearDragState();
                            }}
                            className={clsx(
                              'transition-all rounded-full',
                              draggingItem?.role === role.value ? 'h-1.5 mt-2' : 'h-0 mt-0',
                              dragInsertIndex?.role === role.value &&
                                dragInsertIndex.index === chains[role.value].length
                                ? 'bg-accent-primary/80'
                                : 'bg-transparent',
                            )}
                          />
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}

            <Card className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-text-primary">Routing & Retries</h3>
                  <p className="text-xs text-text-tertiary">
                    Control how many times the agent retries a model and whether to fall back to the
                    next model when rate-limited.
                  </p>
                </div>
                {routingModified && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadRouting}
                      disabled={routingSaving || routingLoading}
                    >
                      <RotateCcw size={14} /> Revert
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={saveRouting}
                      isLoading={routingSaving}
                    >
                      <Save size={14} /> Save
                    </Button>
                  </div>
                )}
              </div>

              {routingLoading ? (
                <div className="p-4 flex justify-center">
                  <Spinner />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] uppercase text-text-muted font-medium">
                      Max retries per model
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={routing.maxRetries}
                      onChange={(e) => {
                        const val = Math.min(Math.max(Number(e.target.value || 1), 1), 10);
                        setRouting((prev) => ({ ...prev, maxRetries: val }));
                        setRoutingModified(true);
                      }}
                      className="rounded-lg bg-bg-tertiary border border-border-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary/50"
                    />
                    <p className="text-[11px] text-text-tertiary">
                      Default 5. Applies before moving to the next model.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase text-text-muted font-medium">
                      Fallback on rate limit
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={routing.fallbackOnRateLimit}
                        onChange={(e) => {
                          setRouting((prev) => ({
                            ...prev,
                            fallbackOnRateLimit: e.target.checked,
                          }));
                          setRoutingModified(true);
                        }}
                        className="h-4 w-4 accent-accent-primary"
                      />
                      <span className="text-sm text-text-primary">
                        Try next model in chain when 429/Rate limit occurs
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] uppercase text-text-muted font-medium">
                      Fallback on other errors
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={routing.fallbackOnError}
                        onChange={(e) => {
                          setRouting((prev) => ({ ...prev, fallbackOnError: e.target.checked }));
                          setRoutingModified(true);
                        }}
                        className="h-4 w-4 accent-accent-primary"
                      />
                      <span className="text-sm text-text-primary">
                        Advance to next model after non-rate-limit failures
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
