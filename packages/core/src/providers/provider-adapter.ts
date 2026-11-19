import type { ProviderName } from '../types/provider.js';
import type { TokenUsage } from '../types/usage.js';

/**
 * Normalizes provider-specific usage into TokenTrack's common format.
 */
export interface ProviderAdapter<TUsage = unknown> {
  /** AI provider handled by this adapter. */
  readonly provider: ProviderName;

  /** Converts provider-specific usage into normalized token usage. */
  normalizeUsage(usage: TUsage): TokenUsage;
}
