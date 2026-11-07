import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Maintains the active TokenTrack operation ID across asynchronous calls.
 */
export class OperationContext {
  private readonly storage = new AsyncLocalStorage<string>();

  /**
   * Returns the ID of the currently active operation.
   */
  getCurrentOperationId(): string | undefined {
    return this.storage.getStore();
  }

  /**
   * Runs a callback within the context of an operation.
   */
  run<T>(operationId: string, callback: () => T): T {
    return this.storage.run(operationId, callback);
  }
}
