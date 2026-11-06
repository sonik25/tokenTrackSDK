import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { UsageEvent } from '../types/usage-event.js';
import type { OperationRecord, StorageAdapter } from './storage-adapter.js';

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

function isUsageEvent(value: unknown): value is UsageEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const event = value as Record<string, unknown>;

  return (
    typeof event.id === 'string' &&
    typeof event.provider === 'string' &&
    typeof event.model === 'string' &&
    typeof event.timestamp === 'string' &&
    typeof event.usage === 'object' &&
    event.usage !== null
  );
}

function isOperationRecord(value: unknown): value is OperationRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const operation = value as Record<string, unknown>;

  return (
    typeof operation.id === 'string' &&
    typeof operation.name === 'string' &&
    typeof operation.startedAt === 'string' &&
    ['running', 'completed', 'failed'].includes(operation.status as string)
  );
}

export class JsonFileStorage implements StorageAdapter {
  private readonly filePath: string;
  private readonly onCorruption?: JsonFileStorageOptions['onCorruption'];
  private writeQueue: Promise<void> = Promise.resolve();
  private initialization: Promise<void> | undefined;

  constructor(filePath: string, options: JsonFileStorageOptions = {}) {
    this.filePath = filePath;
    this.onCorruption = options.onCorruption;
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
  }

  private async preserveCorruptedFile(): Promise<string> {
    const backupPath = `${this.filePath}.corrupt-${Date.now()}-${randomUUID()}.bak`;

    await rename(this.filePath, backupPath);

    return backupPath;
  }

  private async recoverData(error: Error): Promise<StorageData> {
    const backupPath = await this.preserveCorruptedFile();

    let recoveredData: StorageData = {
      usageEvents: [],
      operations: [],
    };

    try {
      const content = await readFile(backupPath, 'utf-8');
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

  private enqueueWrite(task: () => Promise<void>): Promise<void> {
    const write = this.writeQueue.then(task);

    // Keep the queue usable even if one write fails.
    this.writeQueue = write.catch(() => undefined);

    return write;
  }

  async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initializeFile().catch((error: unknown) => {
        this.initialization = undefined;
        throw error;
      });
    }

    await this.initialization;
  }

  private async initializeFile(): Promise<void> {
    await this.ensureDirectory();

    try {
      await readFile(this.filePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }

      await writeFile(this.filePath, JSON.stringify(EMPTY_STORAGE, null, 2), 'utf-8');
    }
    // Read the data to ensure the file is valid and recover if necessary.
    await this.readData();
  }

  private async readData(): Promise<StorageData> {
    const content = await readFile(this.filePath, 'utf-8');
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
    await this.initialize();

    const data = await this.readData();

    return structuredClone(data.usageEvents);
  }

  async getOperations(): Promise<OperationRecord[]> {
    await this.initialize();

    const data = await this.readData();

    return structuredClone(data.operations);
    /*  
    structuredClone 
    It prevents callers from modifying the records inside the storage implementation through returned objects.

    For example, changing a retrieved event won't automatically change the data stored in the JSON file.
    */
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
    return this.enqueueWrite(async () => {
      await this.initialize();

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

  async saveOperation(operation: OperationRecord): Promise<void> {
    return this.enqueueWrite(async () => {
      await this.initialize();

      const data = await this.readData();

      const index = data.operations.findIndex((existing) => existing.id === operation.id);

      if (index >= 0) {
        data.operations[index] = structuredClone(operation);
      } else {
        data.operations.push(structuredClone(operation));
      }

      await this.atomicWrite(data);
    });
  }

  async clear(): Promise<void> {
    return this.enqueueWrite(async () => {
      await this.atomicWrite(EMPTY_STORAGE);
    });
  }
}
