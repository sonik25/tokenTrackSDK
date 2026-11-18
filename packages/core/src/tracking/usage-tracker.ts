import { randomUUID } from 'node:crypto';

import type { CostBreakdown } from '../types/cost.js';
import type { ProviderName } from '../types/provider.js';
import type { UsageEvent } from '../types/usage-event.js';
import type { TokenUsage } from '../types/usage.js';
import type { StorageAdapter } from '../storage/storage-adapter.js';
import type { OperationContext } from '../operations/operation-context.js';

/**
 * Input required to record a normalized provider usage event.
 */
export interface TrackUsageInput {
  provider: ProviderName;
  model: string;
  usage: TokenUsage;
  requestId?: string;
  attemptNumber?: number;
  durationMs?: number;
  streaming?: boolean;
  cost?: CostBreakdown;
}

/**
 * Creates and persists normalized AI usage events.
 */
export class UsageTracker {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly context: OperationContext,
  ) {}

  /**
   * Creates and persists a usage event.
   */
  async track(input: TrackUsageInput): Promise<UsageEvent> {
    const event: UsageEvent = {
      id: randomUUID(),
      provider: input.provider,
      model: input.model,
      usage: input.usage,
      timestamp: new Date().toISOString(),
      operationId: this.context.getCurrentOperationId(),
      requestId: input.requestId,
      attemptNumber: input.attemptNumber,
      durationMs: input.durationMs,
      streaming: input.streaming,
      cost: input.cost,
    };

    await this.storage.saveUsageEvent(event);

    return event;
  }
}
