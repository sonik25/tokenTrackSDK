import { MemoryStorage } from '../src/storage/memory-storage.js';
import type { UsageEvent } from '../src/types/usage-event.js';
import type { OperationRecord } from '../src/storage/storage-adapter.js';

describe('MemoryStorage', () => {
  let storage: MemoryStorage;

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
    name: 'chat-completion',
    startedAt: '2026-11-06T10:00:00.000Z',
    status: 'running',
  };

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('should save and retrieve usage events', async () => {
    await storage.saveUsageEvent(usageEvent);

    const events = await storage.getUsageEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(usageEvent);
  });

  it('should save and retrieve operations', async () => {
    await storage.saveOperation(operation);

    const operations = await storage.getOperations();

    expect(operations).toHaveLength(1);
    expect(operations[0]).toEqual(operation);
  });

  it('should update an existing usage event with the same ID', async () => {
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

    const events = await storage.getUsageEvents();

    expect(events).toHaveLength(1);
    expect(events[0].usage.inputTokens).toBe(200);
  });

  it('should update an existing operation with the same ID', async () => {
    await storage.saveOperation(operation);

    const updatedOperation: OperationRecord = {
      ...operation,
      status: 'completed',
      completedAt: '2026-11-06T10:01:00.000Z',
    };

    await storage.saveOperation(updatedOperation);

    const operations = await storage.getOperations();

    expect(operations).toHaveLength(1);
    expect(operations[0].status).toBe('completed');
  });

  it('should return empty arrays when storage is empty', async () => {
    expect(await storage.getUsageEvents()).toEqual([]);
    expect(await storage.getOperations()).toEqual([]);
  });

  it('should clear all stored records', async () => {
    await storage.saveUsageEvent(usageEvent);
    await storage.saveOperation(operation);

    await storage.clear();

    expect(await storage.getUsageEvents()).toEqual([]);
    expect(await storage.getOperations()).toEqual([]);
  });

  it('should protect stored records from external modifications', async () => {
    const mutableEvent = structuredClone(usageEvent);

    await storage.saveUsageEvent(mutableEvent);

    mutableEvent.usage.inputTokens = 999;

    const events = await storage.getUsageEvents();

    expect(events[0].usage.inputTokens).toBe(100);
  });
});
