
import type { CostBreakdown } from '../src/types/cost.js';

describe('CostBreakdown', () => {
  it('should support an estimated cost', () => {
    const cost: CostBreakdown = {
      estimatedCost: {
        amount: '0.002500',
        currency: 'USD',
        pricingVersion: '2026-11',
      },
    };

    expect(cost.estimatedCost?.amount).toBe('0.002500');
  });

  it('should support a provider-reported cost', () => {
    const cost: CostBreakdown = {
      reportedCost: {
        amount: '0.003000',
        currency: 'USD',
        source: 'provider',
      },
    };

    expect(cost.reportedCost?.amount).toBe('0.003000');
  });

  it('should support both cost sources independently', () => {
    const cost: CostBreakdown = {
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
    };

    expect(cost.estimatedCost?.amount).not.toBe(
      cost.reportedCost?.amount,
    );
  });
});
