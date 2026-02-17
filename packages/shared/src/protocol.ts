/**
 * @file packages/shared/src/protocol.ts
 * @description Defines module behavior for the Adytum workspace.
 */

import { z } from 'zod';

// ─── WebSocket Frame Types ────────────────────────────────────

export const FrameTypeSchema = z.enum([
  'connect',
  'disconnect',
  'message',
  'stream',
  'tool_call',
  'tool_result',
  'control',
  'feedback',
  'token_update',
  'error',
  'heartbeat_ping',
  'heartbeat_pong',
]);
export type FrameType = z.infer<typeof FrameTypeSchema>;

// ─── Connect Frame ────────────────────────────────────────────

export const ConnectFrameSchema = z.object({
  type: z.literal('connect'),
  channel: z.string(),
  sessionId: z.string().optional(),
  clientVersion: z.string().optional(),
});
export type ConnectFrame = z.infer<typeof ConnectFrameSchema>;

// ─── Message Frame ────────────────────────────────────────────

export const MessageFrameSchema = z.object({
  type: z.literal('message'),
  sessionId: z.string(),
  content: z.string(),
  modelRole: z.string().optional(),
  modelId: z.string().optional(),
  workspaceId: z.string().optional(),
  attachments: z
    .array(
      z.object({
        type: z.enum(['image', 'file', 'audio', 'video']),
        data: z.string(),
        name: z.string().optional(),
      }),
    )
    .optional(),
});
export type MessageFrame = z.infer<typeof MessageFrameSchema>;

// ─── Stream Frame (for live console) ──────────────────────────

export const StreamFrameSchema = z.object({
  type: z.literal('stream'),
  sessionId: z.string(),
  traceId: z.string().uuid(),
  delta: z.string(),
  streamType: z.enum([
    'thinking', // Agent's internal reasoning
    'response', // Final response text
    'tool_call', // Tool being invoked
    'tool_result', // Tool execution result
    'status', // Status update
  ]),
  workspaceId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type StreamFrame = z.infer<typeof StreamFrameSchema>;

// ─── Control Frame (human-in-the-loop) ────────────────────────

export const ControlFrameSchema = z.object({
  type: z.literal('control'),
  sessionId: z.string(),
  action: z.enum(['approve', 'reject', 'cancel', 'pause', 'resume']),
  traceId: z.string().uuid().optional(),
  reason: z.string().optional(),
});
export type ControlFrame = z.infer<typeof ControlFrameSchema>;

// ─── Feedback Frame ───────────────────────────────────────────

export const FeedbackFrameSchema = z.object({
  type: z.literal('feedback'),
  sessionId: z.string(),
  traceId: z.string().uuid(),
  rating: z.enum(['up', 'down']),
  reasonCode: z.string().optional(),
  comment: z.string().optional(),
});
export type FeedbackFrame = z.infer<typeof FeedbackFrameSchema>;

// ─── Token Update Frame ──────────────────────────────────────

export const TokenUpdateFrameSchema = z.object({
  type: z.literal('token_update'),
  sessionId: z.string(),
  model: z.string(),
  role: z.string(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
  estimatedCost: z.number().optional(),
  cumulativeTokens: z.number(),
  cumulativeCost: z.number().optional(),
});
export type TokenUpdateFrame = z.infer<typeof TokenUpdateFrameSchema>;

// ─── Error Frame ──────────────────────────────────────────────

export const ErrorFrameSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  sessionId: z.string().optional(),
});
export type ErrorFrame = z.infer<typeof ErrorFrameSchema>;

// ─── Union Frame ──────────────────────────────────────────────

export const WebSocketFrameSchema = z.discriminatedUnion('type', [
  ConnectFrameSchema,
  MessageFrameSchema,
  StreamFrameSchema,
  ControlFrameSchema,
  FeedbackFrameSchema,
  TokenUpdateFrameSchema,
  ErrorFrameSchema,
  z.object({ type: z.literal('disconnect'), sessionId: z.string() }),
  z.object({ type: z.literal('heartbeat_ping') }),
  z.object({ type: z.literal('heartbeat_pong') }),
  z.object({
    type: z.literal('approval_request'),
    id: z.string().uuid(),
    kind: z.string(),
    description: z.string(),
    meta: z.record(z.any()).optional(),
    expiresAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('approval_response'),
    id: z.string().uuid(),
    approved: z.boolean(),
  }),
]);
export type WebSocketFrame = z.infer<typeof WebSocketFrameSchema>;

// ─── Frame Helpers ────────────────────────────────────────────

/**
 * Parses frame.
 * @param raw - Raw.
 * @returns The parse frame result.
 */
export function parseFrame(raw: string): WebSocketFrame {
  const parsed = JSON.parse(raw);
  return WebSocketFrameSchema.parse(parsed);
}

/**
 * Executes serialize frame.
 * @param frame - Frame.
 * @returns The resulting string value.
 */
export function serializeFrame(frame: WebSocketFrame): string {
  return JSON.stringify(frame);
}
