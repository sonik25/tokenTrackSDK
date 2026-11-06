import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { JsonFileStorage } from '../src/storage/json-file-storage.js';
import type { UsageEvent } from '../src/types/usage-event.js';
import type { OperationRecord } from '../src/storage/storage-adapter.js';

describe('JsonFileStorage', () => {
  let directory: string;
  let filePath: string;
  let storage: JsonFileStorage;

  const usageEvent: UsageEvent = {
    id: 'event-1',
    provider: 'openai',
    model: 'gpt-4o',
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    },
    timestamp: '2026-11-06T10:00:00.000Z',
  };

  const operation: OperationRecord = {
    id: 'operation-1',
    name: 'Generate summary',
    startedAt: '2026-11-06T10:00:00.000Z',
    status: 'completed',
    completedAt: '2026-11-06T10:00:05.000Z',
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tokentrack-test-'));
    filePath = join(directory, 'storage.json');
    storage = new JsonFileStorage(filePath);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('should create a storage file when it does not exist', async () => {
    await storage.initialize();

    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    expect(data).toEqual({
      usageEvents: [],
      operations: [],
    });
  });

  it('should save and retrieve usage events', async () => {
    await storage.saveUsageEvent(usageEvent);

    await expect(storage.getUsageEvents()).resolves.toEqual([usageEvent]);
  });

  it('should save and retrieve operations', async () => {
    await storage.saveOperation(operation);

    await expect(storage.getOperations()).resolves.toEqual([operation]);
  });

  it('should update an existing usage event instead of duplicating it', async () => {
    await storage.saveUsageEvent(usageEvent);

    const updatedEvent: UsageEvent = {
      ...usageEvent,
      usage: {
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
      },
    };

    await storage.saveUsageEvent(updatedEvent);

    await expect(storage.getUsageEvents()).resolves.toEqual([updatedEvent]);
  });

  it('should update an existing operation instead of duplicating it', async () => {
    await storage.saveOperation(operation);

    const updatedOperation: OperationRecord = {
      ...operation,
      status: 'failed',
    };

    await storage.saveOperation(updatedOperation);

    await expect(storage.getOperations()).resolves.toEqual([updatedOperation]);
  });

  it('should handle multiple concurrent usage event saves', async () => {
    const events = Array.from({ length: 10 }, (_, index) => ({
      ...usageEvent,
      id: `event-${index}`,
    }));

    await Promise.all(events.map((event) => storage.saveUsageEvent(event)));

    const savedEvents = await storage.getUsageEvents();

    expect(savedEvents).toHaveLength(10);
    expect(savedEvents.map((event) => event.id).sort()).toEqual(
      events.map((event) => event.id).sort(),
    );
  });

  it('should clear all stored records', async () => {
    await storage.saveUsageEvent(usageEvent);
    await storage.saveOperation(operation);

    await storage.clear();

    await expect(storage.getUsageEvents()).resolves.toEqual([]);
    await expect(storage.getOperations()).resolves.toEqual([]);
  });

  it('should return cloned data without exposing internal storage', async () => {
    await storage.saveUsageEvent(usageEvent);

    const events = await storage.getUsageEvents();
    events[0]!.usage.inputTokens = 999;

    await expect(storage.getUsageEvents()).resolves.toEqual([usageEvent]);
  });

  it('should preserve corrupted JSON and create fresh storage', async () => {
    const onCorruption = jest.fn();

    storage = new JsonFileStorage(filePath, { onCorruption });

    await storage.initialize();

    await writeFile(filePath, '{ invalid json', 'utf-8');

    await expect(storage.getUsageEvents()).resolves.toEqual([]);

    const files = await readdir(directory);
    const backupFile = files.find((file) => file.includes('.corrupt-'));

    expect(backupFile).toBeDefined();

    const backupContent = await readFile(join(directory, backupFile!), 'utf-8');

    expect(backupContent).toBe('{ invalid json');
    expect(onCorruption).toHaveBeenCalledTimes(1);
  });

  it('should recover valid records from structurally corrupted storage', async () => {
    const onCorruption = jest.fn();

    storage = new JsonFileStorage(filePath, { onCorruption });

    const validEvent: UsageEvent = {
      ...usageEvent,
      id: 'valid-event',
    };

    await writeFile(
      filePath,
      JSON.stringify({
        usageEvents: [validEvent, { id: 'invalid-event' }],
        operations: [operation],
      }),
      'utf-8',
    );

    await expect(storage.getUsageEvents()).resolves.toEqual([validEvent]);
    await expect(storage.getOperations()).resolves.toEqual([operation]);

    expect(onCorruption).toHaveBeenCalledTimes(1);
  });

  it('should not allow diagnostic callback errors to interrupt recovery', async () => {
    storage = new JsonFileStorage(filePath, {
      onCorruption: () => {
        throw new Error('Diagnostic callback failed');
      },
    });

    await storage.initialize();
    await writeFile(filePath, '{ invalid json', 'utf-8');

    await expect(storage.getUsageEvents()).resolves.toEqual([]);
  });

  it('should recover corrupted storage during initialization', async () => {
    const onCorruption = jest.fn();

    storage = new JsonFileStorage(filePath, { onCorruption });

    await writeFile(filePath, '{ broken json', 'utf-8');

    await storage.initialize();

    expect(onCorruption).toHaveBeenCalledTimes(1);

    await expect(storage.getUsageEvents()).resolves.toEqual([]);
    await expect(storage.getOperations()).resolves.toEqual([]);

    const content = await readFile(filePath, 'utf-8');

    expect(JSON.parse(content)).toEqual({
      usageEvents: [],
      operations: [],
    });
  });
});
