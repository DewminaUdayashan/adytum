/**
 * @file packages/shared/src/constants.ts
 * @description Defines module behavior for the Adytum workspace.
 */

// ─── Adytum Constants ─────────────────────────────────────────

export const ADYTUM_VERSION = '0.1.0';

export const DEFAULT_PORTS = {
  gateway: 3001,
  dashboard: 3002,
  litellm: 4000,
  ollama: 11434,
} as const;

export const MODEL_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', requiresKey: true },
  { id: 'openai', name: 'OpenAI', requiresKey: true },
  { id: 'ollama', name: 'Ollama (Local)', requiresKey: false },
  { id: 'openrouter', name: 'OpenRouter', requiresKey: true },
  { id: 'google', name: 'Google AI', requiresKey: true },
  { id: 'mistral', name: 'Mistral AI', requiresKey: true },
  { id: 'deepseek', name: 'DeepSeek', requiresKey: true },
  { id: 'lmstudio', name: 'LM Studio (Local)', requiresKey: false },
  { id: 'vllm', name: 'vLLM (Local)', requiresKey: false },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', requiresKey: false },
] as const;

export const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: [
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-haiku-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
  ollama: [
    'llama3.3',
    'llama3.1',
    'mistral',
    'mixtral',
    'codellama',
    'deepseek-r1',
    'phi3',
    'qwen2.5',
  ],
  openrouter: [
    'anthropic/claude-sonnet-4',
    'openai/gpt-4o',
    'google/gemini-2.5-pro',
    'meta-llama/llama-3.3-70b',
    'mistralai/mistral-large',
  ],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  mistral: [
    'mistral-large-latest',
    'mistral-medium-latest',
    'mistral-small-latest',
    'codestral-latest',
  ],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  lmstudio: ['lmstudio-community/default'],
  vllm: ['default'],
  custom: ['custom-model'],
};

export const MODEL_ROLES = ['thinking', 'fast', 'local'] as const;

export const MODEL_ROLE_DESCRIPTIONS: Record<string, string> = {
  thinking: 'Deep reasoning, planning, and code generation',
  fast: 'Quick responses, summaries, and simple Q&A',
  local: 'Memory consolidation, embeddings, offline tasks',
};

export const DANGEROUS_COMMANDS = [
  'rm -rf',
  'rm -r /',
  'mkfs',
  'dd if=',
  'sudo rm',
  ':(){:|:&};:',
  'chmod -R 777 /',
  'wget | sh',
  'curl | sh',
  'shutdown',
  'reboot',
  'kill -9 1',
  'format',
  'del /f /s',
];

export const FEEDBACK_REASONS = [
  { code: 'inaccurate', label: 'Inaccurate Output' },
  { code: 'too_verbose', label: 'Too Verbose' },
  { code: 'wrong_tone', label: 'Wrong Tone' },
  { code: 'security_overreach', label: 'Security Overreach' },
  { code: 'slow', label: 'Too Slow' },
  { code: 'perfect', label: 'Perfect Response' },
  { code: 'other', label: 'Other' },
] as const;

export const CONTEXT_SOFT_LIMIT = 40_000;
export const HEARTBEAT_DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
