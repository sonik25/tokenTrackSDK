import type { CurrencyCode, MoneyAmount } from './money.js';

/**
 * Cost calculated using TokenTrack's pricing catalogue.
 */
export interface EstimatedCost {
  amount: MoneyAmount;
  currency: CurrencyCode;
  pricingVersion: string;
}

/**
 * Cost explicitly reported by the provider.
 */
export interface ReportedCost {
  amount: MoneyAmount;
  currency: CurrencyCode;
  source: string;
}

/**
 * Cost information associated with one usage event.
 */
export interface CostBreakdown {
  estimatedCost?: EstimatedCost;
  reportedCost?: ReportedCost;
}
