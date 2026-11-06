import type { UsageEvent } from '../types/usage-event.js';
import type { OperationRecord, StorageAdapter } from './storage-adapter.js';

/**
 * In-memory storage implementation for TokenTrack.
 *
 * Records are stored in Maps using their IDs.
 * Saving an existing ID updates that record.
 */
export class MemoryStorage implements StorageAdapter {
  private readonly usageEvents = new Map<string, UsageEvent>();

  private readonly operations = new Map<string, OperationRecord>();

  async saveUsageEvent(event: UsageEvent): Promise<void> {
    this.usageEvents.set(event.id, structuredClone(event));
  }

  async getUsageEvents(): Promise<UsageEvent[]> {
    return structuredClone(Array.from(this.usageEvents.values()));
  }

  async saveOperation(operation: OperationRecord): Promise<void> {
    this.operations.set(operation.id, structuredClone(operation));
  }

  async getOperations(): Promise<OperationRecord[]> {
    return structuredClone(Array.from(this.operations.values()));
  }

  async clear(): Promise<void> {
    this.usageEvents.clear();
    this.operations.clear();
  }
}
