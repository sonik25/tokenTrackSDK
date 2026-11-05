import type { UsageEvent } from '../src/types/usage-event.js';

describe('UsageEvent', () => {
  it('should represent an OpenAI usage event', () => {
    const event: UsageEvent = {
      id: 'event-001',
      provider: 'openai',
      model: 'gpt-4o',
      timestamp: '2026-11-05T12:00:00.000Z',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      },
    };

    expect(event.provider).toBe('openai');
    expect(event.usage.totalTokens).toBe(150);
  });

  it('should support estimated and reported costs', () => {
  const event: UsageEvent = {
    id: 'event-003',
    provider: 'openai',
    model: 'gpt-4o',
    timestamp: '2026-11-05T12:00:00.000Z',
    usage: {
      inputTokens: 100,
      outputTokens: 50,
    },
    cost: {
      estimatedCost: {
        amount: '0.002500',
        currency: 'USD',
        pricingVersion: '2026-11',
      },
      reportedCost: {
        amount: '0.003000',
        currency: 'USD',
        source: 'provider',
      },
    },
  };

  expect(event.cost?.estimatedCost?.amount).toBe('0.002500');
  expect(event.cost?.reportedCost?.amount).toBe('0.003000');
});

  it('should support optional request and operation metadata', () => {
    const event: UsageEvent = {
      id: 'event-002',
      provider: 'anthropic',
      model: 'claude-sonnet',
      timestamp: '2026-11-05T12:00:00.000Z',
      usage: {
        inputTokens: 200,
        outputTokens: 80,
      },
      requestId: 'request-123',
      operationId: 'operation-456',
      attemptNumber: 2,
      durationMs: 1200,
      streaming: true,
    };

    expect(event.operationId).toBe('operation-456');
    expect(event.attemptNumber).toBe(2);
    expect(event.streaming).toBe(true);
  });
});