/**
 * AgentRetentionService - Automatic housekeeping for agent-owned data.
 *
 * Periodically deletes top-level chat agents that have been inactive for
 * longer than the user-configured retention window (`preferences.agent
 * .agentRetentionDays`), so long-running installs don't accumulate
 * unbounded SQLite rows and on-disk attachment/apps/shell-log data.
 *
 * Deletion goes through `AgentManagerService.deleteAgentForRetention`,
 * which dispatches the same `agents.delete` command used by manual,
 * user-initiated deletion — so this job never has its own copy of the
 * cleanup logic to drift out of sync with.
 */

import { DisposableService } from './disposable';
import type { Logger } from './logger';
import type { PreferencesService } from './preferences';
import type { AgentManagerService } from './agent-manager/agent-manager';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day
const STARTUP_DELAY_MS = 60 * 1000; // let startup settle first

export class AgentRetentionService extends DisposableService {
  private checkIntervalId: ReturnType<typeof setInterval> | null = null;
  private startupTimeoutId: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    private readonly logger: Logger,
    private readonly preferencesService: PreferencesService,
    private readonly agentManagerService: AgentManagerService,
  ) {
    super();
  }

  public static create(
    logger: Logger,
    preferencesService: PreferencesService,
    agentManagerService: AgentManagerService,
  ): AgentRetentionService {
    const instance = new AgentRetentionService(
      logger,
      preferencesService,
      agentManagerService,
    );
    instance.startupTimeoutId = setTimeout(() => {
      if (!instance.disposed) void instance.runCleanup();
    }, STARTUP_DELAY_MS);
    instance.checkIntervalId = setInterval(() => {
      if (!instance.disposed) void instance.runCleanup();
    }, CHECK_INTERVAL_MS);
    return instance;
  }

  private async runCleanup(): Promise<void> {
    const retentionDays =
      this.preferencesService.get().agent.agentRetentionDays;
    if (retentionDays === null) {
      this.logger.debug(
        '[AgentRetentionService] Automatic retention disabled, skipping',
      );
      return;
    }

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    try {
      const staleAgentIds =
        await this.agentManagerService.getStaleAgentIds(cutoff);
      if (staleAgentIds.length === 0) return;

      this.logger.debug(
        `[AgentRetentionService] Deleting ${staleAgentIds.length} agent(s) inactive since before ${cutoff.toISOString()}`,
      );

      for (const agentId of staleAgentIds) {
        try {
          await this.agentManagerService.deleteAgentForRetention(agentId);
        } catch (error) {
          this.logger.error(
            `[AgentRetentionService] Failed to delete stale agent ${agentId}`,
            error,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        '[AgentRetentionService] Failed to run retention cleanup',
        error,
      );
    }
  }

  protected onTeardown(): void {
    if (this.startupTimeoutId) {
      clearTimeout(this.startupTimeoutId);
      this.startupTimeoutId = null;
    }
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
    }
  }
}
