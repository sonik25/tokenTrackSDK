
import type { CurrencyCode, MoneyAmount } from './money.js';
import type { ProviderName } from './provider.js';

/**
 * Pricing rates are expressed per one million tokens.
 */
export interface ModelTokenPricing {
  /** Cost per million uncached input tokens. */
  inputPerMillion: MoneyAmount;

  /** Cost per million output tokens. */
  outputPerMillion: MoneyAmount;

  /** Optional cost per million cached input tokens. */
  cachedInputPerMillion?: MoneyAmount;

  /** Optional cost per million cache-write input tokens. */
  cacheWriteInputPerMillion?: MoneyAmount;

  /** Optional separate rate for reasoning output tokens. */
  reasoningOutputPerMillion?: MoneyAmount;
}

/**
 * Pricing configuration for one provider model.
 */
export interface ModelPricing {
  provider: ProviderName;

  /** Provider model identifier, e.g. gpt-4o. */
  model: string;

  currency: CurrencyCode;

  rates: ModelTokenPricing;

  /** Version or revision of this pricing entry. */
  pricingVersion: string;

  /** Date from which this pricing entry is effective (ISO 8601). */
  effectiveFrom?: string;
}

/**
 * Source of a pricing entry.
 */
export type PricingSource = 'builtin' | 'custom';
