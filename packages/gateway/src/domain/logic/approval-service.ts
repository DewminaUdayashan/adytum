/**
 * @file packages/gateway/src/domain/logic/approval-service.ts
 * @description Contains domain logic and core business behavior.
 */

import { singleton, inject } from 'tsyringe';
import { Logger } from '../../logger.js';
import { randomUUID } from 'node:crypto';

export interface PendingApproval {
  resolve: (approved: boolean) => void;
  reject: (error: Error) => void;
  expiresAt: number;
  payload: {
    kind: string;
    description: string;
    meta?: Record<string, unknown>;
  };
}

/**
 * Encapsulates approval service behavior.
 */
@singleton()
export class ApprovalService {
  private pending = new Map<string, PendingApproval>();

  constructor(@inject(Logger) private logger: Logger) {
    this.logger.info('ApprovalService initialized');
  }

  /**
   * Executes request.
   * @param payload - Payload.
   * @returns Whether the operation succeeded.
   */
  public request(payload: {
    kind: string;
    description: string;
    meta?: Record<string, unknown>;
  }): Promise<boolean> {
    const id = randomUUID();
    return this.requestManual(id, payload);
  }

  /**
   * Executes request manual.
   * @param id - Id.
   * @param payload - Payload.
   * @returns Whether the operation succeeded.
   */
  public requestManual(
    id: string,
    payload: {
      kind: string;
      description: string;
      meta?: Record<string, unknown>;
    },
  ): Promise<boolean> {
    const expiresAt = Date.now() + 60_000;

    return new Promise<boolean>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, expiresAt, payload });
      this.logger.info(`Approval requested [${id}]: ${payload.description}`);

      // Auto-expire after 60s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve(false);
          this.logger.warn(`Approval [${id}] expired`);
        }
      }, 60_000);
    });
  }

  /**
   * Executes resolve.
   * @param id - Id.
   * @param approved - Approved.
   * @returns Whether the operation succeeded.
   */
  public resolve(id: string, approved: boolean): boolean {
    const item = this.pending.get(id);
    if (!item) return false;
    this.pending.delete(id);
    item.resolve(approved);
    this.logger.info(`Approval [${id}] resolved as ${approved}`);
    return true;
  }

  /**
   * Retrieves pending.
   * @param id - Id.
   * @returns The get pending result.
   */
  public getPending(id: string): PendingApproval | undefined {
    return this.pending.get(id);
  }

  /**
   * Retrieves all pending.
   */
  /**
   * Retrieves all pending.
   */
  public getAllPending() {
    return Array.from(this.pending.entries()).map(([id, p]) => ({
      id,
      ...p.payload,
      expiresAt: p.expiresAt,
    }));
  }

  // ─── Input Request Support ───────────────────────────────

  private pendingInputs = new Map<
    string,
    {
      resolve: (value: string) => void;
      reject: (error: Error) => void;
      expiresAt: number;
      payload: { description: string };
    }
  >();

  /**
   * Request text input from the user.
   */
  public requestInput(id: string, description: string): Promise<string> {
    const expiresAt = Date.now() + 300_000; // 5 minutes expiration for input

    return new Promise<string>((resolve, reject) => {
      this.pendingInputs.set(id, { resolve, reject, expiresAt, payload: { description } });
      this.logger.info(`Input requested [${id}]: ${description}`);

      setTimeout(() => {
        if (this.pendingInputs.has(id)) {
          this.pendingInputs.delete(id);
          reject(new Error('Input request timed out'));
          this.logger.warn(`Input request [${id}] timed out`);
        }
      }, 300_000);
    });
  }

  /**
   * Resolve a pending input request.
   */
  public resolveInput(id: string, value: string): boolean {
    const item = this.pendingInputs.get(id);
    if (!item) return false;
    this.pendingInputs.delete(id);
    item.resolve(value);
    this.logger.info(`Input request [${id}] resolved`);
    return true;
  }
}
