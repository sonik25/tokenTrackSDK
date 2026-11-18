import type { EstimatedCost, ReportedCost } from '../types/cost.js';
import type { TokenUsage } from '../types/usage.js';
import type { OperationRecord } from '../storage/storage-adapter.js';

/**
 * Dynamically calculated summary of an application operation.
 */
export interface OperationSummary {
  operationId: string;
  name: string;
  status: OperationRecord['status'];
  startedAt: string;
  completedAt?: string;
  durationMs?: number;

  usage: TokenUsage;

  usageEventCount: number;
  childOperationCount: number;
  estimatedCosts: EstimatedCost[];
  reportedCosts: ReportedCost[];
}
