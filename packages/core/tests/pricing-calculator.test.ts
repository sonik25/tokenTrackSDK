import { calculateEstimatedCost } from '../src/pricing/pricing-calculator.js';
import type { ModelPricing } from '../src/types/pricing.js';

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

describe('calculateEstimatedCost', () => {
  it('should calculate standard input and output costs', () => {
    const result = calculateEstimatedCost(
      {
        inputTokens: 1000,
        outputTokens: 500,
      },
      pricing,
    );

    expect(result?.amount).toBe('0.0075');
    expect(result?.currency).toBe('USD');
  });

  it('should return undefined when token usage is incomplete', () => {
    const result = calculateEstimatedCost(
      {
        inputTokens: 1000,
      },
      pricing,
    );

    expect(result).toBeUndefined();
  });

  it('should calculate cached input pricing separately', () => {
    const result = calculateEstimatedCost(
      {
        inputTokens: 1000,
        outputTokens: 500,
        inputTokenDetails: {
          cachedTokens: 400,
        },
      },
      {
        ...pricing,
        rates: {
          ...pricing.rates,
          cachedInputPerMillion: '1.00',
        },
      },
    );

    expect(result?.amount).toBe('0.0069');
  });

  it('should calculate reasoning output pricing separately', () => {
    const result = calculateEstimatedCost(
      {
        inputTokens: 1000,
        outputTokens: 500,
        outputTokenDetails: {
          reasoningTokens: 200,
        },
      },
      {
        ...pricing,
        rates: {
          ...pricing.rates,
          reasoningOutputPerMillion: '20.00',
        },
      },
    );

    expect(result?.amount).toBe('0.0095');
  });

  it('should reject invalid negative token counts', () => {
    expect(() =>
      calculateEstimatedCost(
        {
          inputTokens: -100,
          outputTokens: 50,
        },
        pricing,
      ),
    ).toThrow(RangeError);
  });

  it('should reject cached tokens exceeding input tokens', () => {
    expect(() =>
      calculateEstimatedCost(
        {
          inputTokens: 100,
          outputTokens: 50,
          inputTokenDetails: {
            cachedTokens: 150,
          },
        },
        pricing,
      ),
    ).toThrow(RangeError);
  });

  it('should preserve exact decimal arithmetic', () => {
    const result = calculateEstimatedCost(
      {
        inputTokens: 1,
        outputTokens: 1,
      },
      {
        ...pricing,
        rates: {
          inputPerMillion: '0.10',
          outputPerMillion: '0.20',
        },
      },
    );

    expect(result?.amount).toBe('0.0000003');
  });
});
