import { MemoryStorage } from '../src/storage/memory-storage.js';
import { OperationManager } from '../src/operations/operation-manager.js';
import { OperationContext } from '../src/operations/operation-context.js';
import type { UsageEvent } from '../src/types/usage-event.js';

describe('OperationManager', () => {
  let storage: MemoryStorage;
  let manager: OperationManager;
  let context: OperationContext;

  beforeEach(() => {
    storage = new MemoryStorage();
    context = new OperationContext();
    manager = new OperationManager(storage, context);
  });

  it('should start a new operation', async () => {
    const operationId = await manager.start('test-operation');

    const operations = await storage.getOperations();

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      id: operationId,
      name: 'test-operation',
      status: 'running',
    });
    expect(operations[0].startedAt).toBeDefined();
  });

  it('should complete an operation', async () => {
    const operationId = await manager.start('test-operation');

    await manager.complete(operationId);

    const operations = await storage.getOperations();

    expect(operations[0].status).toBe('completed');
    expect(operations[0].completedAt).toBeDefined();
  });

  it('should fail an operation', async () => {
    const operationId = await manager.start('test-operation');

    await manager.fail(operationId);

    const operations = await storage.getOperations();

    expect(operations[0].status).toBe('failed');
    expect(operations[0].completedAt).toBeDefined();
  });

  it('should throw an error when completing an unknown operation', async () => {
    await expect(manager.complete('unknown-id')).rejects.toThrow('Operation not found: unknown-id');
  });

  it('should complete an operation after a successful callback', async () => {
    const result = await manager.run('successful-operation', async () => {
      return 'success';
    });

    const operations = await storage.getOperations();

    expect(result).toBe('success');
    expect(operations[0].status).toBe('completed');
  });

  it('should fail an operation when the callback throws an error', async () => {
    await expect(
      manager.run('failed-operation', async () => {
        throw new Error('Something went wrong');
      }),
    ).rejects.toThrow('Something went wrong');

    const operations = await storage.getOperations();

    expect(operations[0].status).toBe('failed');
  });

  it('should expose the active operation ID inside the callback', async () => {
    let activeOperationId: string | undefined;

    await manager.run('context-operation', async () => {
      activeOperationId = context.getCurrentOperationId();
    });

    const operations = await storage.getOperations();

    expect(activeOperationId).toBe(operations[0].id);
  });

  it('should link nested operations to their parent', async () => {
    await manager.run('parent-operation', async () => {
      await manager.run('child-operation', async () => {
        // Child operation runs inside the parent context.
      });
    });

    const operations = await storage.getOperations();

    const parent = operations.find((operation) => operation.name === 'parent-operation');

    const child = operations.find((operation) => operation.name === 'child-operation');

    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(child?.parentOperationId).toBe(parent?.id);
  });

  it('should execute callback even when operation storage fails', async () => {
    jest.spyOn(storage, 'saveOperation').mockRejectedValue(new Error('Storage unavailable'));

    const result = await manager.run('untracked-operation', async () => {
      return 'application-success';
    });

    expect(result).toBe('application-success');
  });

  it('should prevent completing an already completed operation', async () => {
    const operationId = await manager.start('test-operation');

    await manager.complete(operationId);

    await expect(manager.complete(operationId)).rejects.toThrow(
      `Operation is already completed: ${operationId}`,
    );
  });

  it('should throw an error when failing an unknown operation', async () => {
    await expect(manager.fail('unknown-id')).rejects.toThrow('Operation not found: unknown-id');
  });

  it('should return a summary for an existing operation', async () => {
    const operationId = await manager.start('test-operation');

    await manager.complete(operationId);

    const summary = await manager.getSummary(operationId);

    expect(summary).toMatchObject({
      operationId,
      name: 'test-operation',
      status: 'completed',
      usageEventCount: 0,
      childOperationCount: 0,
      estimatedCosts: [],
      reportedCosts: [],
    });
  });

  it('should include child operation usage in the parent summary', async () => {
    let parentId = '';
    let childId = '';

    await manager.run('parent-operation', async () => {
      parentId = context.getCurrentOperationId()!;

      childId = await manager.start('child-operation');
    });

    const usageEvent: UsageEvent = {
      id: 'event-1',
      provider: 'openai',
      model: 'gpt-4o',
      operationId: childId,
      timestamp: new Date().toISOString(),
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      },
    };

    await storage.saveUsageEvent(usageEvent);

    const summary = await manager.getSummary(parentId);

    expect(summary.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
    expect(summary.usageEventCount).toBe(1);
    expect(summary.childOperationCount).toBe(1);
  });

  it('should return an empty summary when no usage events exist', async () => {
    const operationId = await manager.start('empty-operation');

    const summary = await manager.getSummary(operationId);

    expect(summary.usageEventCount).toBe(0);
    expect(summary.usage).toEqual({});
    expect(summary.estimatedCosts).toEqual([]);
    expect(summary.reportedCosts).toEqual([]);
  });

  it('should throw an error when retrieving an unknown operation summary', async () => {
    await expect(manager.getSummary('unknown-id')).rejects.toThrow(
      'Operation not found: unknown-id',
    );
  });
});
