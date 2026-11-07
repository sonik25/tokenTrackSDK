import { calculateOperationSummary } from '../src/operations/operation-summary-calculator.js';
import type { OperationRecord } from '../src/storage/storage-adapter.js';
import type { UsageEvent } from '../src/types/usage-event.js';

describe('calculateOperationSummary', () => {
  const rootOperation: OperationRecord = {
    id: 'op-1',
    name: 'Checkout',
    startedAt: '2026-11-07T10:00:00.000Z',
    completedAt: '2026-11-07T10:00:05.000Z',
    status: 'completed',
  };

  const usageEvent: UsageEvent = {
    id: 'event-1',
    provider: 'openai',
    model: 'gpt-4o',
    timestamp: '2026-11-07T10:00:02.000Z',
    operationId: 'op-1',
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    },
  };

  it('should calculate a summary for an operation with its own usage', () => {
    const summary = calculateOperationSummary(rootOperation, [rootOperation], [usageEvent]);

    expect(summary.operationId).toBe('op-1');
    expect(summary.name).toBe('Checkout');
    expect(summary.status).toBe('completed');
    expect(summary.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
    expect(summary.usageEventCount).toBe(1);
    expect(summary.childOperationCount).toBe(0);
    expect(summary.durationMs).toBe(5000);
  });

  it('should include usage from all descendants in the parent summary', () => {
    const childOperation: OperationRecord = {
      id: 'op-2',
      name: 'Payment',
      startedAt: '2026-11-07T10:00:01.000Z',
      status: 'running',
      parentOperationId: 'op-1',
    };

    const grandchildOperation: OperationRecord = {
      id: 'op-3',
      name: 'Payment Provider',
      startedAt: '2026-11-07T10:00:02.000Z',
      status: 'running',
      parentOperationId: 'op-2',
    };

    const childEvent: UsageEvent = {
      ...usageEvent,
      id: 'event-2',
      operationId: 'op-2',
      usage: {
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
      },
    };

    const grandchildEvent: UsageEvent = {
      ...usageEvent,
      id: 'event-3',
      operationId: 'op-3',
      usage: {
        inputTokens: 300,
        outputTokens: 150,
        totalTokens: 450,
      },
    };

    const operations = [rootOperation, childOperation, grandchildOperation];
    const events = [usageEvent, childEvent, grandchildEvent];

    const summary = calculateOperationSummary(rootOperation, operations, events);

    expect(summary.usage).toEqual({
      inputTokens: 600,
      outputTokens: 300,
      totalTokens: 900,
    });

    expect(summary.usageEventCount).toBe(3);
    expect(summary.childOperationCount).toBe(1);
  });

  it('should exclude parent usage when calculating a child summary', () => {
    const childOperation: OperationRecord = {
      id: 'op-2',
      name: 'Payment',
      startedAt: '2026-11-07T10:00:01.000Z',
      status: 'running',
      parentOperationId: 'op-1',
    };

    const childEvent: UsageEvent = {
      ...usageEvent,
      id: 'event-2',
      operationId: 'op-2',
      usage: {
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
      },
    };

    const summary = calculateOperationSummary(
      childOperation,
      [rootOperation, childOperation],
      [usageEvent, childEvent],
    );

    expect(summary.operationId).toBe('op-2');
    expect(summary.usage).toEqual({
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
    });
    expect(summary.usageEventCount).toBe(1);
    expect(summary.childOperationCount).toBe(0);
  });

  it('should keep aggregated token fields undefined when any event has missing values', () => {
    const incompleteEvent: UsageEvent = {
      ...usageEvent,
      id: 'event-2',
      usage: {
        inputTokens: 200,
        // outputTokens and totalTokens are unknown
      },
    };

    const summary = calculateOperationSummary(
      rootOperation,
      [rootOperation],
      [usageEvent, incompleteEvent],
    );

    expect(summary.usage).toEqual({
      inputTokens: 300,
    });
  });

  it('should aggregate estimated costs by currency and pricing version', () => {
    const firstEvent: UsageEvent = {
      ...usageEvent,
      cost: {
        estimatedCost: {
          amount: '0.10',
          currency: 'USD',
          pricingVersion: 'v1',
        },
      },
    };

    const secondEvent: UsageEvent = {
      ...usageEvent,
      id: 'event-2',
      cost: {
        estimatedCost: {
          amount: '0.20',
          currency: 'USD',
          pricingVersion: 'v1',
        },
      },
    };

    const thirdEvent: UsageEvent = {
      ...usageEvent,
      id: 'event-3',
      cost: {
        estimatedCost: {
          amount: '0.30',
          currency: 'USD',
          pricingVersion: 'v2',
        },
      },
    };

    const summary = calculateOperationSummary(
      rootOperation,
      [rootOperation],
      [firstEvent, secondEvent, thirdEvent],
    );

    expect(summary.estimatedCosts).toEqual([
      {
        amount: '0.3',
        currency: 'USD',
        pricingVersion: 'v1',
      },
      {
        amount: '0.3',
        currency: 'USD',
        pricingVersion: 'v2',
      },
    ]);
  });

  it('should aggregate reported costs by currency and source', () => {
    const firstEvent: UsageEvent = {
      ...usageEvent,
      cost: {
        reportedCost: {
          amount: '0.10',
          currency: 'USD',
          source: 'provider',
        },
      },
    };

    const secondEvent: UsageEvent = {
      ...usageEvent,
      id: 'event-2',
      cost: {
        reportedCost: {
          amount: '0.20',
          currency: 'USD',
          source: 'provider',
        },
      },
    };

    const thirdEvent: UsageEvent = {
      ...usageEvent,
      id: 'event-3',
      cost: {
        reportedCost: {
          amount: '0.30',
          currency: 'USD',
          source: 'billing-api',
        },
      },
    };

    const summary = calculateOperationSummary(
      rootOperation,
      [rootOperation],
      [firstEvent, secondEvent, thirdEvent],
    );

    expect(summary.reportedCosts).toEqual([
      {
        amount: '0.3',
        currency: 'USD',
        source: 'provider',
      },
      {
        amount: '0.3',
        currency: 'USD',
        source: 'billing-api',
      },
    ]);
  });

  it('should preserve decimal precision when aggregating costs', () => {
    const firstEvent: UsageEvent = {
      ...usageEvent,
      cost: {
        estimatedCost: {
          amount: '0.1',
          currency: 'USD',
          pricingVersion: 'v1',
        },
      },
    };

    const secondEvent: UsageEvent = {
      ...usageEvent,
      id: 'event-2',
      cost: {
        estimatedCost: {
          amount: '0.2',
          currency: 'USD',
          pricingVersion: 'v1',
        },
      },
    };

    const summary = calculateOperationSummary(
      rootOperation,
      [rootOperation],
      [firstEvent, secondEvent],
    );

    expect(summary.estimatedCosts[0].amount).toBe('0.3');
  });

  it('should calculate operation duration in milliseconds', () => {
    const operation: OperationRecord = {
      id: 'op-duration',
      name: 'Test Operation',
      startedAt: '2026-11-07T10:00:00.000Z',
      completedAt: '2026-11-07T10:00:12.500Z',
      status: 'completed',
    };

    const summary = calculateOperationSummary(operation, [operation], []);

    expect(summary.durationMs).toBe(12500);
  });

  it('should leave duration undefined for a running operation', () => {
    const operation: OperationRecord = {
      id: 'op-running',
      name: 'Running Operation',
      startedAt: '2026-11-07T10:00:00.000Z',
      status: 'running',
    };

    const summary = calculateOperationSummary(operation, [operation], []);

    expect(summary.durationMs).toBeUndefined();
    expect(summary.completedAt).toBeUndefined();
  });

  it('should reject invalid estimated cost amounts', () => {
    const invalidEvent: UsageEvent = {
      ...usageEvent,
      cost: {
        estimatedCost: {
          amount: 'invalid',
          currency: 'USD',
          pricingVersion: 'v1',
        },
      },
    };

    expect(() => calculateOperationSummary(rootOperation, [rootOperation], [invalidEvent])).toThrow(
      'Invalid monetary amount: invalid',
    );
  });

  it('should reject aggregated token counts exceeding the safe integer limit', () => {
    const firstEvent: UsageEvent = {
      ...usageEvent,
      usage: {
        inputTokens: Number.MAX_SAFE_INTEGER,
      },
    };

    const secondEvent: UsageEvent = {
      ...usageEvent,
      id: 'event-2',
      usage: {
        inputTokens: 1,
      },
    };

    expect(() =>
      calculateOperationSummary(rootOperation, [rootOperation], [firstEvent, secondEvent]),
    ).toThrow('Aggregated token count exceeds the maximum safe integer.');
  });
});
