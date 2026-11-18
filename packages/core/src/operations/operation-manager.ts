import { randomUUID } from 'node:crypto';

import type { OperationRecord, StorageAdapter } from '../storage/storage-adapter.js';
import { OperationContext } from './operation-context.js';
import type { OperationSummary } from './operation-summary.js';
import { calculateOperationSummary } from './operation-summary-calculator.js';
import type { PaginatedOperationSummaries } from './paginated-operation-summaries.js';
import type { OperationSummaryQuery } from './operation-summary-query.js';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

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
   * Retrieves a dynamically calculated summary for an operation.
   */
  async getSummary(operationId: string): Promise<OperationSummary> {
    const [operations, usageEvents] = await Promise.all([
      this.storage.getOperations(),
      this.storage.getUsageEvents(),
    ]);

    const operation = operations.find((item) => item.id === operationId);

    if (!operation) {
      throw new Error(`Operation not found: ${operationId}`);
    }

    return calculateOperationSummary(operation, operations, usageEvents);
  }

  /**
   * Retrieves dynamically calculated summaries for all operations.
   */
  async getAllSummaries(): Promise<OperationSummary[]> {
    const [operations, usageEvents] = await Promise.all([
      this.storage.getOperations(),
      this.storage.getUsageEvents(),
    ]);

    return operations.map((operation) =>
      calculateOperationSummary(operation, operations, usageEvents),
    );
  }

  /**
   * Retrieves filtered and paginated operation summaries.
   */
  async getSummaries(options: OperationSummaryQuery = {}): Promise<PaginatedOperationSummaries> {
    const page = options.page ?? DEFAULT_PAGE;
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

    if (!Number.isInteger(page) || page < 1) {
      throw new Error('Page must be a positive integer.');
    }

    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new Error(`Page size must be between 1 and ${MAX_PAGE_SIZE}.`);
    }

    const startedAfter = options.startedAfter ? Date.parse(options.startedAfter) : undefined;

    const startedBefore = options.startedBefore ? Date.parse(options.startedBefore) : undefined;

    if (options.startedAfter && !Number.isFinite(startedAfter)) {
      throw new Error('startedAfter must be a valid date.');
    }

    if (options.startedBefore && !Number.isFinite(startedBefore)) {
      throw new Error('startedBefore must be a valid date.');
    }

    if (startedAfter !== undefined && startedBefore !== undefined && startedAfter > startedBefore) {
      throw new Error('startedAfter must be earlier than or equal to startedBefore.');
    }

    const [operations, usageEvents] = await Promise.all([
      this.storage.getOperations(),
      this.storage.getUsageEvents(),
    ]);

    const filteredOperations = operations
      .filter((operation) => {
        if (options.status && operation.status !== options.status) {
          return false;
        }

        if (
          options.parentOperationId !== undefined &&
          operation.parentOperationId !== options.parentOperationId
        ) {
          return false;
        }

        const operationStart = Date.parse(operation.startedAt);

        if (startedAfter !== undefined && operationStart < startedAfter) {
          return false;
        }

        if (startedBefore !== undefined && operationStart > startedBefore) {
          return false;
        }

        return true;
      })
      .sort((first, second) => Date.parse(second.startedAt) - Date.parse(first.startedAt));

    const totalItems = filteredOperations.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const startIndex = (page - 1) * pageSize;

    const items = filteredOperations
      .slice(startIndex, startIndex + pageSize)
      .map((operation) => calculateOperationSummary(operation, operations, usageEvents));

    return {
      items,
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1 && totalItems > 0,
    };
  }

  /**
   * Retrieves dynamically calculated summaries for direct child operations.
   */
  async getChildSummaries(operationId: string): Promise<OperationSummary[]> {
    const [operations, usageEvents] = await Promise.all([
      this.storage.getOperations(),
      this.storage.getUsageEvents(),
    ]);

    const parentOperation = operations.find((item) => item.id === operationId);

    if (!parentOperation) {
      throw new Error(`Operation not found: ${operationId}`);
    }

    return operations
      .filter((operation) => operation.parentOperationId === operationId)
      .map((operation) => calculateOperationSummary(operation, operations, usageEvents));
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
