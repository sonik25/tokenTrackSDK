
import type { EstimatedCost } from '../types/cost.js';
import type { ModelPricing } from '../types/pricing.js';
import type { TokenUsage } from '../types/usage.js';

interface Decimal {
  coefficient: bigint;
  scale: number;
}

// const TOKENS_PER_MILLION = 1_000_000n;

function parseDecimal(value: string): Decimal {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    throw new TypeError(`Invalid monetary amount: ${value}`);
  }

  const [whole, fraction = ''] = value.split('.');

  return {
    coefficient: BigInt(whole + fraction),
    scale: fraction.length,
  };
}

function addDecimals(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);

  return {
    coefficient:
      a.coefficient * 10n ** BigInt(scale - a.scale) +
      b.coefficient * 10n ** BigInt(scale - b.scale),
    scale,
  };
}

function multiplyRateByTokens(rate: string, tokens: number): Decimal {
  const decimal = parseDecimal(rate);

  return {
    coefficient: decimal.coefficient * BigInt(tokens),
    scale: decimal.scale + 6,
  };
}

function formatDecimal(decimal: Decimal): string {
  let value = decimal.coefficient.toString();

  if (decimal.scale === 0) {
    return value;
  }

  value = value.padStart(decimal.scale + 1, '0');

  const whole = value.slice(0, -decimal.scale);
  const fraction = value
    .slice(-decimal.scale)
    .replace(/0+$/, '');

  return fraction ? `${whole}.${fraction}` : whole;
}

function validateTokenCount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer`);
  }
}

/**
 * Calculates estimated cost using provider model pricing.
 *
 * Returns undefined when input or output token counts are unknown.
 *
 * Cached input tokens are treated as a subset of input tokens.
 * Reasoning output tokens are treated as a subset of output tokens.
 */
export function calculateEstimatedCost(
  usage: TokenUsage,
  pricing: ModelPricing,
): EstimatedCost | undefined {
  const { inputTokens, outputTokens } = usage;

  // A complete estimate requires both input and output token counts.
  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }

  validateTokenCount(inputTokens, 'inputTokens');
  validateTokenCount(outputTokens, 'outputTokens');

  const cachedTokens = usage.inputTokenDetails?.cachedTokens ?? 0;
  const cacheWriteTokens =
    usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  const reasoningTokens =
    usage.outputTokenDetails?.reasoningTokens ?? 0;

  validateTokenCount(cachedTokens, 'cachedTokens');
  validateTokenCount(cacheWriteTokens, 'cacheWriteTokens');
  validateTokenCount(reasoningTokens, 'reasoningTokens');

  if (cachedTokens + cacheWriteTokens > inputTokens) {
    throw new RangeError(
      'Cached and cache-write tokens cannot exceed input tokens',
    );
  }

  if (reasoningTokens > outputTokens) {
    throw new RangeError(
      'Reasoning tokens cannot exceed output tokens',
    );
  }

  const rates = pricing.rates;

  const uncachedInputTokens =
    inputTokens - cachedTokens - cacheWriteTokens;

  const ordinaryOutputTokens = outputTokens - reasoningTokens;

  const components = [
    multiplyRateByTokens(rates.inputPerMillion, uncachedInputTokens),
    multiplyRateByTokens(
      rates.cachedInputPerMillion ?? rates.inputPerMillion,
      cachedTokens,
    ),
    multiplyRateByTokens(
      rates.cacheWriteInputPerMillion ?? rates.inputPerMillion,
      cacheWriteTokens,
    ),
    multiplyRateByTokens(
      rates.outputPerMillion,
      ordinaryOutputTokens,
    ),
    multiplyRateByTokens(
      rates.reasoningOutputPerMillion ?? rates.outputPerMillion,
      reasoningTokens,
    ),
  ];

  const total = components.reduce(addDecimals, {
    coefficient: 0n,
    scale: 0,
  });

  return {
    amount: formatDecimal(total),
    currency: pricing.currency,
    pricingVersion: pricing.pricingVersion,
  };
}
