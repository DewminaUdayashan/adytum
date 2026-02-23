import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeartbeatManager } from './heartbeat-manager.js';
import { join } from 'node:path';
import * as fs from 'node:fs';

vi.mock('node:fs');
vi.mock('node-cron');

describe('HeartbeatManager', () => {
  let heartbeat: HeartbeatManager;
  let mockAgent: any;
  const workspacePath = '/test/workspace';

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgent = {
      run: vi.fn().mockResolvedValue({ response: 'STATUS: updated\nSUMMARY: Test run.' }),
    };
    heartbeat = new HeartbeatManager(mockAgent, workspacePath);
  });

  it('should prevent overlapping runs using isRunning lock', async () => {
    // Mock fs.existsSync to true for HEARTBEAT.md
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue('# Tasks\n- [ ] Task 1');

    // Make agent.run hang for a bit
    let resolveRun: any;
    const runPromise = new Promise((resolve) => {
      resolveRun = resolve;
    });
    mockAgent.run.mockReturnValueOnce(
      runPromise.then(() => ({ response: 'STATUS: updated\nSUMMARY: Done' })),
    );

    // First trigger
    const firstRun = heartbeat.runNow();
    expect((heartbeat as any).isRunning).toBe(true);

    // Second trigger while first is running
    await heartbeat.runNow();

    // agent.run should only have been called once
    expect(mockAgent.run).toHaveBeenCalledTimes(1);

    // Resolve first run
    resolveRun();
    await firstRun;

    expect((heartbeat as any).isRunning).toBe(false);
  });

  it('should NOT run if HEARTBEAT.md content is empty or only whitespace/headers', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue('# Heartbeat\n\n   \n');

    await heartbeat.run();

    expect(mockAgent.run).not.toHaveBeenCalled();
    expect((heartbeat as any).isRunning).toBe(false);
  });
});
