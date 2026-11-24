import type { UsageEvent } from '../types/usage-event.js';

/**
 * Represents a single application operation tracked by TokenTrack.
 */
export interface OperationRecord {
  id: string;
  name: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  parentOperationId?: string;
}

/**
 * Common storage contract for TokenTrack.
 *
 * Implementations:
 * - MemoryStorage
 * - JsonFileStorage
 */
export interface StorageAdapter {
  // Usage event operations
  saveUsageEvent(event: UsageEvent): Promise<void>;

  getUsageEvents(): Promise<UsageEvent[]>;

  // Application operation operations
  /** When supplied, atomically require the current record to have the expected status. */
  saveOperation(
    operation: OperationRecord,
    expectedStatus?: OperationRecord['status'],
  ): Promise<void>;

  getOperations(): Promise<OperationRecord[]>;

  // Remove all stored records
  clear(): Promise<void>;
}

export function requireOperationStatus(
  operation: OperationRecord | undefined,
  id: string,
  expected: OperationRecord['status'],
): asserts operation is OperationRecord {
  if (!operation) throw new Error(`Operation not found: ${id}`);
  if (operation.status !== expected) {
    throw new Error(`Operation is already ${operation.status}: ${id}`);
  }
}
