import { describe, expect, it, vi } from 'vitest';
import { AgentRetentionService } from './agent-retention';
import type { Logger } from './logger';
import type { PreferencesService } from './preferences';
import type { AgentManagerService } from './agent-manager/agent-manager';

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

function createPreferencesService(
  agentRetentionDays: number | null,
): PreferencesService {
  return {
    get: () => ({ agent: { agentRetentionDays } }) as any,
  } as PreferencesService;
}

describe('AgentRetentionService', () => {
  it('does not query or delete anything when retention is disabled (null)', async () => {
    vi.useFakeTimers();
    try {
      const preferencesService = createPreferencesService(null);
      const getStaleAgentIds = vi.fn(async () => ['a1']);
      const deleteAgentForRetention = vi.fn(async () => {});
      const agentManagerService = {
        getStaleAgentIds,
        deleteAgentForRetention,
      } as unknown as AgentManagerService;

      const service = AgentRetentionService.create(
        noopLogger,
        preferencesService,
        agentManagerService,
      );

      await vi.advanceTimersByTimeAsync(60_000);

      expect(getStaleAgentIds).not.toHaveBeenCalled();
      expect(deleteAgentForRetention).not.toHaveBeenCalled();

      await service.teardown();
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes every stale agent id found for the configured retention window', async () => {
    vi.useFakeTimers();
    try {
      const preferencesService = createPreferencesService(30);
      const getStaleAgentIds = vi.fn(async () => ['a1', 'a2']);
      const deleteAgentForRetention = vi.fn(async () => {});
      const agentManagerService = {
        getStaleAgentIds,
        deleteAgentForRetention,
      } as unknown as AgentManagerService;

      const service = AgentRetentionService.create(
        noopLogger,
        preferencesService,
        agentManagerService,
      );

      await vi.advanceTimersByTimeAsync(60_000);

      expect(getStaleAgentIds).toHaveBeenCalledTimes(1);
      expect(deleteAgentForRetention).toHaveBeenCalledWith('a1');
      expect(deleteAgentForRetention).toHaveBeenCalledWith('a2');

      await service.teardown();
    } finally {
      vi.useRealTimers();
    }
  });

  it('continues deleting remaining agents when one deletion fails', async () => {
    vi.useFakeTimers();
    try {
      const preferencesService = createPreferencesService(30);
      const getStaleAgentIds = vi.fn(async () => ['a1', 'a2']);
      const deleteAgentForRetention = vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined);
      const agentManagerService = {
        getStaleAgentIds,
        deleteAgentForRetention,
      } as unknown as AgentManagerService;

      const service = AgentRetentionService.create(
        noopLogger,
        preferencesService,
        agentManagerService,
      );

      await vi.advanceTimersByTimeAsync(60_000);

      expect(deleteAgentForRetention).toHaveBeenCalledTimes(2);

      await service.teardown();
    } finally {
      vi.useRealTimers();
    }
  });
});
