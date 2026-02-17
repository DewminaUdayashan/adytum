/**
 * @file packages/shared/src/types.ts
 * @description Defines module behavior for the Adytum workspace.
 */

import { z } from 'zod';

// ─── Core Message Types ───────────────────────────────────────

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const AdytumMessageSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: MessageRoleSchema,
  content: z.string(),
  channel: z.string().default('terminal'),
  timestamp: z.number(),
  metadata: z.record(z.unknown()).optional(),
  attachments: z
    .array(
      z.object({
        type: z.enum(['image', 'file', 'audio', 'video']),
        url: z.string(),
        name: z.string().optional(),
        mimeType: z.string().optional(),
      }),
    )
    .optional(),
});
export type AdytumMessage = z.infer<typeof AdytumMessageSchema>;

// ─── Tool Types ───────────────────────────────────────────────

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  toolCallId: z.string(),
  name: z.string(),
  result: z.unknown(),
  isError: z.boolean().default(false),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

// ─── Model Roles ──────────────────────────────────────────────

export const ModelRoleSchema = z.enum(['thinking', 'fast', 'local']);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const ModelConfigSchema = z.object({
  role: ModelRoleSchema,
  provider: z.string(),
  model: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().min(0).max(2).optional(),
  inputCost: z.number().optional(),
  outputCost: z.number().optional(),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// ─── Token Usage ──────────────────────────────────────────────

export const TokenUsageSchema = z.object({
  model: z.string(),
  role: ModelRoleSchema,
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
  estimatedCost: z.number().optional(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

// ─── Session ──────────────────────────────────────────────────

export const SessionSchema = z.object({
  id: z.string().uuid(),
  agentName: z.string(),
  channel: z.string(),
  createdAt: z.number(),
  lastActiveAt: z.number(),
  isActive: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(),
});
export type Session = z.infer<typeof SessionSchema>;

// ─── Trace / Log ──────────────────────────────────────────────

export const TraceSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  parentTraceId: z.string().uuid().optional(),
  startTime: z.number(),
  endTime: z.number().optional(),
  initialGoal: z.string(),
  outcome: z.string().optional(),
  modelUsed: z.string().optional(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
});
export type Trace = z.infer<typeof TraceSchema>;

export const AgentLogSchema = z.object({
  id: z.string().uuid(),
  traceId: z.string().uuid(),
  timestamp: z.number(),
  actionType: z.enum([
    'model_call',
    'model_response',
    'tool_call',
    'tool_result',
    'thinking',
    'message_sent',
    'message_received',
    'security_event',
    'error',
    'sub_agent_spawn',
    'monologue_run',
    'dreamer_run',
    'soul_evolve',
    'system_event',
  ]),
  payload: z.record(z.unknown()),
  status: z.enum(['success', 'error', 'blocked', 'pending']),
  tokenUsage: TokenUsageSchema.optional(),
});
export type AgentLog = z.infer<typeof AgentLogSchema>;

// ─── Feedback ─────────────────────────────────────────────────

export const FeedbackReasonSchema = z.enum([
  'inaccurate',
  'too_verbose',
  'wrong_tone',
  'security_overreach',
  'slow',
  'perfect',
  'other',
]);
export type FeedbackReason = z.infer<typeof FeedbackReasonSchema>;

export const UserFeedbackSchema = z.object({
  id: z.string().uuid(),
  traceId: z.string().uuid(),
  rating: z.enum(['up', 'down']),
  reasonCode: FeedbackReasonSchema.optional(),
  comment: z.string().optional(),
  timestamp: z.number(),
});
export type UserFeedback = z.infer<typeof UserFeedbackSchema>;

// ─── Security ─────────────────────────────────────────────────

export const AccessModeSchema = z.enum([
  'workspace_only',
  'read_only',
  'full_access',
  'just_in_time',
]);
export type AccessMode = z.infer<typeof AccessModeSchema>;

export const PermissionEntrySchema = z.object({
  path: z.string(),
  mode: AccessModeSchema,
  grantedAt: z.number(),
  expiresAt: z.number().optional(),
});
export type PermissionEntry = z.infer<typeof PermissionEntrySchema>;

export const SecurityEventSchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  blockedPath: z.string().optional(),
  reason: z.string(),
  agentId: z.string(),
  timestamp: z.number(),
});
export type SecurityEvent = z.infer<typeof SecurityEventSchema>;

// ─── Skill ────────────────────────────────────────────────────

export const SkillMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string().optional(),
  requires: z
    .object({
      bins: z.array(z.string()).optional(),
      anyBins: z.array(z.string()).optional(),
      env: z.array(z.string()).optional(),
      config: z.array(z.string()).optional(),
      os: z.array(z.string()).optional(),
    })
    .optional(),
  primaryEnv: z.string().optional(),
  always: z.boolean().optional(),
  communication: z.boolean().optional(),
  install: z
    .array(
      z.object({
        id: z.string().optional(),
        kind: z.enum(['brew', 'node', 'go', 'uv', 'download']).optional(),
        formula: z.string().optional(),
        package: z.string().optional(),
        module: z.string().optional(),
        url: z.string().optional(),
        bins: z.array(z.string()).optional(),
        label: z.string().optional(),
        os: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  adytum: z.record(z.unknown()).optional(),
});
export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;

// ─── Discord Config ──────────────────────────────────────────

export const DiscordConfigSchema = z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().optional(),
  defaultChannelId: z.string().optional(),
  defaultUserId: z.string().optional(),
  guildId: z.string().optional(),
  allowedChannelIds: z.array(z.string()).optional(),
  allowedUserIds: z.array(z.string()).optional(),
  allowDm: z.boolean().optional(),
});
export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;

export const SkillEntryConfigSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  apiKey: z.string().optional(),
  installPermission: z.enum(['auto', 'ask', 'deny']).optional(),
});
export type SkillEntryConfig = z.infer<typeof SkillEntryConfigSchema>;

