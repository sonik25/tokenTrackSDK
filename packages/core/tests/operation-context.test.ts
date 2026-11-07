import { OperationContext } from '../src/operations/operation-context.js';

describe('OperationContext', () => {
  let context: OperationContext;

  beforeEach(() => {
    context = new OperationContext();
  });

  it('should return undefined when no operation is active', () => {
    expect(context.getCurrentOperationId()).toBeUndefined();
  });

  it('should return the current operation ID inside run()', () => {
    const result = context.run('operation-123', () => {
      return context.getCurrentOperationId();
    });

    expect(result).toBe('operation-123');
  });

  it('should preserve context across asynchronous calls', async () => {
    await context.run('operation-async', async () => {
      await Promise.resolve();

      expect(context.getCurrentOperationId()).toBe('operation-async');
    });
  });

  it('should restore parent operation ID after a nested operation', () => {
    context.run('parent-operation', () => {
      expect(context.getCurrentOperationId()).toBe('parent-operation');

      context.run('child-operation', () => {
        expect(context.getCurrentOperationId()).toBe('child-operation');
      });

      expect(context.getCurrentOperationId()).toBe('parent-operation');
    });
  });

  it('should isolate concurrent operation contexts', async () => {
    const results = await Promise.all([
      context.run('operation-A', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return context.getCurrentOperationId();
      }),
      context.run('operation-B', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return context.getCurrentOperationId();
      }),
    ]);

    expect(results).toEqual(['operation-A', 'operation-B']);
  });
});
