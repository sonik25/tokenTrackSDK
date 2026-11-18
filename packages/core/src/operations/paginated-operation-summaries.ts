import type { OperationSummary } from './operation-summary.js';

export interface PaginatedOperationSummaries {
  items: OperationSummary[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}
