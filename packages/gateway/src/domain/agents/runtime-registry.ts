import { logger } from '../../logger.js';
import { singleton } from 'tsyringe';
import type { AgentRuntime } from '../logic/agent-runtime.js';

/**
 * Registry of active AgentRuntime instances (sessions).
 * Used to track running agents and support cancellation/abortion of tasks.
 */
@singleton()
export class RuntimeRegistry {
  // Map sessionId -> AgentRuntime instance
  private sessions = new Map<string, AgentRuntime>();

  // Map parentSessionId -> Set<childSessionId>
  // Tracks the hierarchy for cascade abortion
  private hierarchy = new Map<string, Set<string>>();

  /**
   * Registers a running session.
   * @param sessionId - The unique session ID.
   * @param runtime - The runtime instance.
   * @param parentSessionId - Optional parent session ID (if this is a sub-agent).
   */
  register(sessionId: string, runtime: AgentRuntime, parentSessionId?: string) {
    this.sessions.set(sessionId, runtime);

    if (parentSessionId) {
      if (!this.hierarchy.has(parentSessionId)) {
        this.hierarchy.set(parentSessionId, new Set());
      }
      this.hierarchy.get(parentSessionId)?.add(sessionId);
    }
  }

  /**
   * Unregisters a session (called when agent completes).
   */
  unregister(sessionId: string) {
    this.sessions.delete(sessionId);

    // Remove from hierarchy tracking if it was a child
    for (const children of this.hierarchy.values()) {
      children.delete(sessionId);
    }

    // Remove its own children entry if it exists (though children should be gone by now)
    this.hierarchy.delete(sessionId);
  }

  /**
   * Aborts a specific session.
   */
  abortSession(sessionId: string) {
    const runtime = this.sessions.get(sessionId);
    if (runtime) {
      logger.debug(`[RuntimeRegistry] Aborting session: ${sessionId}`);
      runtime.abort(sessionId);
    }
  }

  /**
   * Aborts a session and all its descendants (sub-agents).
   */
  abortHierarchy(rootSessionId: string) {
    logger.debug(`[RuntimeRegistry] Aborting hierarchy for root: ${rootSessionId}`);

    // 1. Abort the root itself
    this.abortSession(rootSessionId);

    // 2. Find and abort all children (recursively)
    const children = this.hierarchy.get(rootSessionId);
    if (children) {
      for (const childId of children) {
        this.abortHierarchy(childId);
      }
    }
  }

  /**
   * Check if a session is currently active.
   */
  isSessionActive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Retrieves the runtime instance for a session.
   */
  getRuntime(sessionId: string): AgentRuntime | undefined {
    return this.sessions.get(sessionId);
  }
}
