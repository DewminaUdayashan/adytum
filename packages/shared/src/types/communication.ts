import { z } from 'zod';

export const SwarmMessageSchema = z.object({
  id: z.string().uuid(),
  fromAgentId: z.string(),
  toAgentId: z.string(), // 'BROADCAST' for all agents
  type: z.enum(['instruction', 'report', 'query', 'alert', 'chat']),
  content: z.string(),
  timestamp: z.number(),
  correlationId: z.string().optional(), // Links to a specific task/trace
  metadata: z.record(z.unknown()).optional(),
});

export type SwarmMessage = z.infer<typeof SwarmMessageSchema>;
