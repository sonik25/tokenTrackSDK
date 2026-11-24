import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { validTokenCount } from '../types/token-count.js';
import type { UsageEvent } from '../types/usage-event.js';
import type { OperationRecord, StorageAdapter } from './storage-adapter.js';
import { requireOperationStatus } from './storage-adapter.js';

interface StorageData {
  usageEvents: UsageEvent[];
  operations: OperationRecord[];
}

export interface JsonFileStorageOptions {
  onCorruption?: (error: Error, backupPath?: string) => void;
}

const EMPTY_STORAGE: StorageData = {
  usageEvents: [],
  operations: [],
};

const transactions = new Map<string, Promise<unknown>>();

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function counts(value: unknown, keys: string[]): boolean {
  return (
    record(value) &&
    keys.every((key) => value[key] === undefined || validTokenCount(value[key]) !== undefined)
  );
}

function cost(value: unknown): boolean {
  if (!record(value)) return false;
  return (['estimatedCost', 'reportedCost'] as const).every((key) => {
    const item = value[key];
    return (
      item === undefined ||
      (record(item) &&
        typeof item.amount === 'string' &&
        /^(0|[1-9]\d*)(\.\d+)?$/.test(item.amount) &&
        typeof item.currency === 'string' &&
        typeof item[key === 'estimatedCost' ? 'pricingVersion' : 'source'] === 'string')
    );
  });
}

function isUsageEvent(value: unknown): value is UsageEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const event = value as Record<string, unknown>;

  return (
    typeof event.id === 'string' &&
    event.id.length > 0 &&
    typeof event.provider === 'string' &&
    event.provider.length > 0 &&
    typeof event.model === 'string' &&
    event.model.length > 0 &&
    timestamp(event.timestamp) &&
    record(event.usage) &&
    counts(event.usage, ['inputTokens', 'outputTokens', 'totalTokens']) &&
    (event.usage.inputTokenDetails === undefined ||
      counts(event.usage.inputTokenDetails, ['cachedTokens', 'cacheWriteTokens'])) &&
    (event.usage.outputTokenDetails === undefined ||
      counts(event.usage.outputTokenDetails, ['reasoningTokens'])) &&
    (event.attemptNumber === undefined || validTokenCount(event.attemptNumber) !== undefined) &&
    (event.durationMs === undefined ||
      (typeof event.durationMs === 'number' &&
        Number.isFinite(event.durationMs) &&
        event.durationMs >= 0)) &&
    (event.cost === undefined || cost(event.cost))
  );
}

function isOperationRecord(value: unknown): value is OperationRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const operation = value as Record<string, unknown>;

  return (
    typeof operation.id === 'string' &&
    operation.id.length > 0 &&
    typeof operation.name === 'string' &&
    timestamp(operation.startedAt) &&
    (operation.completedAt === undefined || timestamp(operation.completedAt)) &&
    ['running', 'completed', 'failed'].includes(operation.status as string)
  );
}

export class JsonFileStorage implements StorageAdapter {
  private readonly filePath: string;
  private readonly onCorruption?: JsonFileStorageOptions['onCorruption'];

  constructor(filePath: string, options: JsonFileStorageOptions = {}) {
    this.filePath = resolve(filePath);
    this.onCorruption = options.onCorruption;
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
  }

  private async preserveCorruptedFile(): Promise<string> {
    const backupPath = `${this.filePath}.corrupt-${Date.now()}-${randomUUID()}.bak`;

    await copyFile(this.filePath, backupPath);

    return backupPath;
  }

  private async recoverData(error: Error): Promise<StorageData> {
    const backupPath = await this.preserveCorruptedFile();

    // Read failures must propagate instead of turning a readable history into an empty one.
    const content = await readFile(backupPath, 'utf-8');
    let recoveredData: StorageData = {
      usageEvents: [],
      operations: [],
    };

    try {
      const parsed: unknown = JSON.parse(content);

      if (typeof parsed === 'object' && parsed !== null) {
        const data = parsed as Record<string, unknown>;

        recoveredData = {
          usageEvents: Array.isArray(data.usageEvents) ? data.usageEvents.filter(isUsageEvent) : [],
          operations: Array.isArray(data.operations)
            ? data.operations.filter(isOperationRecord)
            : [],
        };
      }
    } catch {
      // Invalid JSON cannot be reliably recovered.
      // The original file is preserved in the backup.
    }

    await this.atomicWrite(recoveredData);

    try {
      this.onCorruption?.(error, backupPath);
    } catch {
      // A diagnostic callback must not interrupt storage recovery.
    }

    return structuredClone(recoveredData);
  }