export const SkillsPermissionsSchema = z.object({
  install: z.enum(['auto', 'ask', 'deny']).default('ask'),
  defaultChannel: z.string().optional(),
  defaultUser: z.string().optional(),
});
export type SkillsPermissions = z.infer<typeof SkillsPermissionsSchema>;

export const SkillsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
  load: z
    .object({
      paths: z.array(z.string()).default([]),
      extraDirs: z.array(z.string()).default([]),
    })
    .optional(),
  permissions: SkillsPermissionsSchema.optional(),
  entries: z.record(SkillEntryConfigSchema).default({}),
});
export type SkillsConfig = z.infer<typeof SkillsConfigSchema>;

export const ExecutionPermissionsSchema = z.object({
  shell: z.enum(['auto', 'ask', 'deny']).default('ask'),
  defaultChannel: z.string().optional(),
  defaultUser: z.string().optional(),
  defaultCommSkillId: z.string().optional(),
  approvalBaseUrl: z.string().url().optional(),
});
export type ExecutionPermissions = z.infer<typeof ExecutionPermissionsSchema>;

export const RoutingConfigSchema = z.object({
  maxRetries: z.number().int().min(1).max(10).default(5),
  fallbackOnRateLimit: z.boolean().default(true),
  fallbackOnError: z.boolean().default(false),
});
export type RoutingConfig = z.infer<typeof RoutingConfigSchema>;

// ─── Hierarchical Multi-Agent (Birth Protocol) ─────────────────

export const AgentTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type AgentTier = z.infer<typeof AgentTierSchema>;

export const AgentMetadataSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: z.string().optional(),
  tier: AgentTierSchema,
  birthTime: z.number(),
  lastBreath: z.number().nullable(),
  avatar: z.string().nullable(),
  parentId: z.string().uuid().nullable(),
  /** Allocated LLM model IDs (e.g. "google/gemini-2.0-flash"). Tier 1/2: max 5, Tier 3: max 3. */
  modelIds: z.array(z.string()).max(5).optional(),
});
export type AgentMetadata = z.infer<typeof AgentMetadataSchema>;

export const HierarchySettingsSchema = z.object({
  avatarGenerationEnabled: z.boolean().default(true),
  maxTier2Agents: z.number().int().min(0).max(50).default(10),
  maxTier3Agents: z.number().int().min(0).max(100).default(30),
  defaultRetryLimit: z.number().int().min(1).max(10).default(3),
  modelPriorityTier1And2: z.array(z.string()).max(5).default([]),
  modelPriorityTier3: z.array(z.string()).max(3).default([]),
});
export type HierarchySettings = z.infer<typeof HierarchySettingsSchema>;

