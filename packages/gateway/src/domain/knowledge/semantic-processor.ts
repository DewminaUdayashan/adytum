/**
 * @file packages/gateway/src/domain/knowledge/semantic-processor.ts
 * @description Uses LLM to extract semantic meaning and summaries from files during index.
 */

import { KnowledgeGraph, GraphNode } from '@adytum/shared';
import { ModelRouter } from '../../infrastructure/llm/model-router.js';
import { logger } from '../../logger.js';
import { readFileSync, existsSync } from 'node:fs';

export class SemanticProcessor {
  constructor(private modelRouter: ModelRouter) {}

  /**
   * Performs deep semantic analysis on a set of nodes.
   * Injects summaries and extracts key concepts (entities/tags).
   */
  async process(nodes: GraphNode[]): Promise<GraphNode[]> {
    logger.info(`Starting semantic analysis on ${nodes.length} nodes...`);
    
    // Process in small batches to avoid overwhelming the LLM
    const items = [...nodes];
    const results: GraphNode[] = [];
    
    while (items.length > 0) {
      const batch = items.splice(0, 5);
      const batchResults = await Promise.all(batch.map(node => this.processNode(node)));
      results.push(...batchResults);
    }
    
    return results;
  }

  private async processNode(node: GraphNode): Promise<GraphNode> {
    if (node.type !== 'file' && node.type !== 'doc') return node;
    if (!node.path || !existsSync(node.path)) return node;

    try {
      const content = readFileSync(node.path, 'utf-8');
      if (content.length < 50) return node; // Skip tiny files

      const prompt = `
Analyze the following file content and provide:
1. A concise 1-2 sentence summary of its purpose.
2. A list of 3-5 key technical concepts or entities defined in it.

File: ${node.path}
Content:
${content.slice(0, 4000)} // Truncate to avoid context limit

Format:
Summary: [text]
Concepts: [comma separated list]
`;

      const { message } = await this.modelRouter.chat('fast', [
        { role: 'system', content: 'You are a technical documentation assistant.' },
        { role: 'user', content: prompt }
      ]);

      if (message.content) {
          const summaryMatch = message.content.match(/Summary:\s*(.*)/i);
          const conceptsMatch = message.content.match(/Concepts:\s*(.*)/i);

          if (summaryMatch) {
              node.description = summaryMatch[1].trim();
          }
          if (conceptsMatch) {
              node.metadata = {
                  ...node.metadata,
                  concepts: conceptsMatch[1].split(',').map(c => c.trim())
              };
          }
      }

      return node;
    } catch (err) {
      logger.error({ err, path: node.path }, 'Failed to process node semantically.');
      return node;
    }
  }
}
