/**
 * @file packages/gateway/src/domain/knowledge/semantic-processor.ts
 * @description Uses LLM to extract semantic meaning and summaries from files during index.
 */

import { KnowledgeGraph, GraphNode } from '@adytum/shared';
import { ModelRouter } from '../../infrastructure/llm/model-router.js';
import { logger } from '../../logger.js';
import { readFileSync, existsSync } from 'node:fs';
import { MemoryStore } from '../../infrastructure/repositories/memory-store.js';
import { inject, singleton } from 'tsyringe';

@singleton()
export class SemanticProcessor {
  constructor(
    @inject(ModelRouter) private modelRouter: ModelRouter,
    @inject(MemoryStore) private memoryStore: MemoryStore,
  ) {}

  /**
   * Performs deep semantic analysis on a set of nodes.
   * Injects summaries and extracts key concepts (entities/tags).
   */
  async process(nodes: GraphNode[], options: { skipLLM?: boolean } = {}): Promise<GraphNode[]> {
    logger.info(
      `Starting semantic analysis on ${nodes.length} nodes (skipLLM: ${options.skipLLM})...`,
    );

    const items = [...nodes];
    const results: GraphNode[] = [];

    while (items.length > 0) {
      // Reduced batch size to 2 to prevent event loop blocking
      const batch = items.splice(0, 2);
      const batchResults = await Promise.all(batch.map((node) => this.processNode(node, options)));
      results.push(...batchResults);

      // Yield to event loop to allow heartbeats and other requests
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return results;
  }

  private async processNode(
    node: GraphNode,
    options: { skipLLM?: boolean } = {},
  ): Promise<GraphNode> {
    if (node.type !== 'file' && node.type !== 'doc') return node;
    if (!node.path || !existsSync(node.path)) return node;

    try {
      const content = readFileSync(node.path, 'utf-8');
      if (content.length < 50) return node; // Skip tiny files

      // NOTE: We are skipping the semantic analysis for now.
      // 1. Generate Summary & Concepts (only if not skipped)
      //       if (!options.skipLLM) {
      //         const prompt = `
      // Analyze the following file content and provide:
      // 1. A concise 1-2 sentence summary of its purpose.
      // 2. A list of 3-5 key technical concepts or entities defined in it.

      // File: ${node.path}
      // Content:
      // ${content.slice(0, 4000)} // Truncate to avoid context limit

      // Format:
      // Summary: [text]
      // Concepts: [comma separated list]
      // `;

      //         const { message } = await this.modelRouter.chat('fast', [
      //           { role: 'system', content: 'You are a technical documentation assistant.' },
      //           { role: 'user', content: prompt },
      //         ]);

      //         if (message.content) {
      //           const summaryMatch = message.content.match(/Summary:\s*(.*)/i);
      //           const conceptsMatch = message.content.match(/Concepts:\s*(.*)/i);

      //           if (summaryMatch) {
      //             node.description = summaryMatch[1].trim();
      //           }
      //           if (conceptsMatch) {
      //             node.metadata = {
      //               ...node.metadata,
      //               concepts: conceptsMatch[1].split(',').map((c) => c.trim()),
      //             };
      //           }
      //         }
      //       }

      // 2. Vector Indexing (Chunking)
      const concepts = Array.isArray(node.metadata?.concepts)
        ? (node.metadata.concepts as string[])
        : [];
      await this.indexDocumentChunks(node.path, content, concepts);

      // 3. Mark as processed
      node.metadata = {
        ...node.metadata,
        lastProcessed: Date.now(),
      };

      return node;
    } catch (err) {
      logger.error({ err, path: node.path }, 'Failed to process node semantically.');
      return node;
    }
  }

  private async indexDocumentChunks(path: string, content: string, tags: string[]): Promise<void> {
    // Simple chunking by paragraph or fixed size
    const chunks = this.chunkText(content, 1000); // 1000 chars approx

    for (const chunk of chunks) {
      await this.memoryStore.add(
        chunk,
        'file_system',
        tags,
        { path },
        'doc_chunk', // Category for semantic search tool
      );
      // Small pause between chunks to keep event loop alive
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  private chunkText(text: string, size: number): string[] {
    const chunks: string[] = [];
    let current = '';
    const lines = text.split('\n');

    for (const line of lines) {
      if (current.length + line.length > size) {
        chunks.push(current);
        current = '';
      }
      current += line + '\n';
    }
    if (current) chunks.push(current);
    return chunks;
  }
}
