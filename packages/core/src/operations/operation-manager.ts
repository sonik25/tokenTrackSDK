import { randomUUID } from 'node:crypto';

import type { OperationRecord, StorageAdapter } from '../storage/storage-adapter.js';
import { OperationContext } from './operation-context.js';

/**
 * Manages TokenTrack application operations.
 */
export class OperationManager {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly context: OperationContext = new OperationContext(),
  ) {}

  /**
   * Starts a new operation and persists its initial record.
   */
  async start(name: string): Promise<string> {
    const operation: OperationRecord = {
      id: randomUUID(),
      name,
      startedAt: new Date().toISOString(),
      status: 'running',
      parentOperationId: this.context.getCurrentOperationId(),
    };

    await this.storage.saveOperation(operation);

    return operation.id;
  }

  /**
   * Marks an operation as completed.
   */
  async complete(operationId: string): Promise<void> {
    const operations = await this.storage.getOperations();

    const operation = operations.find((item) => item.id === operationId);

    if (!operation) {
      throw new Error(`Operation not found: ${operationId}`);
    }

    if (operation.status !== 'running') {
      throw new Error(`Operation is already ${operation.status}: ${operationId}`);
    }

    await this.storage.saveOperation({
      ...operation,
      completedAt: new Date().toISOString(),
      status: 'completed',
    });
  }

  /**
   * Marks an operation as failed.
   */
  async fail(operationId: string): Promise<void> {
    const operations = await this.storage.getOperations();

    const operation = operations.find((item) => item.id === operationId);

    if (!operation) {
      throw new Error(`Operation not found: ${operationId}`);
    }

    if (operation.status !== 'running') {
      throw new Error(`Operation is already ${operation.status}: ${operationId}`);
    }

    await this.storage.saveOperation({
      ...operation,
      completedAt: new Date().toISOString(),
      status: 'failed',
    });
  }

  /**
   * Runs a callback within an automatically managed operation lifecycle.
   */
  async run<T>(name: string, callback: () => T | Promise<T>): Promise<T> {
    const operationId = await this.start(name).catch(() => undefined);

    if (!operationId) {
      // Best-effort tracking: don't interrupt application work if tracking fails.
      return callback();
    }

    return this.context.run(operationId, async () => {
      let result: T;

      try {
        result = await callback();
      } catch (error) {
        try {
          await this.fail(operationId);
        } catch {
          // Preserve the original application error.
        }

        throw error;
      }

      try {
        await this.complete(operationId);
      } catch {
        // Best-effort tracking: preserve the successful application result.
      }

      return result;
    });
  }
}
