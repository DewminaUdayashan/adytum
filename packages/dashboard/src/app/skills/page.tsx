'use client';

import { useEffect, useMemo, useState } from 'react';
import { gatewayFetch } from '@/lib/api';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';
import { Puzzle, Save, RefreshCw, Wrench, ShieldCheck } from 'lucide-react';

type SkillUiHint = {
  label?: string;
  help?: string;
  advanced?: boolean;
  sensitive?: boolean;
  placeholder?: string;
};

type JsonSchema = {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
};

type SkillManifest = {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  kind?: string;
  channels?: string[];
  providers?: string[];
  configSchema: JsonSchema;
  uiHints?: Record<string, SkillUiHint>;
};

type SkillConfigEntry = {
  enabled?: boolean;
  config?: Record<string, unknown>;
};

type SkillRecord = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  origin: string;
  status: 'discovered' | 'loaded' | 'disabled' | 'error';
  enabled: boolean;
  error?: string;
  toolNames: string[];
  serviceIds: string[];
  instructionFiles: string[];
  manifest: SkillManifest | null;
  configEntry: SkillConfigEntry;
};

type SkillInstructionFile = {
  path: string;
  relativePath: string;
  content: string;
  editable: boolean;
};

type SkillInstructionsResponse = {
  files: SkillInstructionFile[];
  combined: string;
};

type SkillsResponse = {
  skills: SkillRecord[];
  global: {
    enabled: boolean;
    allow: string[];
    deny: string[];
    loadPaths: string[];
  };
};

