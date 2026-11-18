
import type { OperationRecord } from '../storage/storage-adapter.js';

export interface OperationSummaryQuery {
  status?: OperationRecord['status'];
  parentOperationId?: string;
  startedAfter?: string;
  startedBefore?: string;
  page?: number;
  pageSize?: number;
}