  private async transact<T>(task: () => Promise<T>): Promise<T> {
    const key = process.platform === 'win32' ? this.filePath.toLowerCase() : this.filePath;
    const previous = transactions.get(key) ?? Promise.resolve();
    const transaction = previous
      .catch(() => undefined)
      .then(async () => {
        await this.ensureDirectory();
        const lock = this.filePath + '.lock';
        await writeFile(lock, '', { flag: 'wx' });
        try {
          return await task();
        } finally {
          await unlink(lock);
        }
      });
    transactions.set(key, transaction);
    try {
      return await transaction;
    } finally {
      if (transactions.get(key) === transaction) transactions.delete(key);
    }
  }

  async initialize(): Promise<void> {
    await this.transact(() => this.readData());
  }

  private async readData(): Promise<StorageData> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.atomicWrite(EMPTY_STORAGE);
      return structuredClone(EMPTY_STORAGE);
    }
    try {
      const data: unknown = JSON.parse(content);

      if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid TokenTrack storage file format');
      }

      const storage = data as Record<string, unknown>;

      if (!Array.isArray(storage.usageEvents) || !Array.isArray(storage.operations)) {
        throw new Error('Invalid TokenTrack storage file format');
      }

      const hasInvalidRecords =
        !storage.usageEvents.every(isUsageEvent) || !storage.operations.every(isOperationRecord);

      if (hasInvalidRecords) {
        throw new Error('Invalid records found in TokenTrack storage file');
      }

      return {
        usageEvents: storage.usageEvents,
        operations: storage.operations,
      } as StorageData;
    } catch (error) {
      const corruptionError =
        error instanceof Error ? error : new Error('Unknown TokenTrack storage corruption');

      return this.recoverData(corruptionError);
    }
  }

  async getUsageEvents(): Promise<UsageEvent[]> {
    return this.transact(async () => (await this.readData()).usageEvents);
  }

  async getOperations(): Promise<OperationRecord[]> {
    return this.transact(async () => (await this.readData()).operations);
  }

  private async atomicWrite(data: StorageData): Promise<void> {
    await this.ensureDirectory();

    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;

    try {
      await writeFile(temporaryPath, JSON.stringify(data, null, 2), 'utf-8');

      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async saveUsageEvent(event: UsageEvent): Promise<void> {
    return this.transact(async () => {
      if (!isUsageEvent(event)) throw new Error('Invalid TokenTrack usage event');

      const data = await this.readData();

      const index = data.usageEvents.findIndex((existing) => existing.id === event.id);

      if (index >= 0) {
        data.usageEvents[index] = structuredClone(event);
      } else {
        data.usageEvents.push(structuredClone(event));
      }

      await this.atomicWrite(data);
    });
  }

  async saveOperation(
    operation: OperationRecord,
    expectedStatus?: OperationRecord['status'],
  ): Promise<void> {
    return this.transact(async () => {
      if (!isOperationRecord(operation)) throw new Error('Invalid TokenTrack operation');

      const data = await this.readData();

      const index = data.operations.findIndex((existing) => existing.id === operation.id);
      if (expectedStatus !== undefined) {
        requireOperationStatus(data.operations[index], operation.id, expectedStatus);
      }

      if (index >= 0) {
        data.operations[index] = structuredClone(operation);
      } else {
        data.operations.push(structuredClone(operation));
      }

      await this.atomicWrite(data);
    });
  }

  async clear(): Promise<void> {
    return this.transact(async () => {
      await this.atomicWrite(EMPTY_STORAGE);
    });
  }
}
