import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryStore } from './memory-store.js';
import { EmbeddingService } from '../llm/embedding-service.js';

describe('MemoryStore Hybrid Search & MMR', () => {
  let memoryStore: MemoryStore;
  let mockDb: any;
  let mockEmbeddingService: any;

  beforeEach(() => {
    mockDb = {
      redactSensitiveData: vi.fn(),
      addMemory: vi.fn(),
      searchMemories: vi.fn().mockReturnValue([]),
      getMemoriesFiltered: vi.fn().mockReturnValue([]),
    };
    mockEmbeddingService = {
      embed: vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2])),
      cosineSimilarity: vi.fn().mockReturnValue(0.8),
    };
    memoryStore = new MemoryStore(mockDb, mockEmbeddingService);
  });

  it('should perform hybrid search and combine ranks (RRF)', async () => {
    // 1. Mock keyword results
    const docA = { id: 'A', content: 'Keyword Match', embedding: Buffer.alloc(8) };
    mockDb.searchMemories.mockReturnValue([docA]);

    // 2. Mock semantic results (different from keyword)
    const docB = { id: 'B', content: 'Semantic Match', embedding: Buffer.alloc(8) };
    mockDb.getMemoriesFiltered.mockReturnValue([docB]);

    // queryVector similarity
    mockEmbeddingService.cosineSimilarity.mockImplementation(
      (v1: Float32Array, v2: Float32Array) => {
        // if it's docB, high similarity
        return 0.9;
      },
    );

    const results = await memoryStore.searchHybrid('test query', 5);

    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('A');
    expect(ids).toContain('B');
  });

  it('should apply MMR to ensure result diversity', async () => {
    // Three documents: A, B (similar to A), C (diverse)
    const docA = {
      id: 'A',
      content: 'Topic X - Part 1',
      embedding: Buffer.from(new Float32Array([1, 0]).buffer),
    };
    const docB = {
      id: 'B',
      content: 'Topic X - Part 2',
      embedding: Buffer.from(new Float32Array([0.99, 0.01]).buffer),
    };
    const docC = {
      id: 'C',
      content: 'Topic Y - Different',
      embedding: Buffer.from(new Float32Array([0, 1]).buffer),
    };

    mockDb.getMemoriesFiltered.mockReturnValue([docA, docB, docC]);

    // query is similar to A and B
    mockEmbeddingService.cosineSimilarity.mockImplementation(
      (v1: Float32Array, v2: Float32Array) => {
        // Helper to identify vectors
        const isVector = (v: Float32Array, pattern: number[]) => {
          return v[0] === pattern[0] && v[1] === pattern[1];
        };

        const isA = (v: Float32Array) => isVector(v, [1, 0]);
        const isB = (v: Float32Array) => isVector(v, [0.99, 0.01]);
        const isC = (v: Float32Array) => isVector(v, [0, 1]);

        // Comparison to query vector (always v1 in searchHybrid before MMR loop)
        // Comparison between docs (in MMR loop)
        // v1 is docVec (candidate), v2 is selVec (already selected)

        if (isA(v1) && isB(v2)) return 0.99;
        if (isB(v1) && isA(v2)) return 0.99;
        if (isA(v1) && isC(v2)) return 0.01;
        if (isC(v1) && isA(v2)) return 0.01;

        // Default similarities to query vector
        if (isA(v1) || isA(v2)) return 0.95;
        if (isB(v1) || isB(v2)) return 0.94;
        if (isC(v1) || isC(v2)) return 0.7;

        return 0;
      },
    );

    // We want top 2. MMR should pick A and C, skipping B because it's too similar to A.
    const results = await memoryStore.searchHybrid('topic X', 2, { category: 'doc_chunk' }, 0.5);

    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('A');
    expect(ids).toContain('C');
    expect(ids).not.toContain('B');
  });
});