export const AgentLogEntrySchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  timestamp: z.number(),
  type: z.enum(['thought', 'action', 'interaction']),
  content: z.string(),
  payload: z.record(z.unknown()).optional(),
  model: z.string().optional(),
});
export type AgentLogEntry = z.infer<typeof AgentLogEntrySchema>;

// ─── Agent Config ─────────────────────────────────────────────

export const AdytumConfigSchema = z.object({
  agentName: z.string().default('Adytum'),
  userName: z.string().optional(),
  userRole: z.string().optional(),
  userPreferences: z.string().optional(),
  workspacePath: z.string(),
  dataPath: z.string(),
  models: z.array(ModelConfigSchema),
  modelChains: z.record(ModelRoleSchema, z.array(z.string())).default({
    thinking: [],
    fast: [],
    local: [],
  }),
  taskOverrides: z.record(z.string(), z.string()).default({}), // taskName -> modelId/chainId
  soul: z
    .object({
      autoUpdate: z.boolean().default(true),
    })
    .default({ autoUpdate: true }),
  litellmPort: z.number().default(4000),
  gatewayPort: z.number().default(3001),
  dashboardPort: z.number().default(3002),
  contextSoftLimit: z.number().default(40000),
  heartbeatIntervalMinutes: z.number().default(30),
  dreamerIntervalMinutes: z.number().default(30),
  monologueIntervalMinutes: z.number().default(15),
  skills: SkillsConfigSchema.optional(),
  execution: ExecutionPermissionsSchema.optional(),
  discord: DiscordConfigSchema.optional(),
  routing: RoutingConfigSchema.default({
    maxRetries: 5,
    fallbackOnRateLimit: true,
    fallbackOnError: false,
  }),
  hierarchy: HierarchySettingsSchema.optional(),
});
export type AdytumConfig = z.infer<typeof AdytumConfigSchema>;

// ─── Skill & Tool Definitions ────────────────────────────────

// ─── Knowledge Graph ──────────────────────────────────────────
export const GraphNodeTypeSchema = z.enum([
  'file',
  'directory',
  'class',
  'interface',
  'type',
  'function',
  'method',
  'variable',
  'constant',
  'memory',
  'email',
  'doc',
  'image',
  'archive',
]);
export type GraphNodeType = z.infer<typeof GraphNodeTypeSchema>;

export const GraphEdgeTypeSchema = z.enum([
  'imports',
  'calls',
  'references',
  'extends',
  'implements',
  'contains',
  'relates_to',
]);
export type GraphEdgeType = z.infer<typeof GraphEdgeTypeSchema>;

export const GraphNodeSchema = z.object({
  id: z.string(),
  type: GraphNodeTypeSchema,
  label: z.string(),
  path: z.string().optional(),
  line: z.number().optional(),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: GraphEdgeTypeSchema,
  metadata: z.record(z.unknown()).optional(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const KnowledgeGraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  lastUpdated: z.number(),
  version: z.string(),
});
export type KnowledgeGraph = z.infer<typeof KnowledgeGraphSchema>;

// ─── Workspaces ───────────────────────────────────────────────
export const WorkspaceTypeSchema = z.enum(['project', 'collection']);
export type WorkspaceType = z.infer<typeof WorkspaceTypeSchema>;

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  path: z.string(),
  description: z.string().optional(),
  type: WorkspaceTypeSchema,
  lastIndexed: z.number().optional(),
  nodeCount: z.number().default(0),
  edgeCount: z.number().default(0),
  indexingMode: z.enum(['fast', 'deep']).default('fast'),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodObject<any>;
  requiresApproval?: boolean;
  execute: (args: any) => Promise<unknown>;
}

export interface AdytumSkill {
  tools?: ToolDefinition[];
  onLoad?: () => Promise<void>;
  onUnload?: () => Promise<void>;
}

// ─── Planner Types ────────────────────────────────────────────

export const PlanStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  tool: z.string().optional(),
  args: z.record(z.unknown()).optional(),
  dependencies: z.array(z.string()).default([]),
  status: z.enum(['pending', 'running', 'completed', 'failed']).default('pending').optional(),
  result: z.string().optional(),
  error: z.string().optional(),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const PlanSchema = z.object({
  goal: z.string(),
  steps: z.array(PlanStepSchema),
});
export type Plan = z.infer<typeof PlanSchema>;
