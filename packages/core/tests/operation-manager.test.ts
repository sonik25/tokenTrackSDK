import { MemoryStorage } from '../src/storage/memory-storage.js';
import { OperationManager } from '../src/operations/operation-manager.js';
import { OperationContext } from '../src/operations/operation-context.js';

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
  await expect(manager.fail('unknown-id')).rejects.toThrow(
    'Operation not found: unknown-id',
  );
});
});
