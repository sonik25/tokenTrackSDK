import { MemoryStorage } from '../src/storage/memory-storage.js';
import { OperationManager } from '../src/operations/operation-manager.js';
import { OperationContext } from '../src/operations/operation-context.js';
import type { UsageEvent } from '../src/types/usage-event.js';
import type { OperationRecord } from '../src/storage/storage-adapter.js';
import { UsageTracker } from '../src/tracking/usage-tracker.js';

describe('OperationManager', () => {
  let storage: MemoryStorage;
  let manager: OperationManager;
  let context: OperationContext;

  beforeEach(() => {
    storage = new MemoryStorage();
    context = new OperationContext();
    manager = new OperationManager(storage, context);
  });

  const createOperation = (overrides: Partial<OperationRecord> = {}): OperationRecord => ({
    id: 'operation-default',
    name: 'Default Operation',
    startedAt: '2026-11-18T10:00:00.000Z',
    status: 'completed',
    ...overrides,
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

  it('should return summaries for all operations', async () => {
    let parentId = '';
    let childId = '';

    await manager.run('parent-operation', async () => {
      parentId = context.getCurrentOperationId()!;

      childId = await manager.start('child-operation');
    });

    await storage.saveUsageEvent({
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
    });

    const summaries = await manager.getAllSummaries();

    expect(summaries).toHaveLength(2);

    const parentSummary = summaries.find((item) => item.operationId === parentId);
    const childSummary = summaries.find((item) => item.operationId === childId);

    expect(parentSummary?.usage.inputTokens).toBe(100);
    expect(parentSummary?.childOperationCount).toBe(1);

    expect(childSummary?.usage.inputTokens).toBe(100);
    expect(childSummary?.childOperationCount).toBe(0);
  });

  it('should return an empty array when no operations exist', async () => {
    const summaries = await manager.getAllSummaries();

    expect(summaries).toEqual([]);
  });

  it('should return summaries for direct child operations only', async () => {
    let parentId = '';
    let childId = '';
    let grandchildId = '';

    await manager.run('parent-operation', async () => {
      parentId = context.getCurrentOperationId()!;

      await manager.run('child-operation', async () => {
        childId = context.getCurrentOperationId()!;

        grandchildId = await manager.start('grandchild-operation');
      });
    });

    const childSummaries = await manager.getChildSummaries(parentId);

    expect(childSummaries).toHaveLength(1);
    expect(childSummaries[0].operationId).toBe(childId);
    expect(childSummaries[0].name).toBe('child-operation');
    expect(childSummaries.some((item) => item.operationId === grandchildId)).toBe(false);
  });

  it('should include descendant usage in direct child summaries', async () => {
    let parentId = '';
    let childId = '';
    let grandchildId = '';

    await manager.run('parent-operation', async () => {
      parentId = context.getCurrentOperationId()!;

      await manager.run('child-operation', async () => {
        childId = context.getCurrentOperationId()!;

        grandchildId = await manager.start('grandchild-operation');
      });
    });

    await storage.saveUsageEvent({
      id: 'event-grandchild',
      provider: 'openai',
      model: 'gpt-4o',
      operationId: grandchildId,
      timestamp: new Date().toISOString(),
      usage: {
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
      },
    });

    const childSummaries = await manager.getChildSummaries(parentId);

    expect(childSummaries).toHaveLength(1);
    expect(childSummaries[0].operationId).toBe(childId);
    expect(childSummaries[0].usage.inputTokens).toBe(200);
    expect(childSummaries[0].usage.outputTokens).toBe(100);
    expect(childSummaries[0].usageEventCount).toBe(1);
  });

  it('should throw an error when retrieving children of an unknown operation', async () => {
    await expect(manager.getChildSummaries('unknown-id')).rejects.toThrow(
      'Operation not found: unknown-id',
    );
  });

  describe('getSummaries', () => {
    it('should return the first page with default pagination settings', async () => {
      for (let index = 0; index < 25; index++) {
        await storage.saveOperation(
          createOperation({
            id: `operation-${index}`,
            name: `Operation ${index}`,
            startedAt: new Date(Date.UTC(2026, 10, 18, 10, index)).toISOString(),
          }),
        );
      }

      const result = await manager.getSummaries();

      expect(result.items).toHaveLength(20);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalItems).toBe(25);
      expect(result.totalPages).toBe(2);
      expect(result.hasNextPage).toBe(true);
      expect(result.hasPreviousPage).toBe(false);

      expect(result.items[0].operationId).toBe('operation-24');
      expect(result.items[19].operationId).toBe('operation-5');
    });

    it('should support custom page and page size', async () => {
      for (let index = 0; index < 5; index++) {
        await storage.saveOperation(
          createOperation({
            id: `custom-operation-${index}`,
            name: `Custom Operation ${index}`,
            startedAt: new Date(Date.UTC(2026, 10, 18, 10, index)).toISOString(),
          }),
        );
      }

      const result = await manager.getSummaries({
        page: 2,
        pageSize: 2,
      });

      expect(result.items).toHaveLength(2);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(2);
      expect(result.totalItems).toBe(5);
      expect(result.totalPages).toBe(3);
      expect(result.hasNextPage).toBe(true);
      expect(result.hasPreviousPage).toBe(true);

      expect(result.items[0].operationId).toBe('custom-operation-2');
      expect(result.items[1].operationId).toBe('custom-operation-1');
    });

    it('should filter summaries by operation status', async () => {
      await storage.saveOperation(
        createOperation({
          id: 'completed-operation',
          status: 'completed',
        }),
      );

      await storage.saveOperation(
        createOperation({
          id: 'failed-operation',
          status: 'failed',
        }),
      );

      await storage.saveOperation(
        createOperation({
          id: 'running-operation',
          status: 'running',
        }),
      );

      const result = await manager.getSummaries({
        status: 'failed',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].operationId).toBe('failed-operation');
      expect(result.items[0].status).toBe('failed');
      expect(result.totalItems).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('should filter summaries by parent operation ID', async () => {
      await storage.saveOperation(
        createOperation({
          id: 'parent-1',
          name: 'Parent 1',
        }),
      );

      await storage.saveOperation(
        createOperation({
          id: 'parent-2',
          name: 'Parent 2',
        }),
      );

      await storage.saveOperation(
        createOperation({
          id: 'child-1',
          name: 'Child 1',
          parentOperationId: 'parent-1',
        }),
      );

      await storage.saveOperation(
        createOperation({
          id: 'child-2',
          name: 'Child 2',
          parentOperationId: 'parent-2',
        }),
      );

      const result = await manager.getSummaries({
        parentOperationId: 'parent-1',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].operationId).toBe('child-1');
      expect(result.totalItems).toBe(1);
    });

    it('should filter summaries by start date range', async () => {
      await storage.saveOperation(
        createOperation({
          id: 'before-range',
          startedAt: '2026-11-17T10:00:00.000Z',
        }),
      );

      await storage.saveOperation(
        createOperation({
          id: 'inside-range-1',
          startedAt: '2026-11-18T10:00:00.000Z',
        }),
      );

      await storage.saveOperation(
        createOperation({
          id: 'inside-range-2',
          startedAt: '2026-11-19T10:00:00.000Z',
        }),
      );

      await storage.saveOperation(
        createOperation({
          id: 'after-range',
          startedAt: '2026-11-20T10:00:00.000Z',
        }),
      );

      const result = await manager.getSummaries({
        startedAfter: '2026-11-18T00:00:00.000Z',
        startedBefore: '2026-11-19T23:59:59.999Z',
      });

      expect(result.items).toHaveLength(2);
      expect(result.items.map((item) => item.operationId)).toEqual([
        'inside-range-2',
        'inside-range-1',
      ]);
      expect(result.totalItems).toBe(2);
    });

    it('should reject invalid pagination values', async () => {
      await expect(manager.getSummaries({ page: 0 })).rejects.toThrow(
        'Page must be a positive integer.',
      );

      await expect(manager.getSummaries({ page: 1.5 })).rejects.toThrow(
        'Page must be a positive integer.',
      );

      await expect(manager.getSummaries({ pageSize: 0 })).rejects.toThrow(
        'Page size must be between 1 and 100.',
      );

      await expect(manager.getSummaries({ pageSize: 101 })).rejects.toThrow(
        'Page size must be between 1 and 100.',
      );
    });

    it('should reject invalid date filters', async () => {
      await expect(
        manager.getSummaries({
          startedAfter: 'invalid-date',
        }),
      ).rejects.toThrow('startedAfter must be a valid date.');

      await expect(
        manager.getSummaries({
          startedBefore: 'invalid-date',
        }),
      ).rejects.toThrow('startedBefore must be a valid date.');

      await expect(
        manager.getSummaries({
          startedAfter: '2026-11-20T00:00:00.000Z',
          startedBefore: '2026-11-18T00:00:00.000Z',
        }),
      ).rejects.toThrow('startedAfter must be earlier than or equal to startedBefore.');
    });

    it('should return an empty result when requesting a page beyond available results', async () => {
      await storage.saveOperation(
        createOperation({
          id: 'operation-1',
        }),
      );

      const result = await manager.getSummaries({
        page: 3,
        pageSize: 1,
      });

      expect(result.items).toEqual([]);
      expect(result.page).toBe(3);
      expect(result.totalItems).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(true);
    });

    it('should apply filters before pagination', async () => {
      for (let index = 0; index < 5; index++) {
        await storage.saveOperation(
          createOperation({
            id: `completed-${index}`,
            status: 'completed',
            startedAt: new Date(Date.UTC(2026, 10, 18, 10, index)).toISOString(),
          }),
        );
      }

      await storage.saveOperation(
        createOperation({
          id: 'failed-1',
          status: 'failed',
        }),
      );

      const result = await manager.getSummaries({
        status: 'completed',
        page: 2,
        pageSize: 2,
      });

      expect(result.items).toHaveLength(2);
      expect(result.items.map((item) => item.operationId)).toEqual(['completed-2', 'completed-1']);
      expect(result.totalItems).toBe(5);
      expect(result.totalPages).toBe(3);
      expect(result.hasNextPage).toBe(true);
      expect(result.hasPreviousPage).toBe(true);
    });
  });

  it('should include tracked usage in the operation summary', async () => {
    const tracker = new UsageTracker(storage, context);

    let operationId = '';

    await manager.run('AI Request', async () => {
      operationId = context.getCurrentOperationId()!;

      await tracker.track({
        provider: 'openai',
        model: 'gpt-4o',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
      });
    });

    const summary = await manager.getSummary(operationId);

    expect(summary.operationId).toBe(operationId);
    expect(summary.name).toBe('AI Request');
    expect(summary.status).toBe('completed');
    expect(summary.usageEventCount).toBe(1);
    expect(summary.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
  });
});
