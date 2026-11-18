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
  saveOperation(operation: OperationRecord): Promise<void>;

  getOperations(): Promise<OperationRecord[]>;

  // Remove all stored records
  clear(): Promise<void>;
}
