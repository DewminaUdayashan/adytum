import { logger } from '../../logger.js';
import { pipeline } from '@xenova/transformers';
import { singleton } from 'tsyringe';

export type EmbeddingVector = Float32Array;

@singleton()
export class EmbeddingService {
  private extractor: any = null;
  private modelName = 'Xenova/all-MiniLM-L6-v2';

  constructor() {}

  async initialize(): Promise<void> {
    if (this.extractor) return;
    try {
      logger.debug(`[EmbeddingService] Loading local model: ${this.modelName}...`);
      this.extractor = await pipeline('feature-extraction', this.modelName);
      logger.debug('[EmbeddingService] Model loaded successfully.');
    } catch (error) {
      console.error('[EmbeddingService] Failed to load embedding model:', error);
      throw error;
    }
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.extractor) await this.initialize();

    // Normalize and pool to get a single vector per input
    const output = await this.extractor(text, { pooling: 'mean', normalize: true });

    // output.data is the Float32Array vector
    return output.data;
  }

  /**
   * Calculates cosine similarity between two vectors.
   * Vectors should be normalized.
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) throw new Error('Vector dimension mismatch');

    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
    }
    return dotProduct;
  }
}
