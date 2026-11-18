import type { ModelPricing } from '../src/types/pricing.js';

describe('ModelPricing', () => {
  it('should support standard input and output pricing', () => {
    const pricing: ModelPricing = {
      provider: 'openai',
      model: 'gpt-4o',
      currency: 'USD',
      rates: {
        inputPerMillion: '2.50',
        outputPerMillion: '10.00',
      },
      pricingVersion: '2026-11',
    };

    expect(pricing.rates.inputPerMillion).toBe('2.50');
    expect(pricing.rates.outputPerMillion).toBe('10.00');
  });

  it('should support optional cached and reasoning pricing', () => {
    const pricing: ModelPricing = {
      provider: 'anthropic',
      model: 'claude-sonnet',
      currency: 'USD',
      rates: {
        inputPerMillion: '3.00',
        outputPerMillion: '15.00',
        cachedInputPerMillion: '0.30',
        cacheWriteInputPerMillion: '3.75',
        reasoningOutputPerMillion: '15.00',
      },
      pricingVersion: '2026-11',
      effectiveFrom: '2026-11-01',
    };

    expect(pricing.rates.cachedInputPerMillion).toBe('0.30');
    expect(pricing.rates.reasoningOutputPerMillion).toBe('15.00');
  });
});