function instructionContentKey(skillId: string, relativePath: string): string {
  return `${skillId}:${relativePath}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function humanize(label: string): string {
  return label
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function getAtPath(obj: Record<string, unknown> | undefined, path: string[]): unknown {
  if (!obj) return undefined;
  let cursor: unknown = obj;
  for (const part of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function setAtPath(obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  if (path.length === 0) return obj;
  const [head, ...tail] = path;

  const next: Record<string, unknown> = { ...obj };
  if (tail.length === 0) {
    next[head] = value;
    return next;
  }

  const existingChild = isRecord(next[head]) ? (next[head] as Record<string, unknown>) : {};
  next[head] = setAtPath(existingChild, tail, value);
  return next;
}

function getHint(uiHints: Record<string, SkillUiHint> | undefined, path: string[]): SkillUiHint | undefined {
  if (!uiHints) return undefined;
  const key = path.join('.');
  return uiHints[key];
}

function FieldRenderer(props: {
  schema: JsonSchema;
  path: string[];
  config: Record<string, unknown>;
  onChange: (path: string[], value: unknown) => void;
  uiHints?: Record<string, SkillUiHint>;
}) {
  const { schema, path, config, onChange, uiHints } = props;
  const hint = getHint(uiHints, path);
  const raw = getAtPath(config, path);
  const value = raw === undefined ? schema.default : raw;
  const fieldKey = path.join('.');
  const title = hint?.label || schema.title || humanize(path[path.length - 1] || 'value');
  const help = hint?.help || schema.description;

  if (schema.type === 'object') {
    const properties = schema.properties || {};
    const entries = Object.entries(properties);

    if (entries.length === 0) {
      return null;
    }

    const containerTitle = path.length === 0 ? null : title;

    return (
      <div className="space-y-3" key={fieldKey || 'root-object'}>
        {containerTitle && (
          <div className="rounded-lg border border-border-primary/60 bg-bg-tertiary/30 p-3">
            <p className="text-xs font-semibold text-text-primary">{containerTitle}</p>
            {help && <p className="mt-1 text-[11px] text-text-muted">{help}</p>}
            <div className="mt-3 space-y-3">
              {entries.map(([key, childSchema]) => (
                <FieldRenderer
                  key={`${fieldKey}.${key}`}
                  schema={childSchema}
                  path={[...path, key]}
                  config={config}
                  onChange={onChange}
                  uiHints={uiHints}
                />
              ))}
            </div>
          </div>
        )}

        {!containerTitle &&
          entries.map(([key, childSchema]) => (
            <FieldRenderer
              key={key}
              schema={childSchema}
              path={[...path, key]}
              config={config}
              onChange={onChange}
              uiHints={uiHints}
            />
          ))}
      </div>
    );
  }

  if (schema.type === 'boolean') {
    const checked = Boolean(value);
    return (
      <label key={fieldKey} className="flex items-start justify-between gap-4 rounded-lg border border-border-primary/60 bg-bg-tertiary/20 p-3">
        <div>
          <p className="text-sm font-medium text-text-primary">{title}</p>
          {help && <p className="mt-1 text-[11px] text-text-muted">{help}</p>}
        </div>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(path, e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-border-primary bg-bg-primary text-accent-primary focus:ring-accent-primary/50"
        />
      </label>
    );
  }

  if (schema.type === 'array' && schema.items?.type === 'string') {
    const lines = Array.isArray(value)
      ? value.map((entry) => String(entry)).join('\n')
      : '';

    return (
      <div key={fieldKey} className="space-y-1">
        <label className="block text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</label>
        {help && <p className="text-[11px] text-text-muted">{help}</p>}
        <textarea
          rows={4}
          value={lines}
          onChange={(e) => {
            const list = e.target.value
              .split('\n')
              .map((entry) => entry.trim())
              .filter(Boolean);
            onChange(path, list);
          }}
          className="w-full rounded-lg border border-border-primary bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:border-accent-primary/50 focus:outline-none"
        />
      </div>
    );
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const enumValues = schema.enum.map((entry) => String(entry));
    const selected = typeof value === 'string' ? value : enumValues[0];

    return (
      <div key={fieldKey} className="space-y-1">
        <label className="block text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</label>
        {help && <p className="text-[11px] text-text-muted">{help}</p>}
        <select
          value={selected}
          onChange={(e) => onChange(path, e.target.value)}
          className="w-full rounded-lg border border-border-primary bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:border-accent-primary/50 focus:outline-none"
        >
          {enumValues.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    const numericValue = typeof value === 'number' ? String(value) : '';
    return (
      <div key={fieldKey} className="space-y-1">
        <label className="block text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</label>
        {help && <p className="text-[11px] text-text-muted">{help}</p>}
        <input
          type="number"
          value={numericValue}
          onChange={(e) => {
            const next = e.target.value.trim();
            if (!next) {
              onChange(path, schema.type === 'integer' ? 0 : 0);
              return;
            }
            const parsed = Number(next);
            onChange(path, schema.type === 'integer' ? Math.trunc(parsed) : parsed);
          }}
          className="w-full rounded-lg border border-border-primary bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:border-accent-primary/50 focus:outline-none"
        />
      </div>
    );
  }

  const textValue = typeof value === 'string' ? value : value === undefined ? '' : String(value);
  const isSensitive = hint?.sensitive || /token|secret|password|api.?key/i.test(fieldKey);

  return (
    <div key={fieldKey} className="space-y-1">
      <label className="block text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</label>
      {help && <p className="text-[11px] text-text-muted">{help}</p>}
      <input
        type={isSensitive ? 'password' : 'text'}
        value={textValue}
        placeholder={hint?.placeholder}
        onChange={(e) => onChange(path, e.target.value)}
        className="w-full rounded-lg border border-border-primary bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:border-accent-primary/50 focus:outline-none"
      />
    </div>
  );
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [savingSkillId, setSavingSkillId] = useState<string | null>(null);
  const [draftConfig, setDraftConfig] = useState<Record<string, Record<string, unknown>>>({});
  const [draftEnabled, setDraftEnabled] = useState<Record<string, boolean>>({});
  const [originalConfig, setOriginalConfig] = useState<Record<string, Record<string, unknown>>>({});
  const [originalEnabled, setOriginalEnabled] = useState<Record<string, boolean>>({});
  const [instructionFilesBySkill, setInstructionFilesBySkill] = useState<Record<string, SkillInstructionFile[]>>({});
  const [selectedInstructionFileBySkill, setSelectedInstructionFileBySkill] = useState<Record<string, string>>({});
  const [instructionDrafts, setInstructionDrafts] = useState<Record<string, string>>({});
  const [instructionOriginals, setInstructionOriginals] = useState<Record<string, string>>({});
  const [instructionLoadingSkillId, setInstructionLoadingSkillId] = useState<string | null>(null);
  const [instructionSavingSkillId, setInstructionSavingSkillId] = useState<string | null>(null);

  const loadSkills = async () => {
    try {
      setLoading(true);
      const res = await gatewayFetch<SkillsResponse>('/api/skills');
      const nextSkills = res.skills;
      setSkills(nextSkills);

      const nextConfig: Record<string, Record<string, unknown>> = {};
      const nextEnabled: Record<string, boolean> = {};

      for (const skill of nextSkills) {
        nextConfig[skill.id] = isRecord(skill.configEntry?.config)
          ? (skill.configEntry.config as Record<string, unknown>)
          : {};
        nextEnabled[skill.id] =
          typeof skill.configEntry?.enabled === 'boolean'
            ? skill.configEntry.enabled
            : skill.enabled;
      }

      setDraftConfig(nextConfig);
      setDraftEnabled(nextEnabled);
      setOriginalConfig(nextConfig);
      setOriginalEnabled(nextEnabled);
      setSelectedSkillId((prev) => {
        if (prev && nextSkills.some((skill) => skill.id === prev)) return prev;
        return null;
      });
      setError(null);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadSkillInstructions = async (skillId: string) => {
    try {
      setInstructionLoadingSkillId(skillId);
      const res = await gatewayFetch<SkillInstructionsResponse>(`/api/skills/${skillId}/instructions`);
      const files = Array.isArray(res.files) ? res.files : [];

      setInstructionFilesBySkill((prev) => ({
        ...prev,
        [skillId]: files,
      }));

      setSelectedInstructionFileBySkill((prev) => {
        if (prev[skillId] && files.some((file) => file.relativePath === prev[skillId])) {
          return prev;
        }
        const firstPath = files[0]?.relativePath || '';
        return {
          ...prev,
          [skillId]: firstPath,
        };
      });

      setInstructionDrafts((prev) => {
        const next = { ...prev };
        for (const file of files) {
          next[instructionContentKey(skillId, file.relativePath)] = file.content || '';
        }
        return next;
      });

      setInstructionOriginals((prev) => {
        const next = { ...prev };
        for (const file of files) {
          next[instructionContentKey(skillId, file.relativePath)] = file.content || '';
        }
        return next;
      });

      setError(null);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setInstructionLoadingSkillId((current) => (current === skillId ? null : current));
    }
  };

  useEffect(() => {
    loadSkills();
  }, []);

  useEffect(() => {
    if (!selectedSkillId) return;
    if (instructionFilesBySkill[selectedSkillId]) return;
    loadSkillInstructions(selectedSkillId);
  }, [selectedSkillId, instructionFilesBySkill]);

  const hasSkillChanges = (skillId: string): boolean => {
    const cfgChanged = JSON.stringify(draftConfig[skillId] || {}) !== JSON.stringify(originalConfig[skillId] || {});
    const enabledChanged = draftEnabled[skillId] !== originalEnabled[skillId];
    return cfgChanged || enabledChanged;
  };

  const hasInstructionChanges = (skillId: string, relativePath: string): boolean => {
    const key = instructionContentKey(skillId, relativePath);
    return (instructionDrafts[key] || '') !== (instructionOriginals[key] || '');
  };

  const hasAnyInstructionChanges = (skillId: string): boolean => {
    const files = instructionFilesBySkill[skillId] || [];
    return files.some((file) => hasInstructionChanges(skillId, file.relativePath));
  };

  const saveSkill = async (skillId: string) => {
    try {
      setSavingSkillId(skillId);
      await gatewayFetch(`/api/skills/${skillId}`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: draftEnabled[skillId],
          config: draftConfig[skillId] || {},
        }),
      });
      await loadSkills();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSavingSkillId(null);
    }
  };

  const saveSkillInstructions = async (skillId: string) => {
    const selectedFile = selectedInstructionFileBySkill[skillId];
    if (!selectedFile) {
      setError('No instruction file selected for this skill');
      return;
    }

    const key = instructionContentKey(skillId, selectedFile);
    const content = instructionDrafts[key] || '';

    try {
      setInstructionSavingSkillId(skillId);
      await gatewayFetch(`/api/skills/${skillId}/instructions`, {
        method: 'PUT',
        body: JSON.stringify({
          relativePath: selectedFile,
          content,
        }),
      });
      await loadSkillInstructions(skillId);
      await loadSkills();
      setError(null);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setInstructionSavingSkillId((current) => (current === skillId ? null : current));
    }
  };

  const loadedCount = useMemo(
    () => skills.filter((skill) => skill.status === 'loaded').length,
    [skills],
  );
  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedSkillId) || null,
    [skills, selectedSkillId],
  );
  const selectedInstructionFiles = selectedSkill
    ? instructionFilesBySkill[selectedSkill.id] || []
    : [];
  const selectedInstructionPath = selectedSkill
    ? selectedInstructionFileBySkill[selectedSkill.id] || selectedInstructionFiles[0]?.relativePath || ''
    : '';
  const selectedInstructionKey = selectedSkill && selectedInstructionPath
    ? instructionContentKey(selectedSkill.id, selectedInstructionPath)
    : '';
  const selectedInstructionContent = selectedInstructionKey
    ? instructionDrafts[selectedInstructionKey] || ''
    : '';

  if (loading && skills.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col animate-fade-in">
      <div className="px-8 pt-8 pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-medium">Configuration</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">Skills</h1>
            <p className="mt-1 text-sm text-text-muted">
              Configure each skill from its manifest-defined schema. Changes apply immediately after skill reload.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="info">{loadedCount}/{skills.length} loaded</Badge>
            <Button variant="ghost" size="sm" onClick={loadSkills}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-8 mb-2 rounded-lg border border-error/30 bg-error/10 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto px-8 pb-8">
        {skills.length === 0 ? (
          <EmptyState
            icon={Puzzle}
            title="No skills discovered"
            description="Add skills under workspace/skills/<id>/ (SKILL.md or adytum.plugin.json + index.ts)."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Card className="h-fit">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Installed Skills</p>
                <div className="space-y-2">
                  {skills.map((skill) => {
                    const isActive = selectedSkillId === skill.id;
                    const hasChanges = hasSkillChanges(skill.id) || hasAnyInstructionChanges(skill.id);

                    return (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => setSelectedSkillId(skill.id)}
                        className={`w-full rounded-lg border p-3 text-left transition ${
                          isActive
                            ? 'border-accent-primary/60 bg-accent-primary/10'
                            : 'border-border-primary/60 bg-bg-primary/30 hover:border-border-primary'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-text-primary">{skill.name}</p>
                          <Badge variant={skill.status === 'error' ? 'error' : skill.status === 'loaded' ? 'success' : 'warning'}>
                            {skill.status}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-xs text-text-muted">{skill.id}</p>
                        {hasChanges && (
                          <p className="mt-2 text-[11px] font-medium text-warning">Unsaved changes</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Card>

            {selectedSkill ? (() => {
              const skill = selectedSkill;
              const schema = skill.manifest?.configSchema;
              const uiHints = skill.manifest?.uiHints;
              const canRenderConfig = schema?.type === 'object' && isRecord(schema.properties);

              return (
                <Card key={skill.id}>
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-semibold text-text-primary">{skill.name}</h2>
                          <Badge variant={skill.status === 'error' ? 'error' : skill.status === 'loaded' ? 'success' : 'warning'}>
                            {skill.status}
                          </Badge>
                          <Badge variant="default">{skill.id}</Badge>
                        </div>
                        {skill.description && (
                          <p className="mt-1 text-sm text-text-muted">{skill.description}</p>
                        )}
                        {skill.error && (
                          <p className="mt-2 text-sm text-error">{skill.error}</p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                          <span className="inline-flex items-center gap-1">
                            <Wrench className="h-3.5 w-3.5" />
                            Tools: {skill.toolNames.length}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Services: {skill.serviceIds.length}
                          </span>
                        </div>
                      </div>

                      <label className="inline-flex items-center gap-2 rounded-lg border border-border-primary bg-bg-tertiary/20 px-3 py-2 text-sm">
                        <span className="text-text-secondary">Enabled</span>
                        <input
                          type="checkbox"
                          checked={Boolean(draftEnabled[skill.id])}
                          onChange={(e) =>
                            setDraftEnabled((prev) => ({
                              ...prev,
                              [skill.id]: e.target.checked,
                            }))
                          }
                          className="h-4 w-4 rounded border-border-primary bg-bg-primary text-accent-primary focus:ring-accent-primary/50"
                        />
                      </label>
                    </div>

                    {canRenderConfig ? (
                      <div className="space-y-3 rounded-lg border border-border-primary/60 bg-bg-primary/30 p-4">
                        <h3 className="text-sm font-semibold text-text-primary">Configuration</h3>
                        <FieldRenderer
                          schema={schema}
                          path={[]}
                          config={draftConfig[skill.id] || {}}
                          onChange={(path, value) => {
                            setDraftConfig((prev) => {
                              const current = prev[skill.id] || {};
                              return {
                                ...prev,
                                [skill.id]: setAtPath(current, path, value),
                              };
                            });
                          }}
                          uiHints={uiHints}
                        />
                      </div>
                    ) : (
                      <div className="rounded-lg border border-border-primary/60 bg-bg-primary/30 p-4 text-sm text-text-muted">
                        This skill does not expose configurable schema fields.
                      </div>
                    )}

                    <div className="space-y-3 rounded-lg border border-border-primary/60 bg-bg-primary/30 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-text-primary">Skill Prompt</h3>
                        {selectedInstructionFiles.length > 1 && (
                          <select
                            value={selectedInstructionPath}
                            onChange={(e) => {
                              const nextPath = e.target.value;
                              setSelectedInstructionFileBySkill((prev) => ({
                                ...prev,
                                [skill.id]: nextPath,
                              }));
                            }}
                            className="rounded-md border border-border-primary bg-bg-tertiary px-2 py-1 text-xs text-text-primary focus:border-accent-primary/50 focus:outline-none"
                          >
                            {selectedInstructionFiles.map((file) => (
                              <option key={file.relativePath} value={file.relativePath}>
                                {file.relativePath}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {instructionLoadingSkillId === skill.id ? (
                        <div className="flex items-center gap-2 text-sm text-text-muted">
                          <Spinner size="sm" />
                          Loading instructions...
                        </div>
                      ) : selectedInstructionFiles.length === 0 ? (
                        <p className="text-sm text-text-muted">No instruction files found for this skill.</p>
                      ) : (
                        <>
                          <textarea
                            value={selectedInstructionContent}
                            onChange={(e) => {
                              if (!selectedInstructionPath) return;
                              const key = instructionContentKey(skill.id, selectedInstructionPath);
                              setInstructionDrafts((prev) => ({
                                ...prev,
                                [key]: e.target.value,
                              }));
                            }}
                            className="min-h-[220px] w-full rounded-lg border border-border-primary bg-bg-tertiary px-3 py-2 font-mono text-xs leading-relaxed text-text-primary focus:border-accent-primary/50 focus:outline-none"
                            spellCheck={false}
                          />

                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (!selectedInstructionPath) return;
                                const key = instructionContentKey(skill.id, selectedInstructionPath);
                                setInstructionDrafts((prev) => ({
                                  ...prev,
                                  [key]: instructionOriginals[key] || '',
                                }));
                              }}
                              disabled={!selectedInstructionPath || !hasInstructionChanges(skill.id, selectedInstructionPath)}
                            >
                              Reset Prompt
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              isLoading={instructionSavingSkillId === skill.id}
                              onClick={() => saveSkillInstructions(skill.id)}
                              disabled={
                                !selectedInstructionPath ||
                                !hasInstructionChanges(skill.id, selectedInstructionPath) ||
                                instructionSavingSkillId === skill.id
                              }
                            >
                              <Save className="h-3.5 w-3.5" />
                              Save Prompt
                            </Button>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDraftConfig((prev) => ({ ...prev, [skill.id]: originalConfig[skill.id] || {} }));
                          setDraftEnabled((prev) => ({ ...prev, [skill.id]: originalEnabled[skill.id] }));
                        }}
                        disabled={!hasSkillChanges(skill.id)}
                      >
                        Reset
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        isLoading={savingSkillId === skill.id}
                        onClick={() => saveSkill(skill.id)}
                        disabled={!hasSkillChanges(skill.id) || savingSkillId === skill.id}
                      >
                        <Save className="h-3.5 w-3.5" />
                        Save Skill
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })() : (
              <EmptyState
                icon={Puzzle}
                title="Select a skill"
                description="Choose a skill from the list to view and edit its configuration."
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
