import { MemoryStorage } from '../src/storage/memory-storage.js';
import { OperationContext } from '../src/operations/operation-context.js';
import { UsageTracker } from '../src/tracking/usage-tracker.js';

describe('UsageTracker', () => {
  let storage: MemoryStorage;
  let context: OperationContext;
  let tracker: UsageTracker;

  beforeEach(() => {
    storage = new MemoryStorage();
    context = new OperationContext();
    tracker = new UsageTracker(storage, context);
  });

  it('should create and persist a usage event', async () => {
    const event = await tracker.track({
      provider: 'openai',
      model: 'gpt-4o',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      },
    });

    expect(event.id).toBeTruthy();
    expect(event.timestamp).toBeTruthy();
    expect(event.provider).toBe('openai');
    expect(event.model).toBe('gpt-4o');

    const savedEvents = await storage.getUsageEvents();

    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0]).toEqual(event);
  });

  it('should associate usage with the active operation', async () => {
    const event = await context.run('operation-123', () =>
      tracker.track({
        provider: 'anthropic',
        model: 'claude-sonnet',
        usage: {
          inputTokens: 200,
          outputTokens: 100,
        },
      }),
    );

    expect(event.operationId).toBe('operation-123');
  });

  it('should leave operationId undefined outside an operation', async () => {
    const event = await tracker.track({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      usage: {
        inputTokens: 300,
        outputTokens: 150,
      },
    });

    expect(event.operationId).toBeUndefined();
  });

  it('should preserve optional tracking metadata', async () => {
    const event = await tracker.track({
      provider: 'openai',
      model: 'gpt-4o',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
      },
      requestId: 'request-123',
      attemptNumber: 2,
      durationMs: 1200,
      streaming: true,
    });

    expect(event.requestId).toBe('request-123');
    expect(event.attemptNumber).toBe(2);
    expect(event.durationMs).toBe(1200);
    expect(event.streaming).toBe(true);
  });

  it('should preserve cost information', async () => {
    const cost = {
      estimatedCost: {
        amount: '0.002',
        currency: 'USD',
        pricingVersion: '2026-11',
      },
      reportedCost: {
        amount: '0.003',
        currency: 'USD',
        source: 'provider',
      },
    };

    const event = await tracker.track({
      provider: 'openai',
      model: 'gpt-4o',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
      },
      cost,
    });

    expect(event.cost).toEqual(cost);
  });

  it('should propagate storage errors', async () => {
    jest.spyOn(storage, 'saveUsageEvent').mockRejectedValue(new Error('Storage failed'));

    await expect(
      tracker.track({
        provider: 'openai',
        model: 'gpt-4o',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
        },
      }),
    ).rejects.toThrow('Storage failed');
  });
});
